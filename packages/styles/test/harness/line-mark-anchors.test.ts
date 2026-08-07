/**
 * Regression harness for the END-OF-LINE SUPPRESSION note in `LC` — the one
 * behaviour of `symbol-placement: "line"` that the `line-pattern` it replaced
 * did not have.
 *
 * MapLibre reserves room for a line-placed symbol at BOTH ends of the line it
 * rides: `get_anchors.ts` accepts an anchor only where `markedDistance ±
 * labelLength/2` fits inside the line, and offsets the first one by
 * `(shapedLabelLength/2 + 2·glyphSize) · boxScale`. Both lengths scale with
 * `boxScale`, which `symbol_layout.ts` computes as `tilePixelRatio · text-size
 * / 24` — from the layer's `text-size` even on an icon-only layer, which is
 * why `LC` sets it to 0.
 *
 * A closed ring is ONE polyline and `clipLine` cuts every ring at the tile
 * edge, so at the default `text-size` of 16 a caution-area boundary lost about
 * a whole repeat of teeth at its closure vertex and at every tile seam, and a
 * ring smaller than the reservation got no teeth at all.
 *
 * These cases drive MapLibre's own `getAnchors` with the layout the generator
 * actually emits, rather than restating the arithmetic.
 */
import { describe, expect, test } from "vitest";
import Point from "@mapbox/point-geometry";
import { getAnchors } from "maplibre-gl/src/symbol/get_anchors";
import type { SymbolLayerSpecification } from "maplibre-gl";
import { symbols } from "@enc-tiles/s52";
import { instructionsToStyles } from "../../src/instructions/index.js";
import type { LayerConfig } from "../../src/symbolology/index.js";

const config: LayerConfig = {
  source: "enc",
  mode: "DAY",
  shallowDepth: 3.0,
  safetyDepth: 6.0,
  deepDepth: 9.0,
};

/** `symbol_layout.ts`: `bucket.tilePixelRatio = EXTENT / tileSize`. */
const EXTENT = 8192;
const TILE_PIXEL_RATIO = EXTENT / 512;
/** `symbol_layout.ts`: `const glyphSize = 24`. */
const GLYPH_SIZE = 24;
/** MapLibre's default `text-size`, which an icon-only layer inherits. */
const DEFAULT_TEXT_SIZE = 16;
/** Ring size for the gap cases, in repeats. Deliberately not a whole number. */
const RING_REPEATS = 10.5;

/** The mark layer `LC(<name>)` emits. */
function markLayer(name: string): SymbolLayerSpecification {
  const styles = instructionsToStyles(`LC(${name})`, config);
  const marks = styles.find((style) => style.type === "symbol");
  expect(marks, `LC(${name}) emitted no mark layer`).toBeDefined();
  return marks as SymbolLayerSpecification;
}

/**
 * A closed square ring of the given on-screen perimeter, in tile units, placed
 * well inside the tile so `clipLine` and `getAnchors`' own in-tile test do not
 * come into it — this file is about the LINE ends, not the tile edges.
 */
function ring(perimeterPx: number): Point[] {
  const side = (perimeterPx / 4) * TILE_PIXEL_RATIO;
  const origin = 100;
  expect(origin + side, "ring does not fit inside one tile").toBeLessThan(
    EXTENT,
  );
  return [
    new Point(origin, origin),
    new Point(origin + side, origin),
    new Point(origin + side, origin + side),
    new Point(origin, origin + side),
    new Point(origin, origin),
  ] as Point[];
}

/**
 * The anchor distances along a ring, in screen pixels — MapLibre's own
 * placement, fed the layout the generator emits.
 */
