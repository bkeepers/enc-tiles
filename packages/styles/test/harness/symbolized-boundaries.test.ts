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

/** The paint of every line layer matching a RESARE polygon. */
function boundaryPaint(
  style: StyleSpecification,
  properties: Record<string, unknown>,
): Record<string, unknown>[] {
  return matchingLayers(style, "RESARE", properties, "Polygon")
    .filter((match: Match) => match.type === "line")
    .map((match: Match) => {
      const layer = style.layers.find(
        (candidate: LayerSpecification) => candidate.id === match.id,
      )!;
      return ((layer as { paint?: Record<string, unknown> }).paint ??
        {}) as Record<string, unknown>;
    });
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
    ["entry restricted", "7", "ENTRES"],
    ["entry prohibited", "8", "ENTRES"],
    ["anchoring prohibited", "1", "ACHRES"],
    ["fishing prohibited", "3", "FSHRES"],
    ["own-ship restriction", "13", "CTYARE"],
  ])(
    "symbolized boundaries draw the %s line style",
    (_label, restrn, family) => {
      const paint = boundaryPaint(symbolized, { RESTRN: restrn });
      expect(paint).toHaveLength(1);

      // The prefixed sprite key, not the bare name: the bare name belongs to
      // the centred point symbol of the same family.
      expect(paint[0]!["line-pattern"]).toBe(`LC_${family}51`);
      expect(paint[0]!["line-dasharray"]).toBeUndefined();

      // MapLibre stretches a line-pattern across the full line width, so the
      // width has to be the tile's height for the ticks to come out at their
      // design size and centred on the boundary.
      const sprite = symbols[`LC_${family}51`];
      expect(sprite).toBeDefined();
      expect(paint[0]!["line-width"]).toBe(sprite.height);
      expect(paint[0]!["line-width"]).toBeGreaterThan(1);
    },
  );

  test("the boundary follows the cascade that picks the centred symbol", () => {
    // Entry + anchoring: the symbol takes the 61 suffix, and the boundary
    // stays on the family's only published line style.
    const properties = { RESTRN: "7,1" };
    expect(
      icons(matchingLayers(symbolized, "RESARE", properties, "Polygon")),
    ).toContain("ENTRES61");
    expect(boundaryPaint(symbolized, properties)[0]!["line-pattern"]).toBe(
      "LC_ENTRES51",
    );

    // Anchoring alone drops to the ACHRES family, boundary included.
    const anchoring = { RESTRN: "1" };
    expect(
      icons(matchingLayers(symbolized, "RESARE", anchoring, "Polygon")),
    ).toContain("ACHRES51");
    expect(boundaryPaint(symbolized, anchoring)[0]!["line-pattern"]).toBe(
      "LC_ACHRES51",
    );
  });

  test("both settings emit the same number of boundary layers", () => {
    // The layer ids have to stay aligned across the setting: the frontend
    // toggles between two built styles and anything keyed on a layer id (the
    // display-category filters, the inspector) would shift otherwise.
    for (const restrn of ["7", "1", "3", "13"]) {
      expect(boundaryPaint(plain, { RESTRN: restrn })).toHaveLength(
        boundaryPaint(symbolized, { RESTRN: restrn }).length,
      );
    }
  });
});
