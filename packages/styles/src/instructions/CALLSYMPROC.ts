import {
  ExpressionFilterSpecification,
  ExpressionSpecification,
  LayerSpecification,
} from "maplibre-gl";
import { Reference } from "./parser.js";
import { colour, symbols } from "@enc-tiles/s52";
import { LineStyles } from "./SHOWLINE.js";
import {
  listContains,
  listIncludes,
  quaposLowQuality,
  scaleFilter,
} from "../filters.js";
import type { CSPLayer, LayerConfig } from "../symbolology/index.js";

const procs = {
  DEPARE03,
  DEPCNT03,
  LIGHTS06,
  OBSTRN07,
  QUAPOS01,
  RESARE04,
  RESTRN01,
  SLCONS04,
  SOUNDG03,
  TOPMAR01,
  WRECKS05,
};

/** Get the pivot offset for a symbol, cast to the tuple type MapLibre expects. */
function symbolOffset(name: string): [number, number] {
  return (symbols[name]?.offset ?? [0, 0]) as [number, number];
}

/**
 * Standard icon layout properties for a symbol used in a CSP.
 *
 * Looks up the symbol's pivot offset from the sprite metadata so the icon
 * renders at the correct position relative to the feature point — matching
 * what `SY()` does for lookup-table-driven symbols.
 *
 * Accepts a static symbol name, a `["case", ...]`, or `["match", ...]`
 * expression for data-driven icon selection. Builds a parallel offset
 * expression that mirrors each branch.
 */
function iconLayout(
  image: string | ExpressionSpecification,
): Record<string, unknown> {
  if (typeof image === "string") {
    return {
      "icon-image": image,
      "icon-offset": symbolOffset(image),
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    };
  }

  const op = image[0] as string;

  if (op === "case") {
    // ["case", cond1, name1, cond2, name2, ..., default]
    const [, ...branches] = image;
    const offsetBranches: unknown[] = [];
    for (let i = 0; i < branches.length - 1; i += 2) {
      offsetBranches.push(branches[i]); // condition
      offsetBranches.push(["literal", symbolOffset(branches[i + 1] as string)]);
    }
    offsetBranches.push([
      "literal",
      symbolOffset(branches[branches.length - 1] as string),
    ]);

    return {
      "icon-image": image,
      "icon-offset": ["case", ...offsetBranches] as ExpressionSpecification,
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    };
  }

  if (op === "match") {
    // ["match", input, val1, name1, val2, name2, ..., default]
    const [, input, ...branches] = image;
    const offsetBranches: unknown[] = [];
    for (let i = 0; i < branches.length - 1; i += 2) {
      offsetBranches.push(branches[i]); // match value
      offsetBranches.push(["literal", symbolOffset(branches[i + 1] as string)]);
    }
    offsetBranches.push([
      "literal",
      symbolOffset(branches[branches.length - 1] as string),
    ]);

    return {
      "icon-image": image,
      "icon-offset": [
        "match",
        input,
        ...offsetBranches,
      ] as ExpressionSpecification,
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    };
  }

  // Fallback: unknown expression type, no offset
  return {
    "icon-image": image,
    "icon-allow-overlap": true,
    "icon-ignore-placement": true,
  };
}

export function CS(config: LayerConfig, ref: Reference) {
  if (ref.name in procs) {
    return procs[ref.name](config);
  } else {
    console.warn(`CS(${ref.name}) not implemented yet`);
  }
}

/** DEPARE03 - 13.2.1 Depth area colour fill and dredged area pattern fill */
export function DEPARE03(config: LayerConfig): Partial<LayerSpecification>[] {
  return [
    {
      type: "fill",
      paint: {
        "fill-color": [
          "let",
          "drval1",
          ["coalesce", ["get", "DRVAL1"], -1],
          [
            "let",
            "drval2",
            ["coalesce", ["get", "DRVAL2"], ["+", ["var", "drval1"], 0.01]],
            SEABED01(config),
          ],
        ],
        // TODO: shallow pattern
        // 'fill-pattern': DIAMOND1
      },
    },
  ];
}

/** DEPCNT03 - 13.2.2 Depth contours, including safety contour */
export function DEPCNT03(config: LayerConfig): Partial<LayerSpecification>[] {
  // MapLibre doesn't support data expressions in `line-dasharray`, so split into two layers with filters.
  const lowQuality = quaposLowQuality();
  const depcn = colour(config.mode, "DEPCN");
  const isSafetyContour: ExpressionFilterSpecification = [
    "all",
    ["has", "VALDCO"],
    ["==", ["get", "VALDCO"], config.safetyContour],
  ];
  return [
    // Normal depth contours (non-safety)
    {
      type: "line",
      filter: ["all", lowQuality, ["!", isSafetyContour]],
      paint: {
        "line-dasharray": LineStyles.DASH,
        "line-width": 1,
        "line-color": depcn,
      },
    },
    {
      type: "line",
      filter: ["all", ["!", lowQuality], ["!", isSafetyContour]],
      paint: {
        "line-width": 1,
        "line-color": depcn,
      },
    },

    // Safety contour: LS(SOLD,3,DEPSC) per S-52 10.5.11, Display Base priority 8
    {
      type: "line",
      filter: ["all", isSafetyContour, ["!", lowQuality]],
      paint: {
        "line-width": 3,
        "line-color": colour(config.mode, "DEPSC"),
      },
    },
    // Safety contour with low quality position → dashed
    {
      type: "line",
      filter: ["all", isSafetyContour, lowQuality],
      paint: {
        "line-dasharray": LineStyles.DASH,
        "line-width": 3,
        "line-color": colour(config.mode, "DEPSC"),
      },
    },

    {
      type: "symbol",
    },
    // TODO: add user pref to display contour labels
    ...SAFECON01(config),
  ];
}

/** TODO: DEPVAL02 - 13.2.3 Depth value */
/**
 * LIGHTS06 - 13.2.4 Light flares, light sectors & light coverage
 * (S-52 PresLib 4.0, section 13.2.4)
 *
 * Applies to S-57 object class LIGHTS (point only).
 * Attributes: COLOUR (list), CATLIT (list), SECTR1, SECTR2, ORIENT,
 *             VALNMR, LITCHR, LITVIS, SIGGRP, SIGPER, HEIGHT, STATUS
 *
 * This is the most complex CSP. This implementation covers:
 *   - Floodlights/spotlights (CATLIT 8,11) → LIGHTS82
 *   - Strip lights (CATLIT 9) → LIGHTS81
 *   - Directional lights (CATLIT 1,16) with ORIENT → oriented flare
 *   - Non-sector lights → flare symbol by COLOUR (LIGHTS11/12/13)
 *   - Light description text (LITDSN02): CATLIT prefix + LITCHR + SIGGRP +
 *     COLOUR + SIGPER + HEIGHT + VALNMR + STATUS suffix
 *
 * Sector arcs and leg lines are pre-computed as LineString geometries in the
 * pipeline (bin/generate-sector-arcs) and stored in the _LIGHTS_SECTORS tile
 * layer. This CSP emits MapLibre line layers referencing that synthetic layer.
 *
 * Co-located light detection is pre-computed in the pipeline:
 *   - _EXTENDED_ARC: sector lights with overlapping sectors use 25mm arc radius
 *   - _COLOCATED: non-sector lights at the same position offset flare angles
 *
 * TODO: Major light circles (VALNMR >= 10)
 */
export function LIGHTS06(config: LayerConfig): Partial<LayerSpecification>[] {
  // Colour → flare symbol mapping (S-52 spec table)
  // COLOUR is a list attribute stored as a comma-separated string
  const flareSymbol: ExpressionSpecification = [
    "case",
    // Red (includes white+red, since red takes priority) → LIGHTS11 (red flare)
    listIncludes("COLOUR", "3"),
    "LIGHTS11",
    // Green or white+green → LIGHTS12 (green flare)
    listIncludes("COLOUR", "4"),
    "LIGHTS12",
    // Yellow, orange, white, blue+yellow → LIGHTS13 (yellow flare)
    [
      "any",
      listIncludes("COLOUR", "6"),
      listIncludes("COLOUR", "11"),
      listIncludes("COLOUR", "1"),
    ],
    "LIGHTS13",
    // Default → LITDEF11
    "LITDEF11",
  ];

  const flareLayout = iconLayout(flareSymbol);

  return [
    // --- Special light types (checked first, exit early per spec) ---

    // Floodlight (CATLIT 8) or spotlight (CATLIT 11)
    {
      type: "symbol",
      filter: [
        "all",
        ["has", "CATLIT"],
        ["any", listIncludes("CATLIT", "8"), listIncludes("CATLIT", "11")],
      ] as ExpressionFilterSpecification,
      layout: iconLayout("LIGHTS82"),
    },

    // Strip light (CATLIT 9)
    {
      type: "symbol",
      filter: [
        "all",
        ["has", "CATLIT"],
        listIncludes("CATLIT", "9"),
        ["!", listIncludes("CATLIT", "8")],
        ["!", listIncludes("CATLIT", "11")],
      ] as ExpressionFilterSpecification,
      layout: iconLayout("LIGHTS81"),
    },

    // --- Directional lights (CATLIT 1 or 16) with ORIENT ---
    {
      type: "symbol",
      filter: [
        "all",
        ["has", "CATLIT"],
        ["any", listIncludes("CATLIT", "1"), listIncludes("CATLIT", "16")],
        ["has", "ORIENT"],
        // Exclude flood/spot/strip
        ["!", listIncludes("CATLIT", "8")],
        ["!", listIncludes("CATLIT", "9")],
        ["!", listIncludes("CATLIT", "11")],
      ] as ExpressionFilterSpecification,
      layout: {
        ...flareLayout,
        // ORIENT is from seaward, rotate flare to show direction of light
        "icon-rotate": ["+", ["get", "ORIENT"], 180],
      },
    },

    // Directional light bearing text: "nnn deg"
    {
      type: "symbol",
      filter: [
        "all",
        ["has", "CATLIT"],
        ["any", listIncludes("CATLIT", "1"), listIncludes("CATLIT", "16")],
        ["has", "ORIENT"],
        ["!", listIncludes("CATLIT", "8")],
        ["!", listIncludes("CATLIT", "9")],
        ["!", listIncludes("CATLIT", "11")],
      ] as ExpressionFilterSpecification,
      layout: {
        "text-field": [
          "concat",
          ["number-format", ["get", "ORIENT"], { "max-fraction-digits": 1 }],
          " deg",
        ] as unknown as ExpressionSpecification,
        "text-font": ["Metropolis Regular"],
        "text-size": 10,
        "text-offset": [0, -1.5],
        "text-anchor": "bottom",
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": colour(config.mode, "CHBLK"),
        "text-halo-color": colour(config.mode, "NODTA"),
        "text-halo-width": 1,
      },
      metadata: { "s52:display": "23" },
    },

    // --- Non-sector, non-special lights → flare symbol ---
    // When co-located with other non-sector lights (_COLOCATED=1), the flare
    // angle is offset: white/yellow/orange → 45°, red/green/other → 135°.
    // This separates overlapping flare symbols visually.
    {
      type: "symbol",
      filter: [
        "all",
        // Exclude special types handled above
        [
          "any",
          ["!", ["has", "CATLIT"]],
          [
            "all",
            ["!", listIncludes("CATLIT", "8")],
            ["!", listIncludes("CATLIT", "9")],
            ["!", listIncludes("CATLIT", "11")],
            ["!", listIncludes("CATLIT", "1")],
            ["!", listIncludes("CATLIT", "16")],
          ],
        ],
        // Exclude sector lights (have both SECTR1 and SECTR2)
        ["any", ["!", ["has", "SECTR1"]], ["!", ["has", "SECTR2"]]],
      ] as ExpressionFilterSpecification,
      layout: {
        ...flareLayout,
        "icon-rotate": [
          "case",
          // Not co-located → default orientation (no rotation)
          ["!=", ["get", "_COLOCATED"], 1],
          0,
          // Co-located: white(1), yellow(6), orange(11) → 45°
          [
            "any",
            listIncludes("COLOUR", "1"),
            listIncludes("COLOUR", "6"),
            listIncludes("COLOUR", "11"),
          ],
          45,
          // Co-located: red, green, other → 135°
          135,
        ] as ExpressionSpecification,
      },
    },

    // --- Sector lights: flare symbol for each sector ---
    {
      type: "symbol",
      filter: [
        "all",
        ["has", "SECTR1"],
        ["has", "SECTR2"],
        // Exclude special types
        [
          "any",
          ["!", ["has", "CATLIT"]],
          [
            "all",
            ["!", listIncludes("CATLIT", "8")],
            ["!", listIncludes("CATLIT", "9")],
            ["!", listIncludes("CATLIT", "11")],
            ["!", listIncludes("CATLIT", "1")],
            ["!", listIncludes("CATLIT", "16")],
          ],
        ],
      ] as ExpressionFilterSpecification,
      layout: flareLayout,
    },

    // --- Sector arcs and leg lines (from _LIGHTS_SECTORS synthetic layer) ---
    // Arc OUTLW underlay: solid 4-wide outline behind the coloured arc
    ...sectorArcLayers(config),

    // --- Light description text (LITDSN02) ---
    ...LITDSN02(config),
  ];
}

