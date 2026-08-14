import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { readPmtilesHeader } from "../bin/lib/pmtiles-header.mjs";

// A PMTiles v3 header is 127 bytes: "PMTiles" + version, then offsets, with
// minzoom at byte 100 and maxzoom at byte 101.
function writeHeader(minzoom: number, maxzoom: number, magic = "PMTiles") {
  const header = Buffer.alloc(127);
  header.write(magic, 0, "ascii");
  header.writeUInt8(3, 7);
  header.writeUInt8(minzoom, 100);
  header.writeUInt8(maxzoom, 101);

  const path = join(mkdtempSync(join(tmpdir(), "pmtiles-")), "fixture.pmtiles");
  writeFileSync(path, header);
  return path;
}

test("reads the zoom range out of the header", () => {
  expect(readPmtilesHeader(writeHeader(13, 14))).toEqual({
    minzoom: 13,
    maxzoom: 14,
  });
});

test("rejects a file that is not a PMTiles archive", () => {
  expect(() => readPmtilesHeader(writeHeader(13, 14, "NOTPMT!"))).toThrow(
    /not a PMTiles archive/,
  );
});

test("rejects a file shorter than a header", () => {
  const path = join(mkdtempSync(join(tmpdir(), "pmtiles-")), "short.pmtiles");
  writeFileSync(path, Buffer.alloc(10));

  expect(() => readPmtilesHeader(path)).toThrow(/too short/);
});
