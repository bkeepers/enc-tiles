import { LineLayerSpecification, SymbolLayerSpecification } from "maplibre-gl";
import { describe, test, expect } from "vitest";
import s52, { linestyles, symbols } from "@enc-tiles/s52";
import { instructionsToStyles } from "../../src/instructions/index.js";
import { LayerConfig } from "../../src/symbolology/index.js";

/** CSS pixels per millimetre at 96 dpi — the scale the sprites are drawn at. */
const PX_PER_MM = 3.7795275591;

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

/**
 * LC() emits a PAIR: the pen as a dashed line layer, the marks as a
 * line-placed symbol layer over the same features.
 *
 * It used to be one `line-pattern` of the whole repeat interval. MapLibre
 * scales a line pattern along the line by `2^frac(zoom)`, so every embedded
 * glyph stretched by up to 2x between integer zooms and snapped back at each
 * one — see the header of `LC` for the derivation and the orientation proof
 * the layout properties below come from.
 */
describe("LC – complex line styles", () => {
  test("LC(ACHARE51) is a dashed pen plus its marks", () => {
    // ACHARE51 is a SPLIT style (see SPLIT_LINEMARK_STYLES in the sprite
    // build), so the marks are TWO layers: the repeated tooth on the bare
    // LM_ key at the lattice pitch, the once-per-interval anchor glyph on
    // the _2 key at the interval.
    const styles = instructionsToStyles("LC(ACHARE51)", config);
    expect(styles).toHaveLength(3);

    const pen = styles[0] as LineLayerSpecification;
    expect(pen.type).toBe("line");
    // No pattern at all any more — the pen is a plain dash schedule.
    expect(pen.paint!).not.toHaveProperty("line-pattern");
    expect(pen.paint!["line-color"]).toBe("#C045D1");
    expect(pen.paint!["line-width"]).toBeCloseTo(0.32 * PX_PER_MM, 3);
    // The S-101 schedule (three 6 mm dashes at 2, 18.2 and 26.2 in a 32.3 mm
    // interval) in units of the line width, which is what MapLibre reads.
    expect(pen.paint!["line-dasharray"]).toEqual([
      18.757, 31.887, 18.757, 6.252, 18.757, 6.565,
    ]);
    expect(
      (pen.paint!["line-dasharray"] as number[]).reduce((a, b) => a + b, 0) *
        (pen.paint!["line-width"] as number),
    ).toBeCloseTo(32.3 * PX_PER_MM, 1);

    const tooth = styles[1] as SymbolLayerSpecification;
    expect(tooth.type).toBe("symbol");
    expect(tooth.layout!["symbol-placement"]).toBe("line");
    expect(tooth.layout!["icon-image"]).toBe("LM_ACHARE51");
    // Constant screen pixels at every zoom: that is the whole point. The
    // tooth repeats at the uniform lattice pitch, interval/4.
    expect(tooth.layout!["symbol-spacing"]).toBeCloseTo(
      (32.3 / 4) * PX_PER_MM,
      1,
    );
    expect(symbols["LM_ACHARE51"]).toBeDefined();

    const anchor = styles[2] as SymbolLayerSpecification;
    expect(anchor.type).toBe("symbol");
    expect(anchor.layout!["symbol-placement"]).toBe("line");
    expect(anchor.layout!["icon-image"]).toBe("LM_ACHARE51_2");
    expect(anchor.layout!["symbol-spacing"]).toBeCloseTo(32.3 * PX_PER_MM, 1);
    expect(symbols["LM_ACHARE51_2"]).toBeDefined();

    // All halves name the style they came from, so the frontend can tell a
    // symbolized boundary from a plain one without sniffing paint.
    expect(pen.metadata).toEqual({ "s52:linestyle": "ACHARE51" });
    expect(tooth.metadata).toEqual({ "s52:linestyle": "ACHARE51" });
    expect(anchor.metadata).toEqual({ "s52:linestyle": "ACHARE51" });
  });

  test("LC(CTNARE51) emits exactly two LM_ layers at the split spacings", () => {
    // The round-13 pin: tooth at interval/4 on the bare key -- which stays
    // the MAJORITY glyph, so an old frontend resolving LM_CTNARE51 gets the
    // dominant tooth -- and the caution glyph at the full interval on _2.
    const styles = instructionsToStyles("LC(CTNARE51)", config);
    const marks = styles.filter(
      (style) => style.type === "symbol",
    ) as SymbolLayerSpecification[];
    expect(marks).toHaveLength(2);
    expect(marks.map((layer) => layer.layout!["icon-image"])).toEqual([
      "LM_CTNARE51",
      "LM_CTNARE51_2",
    ]);
    const interval = 32.3 * PX_PER_MM;
    expect(marks[0]!.layout!["symbol-spacing"]).toBeCloseTo(interval / 4, 1);
    expect(marks[1]!.layout!["symbol-spacing"]).toBeCloseTo(interval, 1);

    // Key stability: the bare key is the single tooth now, not the packed
    // 106 px interval bar that jutted across every meander.
    expect(symbols["LM_CTNARE51"]!.width).toBeLessThanOrEqual(14);
    expect(symbols["LM_CTNARE51_2"]!.width).toBeGreaterThan(
      symbols["LM_CTNARE51"]!.width,
    );
  });

  test("a Category-C style still emits ONE layer with the packed sprite", () => {
    // TIDINF51's marks sit on an uneven pitch, so it is not split: one
    // symbol layer, packed sprite, spacing = interval. Byte-identical to the
    // pre-split output.
    const styles = instructionsToStyles("LC(TIDINF51)", config);
    const marks = styles.filter(
      (style) => style.type === "symbol",
    ) as SymbolLayerSpecification[];
    expect(marks).toHaveLength(1);
    expect(marks[0]!.layout!["icon-image"]).toBe("LM_TIDINF51");
    expect(marks[0]!.layout!["symbol-spacing"]).toBeCloseTo(
      33.3 * PX_PER_MM,
      1,
    );
    expect(symbols["LM_TIDINF51"]!.width).toBe(108);
  });

  test("the mark layer count follows the split decision", () => {
    // The orientation and text-size flags that every one of these layers has
    // to carry are asserted over ALL of them in the every-LC() sweep below;
    // this is just the split decision itself, on the styles that bracket it.
    const markLayers = (name: string) =>
      instructionsToStyles(`LC(${name})`, config).filter(
        (style) => style.type === "symbol",
      ) as SymbolLayerSpecification[];

    const cases: [string, number][] = [
      ["RESARE51", 1], // unsplit, single-mark
      ["ACHARE51", 2], // split: tooth x3 + anchor glyph x1
      ["CTNARE51", 2], // split: tooth x3 + caution glyph x1
      // Round 13 reverted this one. Its two glyphs appear once each but they
      // ALTERNATE at half the interval, and the count-1 spacing rule (the
      // whole interval, from anchor 0) would have stacked them on a single
      // anchor. Back to Category C: one layer, packed 62 px sprite.
      ["DWRTCL07", 1],
    ];
    for (const [name, layers] of cases) {
      expect(markLayers(name), `LC(${name})`).toHaveLength(layers);
    }

    const dwrtcl = markLayers("DWRTCL07");
    expect(dwrtcl[0]!.layout!["icon-image"]).toBe("LM_DWRTCL07");
    expect(symbols["LM_DWRTCL07"]!.width).toBe(62);
    expect(symbols["LM_DWRTCL07_2"]).toBeUndefined();
  });

  test("a composite line style emits one pen per part and no marks", () => {
    // INDHLT02 is a yellow pen over a wider black one — two solid parts, no
    // dashes and no symbols anywhere in the definition.
    const styles = instructionsToStyles("LC(INDHLT02)", config);
    expect(styles.map((style) => style.type)).toEqual(["line", "line"]);
    expect(
      styles.map(
        (style) => (style as LineLayerSpecification).paint!["line-color"],
      ),
    ).toEqual(["#0E1315", "#E1E139"]);
    for (const style of styles) {
      expect(style).not.toHaveProperty("paint.line-dasharray");
    }
  });

  test("a drawn line style is marks only", () => {
    // NEWOBJ01 has no S-101 definition and no pen: it is a magenta disc
    // chained along the line at the drawing's own width.
    const styles = instructionsToStyles("LC(NEWOBJ01)", config);
    expect(styles.map((style) => style.type)).toEqual(["symbol"]);
    const marks = styles[0] as SymbolLayerSpecification;
    expect(marks.layout!["icon-image"]).toBe("LM_NEWOBJ01");
    expect(marks.layout!["symbol-spacing"]).toBeCloseTo(6.32 * PX_PER_MM, 1);
  });

  test("every LC() in the look-up tables resolves to a pen and/or marks", () => {
    // Every LC name in the DAI, so a catalogue update that adds one with no
    // metrics is caught here rather than by MapLibre drawing nothing (an
    // unknown icon-image) or an arbitrary atlas image (an unknown pattern).
    const names = new Set(
      [...JSON.stringify(s52).matchAll(/LC\\?\(([A-Z0-9]+)\\?\)/g)].map(
        (match) => match[1]!,
      ),
    );
    expect(names.size).toBeGreaterThan(30);

    for (const name of names) {
      const styles = instructionsToStyles(`LC(${name})`, config);
      expect(styles.length, `LC(${name}) emits layers`).toBeGreaterThan(0);
      // Nothing may reference the old pattern tiles any more: they stay in the
      // sheet for already-shipped frontends, but a reference from here would
      // be the stretched rendering back again.
      for (const style of styles) {
        expect(style.metadata, `LC(${name}) tags its layers`).toEqual({
          "s52:linestyle": name,
        });
        expect(
          (style as LineLayerSpecification).paint?.["line-pattern"],
          `LC(${name}) uses no line-pattern`,
        ).toBeUndefined();
      }

      // One mark layer per sprite the style's metrics declare: a single
      // packed sprite for an unsplit style, one per glyph kind for a split
      // one -- the majority kind first, on the bare LM_ key.
      const marks = styles.filter((style) => style.type === "symbol");
      const declared = linestyles[name];
      const images = declared?.marks
        ? declared.marks.map((entry) => entry.mark)
        : declared?.mark
          ? [declared.mark]
          : [];
      expect(
        marks.map(
          (layer) => (layer as SymbolLayerSpecification).layout!["icon-image"],
        ),
        `LC(${name}) mark sprites`,
      ).toEqual(images);
      if (images.length > 0) {
        expect(images[0], `LC(${name}) majority key`).toBe(`LM_${name}`);
      }
      for (const image of images) {
        expect(
          symbols[image as string],
          `${image} is in the sheet`,
        ).toBeDefined();
      }

      // ORIENTED INTO THE AREA, on EVERY mark layer of EVERY style. The
      // sprite is drawn with the ticks pointing image-DOWN (see
      // `lineMarkGeometry`), and these four properties are what turn that
      // into "the right of travel", which is the filled side of any MVT-wound
      // ring. A split style emits several mark layers and every one must
      // carry the whole set verbatim: the layers must agree on orientation or
      // the glyph kinds part company, and `text-size: 0` is doubly
      // load-bearing there -- it is also what keeps each layer's anchor
      // lattice independent of its own sprite's width, which the phase-free
      // split REQUIRES.
      for (const layer of marks as SymbolLayerSpecification[]) {
        expect(
          layer.layout,
          `LC(${name}) ${layer.layout!["icon-image"]}`,
        ).toMatchObject({
          "symbol-placement": "line",
          "icon-rotate": 0,
          "icon-rotation-alignment": "map",
          "icon-pitch-alignment": "map",
          // NOT true: keep-upright flips a symbol on a westward line, which
          // would move the teeth to the OUTSIDE of the area there.
          // Side-consistency beats uprightness for a mark that carries a
          // direction.
          "icon-keep-upright": false,
          // A boundary mark is part of the boundary, not a label competing
          // for space: without these the dentate run develops holes wherever
          // a chart label lands on the line.
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          // Not a text property here. `boxScale` is derived from `text-size`
          // even on a layer that shapes no text: at the default 16 MapLibre
          // reserves room at both line ends (a hole at every ring's closure
          // vertex) AND folds the sprite's width back into the effective
          // spacing, which would break the split lattices' arithmetic. See
          // END-OF-LINE SUPPRESSION in `LC` and test/harness/line-mark-anchors.
          "text-size": 0,
        });
        // The sprite is centred on its own pivot, so there is no icon-offset
        // to get wrong -- and the orientation derivation assumes there is
        // none.
        expect(
          layer.layout!,
          `LC(${name}) ${layer.layout!["icon-image"]} icon-offset`,
        ).not.toHaveProperty("icon-offset");
      }
    }
  });

  test("LC() drops the layers when the line style has no metrics", () => {
    // LOWACC11 is in the DAI but has neither a drawing nor an S-101
    // definition. Emitting the layers would put an unresolvable icon-image and
    // a pen of unknown width on the line.
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
});
