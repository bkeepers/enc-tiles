import { LineLayerSpecification } from "maplibre-gl";
import { test, expect } from "vitest";
import { instructionsToStyles } from "../../src/instructions/index.js";

test("LS(DASH,2,CHMGD)", () => {
  const styles = instructionsToStyles("LS(DASH,2,CHMGD)");
  expect(styles).toHaveLength(1);
  const style = styles[0] as LineLayerSpecification;
  expect(style.type).toBe("line");
  expect(style.paint!["line-color"]).toBe("#C045D1");
  expect(style.paint!["line-width"]).toBe(2);
  expect(style.paint!["line-dasharray"]).toEqual([3.6, 1.8]);
});

test("LC(ACHARE51)", () => {
  const styles = instructionsToStyles("LC(ACHARE51)");
  expect(styles).toHaveLength(1);
  const style = styles[0] as LineLayerSpecification;
  expect(style.type).toBe("line");
  expect(style.paint!["line-pattern"]).toBe("ACHARE51");
});
