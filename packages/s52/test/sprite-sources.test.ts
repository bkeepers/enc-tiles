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
import {
  lineStyleGeometry,
  patternLattice,
  readSymbolSvg,
  sourceSvg,
  spriteSources,
} from "../build/symbols.js";
import symbolsJson from "../symbols.json" with { type: "json" };

const data = JSON.parse(
  readFileSync(new URL("../data.json", import.meta.url), "utf8"),
);
const sources = spriteSources(data) as {
  name: string;
  key: string;
  description: string;
  kind: string;
}[];

const symbols = symbolsJson as Record<
  string,
  { width: number; height: number; offset: [number, number] }
>;

function viewBoxOf(svgText: string): number[] {
  const svg = new JSDOM(svgText, {
    contentType: "image/svg+xml",
  }).window.document.querySelector("svg");
  expect(svg, "parsed as SVG").not.toBeNull();
  return svg!.getAttribute("viewBox")!.split(/ |,/).map(Number);
}

/** Same, without JSDOM: too slow to run over every source in the atlas. */
function viewBoxNumbers(svgText: string): number[] {
  const viewBox = /viewBox="([^"]+)"/.exec(svgText);
  expect(viewBox, "has a viewBox").not.toBeNull();
  return viewBox![1]!.split(/ |,/).map(Number);
}

/**
 * The tests that walk the whole atlas read and synthesize 600+ drawings, which
 * is comfortably over vitest's 5 s default on a slow filesystem.
 */
const BULK_TIMEOUT = 30_000;

