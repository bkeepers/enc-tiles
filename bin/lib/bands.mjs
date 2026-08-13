// ENC usage bands (S-57 DSID_INTU) and the zoom range each one is tiled at,
// ordered from the smallest scale to the largest. Kept in sync with
// packages/styles/src/bands.ts and with the case statement in bin/s57-to-tiles
// by test/bands.test.ts.
//
// No npm dependencies: .github/workflows/tiles.yml never runs `npm install`.
export const BANDS = [
  { name: "overview", intu: 1, minzoom: 0, maxzoom: 6 },
  { name: "general", intu: 2, minzoom: 7, maxzoom: 8 },
  { name: "coastal", intu: 3, minzoom: 9, maxzoom: 10 },
  { name: "approach", intu: 4, minzoom: 11, maxzoom: 12 },
  { name: "harbour", intu: 5, minzoom: 13, maxzoom: 14 },
  { name: "berthing", intu: 6, minzoom: 15, maxzoom: 16 },
];

/**
 * Resolve the band a tileset belongs to from its PMTiles header minzoom.
 * Returns undefined for a minzoom no band claims, which is how a degenerate
 * z0/z0 archive gets caught.
 */
export function bandForMinzoom(minzoom) {
  return BANDS.find((band) => band.minzoom === minzoom);
}
