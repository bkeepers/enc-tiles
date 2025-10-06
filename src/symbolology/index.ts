import preslib from '../../data/PresLib_e4.0.0.json' with { type: 'json' };
import type { Colors } from "../themes/index.js";
import type { ExpressionFilterSpecification, LayerSpecification } from "maplibre-gl";
import { LookupEntry } from "../dai.js";
import { instructionsToStyles } from '../instructions/index.js';

export interface LayerConfig {
  colors: Colors;
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


export function build(config: LayerConfig): LayerSpecification[] {
  return getLookups(config).flatMap((lookup, i) => {
    return instructionsToStyles(lookup.inst).map((layer, j) => {
      const priority = sortKey(lookup.dpri, layer);
      return {
        ...layer,
        filter: filter(lookup.attc),
        layout: {
          ...layer.layout,
          [`${layer.type}-sort-key`]: priority,
        },
        source: "enc",
        "source-layer": lookup.obcl,
        id: [lookup.obcl, layer.type, lookup.rcid, i, j].join('-'),
      }
    });
  });
}


/**
 * From Section 12 (p 110):
 * > The ECDIS must provide the mariner with the ability to select between "paper chart" and "simplified" point
 * > symbols and also between "plain boundaries" and "symbolized boundaries" area symbols."
 */
export function getLookups({ boundaries = BoundaryType.PLAIN, symbols = SymbolType.SIMPLIFIED } = {}) {
  const sets = [
    'LINES',
    boundaries === BoundaryType.PLAIN ? 'PLAIN_BOUNDARIES' : 'SYMBOLIZED_BOUNDARIES',
    symbols === SymbolType.SIMPLIFIED ? 'SIMPLIFIED' : 'PAPER_CHART'
  ];

  return preslib.lookups.filter(l => sets.includes(l.tnam)) as LookupEntry[];
}

const TypePriority = { symbol: 1, line: 2, fill: 3 }

/**
 * Calculate a sort key for a layer based on its display priority and type. (Section 10.3.4.1, p 70)
 *
 * @returns a sort key number (0-99), higher numbers are drawn on top of lower numbers
 */
export function sortKey(priority: number, layer: LayerSpecification): number {
  // Point objects on top of line objects on top of area objects
  let typePriority = TypePriority[layer.type] ?? 0;
  // Text must be drawn last
  if (layer.layout?.['text-field']) typePriority += 1;
  return (priority * 10) + typePriority;
}

export function filter(conditions: { attl: string, attv?: string }[]): ExpressionFilterSpecification {
  if (conditions.length === 0) return true;
  const filters: ExpressionFilterSpecification[] = conditions.map(c => {
    if (c.attv) {
      return ["==", ["get", c.attl], c.attv];
    } else {
      return ["has", c.attl];
    }
  });

  return filters.length === 1 ? filters[0]! : ["all", ...filters];
}

/**

SENC, or some other neutral criterion, must be used for an arbitrary decision as to which object
is drawn on top. Text must be drawn last (except for own ship etc.), in priority 8.
The display priority must be used to ensure that objects that overlap each other are drawn in the
right sequence. Thus, an object with a higher priority must be drawn after (on top of) an object
70
S-52 PresLib e4.0.0 Part I September 2014
with a lower display priority. However, if two line objects, or two area boundaries, or a line and
an area boundary, are located at the same position and share the same extent (their
coordinates are identical), then the line symbolization with the higher display priority must
suppress the line symbolization of the other object (line or area). Therefore only the line
symbolization of the object (line or area) of the higher display priority is drawn. Where two
objects share the same spatial edge and both have the same display priorities each line must
be symbolized.
Fig 6. Symbolization of shared edges
The coastline object is symbolized with a solid line while the anchorage area is bordered with a
dashed line. Both objects share an edge that is part of the coastline. The symbolization of the
coastline object suppresses the border of the anchorage area since the display priority of the
coastline symbolization is higher. Note that priorities have to be evaluated again, if the
presentation scale changes (see section 8.4).
This suppression only applies to line objects and area boundaries. The rule for centred symbols,
area patterns and point symbols is that all symbols must be drawn with the highest priority
object being drawn last independent of the geometric primitive (point, line or area).
There is one exception to this rule for suppressing overlapping lines. The manual chart
correction lines LC(CHCRIDnn) and LC(CHCRDELn) must coexist with the underlying line. Both
LC(CHCRIDnn) or LC(CHCRDELn) and the underlying line must be drawn.
Overdrawing may be essential, for example in the case of a buoy, and its name and light flare.
These are given offsets in the symbol library to avoid the symbols being drawn over each other.

*/
