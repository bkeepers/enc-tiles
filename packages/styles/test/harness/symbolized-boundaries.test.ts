/**
 * Regression harness for the RESARE04 boundary under symbolized boundaries.
 *
 * S-52 lets the mariner choose "plain boundaries" or "symbolized boundaries",
 * and RESARE04 is reached from both look-up tables. It used to draw the plain
 * dashed magenta line in both — the symbolized branch was a TODO — so a
 * restricted area looked identical either way, with none of the inward-facing
 * ticks that say which side of the line the restriction is on.
 *
 * These cases build the real style both ways and read the boundary layer's
 * paint off it.
 */
import { describe, expect, test } from "vitest";
import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import { symbols } from "@enc-tiles/s52";
import { BoundaryType } from "../../src/symbolology/index.js";
import { buildStyle, icons, matchingLayers, type Match } from "./evaluate.js";

const plain = buildStyle();
const symbolized = buildStyle({ boundaries: BoundaryType.SYMBOLIZED });

/** Every layer of one type matching a RESARE polygon. */
function boundaryLayers(
  style: StyleSpecification,
  properties: Record<string, unknown>,
  type: string,
): LayerSpecification[] {
  return matchingLayers(style, "RESARE", properties, "Polygon")
    .filter((match: Match) => match.type === type)
    .map((match: Match) =>
      style.layers.find(
        (candidate: LayerSpecification) => candidate.id === match.id,
      )!,
    );
}

/** The paint of every line layer matching a RESARE polygon. */
function boundaryPaint(
  style: StyleSpecification,
  properties: Record<string, unknown>,
): Record<string, unknown>[] {
  return boundaryLayers(style, properties, "line").map(
    (layer) =>
      ((layer as { paint?: Record<string, unknown> }).paint ?? {}) as Record<
        string,
        unknown
      >,
  );
}

/** The line style a layer is half of, if any. */
function linestyleOf(layer: LayerSpecification): unknown {
  return (layer as { metadata?: Record<string, unknown> }).metadata?.[
    "s52:linestyle"
  ];
}

/**
 * The layout of the boundary MARK layers of a RESARE polygon.
 *
 * Selected by the line style they name rather than by being symbol layers: the
 * centred restriction symbol (ENTRES51 and friends) is a symbol layer over the
 * same feature and is not part of the boundary.
 */
function boundaryMarks(
  style: StyleSpecification,
  properties: Record<string, unknown>,
): Record<string, unknown>[] {
  return boundaryLayers(style, properties, "symbol")
    .filter((layer) => linestyleOf(layer) !== undefined)
    .map(
      (layer) =>
        ((layer as { layout?: Record<string, unknown> }).layout ??
          {}) as Record<string, unknown>,
    );
}

