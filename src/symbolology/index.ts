import preslib from '../../data/PresLib_e4.0.0.json' with { type: 'json' };
import type { Colors } from "../themes/index.js";
import type { BackgroundLayerSpecification, ExpressionFilterSpecification, LayerSpecification } from "maplibre-gl";
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
  return [
    background(config),
    ...getLookups(config).flatMap((lookup, i) => {
      return instructionsToStyles(lookup.inst).map((layer, j) => {
        const priority = sortKey(lookup.dpri, layer);
        return {
          ...layer,
          ...(lookup.attc.length > 0 ? { filter: filter(lookup.attc) } : {}),
          layout: {
            ...layer.layout,
            [`${layer.type}-sort-key`]: priority,
          },
          source: "enc",
          "source-layer": lookup.obcl,
          id: [lookup.obcl, layer.type, lookup.rcid, i, j].join('-'),
        }
      });
    })
  ];
}

function background({ colors }: LayerConfig): BackgroundLayerSpecification {
  return {
    id: 'background',
    type: 'background',
    paint: {
      'background-color': colors.NODTA!,
    }
  }
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
