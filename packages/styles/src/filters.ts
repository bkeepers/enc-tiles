import { ExpressionFilterSpecification } from "maplibre-gl";

/**
 * Helper for constructing `all` expressions.
 * @see https://maplibre.org/maplibre-style-spec/expressions/#all
 */
export function all(
  ...filters: ExpressionFilterSpecification[]
): ExpressionFilterSpecification {
  // Remove undefined/null
  filters = filters.filter(Boolean);

  if (filters.length === 0) return true;
  if (filters.length === 1 && filters[0]) return filters[0];
  return ["all", ...filters];
}

// Earth's circumference in meters
const C = 2 * Math.PI * 6378137;

export function scaleFilter({
  tilesize = 512,
} = {}): ExpressionFilterSpecification {
  const K = Math.round(C / (tilesize * 0.00028)); // Scale denominator constant

  return [
    "all",
    [
      "any",
      ["!", ["has", "SCAMIN"]],
      [">=", ["zoom"], ["log2", ["/", K, ["get", "SCAMIN"]]]],
    ],
    [
      "any",
      ["!", ["has", "SCAMAX"]],
      ["<=", ["zoom"], ["log2", ["/", K, ["get", "SCAMAX"]]]],
    ],
  ];
}

export function attributeFilters(
  conditions: { attl: string; attv?: string }[],
): ExpressionFilterSpecification[] {
  if (conditions.length === 0) return [];
  const filters: ExpressionFilterSpecification[] = conditions.map((c) => {
    if (c.attv) {
      return ["==", ["get", c.attl], c.attv];
    } else {
      return ["has", c.attl];
    }
  });

  return filters;
}
