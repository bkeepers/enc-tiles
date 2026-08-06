import s52, { colour, Mode } from "@enc-tiles/s52";
import type {
  BackgroundLayerSpecification,
  ExpressionFilterSpecification,
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
} from "maplibre-gl";
import { LookupEntry } from "@enc-tiles/dai";
import { instructionsToStyles } from "../instructions/index.js";
import * as filters from "../filters.js";
import { groupBy } from "../utils.js";

export type DisplayCategory = "DISPLAYBASE" | "STANDARD" | "OTHER";
export type TextGroup = "important" | "other";

export interface LayerConfig {
  mode: Mode;
  source: string;
  /** SHALLOW_CONTOUR: depth area colouring threshold (S-52 default: 2m) */
  shallowContour: number;
  /** SAFETY_CONTOUR: isolated danger and safety contour threshold (S-52 default: 30m) */
  safetyContour: number;
  /** DEEP_CONTOUR: depth area colouring threshold (S-52 default: 30m) */
  deepContour: number;
  /** SAFETY_DEPTH: sounding colour threshold (S-52 default: 30m) */
  safetyDepth: number;
  /**
   * SHALLOW_WATER_DANGERS (UDWHAZ05 Continuation A): also flag shoal hazards
   * whose *surrounding* water is shallower than the safety contour with
   * ISODGR01, instead of their ordinary DANGER01/DANGER02 symbol.
   *
   * The layers are generated either way -- this only decides whether they are
   * visible and whether they displace the ordinary symbol -- so layer ids stay
   * stable across the setting. S-52 default: off.
   */
  shallowWaterDangers?: boolean;
  boundaries?: BoundaryType;
  symbols?: SymbolType;
  /** Display categories to show. Omit to show all. */
  displayCategories?: Set<DisplayCategory>;
  /** Text groups to show. Omit to show all. */
  textGroups?: Set<TextGroup>;
}

/**
 * Extra, non-MapLibre keys a conditional symbology procedure may set on the
 * layers it returns. They are consumed and stripped by `lookupToLayers`.
 */
export interface CSPLayerExtras {
  /**
   * Restrict this layer to the listed S-57 object classes.
   *
   * One CSP can be referenced by look-up table entries for more than one class
   * -- CS(OBSTRN07) is shared by OBSTRN and UWTROC, which S-52 symbolizes
   * differently -- and the class is *not* recoverable from a MapLibre filter:
   * the tiler writes one source-layer per class and excludes OBJL, so the
   * class is the source-layer name rather than a feature property.
   * `lookupToLayers` knows the calling look-up's class, so the gate lives
   * there.
   */
  objectClasses?: string[];

  /**
   * Mark this layer as belonging to an optional layer family the frontend can
   * gate on its own. Surfaces as `metadata["s52:family"]`.
   */
  family?: LayerFamily;

  /**
   * Override the display category the look-up entry carries. UDWHAZ05 puts the
   * shallow-water dangers in a Standard viewing group even though the look-up
   * entries they come from are Display Base.
   */
  displayCategory?: DisplayCategory;

  /**
   * Drop the SCAMIN/SCAMAX scale filter for this layer, for the S-52 layers
   * specified with ScaleMinimum "infinite" (the isolated-danger symbols).
   */
  ignoreScamin?: boolean;
}

/** Optional layer families the frontend can show or hide independently. */
export type LayerFamily = "shallow-water-dangers";

export type CSPLayer = Partial<LayerSpecification> & CSPLayerExtras;

export enum BoundaryType {
  PLAIN = "plain",
  SYMBOLIZED = "symbolized",
}

export enum SymbolType {
  PAPER = "paper",
  SIMPLIFIED = "simplified",
}

const filterGeometryType: Record<LookupEntry["ftyp"], ExpressionSpecification> =
  {
    A: ["==", ["geometry-type"], "Polygon"],
    L: ["==", ["geometry-type"], "LineString"],
    P: ["==", ["geometry-type"], "Point"],
  };