describe("RESARE restriction boundaries", () => {
  test("plain boundaries keep the dashed magenta line", () => {
    const paint = boundaryPaint(plain, { RESTRN: "7" });
    expect(paint).toHaveLength(1);
    expect(paint[0]!["line-pattern"]).toBeUndefined();
    expect(paint[0]!["line-color"]).toBe("#C045D1");
    expect(paint[0]!["line-dasharray"]).toEqual([3.6, 1.8]);
  });

  test.each([
    // The restriction families are SPLIT line styles (round 13): the repeated
    // tick rides the bare LM_ key at the lattice pitch and the family's
    // once-per-interval glyph rides the _2 key at the interval — two mark
    // layers. CTYARE51 places a single glyph kind and stays one layer.
    ["entry restricted", "7", "ENTRES", 2],
    ["entry prohibited", "8", "ENTRES", 2],
    ["anchoring prohibited", "1", "ACHRES", 2],
    ["fishing prohibited", "3", "FSHRES", 2],
    ["own-ship restriction", "13", "CTYARE", 1],
  ])(
    "symbolized boundaries draw the %s line style",
    (_label, restrn, family, markLayers) => {
      const paint = boundaryPaint(symbolized, { RESTRN: restrn });
      expect(paint).toHaveLength(1);

      // THE PEN. No pattern at all: the line half of a complex line style is
      // an ordinary dash schedule now, and the marks ride a symbol layer of
      // their own so MapLibre's along-line pattern stretch cannot reach them.
      expect(paint[0]!["line-pattern"]).toBeUndefined();
      expect(paint[0]!["line-dasharray"]).toBeDefined();
      expect(paint[0]!["line-width"]).toBeGreaterThan(0);

      // THE MARKS. Line-placed symbol layers on the family's mark sprites,
      // repeating in constant screen pixels — the majority kind first, on the
      // bare key.
      const layout = boundaryMarks(symbolized, { RESTRN: restrn });
      expect(layout).toHaveLength(markLayers);
      expect(layout[0]!["symbol-placement"]).toBe("line");
      expect(layout[0]!["icon-image"]).toBe(`LM_${family}51`);
      expect(symbols[`LM_${family}51`]).toBeDefined();
      expect(layout[0]!["symbol-spacing"]).toBeGreaterThan(1);
      if (markLayers > 1) {
        expect(layout[1]!["icon-image"]).toBe(`LM_${family}51_2`);
        expect(symbols[`LM_${family}51_2`]).toBeDefined();
        // The once-per-interval glyph repeats at the full interval; the tick
        // at the lattice pitch beneath it.
        expect(layout[1]!["symbol-spacing"] as number).toBeGreaterThan(
          layout[0]!["symbol-spacing"] as number,
        );
      }
      // The teeth point into the area, and stay pointing into it on a
      // right-to-left edge — see `LC` for the derivation. Every mark layer
      // carries the full orientation set.
      for (const marks of layout) {
        expect(marks["icon-rotation-alignment"]).toBe("map");
        expect(marks["icon-keep-upright"]).toBe(false);
        expect(marks["icon-allow-overlap"]).toBe(true);
      }
    },
  );

  test("the boundary follows the cascade that picks the centred symbol", () => {
    // Entry + anchoring: the symbol takes the 61 suffix, and the boundary
    // stays on the family's only published line style.
    const properties = { RESTRN: "7,1" };
    expect(
      icons(matchingLayers(symbolized, "RESARE", properties, "Polygon")),
    ).toContain("ENTRES61");
    expect(boundaryMarks(symbolized, properties)[0]!["icon-image"]).toBe(
      "LM_ENTRES51",
    );

    // Anchoring alone drops to the ACHRES family, boundary included.
    const anchoring = { RESTRN: "1" };
    expect(
      icons(matchingLayers(symbolized, "RESARE", anchoring, "Polygon")),
    ).toContain("ACHRES51");
    expect(boundaryMarks(symbolized, anchoring)[0]!["icon-image"]).toBe(
      "LM_ACHRES51",
    );
  });

  test("both settings emit the same number of boundary LINE layers", () => {
    // The plain ring and the symbolized pen are the same one line layer in the
    // same position, so anything keyed on a layer id (the display-category
    // filters, the inspector) sees the same list either way. The symbolized
    // setting ADDS the mark layers after it, which is the one difference —
    // two for a split family, one for CTYARE.
    for (const [restrn, markLayers] of [
      ["7", 2],
      ["1", 2],
      ["3", 2],
      ["13", 1],
    ] as const) {
      expect(boundaryPaint(plain, { RESTRN: restrn })).toHaveLength(
        boundaryPaint(symbolized, { RESTRN: restrn }).length,
      );
      expect(boundaryMarks(plain, { RESTRN: restrn })).toHaveLength(0);
      expect(boundaryMarks(symbolized, { RESTRN: restrn })).toHaveLength(
        markLayers,
      );
    }
  });

  test("the symbolized boundary names the line style it came from", () => {
    // The frontend has to tell the symbolized presentation from the plain one
    // to decide which viewing group owns the boundary, and neither half of the
    // pair is recognisable by its paint any more. Both carry the name.
    const tagged = [
      ...boundaryLayers(symbolized, { RESTRN: "7" }, "line"),
      ...boundaryLayers(symbolized, { RESTRN: "7" }, "symbol"),
    ].filter((layer) => linestyleOf(layer) !== undefined);
    // The pen plus BOTH mark layers of the split family — each kind's layer
    // carries the name.
    expect(tagged.map((layer) => layer.type)).toEqual([
      "line",
      "symbol",
      "symbol",
    ]);
    for (const layer of tagged) {
      expect(linestyleOf(layer)).toBe("ENTRES51");
    }

    // The plain ring carries no line style, so the two are distinguishable —
    // which is what the frontend needs to know which viewing group owns the
    // boundary, now that neither half is recognisable by its paint.
    const [ring] = boundaryLayers(plain, { RESTRN: "7" }, "line");
    expect(linestyleOf(ring!)).toBeUndefined();
  });
});
