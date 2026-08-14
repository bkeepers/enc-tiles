import { expect, test } from "vitest";
import { PMTiles } from "pmtiles";
import { loadArchiveHeaders } from "../src/load-archive-headers.js";
import {
  FailingSource,
  FixedBytesSource,
  HTML_FALLBACK_BYTES,
  validPmtilesBytes,
} from "./support/fake-pmtiles-source.js";

const BANDS = [
  { name: "overview" },
  { name: "general" },
  { name: "coastal" },
  { name: "approach" },
  { name: "harbour" },
  { name: "berthing" },
] as const;

function validArchive(name: string) {
  return {
    url: `https://example.test/noaa-${name}.pmtiles`,
    pmtiles: new PMTiles(new FixedBytesSource(name, validPmtilesBytes())),
  };
}

test("resolves a header per band when every archive is valid", async () => {
  const archives = Object.fromEntries(
    BANDS.map((band) => [band.name, validArchive(band.name)]),
  ) as Record<(typeof BANDS)[number]["name"], ReturnType<typeof validArchive>>;

  const headers = await loadArchiveHeaders(BANDS, archives);

  for (const band of BANDS) {
    expect(headers[band.name].minZoom).toBe(0);
  }
});

// This is the property `Promise.all` would violate: it rejects on the
// first failure and abandons the rest, so only one of the two bad bands
// would ever be reported. Putting `Promise.all` back here should make this
// test fail by dropping one of the two band names from the error.
test("reports every failing band, not just the first, when several archives are bad", async () => {
  const archives = {
    overview: validArchive("overview"),
    general: validArchive("general"),
    coastal: {
      url: "http://localhost:4173/tiles/noaa-coastal.pmtiles",
      pmtiles: new PMTiles(
        new FixedBytesSource("coastal-fallback", HTML_FALLBACK_BYTES),
      ),
    },
    approach: validArchive("approach"),
    harbour: validArchive("harbour"),
    berthing: {
      url: "http://localhost:4173/tiles/noaa-berthing.pmtiles",
      pmtiles: new PMTiles(new FailingSource("berthing-missing")),
    },
  };

  let caught: unknown;
  try {
    await loadArchiveHeaders(BANDS, archives);
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(AggregateError);
  const aggregate = caught as AggregateError;
  expect(aggregate.errors).toHaveLength(2);

  const messages = aggregate.errors.map((error: unknown) =>
    error instanceof Error ? error.message : String(error),
  );
  expect(messages).toEqual(
    expect.arrayContaining([
      expect.stringContaining('band "coastal"'),
      expect.stringContaining('band "berthing"'),
    ]),
  );
  // ... and each still names its own URL and underlying cause, exactly as
  // a single-failure error would.
  expect(
    messages.find((message) => message.includes('band "coastal"')),
  ).toContain("Wrong magic number for PMTiles archive");
  expect(
    messages.find((message) => message.includes('band "berthing"')),
  ).toContain("network error");
});

test("reports a single failing band the same way it always did", async () => {
  const archives = {
    overview: validArchive("overview"),
    general: validArchive("general"),
    coastal: validArchive("coastal"),
    approach: validArchive("approach"),
    harbour: validArchive("harbour"),
    berthing: {
      url: "http://localhost:4173/tiles/noaa-berthing.pmtiles",
      pmtiles: new PMTiles(new FailingSource("berthing-missing")),
    },
  };

  let caught: unknown;
  try {
    await loadArchiveHeaders(BANDS, archives);
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(AggregateError);
  const aggregate = caught as AggregateError;
  expect(aggregate.errors).toHaveLength(1);
  expect((aggregate.errors[0] as Error).message).toContain('band "berthing"');
});
