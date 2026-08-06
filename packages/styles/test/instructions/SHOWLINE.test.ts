import { LineLayerSpecification } from "maplibre-gl";
import { test, expect } from "vitest";
import s52, { symbols } from "@enc-tiles/s52";
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
  // The LC_ prefix keeps the line style clear of the ACHARE51 *symbol*, which
  // owns the bare name in the sprite sheet and was being tiled along the
  // boundary in its place.
  expect(style.paint!["line-pattern"]).toBe("LC_ACHARE51");
  // MapLibre stretches the pattern to the line width, so the width has to be
  // the tile's own height or the style is squashed into a smear.
  expect(style.paint!["line-width"]).toBe(symbols["LC_ACHARE51"].height);
  expect(style.paint!["line-width"]).toBeGreaterThan(1);
});

test("every LC() in the look-up tables resolves to a prefixed sprite", () => {
  // Every LC name in the DAI, so a catalogue update that adds one with no
  // sprite is caught here rather than by MapLibre substituting an arbitrary
  // image from the atlas.
  const names = new Set(
    [...JSON.stringify(s52).matchAll(/LC\\?\(([A-Z0-9]+)\\?\)/g)].map(
      (match) => match[1]!,
    ),
  );
  expect(names.size).toBeGreaterThan(30);

  for (const name of names) {
    const styles = instructionsToStyles(`LC(${name})`, config);
    expect(styles, `LC(${name}) emits a layer`).toHaveLength(1);
    const style = styles[0] as LineLayerSpecification;
    expect(style.paint!["line-pattern"], name).toBe(`LC_${name}`);
    expect(style.paint!["line-width"], `${name} width`).toBe(
      symbols[`LC_${name}`].height,
    );
  }
});

test("LC() drops the layer when the line style has no sprite", () => {
  // LOWACC11 is in the DAI but has neither a drawing nor an S-101 definition.
  // Emitting the layer would put an arbitrary sprite on the line.
  const warn = console.warn;
  const warnings: unknown[] = [];
  console.warn = (...args: unknown[]) => warnings.push(args[0]);
  try {
    expect(instructionsToStyles("LC(LOWACC11)", config)).toEqual([]);
  } finally {
    console.warn = warn;
  }
  expect(warnings).toEqual(["Missing line style: LOWACC11"]);
});
