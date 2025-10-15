
import { ExpressionSpecification, LayerSpecification } from "maplibre-gl";
import { Reference } from "./parser.js";
import { colours } from '@enc-tiles/s52';
import { LineStyles } from "./SHOWLINE.js";

const procs = { DEPARE03, DEPCNT03, RESTRN01 }

export function CS(ref: Reference) {
  if (ref.name in procs) {
    return procs[ref.name]();
  } else {
    console.warn(`CS(${ref.name}) not implemented yet`);
  }
}

/** DEPARE03 - 13.2.1 Depth area colour fill and dredged area pattern fill */
export function DEPARE03(): Partial<LayerSpecification>[] {
  return [{
    type: 'fill',
    paint: {
      'fill-color': [
        'let', 'drval1', ['coalesce', ['get', 'DRVAL1'], -1],
        [
          'let', 'drval2', ['coalesce', ['get', 'DRVAL2'], ['+', ['var', 'drval1'], 0.01]],
          SEABED01()
        ]
      ],
      // TODO: shallow pattern
      // 'fill-pattern': DIAMOND1
    }
  }];
}

/** DEPCNT03 - 13.2.2 Depth contours, including safety contour */
export function DEPCNT03(): Partial<LayerSpecification>[] {
  // MapLibre doesn't express data expressions in `line-dasharray`, so need to split into two layers with filters
  const qualityExpression: ExpressionSpecification = ['all', ['has', 'QUAPOS'], ['in', ['get', 'QUAPOS'], ['literal', ['1', '10', '11']]]]
  return [
    {
      type: 'line',
      filter: qualityExpression,
      paint: {
        'line-dasharray': LineStyles.DASH,
        'line-width': 1,
        'line-color': colours.DAY.DEPCN,
      }
    },
    {
      type: 'line',
      filter: ["!", qualityExpression],
      paint: {
        'line-width': 1,
        'line-color': colours.DAY.DEPCN,
      }
    },
    {
      type: 'symbol',

    },
    // TODO: add user pref to display contour labels
    ...SAFECON01()
  ];
}

/** TODO: DEPVAL02 - 13.2.3 Depth value */
/** TODO: LIGHTS06 - 13.2.4 Light flares, light sectors & light coverage */
/** TODO: LITDSN02 - 10.6.3 Light description text string */
/** TODO: OBSTRN07 - 13.2.5 Obstructions and rocks */
/** TODO: QUAPOS01 - 13.2.6 Quality(accuracy) of position */
/** TODO: QUALIN01 - 13.2.7 Quality of position of line objects */
/** TODO: QUAPNT02 - 13.2.8 Quality of position of point and area objects */
/** TODO: RESARE04 - 13.2.9 Restricted areas - object class RESARE  */

/** RESTRN01 - 13.2.10 Entry procedure for restrictions */
export function RESTRN01(): Partial<LayerSpecification>[] {
  return [
    // {
    //   filter: ['has', 'RESTRN'],
    // }
  ];
}

/** TODO: RESCSP02 - 13.2.11 Restrictions – attribute RESTRN */

/** SAFCON01 - 13.2.12 Contour labels, including safety contour */
export function SAFECON01(): Partial<LayerSpecification>[] {
  return [
    {
      type: 'symbol',
      filter: [
        'all',
        ['has', 'VALDCO'],
        ['>', ['get', 'VALDCO'], 0],
        ['<', ['get', 'VALDCO'], 99999],
      ],
      layout: {
        'symbol-placement': 'line',
        'text-size': 12,
        'text-field': [
          'case',
          ['<', ['get', 'VALDCO'], 31],
          ["number-format", ["get", "VALDCO"], { "min-fraction-digits": 0, "max-fraction-digits": 0 }],
          ["number-format", ["floor", ["get", "VALDCO"]], {}]
        ],
        'text-font': ['Metropolis Regular'],
      },
      paint: {
        'text-halo-color': 'rgba(255, 255, 255, 0.5)',
        'text-halo-width': 1,
        'text-color': colours.DAY.CHBLK
      }
    }
  ];
}

/** SLCONS04 - 13.2.13 Shoreline constructions, including accuracy of position */

/** SEABED01 - 13.2.14 Colour fill for depth areas */
export function SEABED01({
  theme = colours.DAY,
  shallowDepth = 2.0,
  safetyDepth = 6.0,
  deepDepth = 30.0,
} = {}): ExpressionSpecification {
  return [
    "case",
    ["all", [">=", ["var", "drval1"], deepDepth], [">", ["var", "drval2"], deepDepth]], theme.DEPDW!,
    ["all", [">=", ["var", "drval1"], safetyDepth], [">", ["var", "drval2"], safetyDepth]], theme.DEPMD!,
    ["all", [">=", ["var", "drval1"], shallowDepth], [">", ["var", "drval2"], shallowDepth]], theme.DEPMS!,
    ["all", [">=", ["var", "drval1"], 0], [">", ["var", "drval2"], 0]], theme.DEPVS!,
    theme.DEPIT!
  ]
}

/** SNDFRM04 - 13.2.15 Symbolizing soundings, including safety depth */
/** SOUNDG03 - 13.2.16 Entry procedure for symbolizing soundings */
/** SYMINS02 - 13.2.17 Symbolizing encoded objects specified by IMO */
/** TOPMAR01 - 13.2.18 Topmarks */
/** UDWHAZ05 - 13.2.19 Isolated dangers in general that endanger own ship */
/** WRECKS05 - 13.2.20 Wrecks */