/**
 * Sector arc and leg line layers from the pre-computed _LIGHTS_SECTORS layer.
 *
 * The pipeline (bin/generate-sector-arcs) produces LineString features with:
 *   _type: "arc" | "leg"
 *   _colour: S-52 colour token (LITRD, LITGN, LITYW, CHMGD)
 *   _style: "SOLD" | "DASH"
 *   _width: line width (1 or 2)
 *
 * Per S-52, arcs are drawn as two layers: a 4-wide OUTLW underlay for contrast,
 * then the coloured arc on top. Obscured/faint lights (LITVIS 3,7,8) use a
 * 1-wide dashed CHBLK line instead of the two-layer approach.
 *
 * Leg lines are always LS(DASH,1,CHBLK).
 */
function sectorArcLayers(config: LayerConfig): Partial<LayerSpecification>[] {
  const { mode } = config;

  // Map _colour attribute to actual colour values for data-driven styling
  const arcColour: ExpressionSpecification = [
    "match",
    ["get", "_colour"],
    "LITRD",
    colour(mode, "LITRD"),
    "LITGN",
    colour(mode, "LITGN"),
    "LITYW",
    colour(mode, "LITYW"),
    colour(mode, "CHMGD"),
  ];

  const scale = scaleFilter();

  return [
    // Arc OUTLW underlay (solid arcs only — obscured arcs skip the underlay)
    {
      type: "line",
      "source-layer": "_LIGHTS_SECTORS",
      filter: [
        "all",
        scale,
        ["==", ["get", "_type"], "arc"],
        ["==", ["get", "_style"], "SOLD"],
      ],
      paint: {
        "line-color": colour(mode, "OUTLW"),
        "line-width": 4,
      },
    } as Partial<LayerSpecification>,

    // Coloured arc (solid, 2-wide)
    {
      type: "line",
      "source-layer": "_LIGHTS_SECTORS",
      filter: [
        "all",
        scale,
        ["==", ["get", "_type"], "arc"],
        ["==", ["get", "_style"], "SOLD"],
      ],
      paint: {
        "line-color": arcColour,
        "line-width": 2,
      },
    } as Partial<LayerSpecification>,

    // Obscured/faint arc (dashed, 1-wide, CHBLK)
    {
      type: "line",
      "source-layer": "_LIGHTS_SECTORS",
      filter: [
        "all",
        scale,
        ["==", ["get", "_type"], "arc"],
        ["==", ["get", "_style"], "DASH"],
      ],
      paint: {
        "line-color": colour(mode, "CHBLK"),
        "line-width": 1,
        "line-dasharray": LineStyles.DASH,
      },
    } as Partial<LayerSpecification>,

    // Leg lines (always dashed CHBLK)
    {
      type: "line",
      "source-layer": "_LIGHTS_SECTORS",
      filter: ["all", scale, ["==", ["get", "_type"], "leg"]],
      paint: {
        "line-color": colour(mode, "CHBLK"),
        "line-width": 1,
        "line-dasharray": LineStyles.DASH,
      },
    } as Partial<LayerSpecification>,
  ];
}

/**
 * LITDSN02 - 10.6.3 Light description text string
 * (S-52 PresLib 4.0, section 10.6.3)
 *
 * Builds the standard light description from S-57 attributes:
 *   LITCHR + SIGGRP + COLOUR + SIGPER + HEIGHT + VALNMR + STATUS
 *   e.g. "Fl(2) WR 10s 15m 15M"
 *
 * LITCHR and SIGPER are scalar. COLOUR, CATLIT, STATUS are list attributes
 * stored as comma-separated strings. SIGGRP is a string like "(2)" or "(2+1)".
 */
function LITDSN02(config: LayerConfig): Partial<LayerSpecification>[] {
  const { mode } = config;

  // LITCHR code → abbreviation (S-57 attribute enumeration)
  const litchrAbbrev: ExpressionSpecification = [
    "match",
    ["get", "LITCHR"],
    1,
    "F",
    2,
    "Fl",
    3,
    "LFl",
    4,
    "Q",
    5,
    "VQ",
    6,
    "UQ",
    7,
    "Iso",
    8,
    "Oc",
    9,
    "IQ",
    10,
    "IVQ",
    11,
    "IUQ",
    12,
    "Mo",
    13,
    "FFl",
    14,
    "Fl+LFl",
    15,
    "OcFl",
    16,
    "FLFl",
    17,
    "AlOc",
    18,
    "AlLFl",
    19,
    "AlFl",
    20,
    "Al",
    25,
    "Q+LFl",
    26,
    "VQ+LFl",
    27,
    "UQ+LFl",
    28,
    "Al",
    29,
    "AlFFl",
    "",
  ];

  // COLOUR abbreviations for lights via list membership on the JSON array
  // COLOUR is stored as e.g. '["1","3"]' for white+red
  const colourAbbrev: ExpressionSpecification = [
    "concat",
    ["case", listContains("COLOUR", "1"), "W", ""],
    ["case", listContains("COLOUR", "3"), "R", ""],
    ["case", listContains("COLOUR", "4"), "G", ""],
    ["case", listContains("COLOUR", "6"), "Y", ""],
    ["case", listContains("COLOUR", "11"), "Y", ""],
    ["case", listContains("COLOUR", "5"), "Bu", ""],
    ["case", listContains("COLOUR", "10"), "Vi", ""],
  ];

  // CATLIT prefix (directional, aeronautical, fog detector)
  const catlitPrefix: ExpressionSpecification = [
    "case",
    ["!", ["has", "CATLIT"]],
    "",
    listContains("CATLIT", "1"),
    "Dir ",
    listContains("CATLIT", "5"),
    "Aero ",
    listContains("CATLIT", "7"),
    "Fog Det Lt ",
    "",
  ];

  // STATUS suffix
  const statusSuffix: ExpressionSpecification = [
    "case",
    ["!", ["has", "STATUS"]],
    "",
    listContains("STATUS", "2"),
    "(occas)",
    listContains("STATUS", "7"),
    "(temp)",
    listContains("STATUS", "8"),
    "(priv)",
    listContains("STATUS", "11"),
    "(exting)",
    listContains("STATUS", "17"),
    "(U)",
    "",
  ];

  // Build the full description string
  const textField: ExpressionSpecification = [
    "concat",
    // CATLIT prefix (e.g. "Dir ")
    catlitPrefix,
    // Light characteristic (e.g. "Fl")
    ["case", ["has", "LITCHR"], litchrAbbrev, ""],
    // Signal group (e.g. "(2)") — SIGGRP is a string attribute
    ["case", ["has", "SIGGRP"], ["get", "SIGGRP"], ""],
    // Space + colour abbreviations
    ["case", ["has", "COLOUR"], ["concat", " ", colourAbbrev], ""],
    // Space + signal period in seconds
    [
      "case",
      ["has", "SIGPER"],
      ["concat", " ", ["number-format", ["get", "SIGPER"], {}], "s"],
      "",
    ],
    // Space + height in metres
    [
      "case",
      ["has", "HEIGHT"],
      [
        "concat",
        " ",
        ["number-format", ["get", "HEIGHT"], { "max-fraction-digits": 0 }],
        "m",
      ],
      "",
    ],
    // Space + nominal range in nautical miles
    [
      "case",
      ["has", "VALNMR"],
      [
        "concat",
        " ",
        ["number-format", ["get", "VALNMR"], { "max-fraction-digits": 0 }],
        "M",
      ],
      "",
    ],
    // STATUS suffix (e.g. "(temp)")
    statusSuffix,
  ];

  return [
    {
      type: "symbol",
      layout: {
        "text-field": textField,
        "text-font": ["Metropolis Regular"],
        "text-size": 10,
        "text-offset": [2, 0],
        "text-anchor": "left",
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": colour(mode, "CHBLK"),
        "text-halo-color": colour(mode, "NODTA"),
        "text-halo-width": 1,
      },
      metadata: { "s52:display": "23" },
    },
  ];
}
/**
 * OBSTRN07 - 13.2.5 Obstructions and rocks (S-52 PresLib 4.0, section 13.2.5)
 *
 * Applies to S-57 object classes OBSTRN (obstruction) and UWTROC (underwater rock).
 * Attributes: VALSOU, CATOBS, WATLEV, EXPSOU
 * Geometry: Point, Line, Area
 *
 * Point obstructions (Continuation A):
 *   - Isolated danger (UDWHAZ05) → ISODGR01, for both classes
 *   - UWTROC with VALSOU: deeper than SAFETY_DEPTH → DANGER02 + sounding;
 *     at or shoaler than SAFETY_DEPTH → WATLEV 4,5 → UWTROC04 (no sounding),
 *     else → DANGER01 + sounding
 *   - UWTROC without VALSOU: WATLEV 3 → UWTROC03, else → UWTROC04
 *   - OBSTRN with VALSOU: shallow → DANGER01, deep → DANGER02
 *   - OBSTRN with CATOBS 6 (foul area): WATLEV 1,2 → OBSTRN11, WATLEV 4,5 → OBSTRN03, else → DANGER01
 *   - OBSTRN without VALSOU: CATOBS 6 → OBSTRN01, WATLEV 1,2 → OBSTRN11,
 *     WATLEV 4,5 → UWTROC04, else → DANGER01
 *
 * The UWTROC branches are gated with `objectClasses` rather than a filter: the
 * two classes are separate source-layers in the tiles and carry no attribute
 * that distinguishes them. See CSPLayerExtras.
 *
 * Line obstructions (Continuation B):
 *   - Isolated danger → ISODGR01 + dotted CHBLK
 *   - Shallow/no sounding → dotted CHBLK
 *   - Deep → dashed CHBLK
 *
 * Area obstructions (Continuation C):
 *   - Isolated danger → DEPVS fill + FOULAR01 pattern + dotted CHBLK + ISODGR01
 *   - With VALSOU: shallow → dotted CHBLK, deep → dashed CHGRD
 *   - CATOBS 6 → FOULAR01 pattern + dotted CHBLK
 *   - WATLEV 1,2 → CHBRN fill + solid CSTLN
 *   - WATLEV 4 → DEPIT fill + dashed CSTLN
 *   - Default → DEPVS fill + dotted CHBLK
 */
