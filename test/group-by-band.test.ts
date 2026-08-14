import { expect, test } from "vitest";
import { groupByBand } from "../bin/lib/group-by-band.mjs";

const headers: Record<string, { minzoom: number; maxzoom: number }> = {
  "tiles/US1EEZ1M/US1EEZ1M.pmtiles": { minzoom: 0, maxzoom: 6 },
  "tiles/US3CA70M/US3CA70M.pmtiles": { minzoom: 9, maxzoom: 10 },
  "tiles/US5CA63M/US5CA63M.pmtiles": { minzoom: 13, maxzoom: 14 },
  "tiles/US5CA65M/US5CA65M.pmtiles": { minzoom: 13, maxzoom: 14 },
  "tiles/USBROKEN/USBROKEN.pmtiles": { minzoom: 0, maxzoom: 0 },
};

const readHeader = (path: string) => headers[path]!;

test("groups archives by band, keeping band order", () => {
  const groups = groupByBand(
    [
      "tiles/US5CA63M/US5CA63M.pmtiles",
      "tiles/US1EEZ1M/US1EEZ1M.pmtiles",
      "tiles/US5CA65M/US5CA65M.pmtiles",
      "tiles/US3CA70M/US3CA70M.pmtiles",
    ],
    readHeader,
  );

  expect([...groups.keys()]).toEqual(["overview", "coastal", "harbour"]);
  expect(groups.get("harbour")).toEqual([
    "tiles/US5CA63M/US5CA63M.pmtiles",
    "tiles/US5CA65M/US5CA65M.pmtiles",
  ]);
});

// A z0/z0 archive is what bin/s57-to-tiles used to emit when the usage band was
// undeterminable. Task 1 stops producing them; this stops them being merged.
test("rejects an archive whose zoom range matches no band", () => {
  expect(() =>
    groupByBand(
      ["tiles/US1EEZ1M/US1EEZ1M.pmtiles", "tiles/USBROKEN/USBROKEN.pmtiles"],
      readHeader,
    ),
  ).toThrow(/USBROKEN/);
});