export function build(config: LayerConfig): LayerSpecification[] {
  const lookupGroups = groupBy(getLookups(config), (lookup) => {
    return [lookup.obcl, lookup.tnam].join("|");
  });

  const layers: LayerSpecification[] = Object.values(lookupGroups).flatMap(
    (lookups) => {
      if (!lookups)
        throw new Error(
          "This should never happen but TypeScript insists it can.",
        );

      if (lookups.length <= 1) {
        return lookups.flatMap((l) => lookupToLayers(l, config));
      } else {
        return lookupGroupToLayers(lookups, config);
      }
    },
  );

  return [background(config), ...layers];
}

/**
 * 10.3.3.1 Look-Up Table Entry Matching
 *
 * > To find the symbology instruction for a specific object, enter the look-up table with the object's
 * > class code and gather all lines that contain [`objc`]. If only a single line is found,
 * > [`attc`] must be empty and the object is always shown with the same symbology
 * > regardless of its description.
 *
 * > If there is more than one line in the look-up table, search for the first line each of whose attribute
 * > values in [`attc`] can also be found in the attribute values of the object. If more than one attribute
 * > value is given in the look-up table, the match to the object must be exact, in order as well as
 * > content.
 */
export function lookupGroupToLayers(
  lookups: LookupEntry[],
  config: LayerConfig,
): LayerSpecification[] {
  // Per S-52 10.3.3.1, the fallback entry is the one with no attribute conditions.
  const fallbackIndex = lookups.findIndex((l) => l.attc.length === 0);
  const fallbackLookup =
    fallbackIndex >= 0 ? lookups[fallbackIndex] : lookups[0];
  const otherLookups = lookups.filter(
    (_, i) => i !== (fallbackIndex >= 0 ? fallbackIndex : 0),
  );

  const fallbackFilter: FilterSpecification = [
    "!",
    [
      "any",
      ...otherLookups.map((lookup) => {
        return filters.all(...filters.attributeFilters(lookup.attc));
      }),
    ],
  ];
  return [
    ...lookupToLayers(fallbackLookup!, config).map((layer) => ({
      ...layer,
      ...("filter" in layer
        ? {
            filter: filters.all(
              fallbackFilter,
              layer.filter as ExpressionFilterSpecification,
            ),
          }
        : {}),
    })),
    ...otherLookups.flatMap((l) => lookupToLayers(l, config)),
  ];
}

function lookupId(lookup: LookupEntry): string {
  const parts = [lookup.obcl, lookup.ftyp];
  if (lookup.attc.length > 0) {
    parts.push(lookup.attc.map((c) => `${c.attl}${c.attv ?? ""}`).join("_"));
  }
  return parts.join("-");
}

export function lookupToLayers(
  lookup: LookupEntry,
  config: LayerConfig,
): LayerSpecification[] {
  const baseId = lookupId(lookup);
  return instructionsToStyles(lookup.inst, config)
    .filter((layer) => {
      // Drop layers a CSP restricted to other object classes (see CSPLayerExtras).
      const { objectClasses } = layer as CSPLayer;
      return !objectClasses || objectClasses.includes(lookup.obcl);
    })
    .map((cspLayer, index) => {
      const {
        objectClasses: _objectClasses,
        family,
        displayCategory,
        ignoreScamin,
        ...layer
      } = cspLayer as CSPLayer;
      const visibility = layerVisibility(lookup, layer, config, {
        ...(family ? { family } : {}),
        ...(displayCategory ? { displayCategory } : {}),
      });

      // CSP layers can set source-layer to reference synthetic tile layers
      // (e.g. _LIGHTS_SECTORS). When present, skip the lookup-derived filter
      // since the synthetic layer has its own schema.
      const sourceLayer =
        (layer as LayerSpecification)["source-layer"] ?? lookup.obcl;
      const isSyntheticLayer = sourceLayer !== lookup.obcl;

      return {
        ...layer,
        metadata: {
          // Preserve any metadata the instruction/CSP set (e.g. "s52:display")
          // rather than replacing it wholesale.
          ...(layer.metadata as Record<string, unknown> | undefined),
          s52: lookup,
          ...(family ? { "s52:family": family } : {}),
          ...(displayCategory ? { "s52:disc": displayCategory } : {}),
        },
        ...(isSyntheticLayer
          ? {
              filter: filters.all(
                ...("filter" in layer
                  ? [layer.filter as ExpressionFilterSpecification]
                  : []),
              ),
            }
          : {
              filter: filters.all(
                ...(ignoreScamin ? [] : [filters.scaleFilter()]),
                filterGeometryType[lookup.ftyp],
                ...filters.attributeFilters(lookup.attc),
                ...("filter" in layer
                  ? [layer.filter as ExpressionFilterSpecification]
                  : []),
              ),
            }),
        layout: {
          ...layer.layout,
          [`${layer.type}-sort-key`]: sortKey(lookup.dpri, layer),
          ...(visibility === "none" ? { visibility } : {}),
        },
        source: "enc",
        "source-layer": sourceLayer,
        id: `${baseId}-${index}`,
      };
    });
}