export function OBSTRN07(config: LayerConfig): CSPLayer[] {
  const { mode, safetyDepth } = config;
  // OBSTRN and UWTROC share the DEPTH_VALUE ladder OBSTRN07 defines, so one
  // hazard key covers both classes (CATOBS simply never matches on a rock).
  const hazard: HazardClass = "OBSTRN";
  const isDanger = isolatedDangerShown(config, hazard);
  const notDanger = notIsolatedDanger(config, hazard);

  /** WATLEV 4 (covers and uncovers) or 5 (awash). */
  const awash: ExpressionFilterSpecification = [
    "in",
    ["get", "WATLEV"],
    ["literal", [4, 5]],
  ];

  /** The plain rock symbol: dangerous rock when always submerged, else awash. */
  const rockSymbol: ExpressionSpecification = [
    "case",
    ["==", ["get", "WATLEV"], 3],
    "UWTROC03",
    "UWTROC04",
  ];

  /**
   * The plain obstruction symbol, by CATOBS/WATLEV. Unlike the no-VALSOU
   * look-up below it defaults to OBSTRN01 rather than DANGER01, because it is
   * used where S-52 asks for a danger symbol and the user wants a plain one.
   */
  const obstructionSymbol: ExpressionSpecification = [
    "case",
    ["==", ["get", "CATOBS"], 6],
    "OBSTRN01",
    ["in", ["get", "WATLEV"], ["literal", [1, 2]]],
    "OBSTRN11",
    awash as ExpressionSpecification,
    "UWTROC04",
    "OBSTRN01",
  ];

  return [
    // ─── Point obstructions (Continuation A) ───

    // Isolated danger → ISODGR01 (display base + optional shallow-water family)
    ...isolatedDangerLayers(config, hazard, ["==", ["geometry-type"], "Point"]),

    // ── UWTROC (underwater/awash rock) ──
    // Rocks reach this procedure through their own look-up entries
    // (rcid 952 SIMPLIFIED / 1300 PAPER_CHART, both CS(OBSTRN07), point only),
    // but S-52 gives them a different Continuation A path from obstructions,
    // so these branches are restricted to the UWTROC class and the equivalent
    // OBSTRN branches below are restricted to OBSTRN.

    // Has VALSOU, VALSOU <= SAFETY_DEPTH, WATLEV 4,5 → UWTROC04 (no sounding)
    {
      objectClasses: ["UWTROC"],
      type: "symbol",
      filter: [
        "all",
        ["==", ["geometry-type"], "Point"],
        notDanger,
        ["has", "VALSOU"],
        ["<=", ["get", "VALSOU"], safetyDepth],
        awash,
      ],
      layout: iconLayout("UWTROC04"),
    },

    // Has VALSOU, VALSOU <= SAFETY_DEPTH, any other WATLEV → DANGER01 + sounding
    {
      objectClasses: ["UWTROC"],
      type: "symbol",
      filter: [
        "all",
        ["==", ["geometry-type"], "Point"],
        notDanger,
        ["has", "VALSOU"],
        ["<=", ["get", "VALSOU"], safetyDepth],
        ["!", awash],
      ],
      layout: iconLayout("DANGER01"),
    },

    // Sounding text on rocks.
    //
    // DELIBERATE DEVIATION FROM S-52 — drying heights on awash rocks.
    // S-52 sets SOUNDING = FALSE for the whole WATLEV 4,5 branch above. A
    // WATLEV 4 rock (covers and uncovers) carries a drying height that Chart 1
    // K11 shows against the symbol, and losing it costs the mariner the one
    // number that says how far the rock dries. We therefore keep UWTROC04 for
    // WATLEV 4 but still draw its sounding; WATLEV 5 (awash at chart datum,
    // where the value is 0 by definition) keeps the S-52 suppression.
    {
      objectClasses: ["UWTROC"],
      ...SNDFRM04(config, "VALSOU", [
        "all",
        ["==", ["geometry-type"], "Point"],
        notDanger,
        ["has", "VALSOU"],
        [
          "!",
          [
            "all",
            ["<=", ["get", "VALSOU"], safetyDepth],
            ["==", ["get", "WATLEV"], 5],
          ],
        ],
      ]),
    },

    // No VALSOU → WATLEV 3 (always under water) → UWTROC03, else UWTROC04.
    // UWTROC03 is the dangerous-rock symbol (rock with dots); UWTROC04 is the
    // rock-awash symbol, and S-52 uses it as the default for every other
    // WATLEV including a missing one.
    {
      objectClasses: ["UWTROC"],
      type: "symbol",
      filter: [
        "all",
        ["==", ["geometry-type"], "Point"],
        notDanger,
        ["!", ["has", "VALSOU"]],
      ],
      layout: iconLayout(rockSymbol),
    },

    // DELIBERATE DEVIATION FROM S-52 — deep hazards get a plain symbol.
    // S-52 sends any sounded hazard deeper than SAFETY_DEPTH to DANGER02, the
    // "obstruction with dotted danger circle" symbol. Below the safety depth
    // the hazard is not a danger to own ship, and the danger circle on every
    // deep rock/wreck/obstruction clutters the chart to the point where the
    // shoal ones stop standing out. We emit the class's ordinary symbol plus
    // the sounding instead. DANGER01 for shoal hazards is untouched.
    {
      objectClasses: ["UWTROC"],
      type: "symbol",
      filter: [
        "all",
        ["==", ["geometry-type"], "Point"],
        notDanger,
        ["has", "VALSOU"],
        [">", ["get", "VALSOU"], safetyDepth],
      ],
      layout: iconLayout(rockSymbol),
    },

    // ── OBSTRN (obstruction) ──

    // Has VALSOU, not isolated danger, CATOBS 6 (foul area).
    // CATOBS is an OBSTRN attribute, so these never match a rock anyway.
    {
      objectClasses: ["OBSTRN"],
      type: "symbol",
      filter: [
        "all",
        ["==", ["geometry-type"], "Point"],
        notDanger,
        ["has", "VALSOU"],
        ["==", ["get", "CATOBS"], 6],
        ["in", ["get", "WATLEV"], ["literal", [1, 2]]],
      ],
      layout: iconLayout("OBSTRN11"),
    },
    {
      objectClasses: ["OBSTRN"],
      type: "symbol",
      filter: [
        "all",
        ["==", ["geometry-type"], "Point"],
        notDanger,
        ["has", "VALSOU"],
        ["==", ["get", "CATOBS"], 6],
        ["in", ["get", "WATLEV"], ["literal", [4, 5]]],
      ],
      layout: iconLayout("OBSTRN03"),
    },

    // Has VALSOU, not isolated danger, not CATOBS 6, VALSOU <= safetyDepth → DANGER01
    {
      objectClasses: ["OBSTRN"],
      type: "symbol",
      filter: [
        "all",
        ["==", ["geometry-type"], "Point"],
        notDanger,
        ["has", "VALSOU"],
        ["!=", ["get", "CATOBS"], 6],
        ["<=", ["get", "VALSOU"], safetyDepth],
      ],
      layout: iconLayout("DANGER01"),
    },

    // Has VALSOU, not isolated danger, not CATOBS 6, VALSOU > safetyDepth.
    // DELIBERATE DEVIATION FROM S-52 — plain symbol instead of DANGER02; see
    // the UWTROC deep-hazard branch above for the rationale.
    {
      objectClasses: ["OBSTRN"],
      type: "symbol",
      filter: [
        "all",
        ["==", ["geometry-type"], "Point"],
        notDanger,
        ["has", "VALSOU"],
        ["!=", ["get", "CATOBS"], 6],
        [">", ["get", "VALSOU"], safetyDepth],
      ],
      layout: iconLayout(obstructionSymbol),
    },

    // Sounding text on point obstructions with VALSOU (SNDFRM04)
    {
      objectClasses: ["OBSTRN"],
      ...SNDFRM04(config, "VALSOU", [
        "all",
        ["==", ["geometry-type"], "Point"],
        notDanger,
        ["has", "VALSOU"],
      ]),
    },

    // No VALSOU, not isolated danger → symbol by CATOBS/WATLEV
    {
      objectClasses: ["OBSTRN"],
      type: "symbol",
      filter: [
        "all",
        ["==", ["geometry-type"], "Point"],
        notDanger,
        ["!", ["has", "VALSOU"]],
      ],
      layout: iconLayout([
        "case",
        // CATOBS 6 (foul area) → OBSTRN01
        ["==", ["get", "CATOBS"], 6],
        "OBSTRN01",
        // WATLEV 1,2 (dry/partly submerged) → OBSTRN11
        ["in", ["get", "WATLEV"], ["literal", [1, 2]]],
        "OBSTRN11",
        // WATLEV 4,5 (covers/uncovers, awash) → UWTROC04
        ["in", ["get", "WATLEV"], ["literal", [4, 5]]],
        "UWTROC04",
        // Default → DANGER01
        "DANGER01",
      ] as ExpressionSpecification),
    },

    // ─── Line obstructions (Continuation B) ───

    // Isolated danger → dotted CHBLK + ISODGR01 at midpoint
    {
      type: "line",
      filter: ["all", ["==", ["geometry-type"], "LineString"], isDanger],
      paint: {
        "line-dasharray": LineStyles.DOTT,
        "line-width": 2,
        "line-color": colour(mode, "CHBLK"),
      },
    },
    ...isolatedDangerLayers(
      config,
      hazard,
      ["==", ["geometry-type"], "LineString"],
      { "symbol-placement": "line" },
    ),

    // Not isolated danger, shallow or no sounding → dotted CHBLK
    {
      type: "line",
      filter: [
        "all",
        ["==", ["geometry-type"], "LineString"],
        notDanger,
        [
          "any",
          ["!", ["has", "VALSOU"]],
          ["<=", ["get", "VALSOU"], safetyDepth],
        ],
      ],
      paint: {
        "line-dasharray": LineStyles.DOTT,
        "line-width": 2,
        "line-color": colour(mode, "CHBLK"),
      },
    },

    // Not isolated danger, deep sounding → dashed CHBLK
    {
      type: "line",
      filter: [
        "all",
        ["==", ["geometry-type"], "LineString"],
        notDanger,
        ["has", "VALSOU"],
        [">", ["get", "VALSOU"], safetyDepth],
      ],
      paint: {
        "line-dasharray": LineStyles.DASH,
        "line-width": 2,
        "line-color": colour(mode, "CHBLK"),
      },
    },

    // ─── Area obstructions (Continuation C) ───

    // Isolated danger area: DEPVS fill + FOULAR01 pattern + dotted CHBLK + ISODGR01
    {
      type: "fill",
      filter: ["all", ["==", ["geometry-type"], "Polygon"], isDanger],
      paint: { "fill-color": colour(mode, "DEPVS") },
    },
    {
      type: "fill",
      filter: ["all", ["==", ["geometry-type"], "Polygon"], isDanger],
      paint: { "fill-pattern": "FOULAR01" },
    },
    {
      type: "line",
      filter: ["all", ["==", ["geometry-type"], "Polygon"], isDanger],
      paint: {
        "line-dasharray": LineStyles.DOTT,
        "line-width": 2,
        "line-color": colour(mode, "CHBLK"),
      },
    },
    ...isolatedDangerLayers(config, hazard, [
      "==",
      ["geometry-type"],
      "Polygon",
    ]),

    // Not isolated danger, has VALSOU, shallow → dotted CHBLK outline
    {
      type: "line",
      filter: [
        "all",
        ["==", ["geometry-type"], "Polygon"],
        notDanger,
        ["has", "VALSOU"],
        ["<=", ["get", "VALSOU"], safetyDepth],
      ],
      paint: {
        "line-dasharray": LineStyles.DOTT,
        "line-width": 2,
        "line-color": colour(mode, "CHBLK"),
      },
    },

    // Not isolated danger, has VALSOU, deep → dashed CHGRD outline
    {
      type: "line",
      filter: [
        "all",
        ["==", ["geometry-type"], "Polygon"],
        notDanger,
        ["has", "VALSOU"],
        [">", ["get", "VALSOU"], safetyDepth],
      ],
      paint: {
        "line-dasharray": LineStyles.DASH,
        "line-width": 2,
        "line-color": colour(mode, "CHGRD"),
      },
    },

    // Sounding text on area obstructions with VALSOU (SNDFRM04)
    SNDFRM04(config, "VALSOU", [
      "all",
      ["==", ["geometry-type"], "Polygon"],
      notDanger,
      ["has", "VALSOU"],
    ]),

    // Not isolated danger, no VALSOU: fill + outline by CATOBS/WATLEV
    // CATOBS 6 → FOULAR01 pattern + dotted CHBLK
    {
      type: "fill",
      filter: [
        "all",
        ["==", ["geometry-type"], "Polygon"],
        notDanger,
        ["!", ["has", "VALSOU"]],
        ["==", ["get", "CATOBS"], 6],
      ],
      paint: { "fill-pattern": "FOULAR01" },
    },
    {
      type: "line",
      filter: [
        "all",
        ["==", ["geometry-type"], "Polygon"],
        notDanger,
        ["!", ["has", "VALSOU"]],
        ["==", ["get", "CATOBS"], 6],
      ],
      paint: {
        "line-dasharray": LineStyles.DOTT,
        "line-width": 2,
        "line-color": colour(mode, "CHBLK"),
      },
    },

    // WATLEV 1,2 → CHBRN fill + solid CSTLN
    {
      type: "fill",
      filter: [
        "all",
        ["==", ["geometry-type"], "Polygon"],
        notDanger,
        ["!", ["has", "VALSOU"]],
        ["!=", ["get", "CATOBS"], 6],
        ["in", ["get", "WATLEV"], ["literal", [1, 2]]],
      ],
      paint: { "fill-color": colour(mode, "CHBRN") },
    },
    {
      type: "line",
      filter: [
        "all",
        ["==", ["geometry-type"], "Polygon"],
        notDanger,
        ["!", ["has", "VALSOU"]],
        ["!=", ["get", "CATOBS"], 6],
        ["in", ["get", "WATLEV"], ["literal", [1, 2]]],
      ],
      paint: {
        "line-width": 2,
        "line-color": colour(mode, "CSTLN"),
      },
    },

    // WATLEV 4 → DEPIT fill + dashed CSTLN
    {
      type: "fill",
      filter: [
        "all",
        ["==", ["geometry-type"], "Polygon"],
        notDanger,
        ["!", ["has", "VALSOU"]],
        ["!=", ["get", "CATOBS"], 6],
        ["==", ["get", "WATLEV"], 4],
      ],
      paint: { "fill-color": colour(mode, "DEPIT") },
    },
    {
      type: "line",
      filter: [
        "all",
        ["==", ["geometry-type"], "Polygon"],
        notDanger,
        ["!", ["has", "VALSOU"]],
        ["!=", ["get", "CATOBS"], 6],
        ["==", ["get", "WATLEV"], 4],
      ],
      paint: {
        "line-dasharray": LineStyles.DASH,
        "line-width": 2,
        "line-color": colour(mode, "CSTLN"),
      },
    },

    // Default (WATLEV 3, 5, or missing) → DEPVS fill + dotted CHBLK
    {
      type: "fill",
      filter: [
        "all",
        ["==", ["geometry-type"], "Polygon"],
        notDanger,
        ["!", ["has", "VALSOU"]],
        ["!=", ["get", "CATOBS"], 6],
        ["!", ["in", ["get", "WATLEV"], ["literal", [1, 2, 4]]]],
      ],
      paint: { "fill-color": colour(mode, "DEPVS") },
    },
    {
      type: "line",
      filter: [
        "all",
        ["==", ["geometry-type"], "Polygon"],
        notDanger,
        ["!", ["has", "VALSOU"]],
        ["!=", ["get", "CATOBS"], 6],
        ["!", ["in", ["get", "WATLEV"], ["literal", [1, 2, 4]]]],
      ],
      paint: {
        "line-dasharray": LineStyles.DOTT,
        "line-width": 2,
        "line-color": colour(mode, "CHBLK"),
      },
    },
  ];
}
/**
 * QUAPOS01 - 13.2.7 Quality of position (S-52 PresLib 4.0, section 13.2.7)
 *
 * Applies to COALNE (line) and LNDARE (line, point).
 * Dispatches to QUALIN01 for lines, QUAPNT02 for points.
 */
