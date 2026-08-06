import { LineLayerSpecification } from "maplibre-gl";
import { test, expect } from "vitest";
import { instructionsToStyles } from "../../src/instructions/index.js";
import { LayerConfig } from "../../src/symbolology/index.js";

const config: LayerConfig = {
  source: "enc",
  mode: "DAY",
  shallowDepth: 3.0,
  safetyDepth: 6.0,
  deepDepth: 9.0,
};

test("LS(DASH,2,CHMGD)", () => {
  const styles = instructionsToStyles("LS(DASH,2,CHMGD)", config);
  expect(styles).toHaveLength(1);
  const style = styles[0] as LineLayerSpecification;
  expect(style.type).toBe("line");
  expect(style.paint!["line-color"]).toBe("#C045D1");
  expect(style.paint!["line-width"]).toBe(2);
  expect(style.paint!["line-dasharray"]).toEqual([3.6, 1.8]);
});

test("LS(SOLD,1,CHBLK) omits line-dasharray", () => {
  const styles = instructionsToStyles("LS(SOLD,1,CHBLK)", config);
  expect(styles).toHaveLength(1);
  const style = styles[0] as LineLayerSpecification;
  expect(style.type).toBe("line");
  // An empty dasharray makes MapLibre draw nothing, so a solid line must have
  // no line-dasharray key at all.
  expect(style.paint!).not.toHaveProperty("line-dasharray");
  expect(style.paint!["line-width"]).toBe(1);
});

test("LS(DOTT,1,CHBLK) keeps its dasharray", () => {
  const styles = instructionsToStyles("LS(DOTT,1,CHBLK)", config);
  const style = styles[0] as LineLayerSpecification;
  expect(style.paint!["line-dasharray"]).toEqual([0.6, 1.2]);
});

test("LC(ACHARE51)", () => {
  const styles = instructionsToStyles("LC(ACHARE51)", config);
  expect(styles).toHaveLength(1);
  const style = styles[0] as LineLayerSpecification;
  expect(style.type).toBe("line");
  expect(style.paint!["line-pattern"]).toBe("ACHARE51");
});
