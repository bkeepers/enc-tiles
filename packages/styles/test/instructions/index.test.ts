import { describe, expect, test } from "vitest";
import { build, filter, LayerConfig } from "../../src/symbolology";

const config: LayerConfig = {
  source: "enc",
  mode: "DAY",
  shallowDepth: 3.0, // meters (9.8 feet)
  safetyDepth: 6.0, // meters (19.6 feet)
  deepDepth: 9.0, // meters (29.5 feet)
};

test("symbology from lookups", () => {
  build(config);
  expect(true).toBe(true);
});
