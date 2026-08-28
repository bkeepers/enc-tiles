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
  PX_PER_MM,
  SPLIT_LINEMARK_STYLES,
  dashSchedule,
  lineMarkGeometry,
  lineMarkKinds,
  lineStyleGeometry,
  lineStyleSpec,
  patternLattice,
  readSymbolSvg,
  sourceSvg,
  spriteSources,
} from "../build/symbols.js";
import symbolsJson from "../symbols.json" with { type: "json" };
import linestylesJson from "../linestyles.json" with { type: "json" };

const data = JSON.parse(
  readFileSync(new URL("../data.json", import.meta.url), "utf8"),
);
const sources = spriteSources(data) as {
  name: string;
  key: string;
  description: string;
  kind: string;
  /** Split linemark sources only — see SPLIT_LINEMARK_STYLES. */
  kindIndex?: number;
  suffix?: string;
  reference?: string;
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
  test("covers symbols, patterns, line styles and line marks", () => {
    const kinds = sources.reduce<Record<string, number>>((counts, source) => {
      counts[source.kind] = (counts[source.kind] ?? 0) + 1;
      return counts;
    }, {});
    expect(kinds).toEqual({
      symbol: data.symbols.length,
      pattern: data.patterns.length,
      linestyle: data.linestyles.length,
      // One per line style that actually places a mark: 55 line styles, less
      // LOWACC11 (no definition and no drawing) and the three that are pure
      // dash schedules (INDHLT02, SCLBDY51, ERBLNA01) — 51 — plus one more
      // for the second glyph kind of each of the 10 SPLIT styles, which file
      // one sprite per kind instead of one packed sprite.
      linemark: 61,
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
    // A fourth key space, and not an S-52 one: the MARKS of a line style drawn
    // on their own, for the symbol half of the LC() split. It cannot reuse the
    // embedded symbol's key even where a style places exactly one -- the same
    // drawing has to be re-boxed about the line axis. A SPLIT style files one
    // sprite per glyph kind: the majority kind keeps the bare LM_<name> key
    // and the rest take the _2, _3... suffix (see SPRITE_PREFIX).
    expect(
      byKind("linemark").every(
        (s) => s.key === `LM_${s.name}${s.suffix ?? ""}`,
      ),
    ).toBe(true);
    expect(
      byKind("linemark")
        .filter((s) => (s.kindIndex ?? 0) === 0)
        .every((s) => s.key === `LM_${s.name}`),
      "the majority kind keeps the bare key",
    ).toBe(true);

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

  test("only the two named line styles may fall back to a drawing", () => {
    // LOWACC01 and NEWOBJ01 have no S-101 definition and their same-named SVG
    // really is the line style, so they draw from it.
    for (const name of ["LOWACC01", "NEWOBJ01"]) {
      const svgText = sourceSvg({ kind: "linestyle", name }) as string;
      expect(svgText, `${name} draws from its own SVG`).toContain("<svg");
      expect(svgText).toBe(readSymbolSvg(name));
    }

    // Anything else with no definition returns undefined rather than the
    // same-named POINT symbol. A point symbol passes every check the build
    // makes — well-formed, non-zero viewBox, draws something — and then ships
    // uncentred and unmirrored along the line, which is exactly the failure
    // this is here to prevent. Undefined trips the build's "no drawing"
    // warning instead, and a human decides which it was.
    expect(readSymbolSvg("BOYCAR01"), "the buoy drawing exists").toContain(
      "<svg",
    );
    expect(sourceSvg({ kind: "linestyle", name: "BOYCAR01" })).toBeUndefined();
    expect(sourceSvg({ kind: "pattern", name: "BOYCAR01" })).toBeUndefined();
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
    "line style pattern sprites stay published at their tile height",
    () => {
      // The generated style no longer references these -- LC() draws the pen
      // and the marks separately now (see SHOWLINE.ts) -- but they are still
      // built and published, because a frontend pinned to an older bundle asks
      // the sheet for them by name and MapLibre answers a missing line-pattern
      // with an ARBITRARY image from the atlas rather than with nothing.
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

/**
 * The SYMBOL half of the LC() split.
 *
 * A line style is drawn as a dashed pen plus a line-placed symbol layer, and
 * the whole point of the change is that the symbol is NOT stretched with zoom
 * the way the old `line-pattern` tile was. What is left to get wrong is the
 * geometry of the mark sprite: which way it faces, and where its centre is.
 */
describe("line style mark sprites", () => {
  /** The repeated tick of each restriction/area boundary family. */
  const TICKS: Record<string, string> = {
    ENTRES51: "EMACHRE2",
    ACHRES51: "EMACHRE2",
    FSHRES51: "EMACHRE2",
    CTYARE51: "EMAREMG1",
    ACHARE51: "EMAREMG1",
    CTNARE51: "EMAREMG1",
    PRCARE51: "EMAREMG1",
    RESARE51: "EMRESAR1",
  };

  test("the sheet carries one LM_ sprite per line style that places a mark", () => {
    // ...and one per GLYPH KIND for the 10 split styles: 51 + 10.
    const marks = sources.filter((source) => source.kind === "linemark");
    expect(marks).toHaveLength(61);
    for (const source of marks) {
      expect(
        symbols[source.key],
        `${source.key} is in symbols.json`,
      ).toBeDefined();
      expect(symbols[source.key]!.width).toBeGreaterThan(0);
      expect(symbols[source.key]!.height).toBeGreaterThan(0);
    }

    // A pure dash schedule gets no mark sprite: an empty one would be a blank
    // image in the atlas and a dangling icon-image in the style.
    for (const name of ["INDHLT02", "SCLBDY51", "ERBLNA01", "LOWACC11"]) {
      expect(symbols[`LM_${name}`], `${name} places no mark`).toBeUndefined();
    }

    // The pattern tiles stay in the sheet alongside them -- older frontends.
    expect(symbols["LC_RESARE51"]).toBeDefined();
  });

  test("the mark sprite is centred on the line axis, not on its ink", () => {
    // A line-placed icon is a quad centred on its anchor and the anchor is ON
    // the line, so y = 0 of the line style has to be the middle of the
    // viewBox. Getting this wrong draws the whole style off to one side.
    for (const source of sources) {
      if (source.kind !== "linemark") continue;
      const [minX, minY, width, height] = viewBoxNumbers(
        sourceSvg(source) as string,
      );
      expect(minY, `${source.key} line axis is centred`).toBeCloseTo(
        -height / 2,
        6,
      );
      expect(minX, `${source.key} marks are centred`).toBeCloseTo(
        -width / 2,
        6,
      );

      // ...which makes the sprite's pivot its own centre, so LC() emits no
      // icon-offset at all. The half pixel is minX and width rounding to
      // whole pixels independently.
      const sprite = symbols[source.key]!;
      expect(
        Math.abs(sprite.offset[0]),
        `${source.key} pivot x`,
      ).toBeLessThanOrEqual(0.5);
      expect(
        Math.abs(sprite.offset[1]),
        `${source.key} pivot y`,
      ).toBeLessThanOrEqual(0.5);
    }
  });

  test("a mark sprite is a whole number of pixels, with all its ink inside", () => {
    // The box used to be the ink's own bounding box, so the drawing touched
    // all four edges and any fraction of a pixel in the extent was dropped
    // when the rasterizer sized the pixmap. PRCARE51: 27.91 mm x 3.7795 =
    // 105.487 px became 105 px and took the right leg of the fourth dentate
    // tooth with it -- 13 px wide where its three siblings are 14.
    //
    // Two things have to hold for that not to come back, and BOTH are about
    // the millimetres the file actually carries, not the exact geometry:
    // resvg sizes the pixmap from the written viewBox, which is rounded to
    // three decimals. So the box has to hold the ink, and the written mm have
    // to land unambiguously on a whole pixel from ABOVE.
    for (const source of sources) {
      if (source.kind !== "linemark") continue;
      const [minX, minY, width, height] = viewBoxNumbers(
        sourceSvg(source) as string,
      );

      // Recomputed from the catalogue rather than from lineMarkGeometry, so
      // this is an independent statement of where the ink is. A split source
      // holds ONE glyph of its kind with the position dropped; a packed
      // source holds every placement of the interval at its position.
      const spec = lineStyleSpec(source.name) as {
        marks: { reference: string; position: number; offset: number }[];
      };
      const inked = source.reference
        ? [
            {
              ...spec.marks.find(
                (mark) => mark.reference === source.reference,
              )!,
              position: 0,
            },
          ]
        : spec.marks;
      let inkLeft = Infinity;
      let inkRight = -Infinity;
      let inkTop = 0;
      let inkBottom = 0;
      for (const mark of inked) {
        const [boxX, boxY, boxW, boxH] = viewBoxNumbers(
          readSymbolSvg(mark.reference) as string,
        );
        inkLeft = Math.min(inkLeft, mark.position + boxX!);
        inkRight = Math.max(inkRight, mark.position + boxX! + boxW!);
        inkTop = Math.min(inkTop, mark.offset + boxY!);
        inkBottom = Math.max(inkBottom, mark.offset + boxY! + boxH!);
      }

      // The box is centred on the ink, so only its extent can be short.
      expect(
        width,
        `${source.key} holds its ink across`,
      ).toBeGreaterThanOrEqual(inkRight! - inkLeft! - 1e-9);
      expect(height, `${source.key} holds its ink down`).toBeGreaterThanOrEqual(
        2 * Math.max(-inkTop, inkBottom) - 1e-9,
      );

      for (const [axis, mm] of [
        ["width", width!],
        ["height", height!],
      ] as const) {
        const px = mm * PX_PER_MM;
        // Whichever way the rasterizer resolves the fraction it gets the same
        // pixel count -- there is no fraction to resolve.
        expect(Math.floor(px), `${source.key} ${axis} floors cleanly`).toBe(
          Math.round(px),
        );
        // ...and it is the count symbols.json promises the frontend.
        expect(symbols[source.key]![axis], `${source.key} ${axis}`).toBe(
          Math.round(px),
        );
      }

      // Growing the box does not stretch the drawing: a viewBox that does not
      // match the declared size is exactly how a sprite comes out squished.
      const declared = /width="([\d.]+)mm" height="([\d.]+)mm"/.exec(
        sourceSvg(source) as string,
      )!;
      expect(Number(declared[1]), `${source.key} declared width`).toBe(width);
      expect(Number(declared[2]), `${source.key} declared height`).toBe(height);
      expect(minX, `${source.key} box grew symmetrically`).toBe(-width! / 2);
      expect(minY, `${source.key} box grew symmetrically`).toBe(-height! / 2);
    }
  });

  test("PRCARE51 draws its triangle at S-52's own proportions", () => {
    // The mark that started it. EMPRCAR1 is 3.66 x 5.03 mm of vectors in
    // `S-52 PresLib Ed 4.0.4.dai` (SYMD EMPRCAR1, PU1138,1098 PD1504,1098
    // PD1313,595 PD1141,1098), which S-101 reproduces as a 3.98 x 5.35 mm
    // viewBox once the 0.32 mm pen is allowed for. The sprite embeds that
    // drawing UNSCALED -- it is translated into place and nothing else -- so
    // the triangle in the atlas is the catalogue's triangle, not a squashed
    // one. Pin the numbers rather than an aspect ratio: a ratio survives both
    // sides being scaled, which is the failure a `line-pattern` tile has.
    //
    // PRCARE51 is a SPLIT style, so the triangle -- its once-per-interval
    // glyph -- now rides the LM_PRCARE51_2 sprite of its own, and the bare
    // LM_PRCARE51 key stays on the majority tooth.
    const [, , triangleW, triangleH] = viewBoxNumbers(
      readSymbolSvg("EMPRCAR1") as string,
    );
    expect([triangleW, triangleH]).toEqual([3.98, 5.35]);

    const marks = sourceSvg({
      kind: "linemark",
      name: "PRCARE51",
      kindIndex: 1,
    }) as string;
    const stroke = /<path d="([^"]+)"/.exec(
      readSymbolSvg("EMPRCAR1") as string,
    )!;
    expect(marks, "the triangle is inlined verbatim").toContain(stroke[1]);
    // Only translates -- no scale(), which is the one transform that could
    // change the drawn aspect.
    expect(marks).not.toContain("scale(");

    // 3.98 mm of ink in a 4.234 mm box: 16 px. 5.6 mm of ink (the triangle
    // hung 2.55 mm above the axis and 2.8 below, boxed symmetrically) in
    // 5.822: 22 px, so the triangle keeps its base row.
    const sprite = symbols["LM_PRCARE51_2"]!;
    expect([sprite.width, sprite.height]).toEqual([16, 22]);
    // The grown box is padding, not room the drawing spread into: the whole
    // triangle still fits between the axis and the bottom edge.
    const { bottom, half } = lineMarkGeometry("PRCARE51", 1) as {
      bottom: number;
      half: number;
    };
    expect(bottom).toBeCloseTo(5.35 - 2.55, 9);
    expect(half).toBeGreaterThanOrEqual(bottom);
    expect(half - bottom, "padding stays sub-pixel").toBeLessThan(
      1 / PX_PER_MM,
    );

    // The majority sprite is the dentate tooth alone: the 106 px packed quad
    // -- four glyphs and their gaps -- is what laid a rigid bar across every
    // meander, and the split is what cut it to single-glyph width.
    expect(symbols["LM_PRCARE51"]!.width).toBeLessThan(20);
  });

  test("the ticks point image-DOWN, which is into the area", () => {
    // The derivation is in lineMarkGeometry, and its conclusion is the one
    // thing a test can pin: image-DOWN faces the right of travel, the right of
    // travel is the filled side of any MVT-wound ring, and S-101 already draws
    // the inward tick at +y. So the mark sprite is the S-101 drawing UNMIRRORED
    // -- the exact opposite of the pattern tile, which has to carry a
    // `scale(1,-1)` because line-pattern samples the image top on that side.
    for (const [name, tick] of Object.entries(TICKS)) {
      const tickSvg = readSymbolSvg(tick) as string;
      const [, tickMinY, , tickHeight] = viewBoxOf(tickSvg);
      // The tick is a one-sided stroke running from the axis into +y.
      expect(tickMinY, `${tick} barely crosses the axis`).toBeGreaterThan(-0.5);
      expect(tickMinY + tickHeight, `${tick} reaches into +y`).toBeGreaterThan(
        1,
      );

      const marks = sourceSvg({ kind: "linemark", name }) as string;
      const stroke = /<path d="([^"]+)"/.exec(tickSvg)![1]!;
      expect(marks, `${name} places ${tick}`).toContain(stroke);
      expect(marks, `${name} marks are NOT mirrored`).not.toContain(
        "scale(1,-1)",
      );

      // The stroke is inlined verbatim and nothing flips it, so the tick still
      // runs from the axis into +y in image space -- which is the whole claim.
      // Nothing trims it off, either: the symmetric box reaches at least as
      // far into +y as the tick does. (The style's OVERALL extent says nothing
      // about the tick side: ENTRES51's EMENTRE1 ring straddles the axis and
      // makes the box symmetric on its own.)
      const { bottom } = lineMarkGeometry(name) as { bottom: number };
      expect(bottom, `${name} keeps the whole tick`).toBeGreaterThanOrEqual(
        tickMinY + tickHeight - 1e-9,
      );
    }
  });

  test("a mark sprite carries every placement of the interval, at its position", () => {
    // MARSYS51 is the awkward one: two DIFFERENT glyphs 13.13 mm apart in a
    // 25.5 mm interval, so the sprite has to hold both at their relative
    // positions -- one sprite per style, not one per glyph.
    const marsys = sourceSvg({ kind: "linemark", name: "MARSYS51" }) as string;
    const [minX, , width] = viewBoxOf(marsys);
    expect(marsys).toContain("M -1,1.4 L 0,-1.6 L 1,1.4"); // EMMARS01's "A"
    const positions = [
      ...marsys.matchAll(/translate\(([-\d.]+),([-\d.]+)\)/g),
    ].map((match) => Number(match[1]));
    expect(positions).toHaveLength(2);
    expect(positions[1]! - positions[0]!).toBeCloseTo(20.44 - 7.31, 3);
    // Centred: the two placements straddle x = 0 within the box.
    expect(minX).toBeCloseTo(-width / 2, 6);

    // The pen is NOT in it -- the dash schedule is the line layer's job, and a
    // dash baked into the icon would be the stretched thing all over again.
    expect(marsys).not.toContain(" M 2,0 L 5,0");
  });

  /**
   * The round-13 SPLIT: one sprite per glyph kind for the 10 uniform-pitch
   * multi-mark styles, so a line-placed icon is a single glyph's quad rather
   * than a whole interval's rigid bar. See SPLIT_LINEMARK_STYLES.
   */
  describe("split mark sprites", () => {
    test("a split style files one sprite per glyph kind, majority on the bare key", () => {
      // CTNARE51: tooth (EMAREMG1) at slots 0, 2, 3; caution (EMCTNAR1) at
      // slot 1. The tooth is the majority glyph, so it KEEPS LM_CTNARE51 --
      // an already-shipped frontend asking for the bare key resolves to the
      // visually dominant repeated glyph -- and the caution takes _2.
      const ctnare = sources.filter(
        (source) => source.kind === "linemark" && source.name === "CTNARE51",
      );
      expect(ctnare.map((source) => source.key)).toEqual([
        "LM_CTNARE51",
        "LM_CTNARE51_2",
      ]);
      expect(ctnare.map((source) => source.reference)).toEqual([
        "EMAREMG1",
        "EMCTNAR1",
      ]);

      // The bare key really is the tooth: the EMAREMG1 chevron stroke is in
      // it and the EMCTNAR1 caution circle is not, and vice versa for _2.
      const chevron = /<path d="([^"]+)"/.exec(
        readSymbolSvg("EMAREMG1") as string,
      )![1]!;
      const tooth = sourceSvg(ctnare[0]!) as string;
      const caution = sourceSvg(ctnare[1]!) as string;
      // The caution ring is the one drawn circle in the family (the hidden
      // pivotPoint marker is r="1", so the radius is the unambiguous pin).
      expect(tooth).toContain(chevron);
      expect(tooth).not.toContain('r="2.59"');
      expect(caution).toContain('r="2.59"');
      expect(caution).not.toContain(chevron);

      // Single-glyph quads: the packed sprite was 106 px wide and its rigid
      // bar sat a measured median 25.7 px off a meandering 45k boundary; the
      // split cuts each sprite to its own glyph's ink.
      expect(symbols["LM_CTNARE51"]!.width).toBeLessThanOrEqual(14);
      expect(symbols["LM_CTNARE51_2"]!.width).toBeLessThanOrEqual(21);

      // Every split style, the same shape: majority first on the bare key,
      // every kind's sprite in the sheet.
      for (const name of SPLIT_LINEMARK_STYLES as Set<string>) {
        const kinds = lineMarkKinds(name) as {
          reference: string;
          count: number;
          suffix: string;
          spacing: number;
        }[];
        expect(kinds.length, `${name} splits into its kinds`).toBeGreaterThan(
          1,
        );
        expect(kinds[0]!.suffix).toBe("");
        for (let i = 1; i < kinds.length; i++) {
          expect(kinds[i]!.suffix).toBe(`_${i + 1}`);
          expect(
            kinds[i]!.count,
            `${name} majority kind comes first`,
          ).toBeLessThanOrEqual(kinds[0]!.count);
        }
        for (const kind of kinds) {
          const key = `LM_${name}${kind.suffix}`;
          expect(symbols[key], `${key} is in symbols.json`).toBeDefined();
        }
      }
    });

    test("each kind's spacing is the phase-free lattice arithmetic", () => {
      // Uniform pitch interval/n is what makes the split work with no phase
      // control: the repeated kind takes the full lattice pitch (a tooth at
      // EVERY slot, one of them under the caution glyph -- the accepted
      // overdraw) and a once-per-interval kind takes the interval itself.
      const spec = lineStyleSpec("CTNARE51") as {
        interval: number;
        marks: unknown[];
      };
      const kinds = lineMarkKinds("CTNARE51") as {
        reference: string;
        count: number;
        spacing: number;
      }[];
      expect(kinds.map((kind) => kind.count)).toEqual([3, 1]);
      expect(kinds[0]!.spacing).toBeCloseTo(spec.interval / 4, 9);
      expect(kinds[1]!.spacing).toBeCloseTo(spec.interval, 9);

      // And that arithmetic is sound ONLY for the count shape [n-1, 1]: one
      // kind repeated within the interval, one kind once per interval. Every
      // member has it. Two repeated kinds would share the interval/n lattice
      // (both glyphs on every anchor); two once-per-interval kinds would both
      // take the whole interval from anchor 0 (both glyphs stacked on one
      // anchor) -- which is exactly why DWRTCL07 is no longer in the set.
      for (const name of SPLIT_LINEMARK_STYLES as Set<string>) {
        const style = lineStyleSpec(name) as {
          interval: number;
          marks: unknown[];
        };
        const shape = lineMarkKinds(name) as { count: number }[];
        expect(
          shape.map((kind) => kind.count),
          `${name} count shape`,
        ).toEqual([style.marks.length - 1, 1]);
      }
    });

    test("a Category-C style keeps its packed sprite, byte-identical shape", () => {
      // TIDINF51's marks sit on an UNEVEN pitch, so the phase-free trick
      // cannot split it: it stays one sprite holding all four placements at
      // their positions, one source, no _2 key, and no `marks` list in the
      // metrics (see `line style metrics` below).
      expect(SPLIT_LINEMARK_STYLES.has("TIDINF51")).toBe(false);
      expect(lineMarkKinds("TIDINF51")).toBeUndefined();
      const tidinf = sources.filter(
        (source) => source.kind === "linemark" && source.name === "TIDINF51",
      );
      expect(tidinf).toHaveLength(1);
      expect(tidinf[0]!.key).toBe("LM_TIDINF51");
      expect(symbols["LM_TIDINF51_2"]).toBeUndefined();
      expect([
        symbols["LM_TIDINF51"]!.width,
        symbols["LM_TIDINF51"]!.height,
      ]).toEqual([108, 14]);
      const svgText = sourceSvg(tidinf[0]!) as string;
      const placements = [...svgText.matchAll(/translate\(/g)];
      expect(placements, "all four placements stay packed").toHaveLength(4);
    });

    test("DWRTCL07 is Category C too: its two glyphs ALTERNATE", () => {
      // It looks split-able -- a uniform two-slot interval -- but its glyphs
      // sit 11.7 mm apart in a 23.4 mm interval: they alternate at HALF the
      // interval. Both kinds have count 1, so the split gave both
      // symbol-spacing = the full interval from anchor 0, stacking them on one
      // anchor and destroying the alternation. Removed in round 13; it keeps
      // the packed 62 px sprite and one source, byte-identical to before.
      expect(SPLIT_LINEMARK_STYLES.has("DWRTCL07")).toBe(false);
      expect(lineMarkKinds("DWRTCL07")).toBeUndefined();
      const dwrtcl = sources.filter(
        (source) => source.kind === "linemark" && source.name === "DWRTCL07",
      );
      expect(dwrtcl).toHaveLength(1);
      expect(dwrtcl[0]!.key).toBe("LM_DWRTCL07");
      expect(symbols["LM_DWRTCL07_2"]).toBeUndefined();
      expect([
        symbols["LM_DWRTCL07"]!.width,
        symbols["LM_DWRTCL07"]!.height,
      ]).toEqual([62, 24]);

      // The alternation itself, from the metrics: two marks, half an interval
      // apart. This is the pin that must fail if anyone re-adds the name.
      const spec = lineStyleSpec("DWRTCL07") as {
        interval: number;
        marks: { position: number }[];
      };
      expect(spec.marks).toHaveLength(2);
      expect(spec.marks[1]!.position - spec.marks[0]!.position).toBeCloseTo(
        spec.interval / 2,
        1,
      );
    });
  });

  test("a drawn line style becomes one mark on its own pivot", () => {
    // NEWOBJ01 has no S-101 definition; its same-named SVG really is the line
    // style (a magenta disc chained along the line), so DRAWN_LINESTYLES lets
    // it through. Under the split it is a single placement at position 0 and
    // no pen at all.
    const spec = lineStyleSpec("NEWOBJ01") as {
      parts: unknown[];
      marks: { reference: string; position: number }[];
      interval: number;
    };
    expect(spec.parts).toEqual([]);
    expect(spec.marks).toEqual([
      { reference: "NEWOBJ01", position: 0, offset: 0 },
    ]);
    // Repeated at the drawing's own width, which is the spacing the tiled
    // pattern had.
    expect(spec.interval).toBeCloseTo(6.32, 2);
    expect(sourceSvg({ kind: "linemark", name: "NEWOBJ01" })).toContain(
      'r="3"',
    );
  });
});

/**
 * `linestyles.json` — the pen and the repeat interval `LC()` reads.
 */
describe("line style metrics", () => {
  const metrics = linestylesJson as Record<
    string,
    {
      interval: number;
      mark?: string;
      marks?: { mark: string; spacing: number }[];
      parts: {
        offset: number;
        width: number;
        colour: string;
        dash?: number[];
      }[];
    }
  >;

  test("covers every drawable line style", () => {
    const names = sources
      .filter((source) => source.kind === "linestyle")
      .map((source) => source.name);
    expect(Object.keys(metrics).sort()).toEqual(
      names.filter((name) => name !== "LOWACC11").sort(),
    );
  });

  test("a dash schedule fills its interval exactly", () => {
    // The invariant that makes the two halves of the style agree: the pen's
    // schedule repeats on the same period the marks are spaced at. It is also
    // what catches a dash the definition gives BACKWARDS -- FERYRT01 declares
    // `<start>5.1</start><length>-3.1</length>`, and unnormalized that sorts
    // into the wrong place and eats the gap either side of it.
    for (const [name, style] of Object.entries(metrics)) {
      for (const part of style.parts) {
        if (!part.dash) continue;
        expect(part.dash.length % 2, `${name} alternates dash and gap`).toBe(0);
        expect(
          part.dash.every((run) => run > 0),
          `${name} has no empty run`,
        ).toBe(true);
        const total = part.dash.reduce((sum, run) => sum + run, 0);
        expect(total, `${name} dash schedule fills the interval`).toBeCloseTo(
          style.interval,
          1,
        );
      }
    }
  });

  test("a pure dash schedule has no mark, and a solid pen no dasharray", () => {
    // INDHLT02 is a yellow pen over a wider black one, both solid: two parts,
    // no dashes, no marks.
    expect(metrics["INDHLT02"]!.mark).toBeUndefined();
    expect(metrics["INDHLT02"]!.parts.map((p) => p.colour)).toEqual([
      "BKAJ1",
      "CHYLW",
    ]);
    expect(metrics["INDHLT02"]!.parts.every((p) => p.dash === undefined)).toBe(
      true,
    );

    // CHRVDEL2's single dash covers the whole interval: solid, not a dash with
    // a zero-length gap (which MapLibre renders as nothing at all).
    expect(metrics["CHRVDEL2"]!.parts[0]!.dash).toBeUndefined();
    expect(metrics["CHRVDEL2"]!.mark).toBe("LM_CHRVDEL2");
  });

  test("the mark half is exactly one of two shapes, never both", () => {
    // `mark` is an unsplit style's packed sprite, spaced at the interval;
    // `marks` is a split style's per-kind list. A style carrying both -- or a
    // split list on a style outside SPLIT_LINEMARK_STYLES -- would be the
    // silent polymorphism the schema is built to exclude.
    for (const [name, style] of Object.entries(metrics)) {
      expect(
        style.mark !== undefined && style.marks !== undefined,
        `${name} carries mark AND marks`,
      ).toBe(false);
      expect(
        style.marks !== undefined,
        `${name} split shape matches the set`,
      ).toBe((SPLIT_LINEMARK_STYLES as Set<string>).has(name));
    }

    // CTNARE51's list, verbatim: tooth on the bare key at the lattice pitch
    // interval/4, caution on _2 at the interval. Both lattices start at
    // anchor 0, so no phase control is needed -- see `lineMarkKinds`.
    const ctnare = metrics["CTNARE51"]!;
    expect(ctnare.marks).toEqual([
      { mark: "LM_CTNARE51", spacing: 30.52 },
      { mark: "LM_CTNARE51_2", spacing: 122.079 },
    ]);
    expect(ctnare.marks![0]!.spacing).toBeCloseTo(ctnare.interval / 4, 2);
    expect(ctnare.marks![1]!.spacing).toBe(ctnare.interval);

    // ...and the packed shape, unchanged: Category C keeps `mark`.
    expect(metrics["TIDINF51"]!.mark).toBe("LM_TIDINF51");
    expect(metrics["TIDINF51"]!.marks).toBeUndefined();
  });

  /**
   * A dash that runs past the end of its own interval is CLIPPED to it, not
   * allowed to discard the schedule.
   *
   * Five catalogue styles declare one. Unclipped, the overrun wraps against the
   * first dash of the next repeat for a NEGATIVE gap, and the whole schedule
   * was thrown away — which spells a dashed pen as a solid one. All three
   * recommended-track styles went solid that way, against LC_ pattern tiles
   * that have always drawn them dashed (the tile's viewBox is one interval
   * wide, so it clips the overrun exactly as this does).
   */
  describe("a dash past the end of the interval", () => {
    test("is clipped, not thrown away", () => {
      // RECTRC09 verbatim: four 3.3 mm dashes at 2, 9, 16 and 21.3 in a 19.3 mm
      // interval. The fourth lies wholly outside and drops; the rest stand.
      expect(
        dashSchedule(
          [2, 9, 16, 21.3].map((start) => ({ start, length: 3.3 })),
          19.3,
        ),
      ).toEqual([3.3, 3.7, 3.3, 3.7, 3.3, 2]);

      // RECTRC10: one dash of 20.6 mm from 0.3 in a 17.6 mm interval. Clipped
      // it is 17.3 long -- short of the interval, so it is a dash with a
      // 0.3 mm gap and NOT the solid pen the whole-interval branch would make
      // of it.
      expect(dashSchedule([{ start: 0.3, length: 20.6 }], 17.6)).toEqual([
        17.3, 0.3,
      ]);

      // A dash that genuinely fills the interval is still solid.
      expect(dashSchedule([{ start: 0, length: 17.6 }], 17.6)).toBeNull();

      // A run ending exactly at the interval and one starting exactly at 0 are
      // the same run of the REPEATING pattern, and the merge above cannot see
      // across the wrap to say so. Folded together they are one 16 mm dash
      // with a 4 mm gap -- not two dashes with a zero-length gap between them,
      // which MapLibre renders as a corrupt dash texture.
      expect(
        dashSchedule(
          [
            { start: 0, length: 4 },
            { start: 8, length: 20 },
          ],
          20,
        ),
      ).toEqual([16, 4]);
    });

    test("leaves every style that declares one dashed", () => {
      // The three recommended tracks are the regression; QUESMRK1 and RCRDEF11
      // were merely drawing their last dash a little long.
      for (const name of [
        "RECTRC09",
        "RECDEF02",
        "RECTRC10",
        "QUESMRK1",
        "RCRDEF11",
      ]) {
        const dash = metrics[name]!.parts[0]!.dash;
        expect(dash, `${name} draws a dashed pen`).toBeDefined();
        expect(
          dash!.reduce((sum, run) => sum + run, 0),
          `${name} fills its interval`,
        ).toBeCloseTo(metrics[name]!.interval, 1);
      }
    });
  });

  test("parallel pens keep their offsets, sign included", () => {
    // SCLBDY51: a wide pen 1.0 mm to one side and two hairlines 1.74/2.43 mm
    // to the other. S-101 measures +y INTO the area and MapLibre offsets a
    // line to the right of travel for a positive value -- the same side -- so
    // the sign carries straight through.
    const pxPerMm = 3.7795275591;
    expect(metrics["SCLBDY51"]!.parts.map((p) => p.offset)).toEqual([
      Math.round(-1.0 * pxPerMm * 1000) / 1000,
      Math.round(1.74 * pxPerMm * 1000) / 1000,
      Math.round(2.43 * pxPerMm * 1000) / 1000,
    ]);
  });
});