function anchorDistances(
  layout: SymbolLayerSpecification["layout"],
  spriteWidth: number,
  perimeterPx: number,
): number[] {
  const textSize =
    (layout?.["text-size"] as number | undefined) ?? DEFAULT_TEXT_SIZE;
  const boxScale = (TILE_PIXEL_RATIO * textSize) / GLYPH_SIZE;
  // `shapeIcon` centres the quad on the anchor, so `right - left` is the
  // sprite's own width; nothing else about the shaping reaches `getAnchors`.
  const shapedIcon = {
    left: -spriteWidth / 2,
    right: spriteWidth / 2,
    top: 0,
    bottom: 0,
  };
  const line = ring(perimeterPx);
  const anchors = getAnchors(
    line,
    (layout!["symbol-spacing"] as number) * TILE_PIXEL_RATIO,
    Math.PI / 4,
    // No text is shaped on an icon-only layer.
    null as never,
    shapedIcon as never,
    GLYPH_SIZE,
    boxScale,
    1,
    EXTENT,
  );

  const side = (perimeterPx / 4) * TILE_PIXEL_RATIO;
  return anchors.map((anchor: Point & { segment: number }) => {
    const start = line[anchor.segment];
    return (anchor.segment * side + start.dist(anchor)) / TILE_PIXEL_RATIO;
  });
}

/** The largest run of boundary with no mark on it, closure vertex included. */
function largestGap(distances: number[], perimeterPx: number): number {
  if (distances.length === 0) return perimeterPx;
  const sorted = [...distances].sort((a, b) => a - b);
  let worst = sorted[0]! + (perimeterPx - sorted[sorted.length - 1]!);
  for (let i = 1; i < sorted.length; i++) {
    worst = Math.max(worst, sorted[i]! - sorted[i - 1]!);
  }
  return worst;
}

describe("line-placed boundary marks reach the ends of the line", () => {
  // The widest mark sprites in the catalogue and therefore the worst case: a
  // line style packs a whole repeat interval's glyphs into one sprite.
  //
  // The widths are each ONE MORE than the ink they hold: the mark box is grown
  // out to whole CSS pixels so the rasterizer cannot drop the fraction, which
  // it was doing to the right leg of PRCARE51's fourth dentate tooth
  // (`lineMarkGeometry`, packages/s52). The padding is at most a pixel and it
  // is symmetric, so the reservation these anchors are placed against moves by
  // at most half a pixel.
  test.each([
    ["CTNARE51", 106],
    ["PRCARE51", 106],
    ["ACHARE51", 106],
    ["TIDINF51", 108],
    ["RESARE51", undefined],
  ])("%s", (name, expectedWidth) => {
    const layout = markLayer(name).layout!;
    const sprite = symbols[layout["icon-image"] as string]!;
    expect(sprite).toBeDefined();
    if (expectedWidth !== undefined) expect(sprite.width).toBe(expectedWidth);

    const spacing = layout["symbol-spacing"] as number;

    // A ring some ten-and-a-half repeats round -- deliberately NOT a whole
    // number of them, which is the case a real ring is in and the case that
    // makes the closure vertex bite. No gap anywhere may exceed the repeat the
    // style asks for. The half-tile-unit slack is `Anchor._round()`, which
    // snaps every anchor to integer tile coordinates.
    const perimeter = RING_REPEATS * spacing;
    const big = anchorDistances(layout, sprite.width, perimeter);
    expect(big.length).toBeGreaterThanOrEqual(10);
    expect(largestGap(big, perimeter)).toBeLessThanOrEqual(spacing + 0.5);

    // A ring SHORTER than the reservation the default text-size would impose
    // (half the sprite plus 48 px, scaled) still gets its mark: a small
    // precautionary or caution area is exactly the case where the boundary is
    // the only thing distinguishing it from the plain presentation.
    const small = anchorDistances(layout, sprite.width, 60);
    expect(small.length).toBeGreaterThanOrEqual(1);
  });

  test("the layout zeroes the anchor box scale, and that is what does it", () => {
    const layout = markLayer("CTNARE51").layout!;
    expect(layout["text-size"]).toBe(0);

    // The counterfactual, so this file fails loudly if `text-size` is ever
    // dropped rather than quietly going back to a hole per ring. At MapLibre's
    // default the same CTNARE ring loses roughly a whole repeat at its closure
    // vertex, and a 60 px ring gets nothing at all.
    const sprite = symbols["LM_CTNARE51"]!;
    const spacing = layout["symbol-spacing"] as number;
    const withDefault = { ...layout, "text-size": DEFAULT_TEXT_SIZE };

    const perimeter = RING_REPEATS * spacing;
    expect(
      largestGap(
        anchorDistances(withDefault, sprite.width, perimeter),
        perimeter,
      ),
    ).toBeGreaterThan(spacing * 1.4);
    expect(anchorDistances(withDefault, sprite.width, 60)).toHaveLength(0);
  });
});
