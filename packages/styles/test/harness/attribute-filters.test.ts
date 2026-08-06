/**
 * Regression harness for the type-agnostic look-up attribute filters.
 *
 * The tiler writes S-57 *enumerated* attributes as MVT integers while the S-52
 * look-up tables give every ATTV as a string. Before `attributeFilters` coerced
 * the feature value with `to-string`, every enumerated condition was dead: the
 * features fell through to the catch-all look-up entry, so lateral buoys drew
 * the generic BOYDEF/BOYGEN symbol, CATMOR 7 mooring buoys drew the MORFAC03
 * square, and the CATZOC fallback (NODATA03, "unassessed") painted over zones
 * that carry a CATZOC.
 *
 * These cases run the real MapLibre filter against features carrying the real
 * decoded types.
 */
import { describe, expect, test } from "vitest";
import { SymbolType } from "../../src/symbolology/index.js";
import { buildStyle, icons, matchingLayers } from "./evaluate.js";

const simplified = buildStyle({ symbols: SymbolType.SIMPLIFIED });
const paper = buildStyle();

describe("enumerated attributes decoded as integers", () => {
  test("BOYLAT lateral buoy reaches its lateral symbol", () => {
    // Port-hand pillar buoy: BOYSHP and CATLAM are integers in the tile,
    // COLOUR is a list and therefore a string.
    const green = matchingLayers(simplified, "BOYLAT", {
      BOYSHP: 4,
      CATLAM: 1,
      COLOUR: "3",
    });
    expect(icons(green)).toContain("BOYLAT24");

    const red = matchingLayers(simplified, "BOYLAT", {
      BOYSHP: 4,
      CATLAM: 1,
      COLOUR: "4",
    });
    expect(icons(red)).toContain("BOYLAT23");

    // The generic buoy symbol must not also fire.
    expect(icons(red)).not.toContain("BOYGEN03");
  });

  test("integer and string encodings of the same value agree", () => {
    const asInt = icons(
      matchingLayers(simplified, "BOYLAT", {
        CATLAM: 2,
        COLOUR: "3",
      }),
    );
    const asString = icons(
      matchingLayers(simplified, "BOYLAT", {
        CATLAM: "2",
        COLOUR: "3",
      }),
    );
    expect(asInt).toEqual(asString);
    expect(asInt).toContain("BOYLAT14");
  });

  test("BOYSHP-only paper-chart entries match an integer BOYSHP", () => {
    const pillar = icons(matchingLayers(paper, "BOYLAT", { BOYSHP: 4 }));
    expect(pillar).toContain("BOYPIL01");
    expect(pillar).not.toContain("BOYGEN03");
  });

  test("MORFAC CATMOR 7 reaches the mooring-buoy symbol, not the square", () => {
    const mooringBuoy = icons(
      matchingLayers(simplified, "MORFAC", { CATMOR: 7 }),
    );
    expect(mooringBuoy).toContain("BOYMOR11");
    // MORFAC03 is the catch-all "mooring facility" square that every mooring
    // buoy used to fall through to.
    expect(mooringBuoy).not.toContain("MORFAC03");

    // The catch-all still covers a MORFAC with no CATMOR.
    expect(icons(matchingLayers(simplified, "MORFAC", {}))).toContain(
      "MORFAC03",
    );
  });

  test("M_QUAL CATZOC fallback stops matching CATZOC-carrying zones", () => {
    // Area fills are filed in the sprite sheet under an AP_ prefix, so that a
    // pattern and a symbol of the same name cannot shadow each other.
    const fillPatterns = fillPatternsOf(paper, { CATZOC: 3 });
    expect(fillPatterns).toContain("AP_DQUALB01");
    // NODATA03 is the "quality of data not assessed" fallback entry.
    expect(fillPatterns).not.toContain("AP_NODATA03");

    // ... and it still covers a zone with no CATZOC at all.
    expect(fillPatternsOf(paper, {})).toEqual(["AP_NODATA03"]);
  });
});

function fillPatternsOf(
  style: ReturnType<typeof buildStyle>,
  properties: Record<string, unknown>,
): string[] {
  return matchingLayers(style, "M_QUAL", properties, "Polygon").flatMap((m) => {
    const layer = style.layers.find((l) => l.id === m.id)!;
    const pattern = ((layer as { paint?: Record<string, unknown> }).paint ??
      {})["fill-pattern"];
    return typeof pattern === "string" ? [pattern] : [];
  });
}
