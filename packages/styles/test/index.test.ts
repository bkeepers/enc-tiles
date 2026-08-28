import s52style, { symbols } from "../src/index.js";
import { test, expect } from "vitest";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";

test("creates a valid style", () => {
  const style = s52style({ source: { type: "vector", url: "test.mbtiles" } });
  const result = validateStyleMin(style);
  if (result.length > 0) {
    expect.fail(`Style is not valid: ${JSON.stringify(result, null, 2)}`);
  }
});

test("exports the sprite metrics the style is drawn against", () => {
  // A consumer that places ONE symbol per area needs `box` to centre the glyph
  // on its own anchor, since `offset` centres the whole sprite on the pivot.
  expect(symbols["INFARE51"]).toEqual({
    description: "area with minor restrictions or information notices",
    width: 86,
    height: 33,
    offset: [42, 5.5],
    box: [26.381, 0, 30.387, 30.425],
  });
  expect(Object.keys(symbols).length).toBeGreaterThan(500);
});