export function QUAPOS01(config: LayerConfig): Partial<LayerSpecification>[] {
  return [
    // Line objects → QUALIN01
    ...QUALIN01(config),
    // Point objects → QUAPNT02 (show LOWACC01 if low accuracy)
    ...QUAPNT02(config),
  ];
}

/**
 * QUALIN01 - 13.2.8 Quality of line positions (S-52 PresLib 4.0, section 13.2.8)
 *
 * Sub-procedure called by QUAPOS01. For line objects, if QUAPOS indicates
 * low accuracy (not 1, 10, or 11), symbolize with LC(LOWACC21).
 * Otherwise use default line style from the lookup table.
 *
 * For COALNE: default is LS(SOLD,1,CSTLN).
 * For LNDARE: default is LS(SOLD,1,CSTLN).
 */
export function QUALIN01(config: LayerConfig): Partial<LayerSpecification>[] {
  const { mode } = config;
  const lowQuality = quaposLowQuality();

  return [
    // Low accuracy line segments → LOWACC21 pattern
    {
      type: "line",
      filter: ["all", ["==", ["geometry-type"], "LineString"], lowQuality],
      layout: {
        // TODO: LC(LOWACC21) complex line pattern — using dashed approximation
      },
      paint: {
        "line-dasharray": LineStyles.DASH,
        "line-width": 1,
        "line-color": colour(mode, "CHMGF"),
      },
    },
    // Accurate line segments → solid CSTLN
    {
      type: "line",
      filter: [
        "all",
        ["==", ["geometry-type"], "LineString"],
        ["!", lowQuality],
      ],
      paint: {
        "line-width": 1,
        "line-color": colour(mode, "CSTLN"),
      },
    },
  ];
}

/**
 * QUAPNT02 - 13.2.9 Quality of point/area positions (S-52 PresLib 4.0, section 13.2.9)
 *
 * Sub-procedure called by QUAPOS01, SLCONS04, OBSTRN07, WRECKS05.
 * Shows LOWACC01 symbol at point/area features with low positional accuracy.
 */
export function QUAPNT02(_config: LayerConfig): Partial<LayerSpecification>[] {
  return [
    {
      type: "symbol",
      filter: [
        "all",
        [
          "any",
          ["==", ["geometry-type"], "Point"],
          ["==", ["geometry-type"], "Polygon"],
        ],
        quaposLowQuality(),
      ] as ExpressionFilterSpecification,
      layout: iconLayout("LOWACC01"),
    },
  ];
}
// RESTRN value groups used by RESARE04, RESTRN01, and RESCSP02
const RESTRN_ENTRY = ["7", "8", "14"];
const RESTRN_ANCHOR = ["1", "2"];
const RESTRN_FISHING = ["3", "4", "5", "6", "24"];
const RESTRN_OWN_SHIP = ["13", "16", "17", "23", "25", "26", "27"];
const RESTRN_OTHER = [
  "9",
  "10",
  "11",
  "12",
  "15",
  "18",
  "19",
  "20",
  "21",
  "22",
];

