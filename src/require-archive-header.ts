import type { Header, PMTiles } from "pmtiles";

/**
 * Reads and validates one band's PMTiles archive by fetching its header.
 *
 * `PMTiles#getHeader()` already refuses to treat non-PMTiles bytes as an
 * archive: it reads the first bytes of the resource and checks that the
 * first two of them decode to the PMTiles magic number ("PM") -- a
 * narrower check than `bin/lib/pmtiles-header.mjs`'s (which confirms all
 * seven ASCII bytes of "PMTiles" when validating a freshly built archive),
 * but enough to catch a static host answering a missing file with its SPA
 * fallback -- HTTP 200/206, `content-type: text/html`, and an HTML body --
 * instead of a 404: the fallback's bytes don't start with "PM", so
 * `getHeader()` rejects instead of treating the HTML as archive data.
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
