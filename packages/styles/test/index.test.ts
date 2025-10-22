import s52style from "../src/index.js";
import { test, expect } from "vitest";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";

test("creates a valid style", () => {
  const style = s52style({ source: { type: "vector", url: "test.mbtiles" } });
  const result = validateStyleMin(style);
  if (result.length > 0) {
    expect.fail(`Style is not valid: ${JSON.stringify(result, null, 2)}`);
  }
});
