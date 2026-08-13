import { expect, test } from "vitest";
import { PMTiles } from "pmtiles";
import { requireArchiveHeader } from "../src/require-archive-header.js";
import {
  FailingSource,
  FixedBytesSource,
  HTML_FALLBACK_BYTES,
  validPmtilesBytes,
} from "./support/fake-pmtiles-source.js";

test("passes the header through when the archive is valid", async () => {
  const pmtiles = new PMTiles(
    new FixedBytesSource("valid", validPmtilesBytes()),
  );

  const header = await requireArchiveHeader(
    "harbour",
    "https://example.test/noaa-harbour.pmtiles",
    pmtiles,
  );

  expect(header.minZoom).toBe(0);
  expect(header.maxZoom).toBe(6);
});

test("names the band and URL when the response isn't a PMTiles archive", async () => {
  const pmtiles = new PMTiles(
    new FixedBytesSource("fallback", HTML_FALLBACK_BYTES),
  );

  await expect(
    requireArchiveHeader(
      "overview",
      "http://localhost:4173/tiles/noaa-overview.pmtiles",
      pmtiles,
    ),
  ).rejects.toThrow(
    'Tile archive for band "overview" did not load from http://localhost:4173/tiles/noaa-overview.pmtiles: Wrong magic number for PMTiles archive',
  );
});

test("names the band and URL when the request fails outright", async () => {
  const pmtiles = new PMTiles(new FailingSource("missing"));

  await expect(
    requireArchiveHeader(
      "berthing",
      "http://localhost:4173/tiles/noaa-berthing.pmtiles",
      pmtiles,
    ),
  ).rejects.toThrow(
    'Tile archive for band "berthing" did not load from http://localhost:4173/tiles/noaa-berthing.pmtiles: network error',
  );
});

test("keeps the original error as the cause", async () => {
  const pmtiles = new PMTiles(new FailingSource("missing"));

  await expect(
    requireArchiveHeader("berthing", "https://example.test", pmtiles),
  ).rejects.toMatchObject({ cause: expect.any(Error) });
});
