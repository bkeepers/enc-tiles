import { expect, test } from "vitest";
import { build, LayerConfig } from "../../src/symbolology";

const config: LayerConfig = {
  sources: ["enc"],
  mode: "DAY",
  shallowDepth: 3.0, // meters (9.8 feet)
  safetyDepth: 6.0, // meters (19.6 feet)
  deepDepth: 9.0, // meters (29.5 feet)
};

test("symbology from lookups", () => {
  const layers = build(config);

  expect(layers.length).toBeGreaterThan(0);

  for (const layer of layers) {
    expect(layer.id).toBeTruthy();
    if (layer.type === "background") continue;
    expect(layer.source).toBe("enc");
    expect(layer["source-layer"]).toBeTruthy();
  }
});
