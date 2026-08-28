import { expect, test } from "vitest";
import { FillLayerSpecification, LineLayerSpecification } from "maplibre-gl";
import { instructionsToStyles } from "../../src/instructions/index.js";
import { LayerConfig } from "../../src/symbolology/index.js";

const config: LayerConfig = {
  source: "enc",
  mode: "DAY",
  shallowDepth: 3.0,
  safetyDepth: 6.0,
  deepDepth: 9.0,
};

test("AC(CHBRN)", () => {
  const styles = instructionsToStyles("AC(CHBRN)", config);
  expect(styles).toHaveLength(1);
  const style = styles[0] as FillLayerSpecification;
  expect(style.type).toBe("fill");
  expect(style.paint!["fill-color"]).toBe("#A19653");
  expect(style.paint!["fill-opacity"]).toBe(1.0);
});

test("AC(TRFCF,3)", () => {
  const styles = instructionsToStyles("AC(TRFCF,3)", config);
  expect(styles).toHaveLength(1);
  const style = styles[0] as FillLayerSpecification;
  expect(style.type).toBe("fill");
  expect(style.paint!["fill-color"]).toBe("#CBA9F9");
  expect(style.paint!["fill-opacity"]).toBe(0.25);
});

test("AP(DQUALA21)", () => {
  const styles = instructionsToStyles("AP(DQUALA21)", config);
  expect(styles).toHaveLength(1);
  const style = styles[0] as FillLayerSpecification;
  expect(style.type).toBe("fill");
  // AP_ prefix: S-52's pattern name space is not MapLibre's sprite name space,
  // and four fills share a name with a point symbol.
  expect(style.paint!["fill-pattern"]).toBe("AP_DQUALA21");
});
