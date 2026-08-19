import { expect, test } from "vitest";
import { readFileSync } from "fs";
import { JSDOM } from "jsdom";
// @ts-expect-error -- the build plugin is untyped plain JS
import { PX_PER_MM } from "../build/symbols.js";
import { symbols } from "../src/index.js";

test("returns symbol data", () => {
  expect(symbols["BCNCAR01"]).toEqual({
    description: "cardinal beacon, north, simplified",
    height: 24,
    offset: [0, 0],
    width: 16,
    box: [0, 0, 15.194, 23.131],
  });
});

/**
 * The glyph box the drawing itself declares, recomputed from the generated day
 * SVG: `[dx, dy, w, h]` px, `dx`/`dy` from the sprite's centre to the glyph
 * box's centre and `w`/`h` the box's size.
 *
 * Only a `symbolBox` that is a direct child of the root <svg> is the sprite's
 * own: the pattern tiles and line marks paste whole symbols inside a
 * `<g transform>`, so those boxes are in another frame and belong to a lattice
 * cell rather than to the sprite.
 */
function glyphBoxFromSvg(key: string): number[] | undefined {
  const source = readFileSync(
    new URL(`../symbols/day/${key}.svg`, import.meta.url),
    "utf8",
  );
  const svg = new JSDOM(source, {
    contentType: "image/svg+xml",
  }).window.document.querySelector("svg") as Element;

  const rect = [...svg.children].find(
    (el) =>
      el.tagName === "rect" &&
      (el.getAttribute("class") ?? "").split(/\s+/).includes("symbolBox"),
  );
  if (!rect) return undefined;

  const [minX, minY, width, height] = (svg.getAttribute("viewBox") ?? "")
    .split(/ |,/)
    .map(Number) as [number, number, number, number];
  const [x, y, w, h] = ["x", "y", "width", "height"].map((name) =>
    Number(rect.getAttribute(name) ?? 0),
  ) as [number, number, number, number];

  // `+ 0` normalizes -0 the way JSON.stringify does, so a box a hair left of
  // centre compares equal to the value that survived the file.
  const px = (mm: number) => Math.round(mm * PX_PER_MM * 1000) / 1000 + 0;
  return [
    px(x + w / 2 - (minX + width / 2)),
    px(y + h / 2 - (minY + height / 2)),
    px(w),
    px(h),
  ];
}

test(
  "records the glyph box of every sprite whose drawing declares one",
  { timeout: 60_000 },
  () => {
    const drawn: Record<string, number[]> = {};
    const recorded: Record<string, number[]> = {};

    for (const key of Object.keys(symbols)) {
      const box = glyphBoxFromSvg(key);
      if (box) drawn[key] = box;
      const metrics = symbols[key]?.box;
      if (metrics) recorded[key] = metrics;
    }

    // Every catalogue symbol has one; only the generated pattern tiles and
    // line marks do not, so this is most of the sheet.
    expect(Object.keys(drawn).length).toBeGreaterThan(500);
    expect(recorded).toEqual(drawn);
  },
);

test("leaves the generated pattern tiles and line marks without a box", () => {
  // Their `symbolBox` rects sit inside a `<g transform>` and describe a
  // pasted-in symbol's lattice cell, not the sprite's own glyph.
  expect(symbols["AP_DIAMOND1"]?.box).toBeUndefined();
  expect(symbols["LM_NAVARE51"]?.box).toBeUndefined();
});

test("puts INFARE51's glyph well to the right of its pivot", () => {
  // The measured case: S-52 hangs the "i" of the RESTRN cascade 14–22 mm right
  // of the pivot, so the sprite is mostly empty and `offset` alone leaves the
  // glyph off any anchor a consumer centres one symbol on.
  const box = symbols["INFARE51"]?.box;
  expect(box).toBeDefined();
  expect(box?.[0]).toBeGreaterThan(20);
  expect(symbols["INFARE51"]?.offset).toEqual([42, 5.5]);
});