// CATREA value groups (military/safety vs nature/ecological)
const CATREA_MILITARY = [
  "1",
  "8",
  "9",
  "12",
  "14",
  "18",
  "19",
  "21",
  "24",
  "25",
  "26",
];
const CATREA_NATURE = ["4", "5", "6", "7", "10", "20", "22", "23"];

/**
 * Select the restriction symbol based on RESTRN priority cascade.
 * Each continuation checks if additional restriction types exist alongside
 * the primary type, upgrading the symbol suffix (51 → 61 → 71).
 *
 * Suffix meanings:
 *   51 = only this restriction type
 *   61 = this type + other navigational restrictions
 *   71 = this type + environmental/nature restrictions
 */
function restrictionSymbol(
  prefix: string,
  additionalRestrn: string[],
  config: LayerConfig,
): Partial<LayerSpecification>[] {
  const { mode } = config;

  const is61: ExpressionFilterSpecification = [
    "any",
    listIncludes("RESTRN", ...additionalRestrn),
    ["all", ["has", "CATREA"], listIncludes("CATREA", ...CATREA_MILITARY)],
  ];
  const is71: ExpressionFilterSpecification = [
    "any",
    listIncludes("RESTRN", ...RESTRN_OTHER),
    ["all", ["has", "CATREA"], listIncludes("CATREA", ...CATREA_NATURE)],
  ];

  return [
    // Symbol in center of area
    {
      type: "symbol",
      layout: iconLayout([
        "case",
        is61,
        `${prefix}61`,
        is71,
        `${prefix}71`,
        `${prefix}51`,
      ] as ExpressionSpecification),
    },

    // Boundary: plain boundaries use LS(DASH,2,CHMGD)
    // TODO: symbolized boundaries should use LC pattern (e.g., LC(ENTRES51))
    {
      type: "line",
      paint: {
        "line-dasharray": LineStyles.DASH,
        "line-width": 2,
        "line-color": colour(mode, "CHMGD"),
      },
    },
  ];
}

/**
 * RESARE04 - 13.2.9 Restricted areas (S-52 PresLib 4.0, section 13.2.9)
 *
 * Applies to S-57 object class RESARE only.
 * Attributes: RESTRN (list), CATREA (list)
 *
 * Priority cascade:
 *   1. Entry restricted/prohibited (RESTRN 7, 8, 14) → ENTRES symbol
 *   2. Anchoring restricted/prohibited (RESTRN 1, 2) → ACHRES symbol
 *   3. Fishing restricted/prohibited (RESTRN 3, 4, 5, 6, 24) → FSHRES symbol
 *   4. Own ship restrictions (RESTRN 13, 16, 17, 23, 25, 26, 27) → CTYARE symbol
 *   5. Other restrictions (RESTRN 9-22) → INFARE51
 *   6. No RESTRN → symbol by CATREA or RSRDEF51
 */
export function RESARE04(config: LayerConfig): Partial<LayerSpecification>[] {
  const { mode } = config;

  // The spec uses a priority cascade: first matching group wins.
  // Each group produces a symbol layer + boundary layer.
  // We implement this as multiple layers with mutually exclusive filters.

  const hasRestrn: ExpressionFilterSpecification = ["has", "RESTRN"];
  const hasEntry = listIncludes("RESTRN", ...RESTRN_ENTRY);
  const hasAnchor = listIncludes("RESTRN", ...RESTRN_ANCHOR);
  const hasFishing = listIncludes("RESTRN", ...RESTRN_FISHING);
  const hasOwnShip = listIncludes("RESTRN", ...RESTRN_OWN_SHIP);
  const hasOther = listIncludes("RESTRN", ...RESTRN_OTHER);

  // Remaining RESTRN values for each level's "additional" check
  const entryAdditional = [
    ...RESTRN_ANCHOR,
    ...RESTRN_FISHING,
    ...RESTRN_OWN_SHIP,
  ];
  const anchorAdditional = [...RESTRN_FISHING, ...RESTRN_OWN_SHIP];
  const fishingAdditional = [...RESTRN_OWN_SHIP];

  const filterA: ExpressionFilterSpecification = ["all", hasRestrn, hasEntry];
  const filterB: ExpressionFilterSpecification = [
    "all",
    hasRestrn,
    ["!", hasEntry],
    hasAnchor,
  ];
  const filterC: ExpressionFilterSpecification = [
    "all",
    hasRestrn,
    ["!", hasEntry],
    ["!", hasAnchor],
    hasFishing,
  ];
  const filterD: ExpressionFilterSpecification = [
    "all",
    hasRestrn,
    ["!", hasEntry],
    ["!", hasAnchor],
    ["!", hasFishing],
    hasOwnShip,
  ];
  const filterOther: ExpressionFilterSpecification = [
    "all",
    hasRestrn,
    ["!", hasEntry],
    ["!", hasAnchor],
    ["!", hasFishing],
    ["!", hasOwnShip],
    hasOther,
  ];
  const filterNoRestrn: ExpressionFilterSpecification = ["!", hasRestrn];

  return [
    // --- Continuation A: Entry restricted/prohibited ---
    ...restrictionSymbol("ENTRES", entryAdditional, config).map((l) => ({
      ...l,
      filter: filterA,
    })),

    // --- Continuation B: Anchoring restricted/prohibited ---
    ...restrictionSymbol("ACHRES", anchorAdditional, config).map((l) => ({
      ...l,
      filter: filterB,
    })),

    // --- Continuation C: Fishing restricted/prohibited ---
    ...restrictionSymbol("FSHRES", fishingAdditional, config).map((l) => ({
      ...l,
      filter: filterC,
    })),

    // --- Continuation D: Own ship restrictions ---
    ...restrictionSymbol("CTYARE", [], config).map((l) => ({
      ...l,
      filter: filterD,
    })),

    // --- RESTRN other (9-22) without any higher-priority restriction ---
    {
      type: "symbol",
      filter: filterOther,
      layout: iconLayout("INFARE51"),
    },
    {
      type: "line",
      filter: filterOther,
      paint: {
        "line-dasharray": LineStyles.DASH,
        "line-width": 2,
        "line-color": colour(mode, "CHMGD"),
      },
    },

    // --- Continuation E: No RESTRN → symbol by CATREA ---
    {
      type: "symbol",
      filter: filterNoRestrn,
      layout: iconLayout([
        "case",
        ["all", ["has", "CATREA"], listIncludes("CATREA", ...CATREA_MILITARY)],
        "CTYARE51",
        ["all", ["has", "CATREA"], listIncludes("CATREA", ...CATREA_NATURE)],
        "INFARE51",
        "RSRDEF51",
      ] as ExpressionSpecification),
    },
    {
      type: "line",
      filter: filterNoRestrn,
      paint: {
        "line-dasharray": LineStyles.DASH,
        "line-width": 2,
        "line-color": colour(mode, "CHMGD"),
      },
    },
  ];
}

/**
 * RESTRN01 - 13.2.10 Entry procedure for restrictions
 * (S-52 PresLib 4.0, section 13.2.10)
 *
 * Called for many object classes (ACHARE, CBLARE, DRGARE, FAIRWY, etc.)
 * when they carry the RESTRN attribute. Delegates to RESCSP02.
 */
export function RESTRN01(config: LayerConfig): Partial<LayerSpecification>[] {
  return RESCSP02(config);
}

/**
 * RESCSP02 - 13.2.11 Restriction sub-procedure
 * (S-52 PresLib 4.0, section 13.2.11)
 *
 * Same priority cascade as RESARE04 but without CATREA checks,
 * since these object classes don't have CATREA.
 */
export function RESCSP02(_config: LayerConfig): Partial<LayerSpecification>[] {
  const hasRestrn: ExpressionFilterSpecification = ["has", "RESTRN"];
  const hasEntry = listIncludes("RESTRN", ...RESTRN_ENTRY);
  const hasAnchor = listIncludes("RESTRN", ...RESTRN_ANCHOR);
  const hasFishing = listIncludes("RESTRN", ...RESTRN_FISHING);
  const hasOwnShip = listIncludes("RESTRN", ...RESTRN_OWN_SHIP);

  const fEntry: ExpressionFilterSpecification = ["all", hasRestrn, hasEntry];
  const fAnchor: ExpressionFilterSpecification = [
    "all",
    hasRestrn,
    ["!", hasEntry],
    hasAnchor,
  ];
  const fFishing: ExpressionFilterSpecification = [
    "all",
    hasRestrn,
    ["!", hasEntry],
    ["!", hasAnchor],
    hasFishing,
  ];
  const fOwnShip: ExpressionFilterSpecification = [
    "all",
    hasRestrn,
    ["!", hasEntry],
    ["!", hasAnchor],
    ["!", hasFishing],
    hasOwnShip,
  ];
  const fOther: ExpressionFilterSpecification = [
    "all",
    hasRestrn,
    ["!", hasEntry],
    ["!", hasAnchor],
    ["!", hasFishing],
    ["!", hasOwnShip],
  ];

  return [
    {
      type: "symbol",
      filter: fEntry,
      layout: iconLayout("ENTRES51"),
    },
    {
      type: "symbol",
      filter: fAnchor,
      layout: iconLayout("ACHRES51"),
    },
    {
      type: "symbol",
      filter: fFishing,
      layout: iconLayout("FSHRES51"),
    },
    {
      type: "symbol",
      filter: fOwnShip,
      layout: iconLayout("CTYARE51"),
    },
    {
      type: "symbol",
      filter: fOther,
      layout: iconLayout("INFARE51"),
    },
  ];
}

/** SAFCON01 - 13.2.12 Contour labels, including safety contour */
export function SAFECON01(config: LayerConfig): Partial<LayerSpecification>[] {
  return [
    {
      type: "symbol",
      filter: [
        "all",
        ["has", "VALDCO"],
        [">", ["get", "VALDCO"], 0],
        ["<", ["get", "VALDCO"], 99999],
      ],
      layout: {
        "symbol-placement": "line",
        "text-size": 12,
        "text-field": [
          "case",
          ["<", ["get", "VALDCO"], 31],
          [
            "number-format",
            ["get", "VALDCO"],
            { "min-fraction-digits": 0, "max-fraction-digits": 0 },
          ],
          ["number-format", ["floor", ["get", "VALDCO"]], {}],
        ],
        "text-font": ["Metropolis Regular"],
      },
      paint: {
        "text-halo-color": colour(config.mode, "NODTA"),
        "text-halo-width": 1,
        "text-color": colour(config.mode, "CHBLK"),
      },
    },
  ];
}

