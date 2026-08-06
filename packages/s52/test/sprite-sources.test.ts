/**
 * The sprite sheet has to contain the area fills and complex line styles, not
 * just `data.symbols`.
 *
 * MapLibre resolves an unknown `fill-pattern`/`line-pattern` to an arbitrary
 * image from the sprite atlas rather than drawing nothing, so a missing pattern
 * is not a blank area — it is the wrong symbol, silently. AP(NODATA03) on
 * unsurveyed water came out tiled with the MARCUL02 fish.
 *
 * spreet/GDAL are not available here, so this checks the SVG stage: every
 * pattern and line style resolves to a well-formed drawing with a non-zero
 * viewBox.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "fs";
import { JSDOM } from "jsdom";
// @ts-expect-error -- the build plugin is untyped plain JS
import { sourceSvg, spriteSources } from "../build/symbols.js";

const data = JSON.parse(
  readFileSync(new URL("../data.json", import.meta.url), "utf8"),
);
const sources = spriteSources(data) as {
  name: string;
  description: string;
  kind: string;
}[];

function viewBoxOf(svgText: string): number[] {
  const svg = new JSDOM(svgText, {
    contentType: "image/svg+xml",
  }).window.document.querySelector("svg");
  expect(svg, "parsed as SVG").not.toBeNull();
  return svg!.getAttribute("viewBox")!.split(/ |,/).map(Number);
}

describe("sprite sources", () => {
  test("covers symbols, patterns and line styles", () => {
    const kinds = sources.reduce<Record<string, number>>((counts, source) => {
      counts[source.kind] = (counts[source.kind] ?? 0) + 1;
      return counts;
    }, {});
    expect(kinds).toEqual({
      symbol: data.symbols.length,
      pattern: data.patterns.length,
      linestyle: data.linestyles.length,
    });
    expect(kinds["pattern"]).toBe(25);
  });

  test("every source resolves to a drawing with a non-zero viewBox", () => {
    const undrawable: string[] = [];
    for (const source of sources) {
      const svgText = sourceSvg(source) as string | undefined;
      if (!svgText) {
        undrawable.push(source.name);
        continue;
      }
      // Cheap parse: JSDOM on all 600+ sources is far too slow for a gate.
      const viewBox = /viewBox="([^"]+)"/.exec(svgText);
      expect(
        viewBox,
        `${source.kind} ${source.name} has a viewBox`,
      ).not.toBeNull();
      const [, , width, height] = viewBox![1]!.split(/ |,/).map(Number);
      expect(width, `${source.kind} ${source.name} width`).toBeGreaterThan(0);
      expect(height, `${source.kind} ${source.name} height`).toBeGreaterThan(0);
    }
    // LOWACC11 is in the DAI but has neither a drawing nor an S-101
    // definition, and nothing in the style references it.
    expect(undrawable).toEqual(["LOWACC11"]);
  });

  test("the patterns and line styles the style references are drawable", () => {
    // NODATA03 is the unsurveyed-area fill; MARSYS51 the IALA-A/B boundary
    // line style. Neither ships as an SVG — both are synthesized from their
    // S-101 definitions.
    for (const name of [
      "NODATA03",
      "MARSYS51",
      "DQUALA21",
      "DRGARE01",
      "FOULAR01",
      "MARCUL02",
      "PIPSOL05",
      "RECTRC09",
    ]) {
      const source = sources.find((s) => s.name === name);
      expect(source, `${name} is a sprite source`).toBeDefined();
      const svgText = sourceSvg(source!) as string;
      const [, , width, height] = viewBoxOf(svgText);
      expect(width, `${name} width`).toBeGreaterThan(0);
      expect(height, `${name} height`).toBeGreaterThan(0);
      // A tile with no drawing in it would rasterize to a blank sprite, which
      // is just as wrong as a missing one.
      expect(svgText, `${name} draws something`).toMatch(
        /<(path|g|circle|rect)/,
      );
    }
  });

  test("pattern tiles carry the referenced symbol's geometry", () => {
    // NODATA03 repeats NODATA03P, a single 0.64mm CHGRD stroke.
    const nodata = sourceSvg(sources.find((s) => s.name === "NODATA03")!);
    expect(nodata).toContain("sCHGRD");
    const [minX, minY, width, height] = viewBoxOf(nodata as string);
    expect([minX, minY]).toEqual([0, 0]);
    // v1 = (7.02, 0), v2 = (3.51, 4.96) → a 7.02 x 9.92 mm staggered tile.
    expect(width).toBeCloseTo(7.02, 2);
    expect(height).toBeCloseTo(9.92, 2);
  });

  test("line style tiles carry their dashes and embedded symbols", () => {
    // MARSYS51: 25.5mm interval, four CHGRD dashes, EMMARS01 + EMMARS02.
    const marsys = sourceSvg(
      sources.find((s) => s.name === "MARSYS51")!,
    ) as string;
    const [, , width] = viewBoxOf(marsys);
    expect(width).toBeCloseTo(25.5, 2);
    expect(marsys).toContain(" M 2,0 L 5,0");
    expect(marsys).toContain(" M 22.5,0 L 25.5,0");
    // Both embedded symbols are inlined at their positions, not referenced.
    expect(marsys).toContain('transform="translate(7.31,0)"');
    expect(marsys).toContain('transform="translate(20.44,0)"');
    // EMMARS01's "A" stroke.
    expect(marsys).toContain("M -1,1.4 L 0,-1.6 L 1,1.4");
  });
});