function background({ mode }: LayerConfig): BackgroundLayerSpecification {
  return {
    id: "background",
    type: "background",
    paint: {
      "background-color": colour(mode, "NODTA"),
    },
  };
}

/**
 * From Section 12 (p 110):
 * > The ECDIS must provide the mariner with the ability to select between "paper chart" and "simplified" point
 * > symbols and also between "plain boundaries" and "symbolized boundaries" area symbols."
 */
export function getLookups({
  boundaries = BoundaryType.PLAIN,
  symbols = SymbolType.PAPER,
} = {}) {
  const sets = [
    "LINES",
    boundaries === BoundaryType.PLAIN
      ? "PLAIN_BOUNDARIES"
      : "SYMBOLIZED_BOUNDARIES",
    symbols === SymbolType.SIMPLIFIED ? "SIMPLIFIED" : "PAPER_CHART",
  ];

  return s52.lookups.filter((l) => sets.includes(l.tnam)) as LookupEntry[];
}

/**
 * Determine layer visibility based on display category and text group settings.
 */
function layerVisibility(
  lookup: LookupEntry,
  layer: Partial<LayerSpecification>,
  config: LayerConfig,
  extras: { family?: LayerFamily; displayCategory?: DisplayCategory } = {},
): "visible" | "none" {
  // Optional families are always generated so layer ids stay stable; the
  // matching option decides whether they are drawn.
  if (
    extras.family === "shallow-water-dangers" &&
    !config.shallowWaterDangers
  ) {
    return "none";
  }

  // Check display category. A CSP may override the look-up entry's own
  // category (see CSPLayerExtras.displayCategory).
  const disc = extras.displayCategory ?? lookup.disc;
  if (config.displayCategories && disc) {
    if (!config.displayCategories.has(disc as DisplayCategory)) {
      return "none";
    }
  }

  // Check text group
  const textDisplay = (layer as { metadata?: { "s52:display"?: string } })
    .metadata?.["s52:display"];
  if (config.textGroups && textDisplay) {
    const group: TextGroup = textDisplay === "50" ? "other" : "important";
    if (!config.textGroups.has(group)) {
      return "none";
    }
  }

  return "visible";
}

const TypePriority = { symbol: 1, line: 2, fill: 3 };

/**
 * Calculate a sort key for a layer based on its display priority and type. (Section 10.3.4.1, p 70)
 *
 * @returns a sort key number (0-99), higher numbers are drawn on top of lower numbers
 */
export function sortKey(
  priority: number,
  layer: Partial<LayerSpecification>,
): number {
  // Point objects on top of line objects on top of area objects
  let typePriority = TypePriority[layer.type!] ?? 0;
  // Text must be drawn last
  if (layer.layout?.["text-field"]) typePriority += 1;
  return priority * 10 + typePriority;
}