/** Synthesizing a tile is not cheap; the bulk tests share one build of each. */
const tiles = new Map<string, string | undefined>();
function tileFor(source: { key: string }): string | undefined {
  if (!tiles.has(source.key)) tiles.set(source.key, sourceSvg(source));
  return tiles.get(source.key);
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

  test("the three S-52 name spaces get three sprite name spaces", () => {
    // Symbols keep the bare name; AP() and LC() take a prefix. Without it the
    // 21 names that live in two name spaces resolved to whichever entry the
    // build saw first -- always the symbol -- so LC(CTNARE51) tiled the
    // CTNARE51 point icon along the boundary and AP(AIRARE02) filled airports
    // with the airport point icon.
    const keys = sources.map((source) => source.key);
    expect(new Set(keys).size, "sprite keys are unique").toBe(keys.length);

    const byKind = (kind: string) =>
      sources.filter((source) => source.kind === kind);
    expect(byKind("symbol").every((s) => s.key === s.name)).toBe(true);
    expect(byKind("pattern").every((s) => s.key === `AP_${s.name}`)).toBe(true);
    expect(byKind("linestyle").every((s) => s.key === `LC_${s.name}`)).toBe(
      true,
    );

    // The names that used to shadow one another, listed so a catalogue update
    // that adds or removes one is visible in the diff.
    const symbolNames = new Set(byKind("symbol").map((s) => s.name));
    expect(
      byKind("linestyle")
        .map((s) => s.name)
        .filter((name) => symbolNames.has(name)),
    ).toEqual([
      "ACHARE51",
      "ACHRES51",
      "CBLARE51",
      "CHCRDEL1",
      "CHCRID01",
      "CTNARE51",
      "CTYARE51",
      "CURENT01",
      "DWRUTE51",
      "ENTRES51",
      "ESSARE01",
      "FSHFAC02",
      "FSHRES51",
      "LOWACC01",
      "NEWOBJ01",
      "PRCARE51",
      "QUESMRK1",
    ]);
    expect(
      byKind("pattern")
        .map((s) => s.name)
        .filter((name) => symbolNames.has(name)),
    ).toEqual(["AIRARE02", "FSHFAC03", "MARCUL02", "QUESMRK1"]);
  });

  test("a pattern or line style ignores the same-named symbol drawing", () => {
    // The other half of the shadowing: `sourceSvg` used to prefer a drawing
    // with the source's name over the S-101 definition, and for these names
    // that drawing is the *symbol*. Symbols/AIRARE02.svg says so itself.
    expect(readSymbolSvg("AIRARE02")).toContain(
      "symbol for airport as a point",
    );
    const airport = sourceSvg(
      sources.find((s) => s.key === "AP_AIRARE02")!,
    ) as string;
    expect(airport).not.toContain("symbol for airport as a point");
    // The AIRARE02P lattice: v1 = (38.24, 0), v2 = (18.24, 38.04), two rows.
    const [, , width, height] = viewBoxOf(airport);
    expect(width).toBeCloseTo(38.24, 2);
    expect(height).toBeCloseTo(76.08, 2);

    // CTNARE51's line style is the boundary style, not the caution icon.
    const caution = sourceSvg(
      sources.find((s) => s.key === "LC_CTNARE51")!,
    ) as string;
    expect(caution).toContain("boundary of area with a specific caution");
  });

  test(
    "every source resolves to a drawing with a non-zero viewBox",
    () => {
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
        expect(height, `${source.kind} ${source.name} height`).toBeGreaterThan(
          0,
        );
      }
      // LOWACC11 is in the DAI but has neither a drawing nor an S-101
      // definition, and nothing in the style references it.
      expect(undrawable).toEqual(["LOWACC11"]);
    },
    BULK_TIMEOUT,
  );

  test("the patterns and line styles the style references are drawable", () => {
    // NODATA03 is the unsurveyed-area fill; MARSYS51 the IALA-A/B boundary
    // line style. Neither ships as an SVG — both are synthesized from their
    // S-101 definitions.
    for (const name of [
      "AP_NODATA03",
      "LC_MARSYS51",
      "AP_DQUALA21",
      "AP_DRGARE01",
      "AP_FOULAR01",
      "AP_MARCUL02",
      "LC_PIPSOL05",
      "LC_RECTRC09",
    ]) {
      const source = sources.find((s) => s.key === name);
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
    const nodata = sourceSvg(sources.find((s) => s.key === "AP_NODATA03")!);
    expect(nodata).toContain("sCHGRD");
    const [minX, minY, width, height] = viewBoxOf(nodata as string);
    expect([minX, minY]).toEqual([0, 0]);
    // v1 = (7.02, 0), v2 = (3.51, 4.96) → a 7.02 x 9.92 mm staggered tile.
    expect(width).toBeCloseTo(7.02, 2);
    expect(height).toBeCloseTo(9.92, 2);
  });

  test(
    "every pattern tile closes on the lattice",
    () => {
      // MapLibre repeats the tile rectangle, so the tile's height has to be a
      // lattice vector: the symbols sitting on the top edge must be at the same
      // x positions (modulo the tile width) as the ones on the bottom edge.
      // Rounding v1.x/v2.x to whole rows did not guarantee that, and the fill
      // then sheared sideways by the leftover at every vertical repeat --
      // measured at 1.00 mm for MARSHES1 and 5.22 mm for FSHFAC04.
      //
      // All 25 are synthesized: every one has an `af:symbolFill` definition, and
      // the four that also have a same-named SVG (AIRARE02, FSHFAC03, MARCUL02,
      // QUESMRK1) no longer take it -- that SVG is the point symbol.
      const synthesized = sources.filter((source) => source.kind === "pattern");
      expect(synthesized).toHaveLength(25);

      for (const source of synthesized) {
        const { tileWidth, tileHeight, rows, step } = patternLattice(
          source.name,
        );

        // (0, tileHeight) = rows*step - columns*v1, for a whole number of
        // columns: the tile's vertical period is on the lattice.
        const columns = Math.round((rows * step.x) / tileWidth);
        expect(
          Math.abs(rows * step.x - columns * tileWidth),
          `${source.name} vertical period is a lattice vector`,
        ).toBeLessThan(1e-6);

        const placed = [
          ...(sourceSvg(source) as string).matchAll(
            /translate\(([-\d.]+),([-\d.]+)\)/g,
          ),
        ].map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));

        /** Distinct x positions on one horizontal edge, folded into [0, width). */
        const edge = (y: number) =>
          [
            ...new Set(
              placed
                .filter((p) => Math.abs(p.y - y) < 1e-9)
                .map((p) => {
                  const wrapped = ((p.x % tileWidth) + tileWidth) % tileWidth;
                  return Number(
                    (tileWidth - wrapped < 1e-6 ? 0 : wrapped).toFixed(6),
                  );
                }),
            ),
          ].sort((a, b) => a - b);

        const bottom = edge(0);
        const top = edge(tileHeight);
        expect(
          bottom.length,
          `${source.name} draws symbols on the y=0 edge`,
        ).toBeGreaterThan(0);
        expect(top, `${source.name} y=height edge matches y=0`).toHaveLength(
          bottom.length,
        );
        top.forEach((x, index) =>
          expect(
            Math.abs(x - bottom[index]!),
            `${source.name} shear at the tile seam`,
          ).toBeLessThan(1e-6),
        );
      }
    },
    BULK_TIMEOUT,
  );

  test("line style tiles carry their dashes and embedded symbols", () => {
    // MARSYS51: 25.5mm interval, four CHGRD dashes, EMMARS01 + EMMARS02.
    const marsys = sourceSvg(
      sources.find((s) => s.key === "LC_MARSYS51")!,
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

  test(
    "every synthesized line style tile is centred on the line axis",
    () => {
      // MapLibre stretches a line-pattern across the whole line width with the
      // image's vertical centre on the line, so y = 0 of the line style has to
      // be the middle of the viewBox. It used to be the topmost ink, which drew
      // the entire style off to one side of the line.
      const synthesized = sources.filter(
        (source) =>
          source.kind === "linestyle" &&
          !["LOWACC01", "LOWACC11", "NEWOBJ01"].includes(source.name),
      );
      expect(synthesized).toHaveLength(52);

      for (const source of synthesized) {
        const svgText = tileFor(source) as string;
        const [minX, minY, , height] = viewBoxNumbers(svgText);
        expect(minX, `${source.name} starts at x = 0`).toBe(0);
        expect(minY, `${source.name} line axis is centred`).toBeCloseTo(
          -height / 2,
          6,
        );

        // The tile is emitted mirrored about that axis -- see buildLineStyleSvg.
        expect(svgText, `${source.name} is mirrored`).toContain(
          '<g transform="scale(1,-1)">',
        );

        // Nothing is clipped: the ink still fits inside the symmetric box.
        const { top, bottom } = lineStyleGeometry(source.name) as {
          top: number;
          bottom: number;
        };
        expect(Math.max(-top, bottom), `${source.name} ink fits`).toBeCloseTo(
          height / 2,
          6,
        );
      }
    },
    BULK_TIMEOUT,
  );

  test("restriction boundary ticks end up inside the area", () => {
    // Step by step, and derived in full in buildLineStyleSvg's comment:
    //
    //   1. S-101 hangs the tick symbols of an area boundary style below the
    //      axis, at +y, with nothing but the pen's half width above it.
    //   2. The tile is emitted mirrored, so those ticks sit at -y -- against
    //      the image's TOP edge.
    //   3. MapLibre samples the image top on the +perp(direction) side of the
    //      line, which with y-down tile coordinates is the right of travel.
    //   4. MVT winds exterior rings clockwise in that same space, so the
    //      polygon's inside is on the right of travel.
    //
    // 2 + 3 + 4: the ticks point into the area.
    // The repeated tick of each family. (Some styles also carry a centred
    // glyph -- ENTRES51's EMENTRE1 ring straddles the axis -- so the style's
    // overall extent is not what says which way the ticks face.)
    const ticks = {
      ENTRES51: "EMACHRE2",
      ACHRES51: "EMACHRE2",
      FSHRES51: "EMACHRE2",
      CTYARE51: "EMAREMG1",
      ACHARE51: "EMAREMG1",
      CTNARE51: "EMAREMG1",
      PRCARE51: "EMAREMG1",
      RESARE51: "EMRESAR1",
    };

    for (const [name, tick] of Object.entries(ticks)) {
      // Step 1: the tick is a bare stroke running from the axis into +y. Its
      // box crosses y = 0 by no more than the pen's half width, and reaches
      // several times that far the other way.
      const tickSvg = readSymbolSvg(tick) as string;
      const [, tickMinY, , tickHeight] = viewBoxOf(tickSvg);
      expect(tickMinY, `${tick} barely crosses the axis`).toBeGreaterThan(-0.5);
      expect(tickMinY + tickHeight, `${tick} reaches into +y`).toBeGreaterThan(
        1.0,
      );
      expect(tickMinY + tickHeight, `${tick} is one-sided`).toBeGreaterThan(
        -4 * tickMinY,
      );

      const svgText = tileFor(
        sources.find((s) => s.key === `LC_${name}`)!,
      ) as string;
      // The tick's own stroke is inlined into the tile.
      const stroke = /<path d="([^"]+)"/.exec(tickSvg)![1]!;
      expect(svgText, `${name} places ${tick}`).toContain(stroke);
      // Step 2.
      expect(svgText, `${name} is mirrored`).toContain(
        '<g transform="scale(1,-1)">',
      );
      // The tick is the only ink beyond the centred glyph, so the tile is at
      // least as tall as the tick: nothing is trimmed off the inward side.
      const { bottom } = lineStyleGeometry(name) as { bottom: number };
      expect(bottom, `${name} keeps the whole tick`).toBeGreaterThanOrEqual(
        tickMinY + tickHeight - 1e-9,
      );
    }
  });

  test(
    "line style sprites are as tall as LC() makes the line wide",
    () => {
      // LC() sets line-width to the sprite's height so the pattern draws at its
      // design scale; that only works if symbols.json is keyed by the prefixed
      // name and carries the centred height.
      const pxPerMm = 3.7795275591;
      for (const source of sources) {
        if (source.kind !== "linestyle") continue;
        const sprite = symbols[source.key];
        if (source.name === "LOWACC11") {
          expect(sprite, "LOWACC11 has no drawing at all").toBeUndefined();
          continue;
        }
        expect(sprite, `${source.key} is in symbols.json`).toBeDefined();
        expect(sprite!.height, `${source.key} height`).toBeGreaterThan(0);

        const svgText = tileFor(source) as string;
        const [, , , height] = viewBoxNumbers(svgText);
        expect(sprite!.height, `${source.key} height matches its tile`).toBe(
          Math.round(height * pxPerMm),
        );
      }

      // The bare names must be gone, or MapLibre would still have a way to
      // resolve a line style to the symbol of the same name.
      expect(symbols["MARSYS51"]).toBeUndefined();
      expect(symbols["LC_MARSYS51"]).toBeDefined();
      // ...except where the symbol legitimately owns the bare name.
      expect(symbols["CTNARE51"]!.description).toContain("caution area");
      expect(symbols["LC_CTNARE51"]!.description).toContain("boundary");
    },
    BULK_TIMEOUT,
  );
});