/**
 * SLCONS04 - 13.2.13 Shoreline constructions (S-52 PresLib 4.0, section 13.2.13)
 *
 * Applies to S-57 object class SLCONS (point, line, area).
 * Attributes: QUAPOS, CONDTN, CATSLC, WATLEV
 *
 * Points: show LOWACC01 if low accuracy (via QUAPNT02).
 * Lines/Areas: low accuracy segments → LC(LOWACC21),
 *   otherwise line style by CONDTN/CATSLC/WATLEV lookup table.
 */
export function SLCONS04(config: LayerConfig): Partial<LayerSpecification>[] {
  const { mode } = config;
  const lowQuality = quaposLowQuality();

  return [
    // Point: QUAPNT02 low accuracy symbol
    ...QUAPNT02(config),

    // Line/Area: low accuracy segments → dashed CHMGF (approximation of LC(LOWACC21))
    {
      type: "line",
      filter: ["all", ["!=", ["geometry-type"], "Point"], lowQuality],
      paint: {
        "line-dasharray": LineStyles.DASH,
        "line-width": 1,
        "line-color": colour(mode, "CHMGF"),
      },
    },

    // Line/Area: accurate segments — style by CONDTN/CATSLC/WATLEV
    // CONDTN 1 or 2 (under construction, ruined) → dashed
    {
      type: "line",
      filter: [
        "all",
        ["!=", ["geometry-type"], "Point"],
        ["!", lowQuality],
        ["has", "CONDTN"],
        ["in", ["get", "CONDTN"], ["literal", [1, 2]]],
      ],
      paint: {
        "line-dasharray": LineStyles.DASH,
        "line-width": 1,
        "line-color": colour(mode, "CSTLN"),
      },
    },

    // CATSLC 6, 15, or 16 (wharf, pier, promenade pier) → thick solid
    {
      type: "line",
      filter: [
        "all",
        ["!=", ["geometry-type"], "Point"],
        ["!", lowQuality],
        [
          "any",
          ["!", ["has", "CONDTN"]],
          ["!", ["in", ["get", "CONDTN"], ["literal", [1, 2]]]],
        ],
        ["has", "CATSLC"],
        ["in", ["get", "CATSLC"], ["literal", [6, 15, 16]]],
      ],
      paint: {
        "line-width": 4,
        "line-color": colour(mode, "CSTLN"),
      },
    },

    // WATLEV 3 or 4 (always under water, covers/uncovers) → dashed
    {
      type: "line",
      filter: [
        "all",
        ["!=", ["geometry-type"], "Point"],
        ["!", lowQuality],
        [
          "any",
          ["!", ["has", "CONDTN"]],
          ["!", ["in", ["get", "CONDTN"], ["literal", [1, 2]]]],
        ],
        [
          "any",
          ["!", ["has", "CATSLC"]],
          ["!", ["in", ["get", "CATSLC"], ["literal", [6, 15, 16]]]],
        ],
        ["has", "WATLEV"],
        ["in", ["get", "WATLEV"], ["literal", [3, 4]]],
      ],
      paint: {
        "line-dasharray": LineStyles.DASH,
        "line-width": 2,
        "line-color": colour(mode, "CSTLN"),
      },
    },

    // WATLEV 1 (partly submerged) or 2 (always dry) or absent → solid CSTLN
    {
      type: "line",
      filter: [
        "all",
        ["!=", ["geometry-type"], "Point"],
        ["!", lowQuality],
        [
          "any",
          ["!", ["has", "CONDTN"]],
          ["!", ["in", ["get", "CONDTN"], ["literal", [1, 2]]]],
        ],
        [
          "any",
          ["!", ["has", "CATSLC"]],
          ["!", ["in", ["get", "CATSLC"], ["literal", [6, 15, 16]]]],
        ],
        [
          "any",
          ["!", ["has", "WATLEV"]],
          ["!", ["in", ["get", "WATLEV"], ["literal", [3, 4]]]],
        ],
      ],
      paint: {
        "line-width": 2,
        "line-color": colour(mode, "CSTLN"),
      },
    },
  ];
}

/** SEABED01 - 13.2.14 Colour fill for depth areas */
export function SEABED01(config: LayerConfig): ExpressionSpecification {
  const { mode, shallowContour, safetyContour, deepContour } = config;
  return [
    "case",
    [
      "all",
      [">=", ["var", "drval1"], deepContour],
      [">", ["var", "drval2"], deepContour],
    ],
    colour(mode, "DEPDW"),
    [
      "all",
      [">=", ["var", "drval1"], safetyContour],
      [">", ["var", "drval2"], safetyContour],
    ],
    colour(mode, "DEPMD"),
    [
      "all",
      [">=", ["var", "drval1"], shallowContour],
      [">", ["var", "drval2"], shallowContour],
    ],
    colour(mode, "DEPMS"),
    ["all", [">=", ["var", "drval1"], 0], [">", ["var", "drval2"], 0]],
    colour(mode, "DEPVS"),
    colour(mode, "DEPIT"),
  ];
}

/**
 * SNDFRM04 - 13.2.15 Symbolizing soundings, including safety depth
 * (S-52 PresLib 4.0, section 13.2.15)
 *
 * Formats a depth value as text for display. Called by SOUNDG03, WRECKS05,
 * and OBSTRN07 when features have a sounding value (DEPTH or VALSOU).
 *
 * The S-52 spec composites individual digit symbols (SOUNDG10, SOUNDG25, etc.).
 * MapLibre can't composite multiple symbols per feature, so we render as
 * formatted text instead, matching the visual intent:
 *   - Depths < 10: show one decimal (e.g. "3.5")
 *   - Depths 10–30: show one decimal if non-zero (e.g. "15.2"), else integer ("15")
 *   - Depths > 30: integer only ("45")
 *   - Colour: SNDG2 (shallow/black) when depth <= safetyDepth, SNDG1 (deep/grey) otherwise
 *
 * @param depthAttr - The attribute name containing the depth value ("DEPTH" or "VALSOU")
 * @param filter - Optional additional filter to apply to the layer
 */
export function SNDFRM04(
  config: LayerConfig,
  depthAttr: string = "DEPTH",
  filter?: ExpressionFilterSpecification,
): Partial<LayerSpecification> {
  const { mode, safetyDepth } = config;
  const depth: ExpressionSpecification = ["get", depthAttr];
  const absDepth: ExpressionSpecification = ["abs", depth];

  const textField: ExpressionSpecification = [
    "case",
    ["<", absDepth, 10],
    [
      "number-format",
      depth,
      { "min-fraction-digits": 1, "max-fraction-digits": 1 },
    ],
    ["all", ["<=", absDepth, 30], ["!=", ["%", absDepth, 1], 0]],
    [
      "number-format",
      depth,
      { "min-fraction-digits": 1, "max-fraction-digits": 1 },
    ],
    [
      "number-format",
      depth,
      { "min-fraction-digits": 0, "max-fraction-digits": 0 },
    ],
  ];

  const textColor: ExpressionSpecification = [
    "case",
    ["<=", depth, safetyDepth],
    colour(mode, "SNDG2"),
    colour(mode, "SNDG1"),
  ];

  return {
    type: "symbol",
    ...(filter ? { filter } : {}),
    layout: {
      "text-field": textField,
      "text-font": ["Metropolis Regular"],
      "text-size": 11,
      "text-allow-overlap": false,
      "symbol-placement": "point",
    },
    paint: {
      "text-color": textColor,
      "text-halo-color": colour(mode, "NODTA"),
      "text-halo-width": 1,
    },
  };
}

/**
 * SOUNDG03 - 13.2.16 Entry procedure for symbolizing soundings
 *
 * S-57 SOUNDG features are MultiPoint, but the tile pipeline splits them into
 * individual points with a DEPTH attribute (SPLIT_MULTIPOINT=ON, ADD_SOUNDG_DEPTH=ON).
 * Delegates to SNDFRM04 for depth value formatting.
 */
export function SOUNDG03(config: LayerConfig): Partial<LayerSpecification>[] {
  return [SNDFRM04(config, "DEPTH", ["has", "DEPTH"])];
}
/** SYMINS02 - 13.2.17 Symbolizing encoded objects specified by IMO */
// TOPSHP → symbol name lookup tables (S-52 PresLib 4.0, section 13.2.18)
// Floating platforms: buoys, light floats, light vessels
// Rigid platforms: beacons, daymarks, landmarks, etc.
// Used by TOPMAR01 when _FLOATING=1
export const TOPSHP_FLOATING: Record<number, string> = {
  1: "TOPMAR02",
  2: "TOPMAR04",
  3: "TOPMAR10",
  4: "TOPMAR12",
  5: "TOPMAR13",
  6: "TOPMAR14",
  7: "TOPMAR65",
  8: "TOPMAR17",
  9: "TOPMAR16",
  10: "TOPMAR08",
  11: "TOPMAR07",
  12: "TOPMAR14",
  13: "TOPMAR05",
  14: "TOPMAR06",
  15: "TMARDEF2",
  16: "TMARDEF2",
  17: "TMARDEF2",
  18: "TOPMAR10",
  19: "TOPMAR13",
  20: "TOPMAR14",
  21: "TOPMAR13",
  22: "TOPMAR14",
  23: "TOPMAR14",
  24: "TOPMAR02",
  25: "TOPMAR04",
  26: "TOPMAR10",
  27: "TOPMAR17",
  28: "TOPMAR18",
  29: "TOPMAR02",
  30: "TOPMAR17",
  31: "TOPMAR14",
  32: "TOPMAR10",
  33: "TMARDEF2",
};

const TOPSHP_RIGID: Record<number, string> = {
  1: "TOPMAR22",
  2: "TOPMAR24",
  3: "TOPMAR30",
  4: "TOPMAR32",
  5: "TOPMAR33",
  6: "TOPMAR34",
  7: "TOPMAR85",
  8: "TOPMAR86",
  9: "TOPMAR36",
  10: "TOPMAR28",
  11: "TOPMAR27",
  12: "TOPMAR14",
  13: "TOPMAR25",
  14: "TOPMAR26",
  15: "TOPMAR88",
  16: "TOPMAR87",
  17: "TMARDEF1",
  18: "TOPMAR30",
  19: "TOPMAR33",
  20: "TOPMAR34",
  21: "TOPMAR33",
  22: "TOPMAR34",
  23: "TOPMAR34",
  24: "TOPMAR22",
  25: "TOPMAR24",
  26: "TOPMAR30",
  27: "TOPMAR86",
  28: "TOPMAR89",
  29: "TOPMAR22",
  30: "TOPMAR86",
  31: "TOPMAR14",
  32: "TOPMAR30",
  33: "TMARDEF1",
};

