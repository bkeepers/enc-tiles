import type { Header, PMTiles } from "pmtiles";
import { requireArchiveHeader } from "./require-archive-header.js";

export interface BandArchive {
  url: string;
  pmtiles: Pick<PMTiles, "getHeader">;
}

/**
 * Reads every band's PMTiles header concurrently, and only fails once all
 * of them have settled.
 *
 * A first version of this used `Promise.all`, which rejects as soon as the
 * first band fails and abandons the rest -- fine for a single missing
 * archive, but the scenario this whole check exists for is a half-failed
 * bulk upload (e.g. to R2), where more than one band can plausibly be
 * missing at once. With `Promise.all`, an operator would see one failure,
 * fix that archive, redeploy, and only then discover the next one -- a
 * slow loop for something that could have been reported in one pass.
 * `Promise.allSettled` waits for every request instead, so every failing
 * band is known and reported together. This costs nothing in wall-clock
 * time: the six requests already run concurrently either way: the only
 * change is choosing to wait for the slowest one to settle rather than
 * bailing out on the first to fail.
 *
 * On failure, throws an `AggregateError` whose `.errors` are the individual
 * `requireArchiveHeader` errors -- each already naming its band, URL and
 * underlying cause.
 */
export async function loadArchiveHeaders<Name extends string>(
  bands: readonly { name: Name }[],
  archives: Record<Name, BandArchive>,
): Promise<Record<Name, Header>> {
  const results = await Promise.allSettled(
    bands.map(async (band) => {
      const { url, pmtiles } = archives[band.name];
      return [
        band.name,
        await requireArchiveHeader(band.name, url, pmtiles),
      ] as const;
    }),
  );

  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((failure) => failure.reason as Error),
      failures.length === 1
        ? "1 tile archive failed to load"
        : `${failures.length} tile archives failed to load`,
    );
  }

  return Object.fromEntries(
    (results as PromiseFulfilledResult<readonly [Name, Header]>[]).map(
      (result) => result.value,
    ),
  ) as Record<Name, Header>;
}
