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
  const isDanger = isolatedDanger(config);
  const notDanger = notIsolatedDanger(config);

  /** WATLEV 4 (covers and uncovers) or 5 (awash). */
  const awash: ExpressionFilterSpecification = [
    "in",
    ["get", "WATLEV"],
    ["literal", [4, 5]],
  ];

  return [
    // ─── Point obstructions (Continuation A) ───

    // Isolated danger → ISODGR01
    {
      type: "symbol",
      filter: ["all", ["==", ["geometry-type"], "Point"], isDanger],
      layout: iconLayout("ISODGR01"),
    },

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

    // Sounding text on rocks, except the WATLEV 4,5 case above where S-52
    // explicitly sets SOUNDING = FALSE.
    {
      objectClasses: ["UWTROC"],
      ...SNDFRM04(config, "VALSOU", [
        "all",
        ["==", ["geometry-type"], "Point"],
        notDanger,
        ["has", "VALSOU"],
        ["!", ["all", ["<=", ["get", "VALSOU"], safetyDepth], awash]],
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
      layout: iconLayout([
        "case",
        ["==", ["get", "WATLEV"], 3],
        "UWTROC03",
        "UWTROC04",
      ] as ExpressionSpecification),
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

    // Has VALSOU, not isolated danger, not CATOBS 6, VALSOU > safetyDepth → DANGER02.
    // Shared by both classes: S-52 sends deep rocks here too.
    {
      type: "symbol",
      filter: [
        "all",
        ["==", ["geometry-type"], "Point"],
        notDanger,
        ["has", "VALSOU"],
        ["!=", ["get", "CATOBS"], 6],
        [">", ["get", "VALSOU"], safetyDepth],
      ],
      layout: iconLayout("DANGER02"),
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
    {
      type: "symbol",
      filter: ["all", ["==", ["geometry-type"], "LineString"], isDanger],
      layout: {
        ...iconLayout("ISODGR01"),
        "symbol-placement": "line",
      },
    },

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
    {
      type: "symbol",
      filter: ["all", ["==", ["geometry-type"], "Polygon"], isDanger],
      layout: iconLayout("ISODGR01"),
    },

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

/**
 * UDWHAZ05 - 13.2.20 Isolated dangers in general that endanger own ship
 * (S-52 PresLib 4.0, section 13.2.20)
 *
 * Not called directly from lookup tables -- used as a helper by WRECKS05 and OBSTRN07.
 *
 * A feature is an isolated danger when:
 *   - VALSOU <= safetyContour (hazard is shallow enough to matter)
 *   - _DEPARE_DRVAL1 >= safetyContour (hazard lies within safe water)
 *   - WATLEV is NOT 1 or 2 (feature is underwater)
 *
 * _DEPARE_DRVAL1 is pre-computed by the pipeline via spatial query (DRVAL1 of
 * the containing DEPARE/DRGARE polygon).
 *
 * Skipped for WATLEV 1 (partly submerged) or 2 (always dry) per spec, as these
 * are above-water dangers that don't get the isolated danger symbol.
 */
export function UDWHAZ05(
  config: LayerConfig,
): Partial<LayerSpecification> | undefined {
  return {
    type: "symbol",
    filter: isolatedDanger(config),
    layout: iconLayout("ISODGR01"),
  };
}

/**
 * Filter for features that are isolated dangers per UDWHAZ05:
 *   - VALSOU exists and <= safetyContour
 *   - _DEPARE_DRVAL1 >= safetyContour (hazard lies within safe water)
 *   - WATLEV is NOT 1 (partly submerged) or 2 (always dry)
 */
export function isolatedDanger(
  config: LayerConfig,
): ExpressionFilterSpecification {
  return [
    "all",
    ["has", "VALSOU"],
    ["<=", ["get", "VALSOU"], config.safetyContour],
    [">=", ["get", "_DEPARE_DRVAL1"], config.safetyContour],
    [
      "any",
      ["!", ["has", "WATLEV"]],
      ["!", ["in", ["get", "WATLEV"], ["literal", [1, 2]]]],
    ],
  ];
}

/**
 * Filter expression for features that are NOT isolated dangers.
 * Used by WRECKS05/OBSTRN07 to avoid double-symbolizing hazards
 * that are already shown with the ISODGR01 symbol.
 */
export function notIsolatedDanger(
  config: LayerConfig,
): ExpressionFilterSpecification {
  return ["!", isolatedDanger(config)];
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
export function WRECKS05(config: LayerConfig): Partial<LayerSpecification>[] {
  const { mode, safetyDepth } = config;
  const isDanger = isolatedDanger(config);
  const notDanger = notIsolatedDanger(config);

  return [
    // --- Point wrecks ---

    // Isolated danger: ISODGR01 (from UDWHAZ05)
    {
      type: "symbol",
      filter: ["all", ["==", ["geometry-type"], "Point"], isDanger],
      layout: iconLayout("ISODGR01"),
    },

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

    // Has sounding, deep (not isolated danger) → DANGER02
    {
      type: "symbol",
      filter: [
        "all",
        ["==", ["geometry-type"], "Point"],
        notDanger,
        ["has", "VALSOU"],
        [">", ["get", "VALSOU"], safetyDepth],
      ],
      layout: iconLayout("DANGER02"),
    },

    // Sounding text on top of DANGER symbols (SNDFRM04)
    SNDFRM04(config, "VALSOU", [
      "all",
      ["==", ["geometry-type"], "Point"],
      notDanger,
      ["has", "VALSOU"],
    ]),

    // No sounding → symbol by CATWRK/WATLEV (S-52 Continuation A lookup table)
    {
      type: "symbol",
      filter: [
        "all",
        ["==", ["geometry-type"], "Point"],
        ["!", ["has", "VALSOU"]],
      ],
      layout: iconLayout([
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
      ] as ExpressionSpecification),
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
    {
      type: "symbol",
      filter: ["all", ["==", ["geometry-type"], "Polygon"], isDanger],
      layout: iconLayout("ISODGR01"),
    },
  ];
}
