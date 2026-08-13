import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

// The depth of an S-57 sounding is its Z coordinate, which MVT cannot carry.
// These GDAL options split the multipoints and lift the depth into an
// attribute, so the style has something to label.
test("the conversion asks GDAL for sounding depths", () => {
  const script = readFileSync("bin/s57-to-tiles", "utf8");

  expect(script).toMatch(/OGR_S57_OPTIONS=/);
  expect(script).toMatch(/SPLIT_MULTIPOINT=ON/);
  expect(script).toMatch(/ADD_SOUNDG_DEPTH=ON/);
});
