/**
 * Narrow the band table to the archives a tileset actually ships.
 *
 * A full NOAA build has all six, and that is the default. Smaller tilesets
 * do not: `bin/fixture-tiles` builds two charts, which yield a coastal and a
 * harbour archive and nothing else. Since the viewer refuses to start unless
 * every band it expects loads -- deliberately, so a half-failed upload is
 * reported rather than silently rendered as a hole -- such a tileset needs a
 * way to say which bands to expect. `VITE_TILESET_BANDS=coastal,harbour`
 * does that.
 *
 * Unknown names throw instead of being ignored: a typo would otherwise
 * silently drop a band, which looks exactly like the missing-charts bug this
 * whole branch exists to fix.
 *
 * The result keeps the table's own order, which is the stacking order of the
 * style -- smallest scale first -- regardless of the order asked for.
 */
export function selectBands<Band extends { name: string }>(
  bands: readonly Band[],
  requested: string | undefined,
): Band[] {
  if (requested === undefined) return [...bands];

  const names = requested
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);

  const known = new Set(bands.map((band) => band.name));
  const unknown = names.filter((name) => !known.has(name));
  if (unknown.length > 0) {
    throw new Error(
      `VITE_TILESET_BANDS: unknown band(s) ${unknown.join(", ")} ` +
        `(known bands: ${[...known].join(", ")})`,
    );
  }

  if (names.length === 0) {
    throw new Error(
      `VITE_TILESET_BANDS is empty; omit it entirely to load every band ` +
        `(${[...known].join(", ")})`,
    );
  }

  const wanted = new Set(names);
  return bands.filter((band) => wanted.has(band.name));
}
