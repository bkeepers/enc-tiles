import {
  ExpressionFilterSpecification,
  ExpressionSpecification,
} from "maplibre-gl";

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
    if (c.attv === "?") {
      return ["!", ["has", c.attl]];
    } else if (c.attv) {
      // The S-52 look-up table always gives ATTV as a string ("4", "3,4,3"),
      // but the tiler writes S-57 *enumerated* attributes as MVT integers and
      // only list-type attributes as comma-separated strings. Comparing
      // ["get", attl] to the string literal therefore silently never matched
      // for the ~42 enumerated attributes (BOYSHP, CATLAM, CATZOC, CATOBS,
      // WATLEV, TOPSHP, ...): buoys/beacons/moorings fell through to the
      // catch-all look-up entries (BOYDEF03 grey "?", MORFAC03 square) and
      // every CATZOC/CATOBS/WATLEV/TOPSHP-conditioned entry was dead.
      //
      // Coercing the feature value to a string makes the comparison
      // type-agnostic: integers stringify to "4", list strings pass through
      // unchanged, and an absent property coerces to "" (which never equals a
      // non-empty ATTV, so absence still fails the test as it did before).
      return ["==", ["to-string", ["get", c.attl]], c.attv];
    } else {
      return ["has", c.attl];
    }
  });

  return filters;
}

/**
 * Test whether a list-type attribute contains any of the given values.
 *
 * List attributes are stored as comma-separated strings (e.g. "7,8,14").
 * To prevent false positives (e.g. "7" matching "17"), both the attribute
 * value and search term are wrapped with commas before substring matching:
 *   search for ",7," in ",7,8,14," → true
 *   search for ",7," in ",17,"     → false
 *
 * @example
 *   listIncludes("RESTRN", "7", "8", "14")
 *   // → ["any", ["in", ",7,", [...concat...]], ["in", ",8,", ...], ...]
 */
export function listIncludes(
  attr: string,
  ...values: string[]
): ExpressionFilterSpecification {
  const wrapped: ExpressionSpecification = ["concat", ",", ["get", attr], ","];
  const conditions = values.map(
    (v) =>
      ["in", `,${v},`, wrapped] as unknown as ExpressionFilterSpecification,
  );
  if (conditions.length === 1) return conditions[0]!;
  return ["any", ...conditions];
}

/**
 * Test whether a list-type attribute contains a given value, for use in
 * expression contexts (paint, layout) rather than filter contexts.
 *
 * @example
 *   listContains("COLOUR", "1")
 *   // → ["in", ",1,", ["concat", ",", ["get", "COLOUR"], ","]]
 */
export function listContains(
  attr: string,
  value: string,
): ExpressionSpecification {
  return [
    "in",
    `,${value},`,
    ["concat", ",", ["get", attr], ","],
  ] as unknown as ExpressionSpecification;
}

/**
 * Test whether a list-type attribute does NOT contain any of the given values.
 */
export function listExcludes(
  attr: string,
  ...values: string[]
): ExpressionFilterSpecification {
  return ["!", listIncludes(attr, ...values)];
}

/**
 * Filter for low quality position (QUAPOS).
 *
 * QUAPOS values 1 (surveyed), 10 (precise), 11 (calculated) indicate good quality.
 * Any other QUAPOS value indicates low quality. Features without QUAPOS are assumed accurate.
 */
export function quaposLowQuality(): ExpressionFilterSpecification {
  return [
    "all",
    ["has", "QUAPOS"],
    ["!", ["in", ["to-number", ["get", "QUAPOS"]], ["literal", [1, 10, 11]]]],
  ];
}