/**
 * Build a MapLibre match expression for TOPSHP → symbol name.
 */
function topshpMatch(table: Record<number, string>, fallback: string) {
  const cases: (number | string)[] = [];
  for (const [topshp, symbol] of Object.entries(table)) {
    cases.push(Number(topshp), symbol);
  }
  return ["match", ["get", "TOPSHP"], ...cases, fallback];
}

/**
 * TOPMAR01 - 13.2.18 Topmarks (S-52 PresLib 4.0, section 13.2.18)
 *
 * Applies to S-57 object class TOPMAR (point only).
 * Attribute: TOPSHP (topmark/daymark shape)
 *
 * The symbol depends on TOPSHP and whether the topmark sits on a floating
 * platform (buoy, light float) or rigid platform (beacon, daymark).
 *
 * The pipeline pre-computes _FLOATING (0 or 1) via spatial co-location query
 * (is there a BOY*, LITFLT, or LITVES at the same position?).
 */
export function TOPMAR01(_config: LayerConfig): Partial<LayerSpecification>[] {
  return [
    // No TOPSHP → question mark
    {
      type: "symbol",
      filter: ["!", ["has", "TOPSHP"]],
      layout: iconLayout("QUESMRK1"),
    },
    // Floating platform (buoy, light float, light vessel) → TOPSHP_FLOATING
    {
      type: "symbol",
      filter: ["all", ["has", "TOPSHP"], ["==", ["get", "_FLOATING"], 1]],
      layout: iconLayout(
        topshpMatch(TOPSHP_FLOATING, "TMARDEF2") as ExpressionSpecification,
      ),
    },
    // Rigid platform (beacon, daymark, etc.) → TOPSHP_RIGID
    {
      type: "symbol",
      filter: ["all", ["has", "TOPSHP"], ["!=", ["get", "_FLOATING"], 1]],
      layout: iconLayout(
        topshpMatch(TOPSHP_RIGID, "TMARDEF1") as ExpressionSpecification,
      ),
    },
  ];
}

/* ─── UDWHAZ05 — isolated dangers ─────────────────────────────────────── */

/**
 * Names of the depth-area join columns pre-computed by `bin/s57-to-tiles` for
 * WRECKS, OBSTRN and UWTROC.
 *
 *   `_DEPARE_DRVAL1_MAX`     greatest DRVAL1 over every intersecting
 *                            DEPARE/DRGARE (NULL DRVAL1 skipped)
 *   `_DEPARE_DRVAL1_MINPOS`  least DRVAL1 >= 0 over the same set
 *
 * S-52 UDWHAZ05 asks a single question of "the surrounding depth", but a
 * hazard can straddle several depth areas, so the safe-water test uses the
 * deepest neighbour (MAX) and the shallow-water test the shoalest non-drying
 * one (MINPOS).
 */
export const SURROUNDING_DEPTH_MAX = "_DEPARE_DRVAL1_MAX";
export const SURROUNDING_DEPTH_MINPOS = "_DEPARE_DRVAL1_MINPOS";

/**
 * Stands in for a missing join value.
 *
 * Negative, so it satisfies neither the safe-water test (`>= safetyContour`)
 * nor the shallow-water one (`>= 0`): a hazard the pipeline could not join to
 * any depth area is simply not an isolated danger and falls through to its
 * ordinary symbol.
 */
const NO_SURROUNDING_DEPTH = -1;

/**
 * Read a pre-computed join column as a number, without any way to throw.
 *
 * This coalesce guard is load-bearing, not defensive dressing. A MapLibre
 * filter that throws is not "false" for that layer -- the evaluation error
 * takes out the whole layer, so a single hazard whose join column is missing
 * or NULL used to make *every* layer of its object class render nothing. The
 * two-argument `to-number` gives a total function: `["get"]` on an absent
 * property yields null, `coalesce` replaces it with the sentinel, and any
 * value that still refuses to convert falls back to the sentinel rather than
 * erroring.
 */
function surroundingDepth(property: string): ExpressionSpecification {
  return [
    "to-number",
    ["coalesce", ["get", property], NO_SURROUNDING_DEPTH],
    NO_SURROUNDING_DEPTH,
  ];
}

/**
 * S-52's "least depth unknown" sentinel for the DEPTH_VALUE ladders.
 *
 * Negative on purpose: a hazard whose least depth cannot be established is
 * treated as shoaler than any safety contour, so the fail-safe outcome is
 * "assume it endangers own ship".
 */
const DEPTH_UNKNOWN = -15;

/** The three object classes that run the UDWHAZ05 isolated-danger test. */
export type HazardClass = "OBSTRN" | "UWTROC" | "WRECKS";

/**
 * DEPTH_VALUE for UDWHAZ05, per the S-52 fail-safe ladders.
 *
 * S-52 does not gate the isolated-danger test on VALSOU being present: when
 * the sounding is missing, OBSTRN07 and DEPVAL02 derive a stand-in depth from
 * the categorical attributes so that a depth-less hazard is still evaluated.
 * Gating on `["has", "VALSOU"]` (as this file used to) silently exempted every
 * unsounded wreck, rock and obstruction from the check.
 *
 *   OBSTRN/UWTROC (OBSTRN07): VALSOU, else 0.01 for a foul area (CATOBS 6) or
 *   an always-submerged feature (WATLEV 3), else 0 for an awash one
 *   (WATLEV 5), else DEPTH_UNKNOWN.
 *
 *   WRECKS (DEPVAL02): VALSOU, else 20.1 for a non-dangerous wreck
 *   (CATWRK 1), else 0 when WATLEV is 3 or 5, else DEPTH_UNKNOWN.
 *
 * The CATWRK arm comes BEFORE the WATLEV one, which is the order WRECKS05
 * reaches them: the flowchart tests "CATWRK = 1" first and only the branch
 * where it is not 1 goes on to consult WATLEV (the procedure's own note on the
 * DEPTH_UNKNOWN arm reads "... OR CATWRK is not equal 1"). Testing WATLEV
 * first inverts the outcome for the commonest coding of a deep, surveyed,
 * non-dangerous wreck -- CATWRK 1 + WATLEV 3 (always submerged) + no VALSOU --
 * which then scores 0 m instead of 20.1 m and is flagged as an isolated danger
 * at EVERY safety contour. That draws ISODGR01 from the display-base,
 * SCAMIN-immune layer family, so it cannot be turned off or scaled away.
 */
export function depthValue(hazard: HazardClass): ExpressionSpecification {
  const valsou: ExpressionSpecification = [
    "to-number",
    ["get", "VALSOU"],
    DEPTH_UNKNOWN,
  ];

  if (hazard === "WRECKS") {
    return [
      "case",
      ["has", "VALSOU"],
      valsou,
      ["==", ["get", "CATWRK"], 1],
      20.1,
      ["in", ["get", "WATLEV"], ["literal", [3, 5]]],
      0,
      DEPTH_UNKNOWN,
    ];
  }

  return [
    "case",
    ["has", "VALSOU"],
    valsou,
    ["any", ["==", ["get", "CATOBS"], 6], ["==", ["get", "WATLEV"], 3]],
    0.01,
    ["==", ["get", "WATLEV"], 5],
    0,
    DEPTH_UNKNOWN,
  ];
}

/**
 * WATLEV 1 (partly submerged) / 2 (always dry) put the feature in UDWHAZ05's
 * "no symbol" viewing groups (14050 / 24050): they are above-water dangers and
 * keep their ordinary symbol.
 */
const underwater: ExpressionFilterSpecification = [
  "any",
  ["!", ["has", "WATLEV"]],
  ["!", ["in", ["get", "WATLEV"], ["literal", [1, 2]]]],
];

/**
 * A filter no feature can satisfy: `any` of an empty list is false, in both
 * MapLibre's expression and legacy filter grammars.
 *
 * Used to switch a branch of UDWHAZ05 off without removing its layers, so the
 * positional layer ids (`${lookupId}-${index}`) stay put.
 */
const NEVER: ExpressionFilterSpecification = ["any"];

/**
 * Whether the isolated-danger substitution runs at all.
 *
 * Absent means yes: `isolatedDangerMarks` is an opt-OUT (see LayerConfig), so
 * a caller that has never heard of it gets S-52 behaviour.
 */
function isolatedDangerMarksEnabled(config: LayerConfig): boolean {
  return config.isolatedDangerMarks !== false;
}

/**
 * UDWHAZ05 isolated danger in **safe water**: a shoal hazard
 * (DEPTH_VALUE <= SAFETY_CONTOUR) whose surrounding depth is at or beyond the
 * safety contour. These are the display-base ISODGR01 layers (viewing group
 * 14010, ScaleMinimum infinite).
 *
 * Returns `NEVER` when `isolatedDangerMarks` is off. The gate lives here, in
 * the two predicates, rather than at the ISODGR01 layers: they are not the
 * only thing that consults it. `notIsolatedDanger` guards every ordinary
 * symbol and every hazard sounding, so gating only the marks would leave the
 * ordinary symbol suppressed on a hazard whose replacement is no longer drawn.
 */
export function isolatedDanger(
  config: LayerConfig,
  hazard: HazardClass,
): ExpressionFilterSpecification {
  if (!isolatedDangerMarksEnabled(config)) return NEVER;
  return [
    "all",
    ["<=", depthValue(hazard), config.safetyContour],
    [">=", surroundingDepth(SURROUNDING_DEPTH_MAX), config.safetyContour],
    underwater,
  ];
}

/**
 * UDWHAZ05 Continuation A shallow-water danger: a shoal hazard whose
 * surrounding water is itself shallower than the safety contour (viewing group
 * 24020, Standard category).
 *
 * The `>= 0` lower bound is the spec's, and it excludes drying areas -- a
 * hazard inside a negative-DRVAL1 area is not flagged.
 *
 * Written as "not safe water AND shoal surroundings" so it stays mutually
 * exclusive with `isolatedDanger`, mirroring the if/elseif in UDWHAZ05.lua.
 * (One feature can touch both a deep and a shallow area, so MAX and MINPOS can
 * satisfy both tests at once.)
 *
 * Also `NEVER` when `isolatedDangerMarks` is off: that option turns the whole
 * procedure off, not just its display-base half.
 */
