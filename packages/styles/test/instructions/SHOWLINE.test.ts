import { LineLayerSpecification, SymbolLayerSpecification } from "maplibre-gl";
import { describe, test, expect } from "vitest";
import s52, { symbols } from "@enc-tiles/s52";
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
    const styles = instructionsToStyles("LC(ACHARE51)", config);
    expect(styles).toHaveLength(2);

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

    const marks = styles[1] as SymbolLayerSpecification;
    expect(marks.type).toBe("symbol");
    expect(marks.layout!["symbol-placement"]).toBe("line");
    expect(marks.layout!["icon-image"]).toBe("LM_ACHARE51");
    // Constant screen pixels at every zoom: that is the whole point.
    expect(marks.layout!["symbol-spacing"]).toBeCloseTo(32.3 * PX_PER_MM, 1);
    expect(symbols["LM_ACHARE51"]).toBeDefined();

    // Both halves name the style they came from, so the frontend can tell a
    // symbolized boundary from a plain one without sniffing paint.
    expect(pen.metadata).toEqual({ "s52:linestyle": "ACHARE51" });
    expect(marks.metadata).toEqual({ "s52:linestyle": "ACHARE51" });
  });

  test("the marks are oriented to point INTO the area", () => {
    // The sprite is drawn with the ticks pointing image-DOWN (see
    // `lineMarkGeometry`), and these four properties are what turn that into
    // "the right of travel", which is the filled side of any MVT-wound ring.
    const marks = instructionsToStyles(
      "LC(RESARE51)",
      config,
    )[1] as SymbolLayerSpecification;
    expect(marks.layout).toMatchObject({
      "symbol-placement": "line",
      "icon-rotate": 0,
      "icon-rotation-alignment": "map",
      "icon-pitch-alignment": "map",
      // NOT true: keep-upright flips a symbol on a westward line, which would
      // move the teeth to the OUTSIDE of the area there. Side-consistency
      // beats uprightness for a mark that carries a direction.
      "icon-keep-upright": false,
      // A boundary mark is part of the boundary, not a label competing for
      // space: without these the dentate run develops holes wherever a chart
      // label lands on the line.
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      // Not a text property here. `boxScale` is derived from `text-size` even
      // on a layer that shapes no text, and at the default 16 MapLibre
      // reserves ~70 px of the line at each end for a 105 px mark sprite —
      // which on a closed ring is a hole at the closure vertex. See
      // END-OF-LINE SUPPRESSION in `LC` and test/harness/line-mark-anchors.
      "text-size": 0,
    });
    // The sprite is centred on its own pivot, so there is no icon-offset to
    // get wrong — and the orientation derivation assumes there is none.
    expect(marks.layout!).not.toHaveProperty("icon-offset");
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

      const marks = styles.filter((style) => style.type === "symbol");
      expect(marks.length, `LC(${name}) mark layers`).toBeLessThanOrEqual(1);
      for (const layer of marks) {
        const image = (layer as SymbolLayerSpecification).layout!["icon-image"];
        expect(image, `LC(${name}) mark sprite`).toBe(`LM_${name}`);
        expect(
          symbols[image as string],
          `${image} is in the sheet`,
        ).toBeDefined();
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
