/**
 * ENC usage bands (S-57 DSID_INTU) and the zoom range each one is tiled at,
 * ordered from the smallest scale to the largest — which is also the order the
 * style stacks them in. Kept in sync with bin/lib/bands.mjs by test/bands.test.ts.
 */
export const BANDS = [
  { name: "overview", intu: 1, minzoom: 0, maxzoom: 6 },
  { name: "general", intu: 2, minzoom: 7, maxzoom: 8 },
  { name: "coastal", intu: 3, minzoom: 9, maxzoom: 10 },
  { name: "approach", intu: 4, minzoom: 11, maxzoom: 12 },
  { name: "harbour", intu: 5, minzoom: 13, maxzoom: 14 },
  { name: "berthing", intu: 6, minzoom: 15, maxzoom: 16 },
] as const;

export type BandName = (typeof BANDS)[number]["name"];
