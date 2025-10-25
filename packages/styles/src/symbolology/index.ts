import s52, { colours, Mode } from "@enc-tiles/s52";
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

export interface LayerConfig {
  mode: Mode;
  source: string;
  shallowDepth: number;
  safetyDepth: number;
  deepDepth: number;
  boundaries?: BoundaryType;
  symbols?: SymbolType;
}

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
        return lookups.flatMap(lookupToLayers);
      } else {
        return lookupGroupToLayers(lookups);
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
): LayerSpecification[] {
  const [fallbackLookup, ...otherLookups] = lookups;

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
    ...lookupToLayers(fallbackLookup!).map((layer) => ({
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
    ...otherLookups.flatMap(lookupToLayers),
  ];
}

let i = 0;

export function lookupToLayers(lookup: LookupEntry): LayerSpecification[] {
  return instructionsToStyles(lookup.inst).map((layer) => {
    return {
      ...layer,
      metadata: {
        s52: lookup,
      },
      filter: filters.all(
        filters.scaleFilter(),
        filterGeometryType[lookup.ftyp],
        ...filters.attributeFilters(lookup.attc),
        ...("filter" in layer
          ? [layer.filter as ExpressionFilterSpecification]
          : []),
      ),
      layout: {
        ...layer.layout,
        [`${layer.type}-sort-key`]: sortKey(lookup.dpri, layer),
      },
      source: "enc",
      "source-layer": lookup.obcl,
      id: [i++, lookup.obcl, lookup.ftyp].join("-"),
    };
  });
}

function background({ mode }: LayerConfig): BackgroundLayerSpecification {
  return {
    id: "background",
    type: "background",
    paint: {
      "background-color": colours[mode].NODTA,
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
