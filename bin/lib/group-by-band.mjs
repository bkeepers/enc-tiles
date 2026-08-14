import { BANDS, bandForMinzoom } from "./bands.mjs";
import { readPmtilesHeader } from "./pmtiles-header.mjs";

/**
 * Group per-chart PMTiles archives by usage band, in band order.
 *
 * @param {string[]} paths
 * @param {(path: string) => { minzoom: number, maxzoom: number }} readHeader
 * @returns {Map<string, string[]>} band name -> archive paths, band order,
 *   empty bands omitted
 */
export function groupByBand(paths, readHeader = readPmtilesHeader) {
  const groups = new Map();
  const unclaimed = [];

  for (const path of paths) {
    const { minzoom, maxzoom } = readHeader(path);
    const band = bandForMinzoom(minzoom);

    if (!band || band.maxzoom !== maxzoom) {
      unclaimed.push(`${path} (z${minzoom}-${maxzoom})`);
      continue;
    }

    groups.set(band.name, [...(groups.get(band.name) ?? []), path]);
  }

  if (unclaimed.length > 0) {
    throw new Error(
      `These archives do not match any usage band and were probably produced by a failed conversion:\n  ${unclaimed.join("\n  ")}`,
    );
  }

  // Re-key in band order so the style can stack the archives smallest scale first.
  return new Map(
    BANDS.filter((band) => groups.has(band.name)).map((band) => [
      band.name,
      groups.get(band.name),
    ]),
  );
}