export function shallowWaterDanger(
  config: LayerConfig,
  hazard: HazardClass,
): ExpressionFilterSpecification {
  if (!isolatedDangerMarksEnabled(config)) return NEVER;
  return [
    "all",
    ["<=", depthValue(hazard), config.safetyContour],
    [
      "!",
      [">=", surroundingDepth(SURROUNDING_DEPTH_MAX), config.safetyContour],
    ],
    [">=", surroundingDepth(SURROUNDING_DEPTH_MINPOS), 0],
    ["<", surroundingDepth(SURROUNDING_DEPTH_MINPOS), config.safetyContour],
    underwater,
  ];
}

/**
 * The features UDWHAZ05 returns a hazard symbol for under the current options
 * -- i.e. the ones whose ordinary symbol (and sounding) it replaces.
 *
 * A shallow-water danger only displaces the ordinary symbol when the
 * `shallowWaterDangers` option is on; with it off, S-52's DANGER01/DANGER02
 * path stays in force for those features. With `isolatedDangerMarks` off both
 * predicates are `NEVER`, so this is false for every feature and the ordinary
 * path is in force for all of them.
 */
export function isolatedDangerShown(
  config: LayerConfig,
  hazard: HazardClass,
): ExpressionFilterSpecification {
  return [
    "any",
    isolatedDanger(config, hazard),
    ...(config.shallowWaterDangers ? [shallowWaterDanger(config, hazard)] : []),
  ];
}

/** Filter for features that keep their ordinary symbol. */
export function notIsolatedDanger(
  config: LayerConfig,
  hazard: HazardClass,
): ExpressionFilterSpecification {
  return ["!", isolatedDangerShown(config, hazard)];
}

/**
 * UDWHAZ05 - 13.2.20 Isolated dangers in general that endanger own ship
 * (S-52 PresLib 4.0, section 13.2.20)
 *
 * Not called from the look-up tables -- WRECKS05 and OBSTRN07 use the filter
 * helpers above directly. Kept as the named entry point for the procedure.
 */
export function UDWHAZ05(config: LayerConfig, hazard: HazardClass): CSPLayer[] {
  return isolatedDangerLayers(config, hazard, [
    "==",
    ["geometry-type"],
    "Point",
  ]);
}

/**
 * The pair of ISODGR01 symbol layers every hazard geometry gets: the
 * display-base safe-water one and the always-emitted, separately gated
 * shallow-water one.
 *
 * Both are emitted unconditionally so that layer ids -- which are positional
 * (`${lookupId}-${index}`) -- do not shift when the `shallowWaterDangers` or
 * `isolatedDangerMarks` option changes. With `isolatedDangerMarks` off both
 * filters reduce to `NEVER` and the pair draws nothing.
 */
function isolatedDangerLayers(
  config: LayerConfig,
  hazard: HazardClass,
  geometry: ExpressionFilterSpecification,
  layout: Record<string, unknown> = {},
): CSPLayer[] {
  return [
    {
      type: "symbol",
      // S-52 gives the isolated-danger symbol ScaleMinimum "infinite": it must
      // never be scaled off the display base.
      ignoreScamin: true,
      filter: ["all", geometry, isolatedDanger(config, hazard)],
      layout: { ...iconLayout("ISODGR01"), ...layout },
    },
    {
      type: "symbol",
      family: "shallow-water-dangers",
      displayCategory: "STANDARD",
      filter: ["all", geometry, shallowWaterDanger(config, hazard)],
      layout: { ...iconLayout("ISODGR01"), ...layout },
    },
  ];
}

/**
 * WRECKS05 - 13.2.21 Wrecks (S-52 PresLib 4.0, section 13.2.21)
 *
 * Applies to S-57 object class WRECKS (point and area).
 * Attributes: VALSOU, CATWRK, WATLEV, EXPSOU
 *
 * Point wrecks:
 *   - Isolated danger (VALSOU <= safetyContour, underwater) → ISODGR01
 *   - VALSOU <= safetyDepth → DANGER01 (shallow hazard)
 *   - VALSOU > safetyDepth → DANGER02 (deep hazard)
 *   - No VALSOU → symbol based on CATWRK/WATLEV from lookup table
 *
 * Area wrecks:
 *   - Fill: CHBRN (WATLEV 1,2), DEPIT (WATLEV 4), DEPVS (default/3/5)
 *   - Line: dotted CHBLK if danger or shallow, dashed CHBLK if deep, else by WATLEV
 */
export function WRECKS05(config: LayerConfig): CSPLayer[] {
  const { mode, safetyDepth } = config;
  const hazard: HazardClass = "WRECKS";
  const isDanger = isolatedDangerShown(config, hazard);
  const notDanger = notIsolatedDanger(config, hazard);

  /** The plain wreck symbol, by CATWRK/WATLEV (S-52 Continuation A table). */
  const wreckSymbol: ExpressionSpecification = [
    "case",
    // WATLEV 1 (partly submerged) or 2 (always dry) → visible wreck
    ["in", ["get", "WATLEV"], ["literal", [1, 2]]],
    "WRECKS01",
    // WATLEV 4 (covers/uncovers) → drying wreck
    ["==", ["get", "WATLEV"], 4],
    "WRECKS01",
    // CATWRK 1 (non-dangerous) + WATLEV 3 (always underwater)
    ["all", ["==", ["get", "CATWRK"], 1], ["==", ["get", "WATLEV"], 3]],
    "WRECKS04",
    // CATWRK 2 (dangerous) + WATLEV 3
    ["all", ["==", ["get", "CATWRK"], 2], ["==", ["get", "WATLEV"], 3]],
    "WRECKS05",
    // CATWRK 4 or 5 (showing mast/funnel)
    ["in", ["get", "CATWRK"], ["literal", [4, 5]]],
    "WRECKS01",
    // Default
    "WRECKS05",
  ];

  return [
    // --- Point wrecks ---

    // Isolated danger: ISODGR01 (from UDWHAZ05)
    ...isolatedDangerLayers(config, hazard, ["==", ["geometry-type"], "Point"]),

    // Has sounding, shallow (not isolated danger) → DANGER01
    {
      type: "symbol",
      filter: [
        "all",
        ["==", ["geometry-type"], "Point"],
        notDanger,
        ["has", "VALSOU"],
        ["<=", ["get", "VALSOU"], safetyDepth],
      ],
      layout: iconLayout("DANGER01"),
    },

    // Has sounding, deep (not isolated danger).
    // DELIBERATE DEVIATION FROM S-52 — plain symbol instead of DANGER02. A
    // wreck below the safety depth is not a danger to own ship; the danger
    // circle on every deep wreck buries the shoal ones. The sounding is still
    // drawn by the SNDFRM04 layer below.
    {
      type: "symbol",
      filter: [
        "all",
        ["==", ["geometry-type"], "Point"],
        notDanger,
        ["has", "VALSOU"],
        [">", ["get", "VALSOU"], safetyDepth],
      ],
      layout: iconLayout(wreckSymbol),
    },

    // Sounding text on top of the point symbols (SNDFRM04)
    SNDFRM04(config, "VALSOU", [
      "all",
      ["==", ["geometry-type"], "Point"],
      notDanger,
      ["has", "VALSOU"],
    ]),

    // No sounding → symbol by CATWRK/WATLEV (S-52 Continuation A lookup table).
    // `notDanger` matters here now: with the DEPVAL02 fail-safe ladder an
    // unsounded wreck can be an isolated danger, and then ISODGR01 replaces
    // this symbol rather than sitting on top of it.
    {
      type: "symbol",
      filter: [
        "all",
        ["==", ["geometry-type"], "Point"],
        notDanger,
        ["!", ["has", "VALSOU"]],
      ],
      layout: iconLayout(wreckSymbol),
    },

    // --- Area wrecks ---

    // Area fill based on WATLEV
    {
      type: "fill",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: {
        "fill-color": [
          "case",
          // WATLEV 1,2 → land/brown
          ["in", ["get", "WATLEV"], ["literal", [1, 2]]],
          colour(mode, "CHBRN"),
          // WATLEV 4 → intertidal
          ["==", ["get", "WATLEV"], 4],
          colour(mode, "DEPIT"),
          // Default (3, 5, or missing) → very shallow
          colour(mode, "DEPVS"),
        ] as ExpressionSpecification,
      },
    },

    // Area outline: dotted for dangers/shallow, dashed for deep, default by WATLEV
    {
      type: "line",
      filter: [
        "all",
        ["==", ["geometry-type"], "Polygon"],
        [
          "any",
          isDanger,
          ["all", ["has", "VALSOU"], ["<=", ["get", "VALSOU"], safetyDepth]],
        ],
      ],
      paint: {
        "line-dasharray": LineStyles.DOTT,
        "line-width": 2,
        "line-color": colour(mode, "CHBLK"),
      },
    },
    {
      type: "line",
      filter: [
        "all",
        ["==", ["geometry-type"], "Polygon"],
        notDanger,
        ["has", "VALSOU"],
        [">", ["get", "VALSOU"], safetyDepth],
      ],
      paint: {
        "line-dasharray": LineStyles.DASH,
        "line-width": 2,
        "line-color": colour(mode, "CHBLK"),
      },
    },
    // No VALSOU, WATLEV 1,2 → solid line
    {
      type: "line",
      filter: [
        "all",
        ["==", ["geometry-type"], "Polygon"],
        notDanger,
        ["!", ["has", "VALSOU"]],
        ["in", ["get", "WATLEV"], ["literal", [1, 2]]],
      ],
      paint: {
        "line-width": 2,
        "line-color": colour(mode, "CSTLN"),
      },
    },
    // No VALSOU, WATLEV 4 → dashed line
    {
      type: "line",
      filter: [
        "all",
        ["==", ["geometry-type"], "Polygon"],
        notDanger,
        ["!", ["has", "VALSOU"]],
        ["==", ["get", "WATLEV"], 4],
      ],
      paint: {
        "line-dasharray": LineStyles.DASH,
        "line-width": 2,
        "line-color": colour(mode, "CSTLN"),
      },
    },
    // No VALSOU, other WATLEV → dotted line
    {
      type: "line",
      filter: [
        "all",
        ["==", ["geometry-type"], "Polygon"],
        notDanger,
        ["!", ["has", "VALSOU"]],
        ["!", ["in", ["get", "WATLEV"], ["literal", [1, 2, 4]]]],
      ],
      paint: {
        "line-dasharray": LineStyles.DOTT,
        "line-width": 2,
        "line-color": colour(mode, "CSTLN"),
      },
    },

    // Sounding text on area wrecks with VALSOU (SNDFRM04)
    SNDFRM04(config, "VALSOU", [
      "all",
      ["==", ["geometry-type"], "Polygon"],
      notDanger,
      ["has", "VALSOU"],
    ]),

    // Area wreck isolated danger symbol at center
    ...isolatedDangerLayers(config, hazard, [
      "==",
      ["geometry-type"],
      "Polygon",
    ]),
  ];
}
