import type { Header, PMTiles } from "pmtiles";

/**
 * Reads and validates one band's PMTiles archive by fetching its header.
 *
 * `PMTiles#getHeader()` already refuses to treat non-PMTiles bytes as an
 * archive: it reads the first bytes of the resource and checks the PMTiles
 * magic number, the same property `bin/lib/pmtiles-header.mjs` checks (over
 * the first seven ASCII bytes, "PMTiles") when validating a freshly built
 * archive. That check is what catches a static host answering a missing
 * file with its SPA fallback -- HTTP 200/206, `content-type: text/html`,
 * and an HTML body -- instead of a 404: the fallback's bytes don't start
 * with the magic number, so `getHeader()` rejects instead of treating the
 * HTML as archive data.
 *
 * The one thing `getHeader()` doesn't do on its own is say *which* archive
 * failed -- its errors ("Wrong magic number for PMTiles archive", a raw
 * network failure, ...) don't mention a band or a URL. This wraps it so the
 * band name and URL are always in the message, whatever the underlying
 * cause.
 */
export async function requireArchiveHeader(
  band: string,
  url: string,
  pmtiles: Pick<PMTiles, "getHeader">,
): Promise<Header> {
  try {
    return await pmtiles.getHeader();
  } catch (cause) {
    throw new Error(
      `Tile archive for band "${band}" did not load from ${url}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      { cause },
    );
  }
}
