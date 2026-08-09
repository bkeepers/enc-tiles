import { LineLayerSpecification, SymbolLayerSpecification } from "maplibre-gl";
import { colour, ColourName, linestyles } from "@enc-tiles/s52";
import { Reference } from "./parser.js";
import type { CSPLayer, LayerConfig } from "../symbolology/index.js";

/**
 * Dash patterns for the S-52 predefined line styles (PSTYLE).
 *
 * SOLD (_________) is deliberately NOT a member. MapLibre treats
 * `"line-dasharray": []` as a zero-length dash pattern and draws *nothing* —
 * it is not the same as "no dashes". A solid line has to be expressed by
 * omitting the `line-dasharray` paint property entirely, which is what `LS`
 * does for any PSTYLE that has no entry here. Adding `SOLD: []` back makes
 * every solid line in the style (bridges and 111 other line layers across 45
 * object classes) invisible.
 */
export const LineStyles = {
  DASH: [3.6, 1.8], // (-----) dash: 3.6 mm; space: 1.8 mm
  DOTT: [0.6, 1.2], // (.........) dot: 0.6 mm; space: 1.2 mm
};

/**
 * LS – Showline (complex linestyle)
 *
 * Syntax:
 *   LS(PSTYLE, WIDTH, COLOUR);
 *
 * Description:
 * The SHOWLINE instruction is designed to symbolize line objects. It is also used within
 * the SHOWAREA instruction to symbolize area boundaries. The command is used to
 * show simple or complex line-styles (described below) and subsequent commands may
 * add a symbol or text as well.
 *
 * Parameters:
 * PSTYLE: Predefined line style parameter: One of three values:
 * WIDTH Line width parameter. Units are 0.32 mm (approximately pixel diameter)
 * COLOUR Line colour parameter. A valid colour token as described in section 7
 */
export function LS(
  config: LayerConfig,
  style: Reference,
  width: number,
  colourRef: Reference,
): Pick<LineLayerSpecification, "type" | "paint"> {
  const dasharray: number[] | undefined =
    LineStyles[style.name as keyof typeof LineStyles];

  return {
    type: "line",
    paint: {
      // Omit the property for SOLD (and any unknown PSTYLE) — see LineStyles.
      ...(dasharray ? { "line-dasharray": dasharray } : {}),
      "line-width": width,
      "line-color": colour(config.mode, colourRef.name as ColourName),
    },
  };
}

/**
 * Sprite-sheet key of a complex line style's PATTERN tile.
 *
 * S-52's symbol, pattern and line-style name spaces collapse into MapLibre's
 * single sprite name space and 17 line styles share a name with a symbol, so
 * the sprite build files line styles under this prefix — see `SPRITE_PREFIX`
 * in `@enc-tiles/s52`'s `build/symbols.ts`. Without it `LC(CTNARE51)` resolved
 * to the CTNARE51 *point* icon and tiled it along the boundary.
 *
 * THE GENERATED STYLE NO LONGER REFERENCES THESE — see `LC`. The tiles are
 * still built and published because frontends pinned to an older bundle still
 * ask the sprite sheet for them, and this helper is kept for the same reason:
 * it is the one place that spells the key.
 */
export function lineStyleImage(linnam: string): string {
  return `LC_${linnam}`;
}

/**
 * Metadata key marking a layer as one half of a complex line style.
 *
 * A symbolized boundary is no longer recognisable by its paint — the line half
 * is an ordinary dashed line — so the frontend, which has to tell the
 * symbolized presentation of a boundary from the plain one to decide which
 * viewing group owns it, is given the line style's name outright instead of
 * being made to sniff a sprite prefix.
 */
export const LINESTYLE_METADATA_KEY = "s52:linestyle";

/**
 * LC – Showline (complex linestyle).
 *
 * Syntax:
 *   LC(LINNAM);
 *
 * Parameters:
 * LINNAM: Name of complex linestyle. This parameter will symbolise the line using the
 * complex linestyle named by the LINNAM parameter.
 *
 * ONE INSTRUCTION, TWO LAYERS — the pen and the marks, drawn by the two
 * MapLibre primitives that can each carry their half undistorted.
 *
 * WHY, MEASURED. This used to be a single `line-pattern` of the whole repeat
 * interval, with `line-width` set to the tile's height so the tile drew at its
 * design scale. MapLibre scales a line pattern ALONG the line by `2^frac(zoom)`
 * (`line_pattern.vertex.glsl` via `tileZoomRatio`) — a renderer property no
 * style property turns off — so between two integer zooms every embedded glyph
 * stretched by up to 2x horizontally and snapped back at the next: dentate
 * teeth sheared into ramps, the PIPSOL circles into ellipses, the INFARE eye
 * into a slit. A dash schedule survives that stretch (a featureless run looks
 * the same at any length); a glyph does not.
 *
 * So the style splits:
 *
 *  - the PEN becomes ordinary `line` layers with `line-dasharray`, one per
 *    `ls:lineStyle` part (a composite style is parallel pens — INDHLT02 is a
 *    yellow line over a black one, SCLBDY51 three at different offsets), and
 *  - the MARKS become `symbol` layers with `symbol-placement: "line"` over
 *    the SAME features. An unsplit style is one layer: `icon-image` its
 *    packed mark sprite, `symbol-spacing` its repeat interval. A SPLIT style
 *    (round 13 — the wide uniform-pitch multi-mark styles, see
 *    `SPLIT_LINEMARK_STYLES` in the sprite build) is one layer per glyph
 *    kind, each on that kind's single-glyph sprite at that kind's spacing,
 *    which is what keeps a rigid 106 px bar from being laid tangent to a
 *    meandering boundary. A symbol is not scaled with zoom at all, so the
 *    marks hold their design size and their screen spacing either way.
 *
 * ORIENTATION. The marks have to point INTO the area. The mark sprite is drawn
 * with them pointing image-space DOWN (S-101's own +y, unmirrored — see
 * `lineMarkGeometry` in the sprite build for the five-step derivation against
 * MapLibre 4.7.1), and image-down faces the RIGHT of travel, which is the
 * filled side of any MVT-wound ring, exterior or hole alike. The layout
 * properties below are the other half of that derivation and are not
 * decoration:
 *
 *  - `icon-rotation-alignment: "map"` — `"auto"` resolves to this for line
 *    placement, but the derivation depends on it (it is also what makes
 *    `icon-pitch-alignment` inherit `"map"`, which keeps the label plane
 *    y-down), so it is stated.
 *  - `icon-keep-upright: false` — the default, stated for the same reason and
 *    because it is the one property that would break the result. Keep-upright
 *    flips a symbol on a line running right-to-left on screen; for a mark that
 *    CARRIES a direction that flip moves the teeth to the outside of the area
 *    on every westward edge. SIDE-CONSISTENCY BEATS UPRIGHTNESS: the cost is
 *    that the two lettered glyphs in the catalogue (MARSYS51's "A" and "B")
 *    read upside down on a westward boundary, which is the S-52 convention's
 *    own tradeoff — the dentate line means "the restriction is on this side"
 *    and that has to be true everywhere.
 *  - `icon-allow-overlap` / `icon-ignore-placement` — a boundary mark is part
 *    of the boundary, not a label competing for space. Without them MapLibre's
 *    collision pass drops marks wherever a chart label lands on the line, and
 *    the dentate run develops holes that read as gaps in the boundary.
 *  - `text-size: 0` — NOT a text property here. See END-OF-LINE SUPPRESSION.
 *
 * END-OF-LINE SUPPRESSION, and why `text-size` is set on a layer with no text.
 * MapLibre reserves room for a line-placed symbol at both ends of the line it
 * rides, and a boundary mark cannot afford it. `get_anchors.ts` accepts an
 * anchor only where `markedDistance ± labelLength/2` fits inside the line, and
 * offsets the FIRST anchor by `(shapedLabelLength/2 + 2·glyphSize) · boxScale`.
 * Both lengths are the sprite's own width scaled by `boxScale`, and `boxScale`
 * is `textMaxBoxScale` — `tilePixelRatio · text-size / 24` — which the ICON
 * layer inherits from the default `text-size` of 16 even though it shapes no
 * text at all (`symbol_layout.ts`, unchanged between MapLibre 4.7.1 and 5.24).
 *
 * At that default the suppression is not subtle. A line style packs a whole
 * repeat interval's marks into ONE sprite, so LM_CTNARE51/ACHARE51/CBLARE51/
 * PIPARE51/PIPARE61/PRCARE51/DWRUTE51 are 105 px wide and LM_TIDINF51 107 px:
 * half-label 35 screen px, first anchor 67 px. `clipLine` cuts every ring at
 * the tile edge with no buffer and a closed ring is ONE polyline, so a caution
 * area drew its dashed pen with no teeth for ~102 px — about one whole 122 px
 * repeat, four teeth — across its arbitrary closure vertex and again at every
 * tile seam, and a ring under ~70 px round got no marks whatsoever (the
 * `placeAtMiddle` retry still requires the label to fit). The `line-pattern`
 * this replaced was continuous through all of it.
 *
 * `text-size: 0` makes `boxScale` zero, which makes both lengths zero: the
 * anchors land at 0, spacing, 2·spacing … with no end reservation at all, so a
 * ring closes with the same tooth spacing it has everywhere else and even a
 * 60 px ring gets its mark. It is inert otherwise — the layer has no
 * `text-field`, so nothing is shaped, `validateStyleMin` accepts it, and
 * `textBoxScale` feeds only text collision boxes that are never built.
 *
 * Tile seams keep a phase reset (a clipped line is `isLineContinued`, whose
 * first anchor is at `spacing/2`), but that is jitter of at most one repeat
 * either way rather than a systematic hole.
 *
 * HOLE RINGS. The same rule holds without a special case: MVT winds holes
 * opposite to exteriors, so the FILLED side is on the right of travel for both
 * and the teeth point into the water body either way. S-52 gives no separate
 * convention for the inner boundary of an area with a hole, so this is the
 * behaviour we take.
 */
export function LC(config: LayerConfig, linnam: Reference): CSPLayer[] {
  const style = linestyles[linnam.name];

  if (!style) {
    // Emitting the layer anyway would be worse than dropping it: MapLibre
    // resolves an unknown icon-image to nothing and an unknown line-pattern to
    // an arbitrary image from the atlas.
    console.warn(`Missing line style: ${linnam.name}`);
    return [];
  }

  const metadata = { [LINESTYLE_METADATA_KEY]: linnam.name };

  const pens: Pick<LineLayerSpecification, "type" | "paint" | "metadata">[] =
    style.parts.map((part) => ({
      type: "line",
      metadata,
      paint: {
        "line-color": colour(config.mode, part.colour as ColourName),
        "line-width": part.width,
        // `line-dasharray` is in units of the line width; the schedule is stored
        // in pixels so its relation to the interval stays visible. Omitted for a
        // solid pen -- an empty dasharray draws nothing (see `LineStyles`).
        ...(part.dash
          ? {
              "line-dasharray": part.dash.map((run) => round(run / part.width)),
            }
          : {}),
        // S-101 measures a composite style's parallel pens from the line axis
        // with +y into the area, and MapLibre offsets a line to the RIGHT of
        // travel for a positive value -- the same side. No sign flip.
        ...(part.offset ? { "line-offset": part.offset } : {}),
      },
    }));

  // The mark half of the style comes in exactly one of two shapes (see
  // `LineStyle` in @enc-tiles/s52): `marks` is a SPLIT style's per-glyph-kind
  // list, one layer per kind at its own spacing; `mark` is an unsplit style's
  // single packed sprite, spaced at the repeat interval. Normalized here, in
  // the one place that reads either.
  const markEntries =
    style.marks ??
    (style.mark ? [{ mark: style.mark, spacing: style.interval }] : []);

  if (markEntries.length === 0) return pens;

  // SPLIT STYLES, AND THE TWO PORTRAYAL DEVIATIONS THEY ACCEPT (ruled in
  // round 13). A split style's layers are phase-free: every layer's anchors
  // land at 0, s, 2s, … so the repeated kind's lattice (pitch interval/n)
  // and the once-per-interval kind's lattice (pitch interval) line up by
  // arithmetic. Two consequences are accepted portrayal deviations rather
  // than bugs: (i) on an unclipped line the once-per-interval glyph's anchor
  // COINCIDES with a repeated-glyph anchor, so the glyph draws over a tooth
  // where S-52 would draw only the glyph — the larger glyph dominates
  // visually; (ii) on a tile-clipped line MapLibre starts an `isLineContinued`
  // segment at spacing/2 PER LAYER, so the two lattices drift by half a slot
  // and the glyph lands between teeth instead of on one. Both accepted.
  const marks: Pick<
    SymbolLayerSpecification,
    "type" | "layout" | "metadata"
  >[] = markEntries.map((entry) => ({
    type: "symbol",
    metadata,
    layout: {
      "symbol-placement": "line",
      "symbol-spacing": entry.spacing,
      "icon-image": entry.mark,
      // See the orientation note above: every one of these is load-bearing,
      // and every one is stated on EVERY mark layer — a split style's
      // layers must agree on orientation or the kinds part company.
      "icon-rotate": 0,
      "icon-rotation-alignment": "map",
      "icon-pitch-alignment": "map",
      "icon-keep-upright": false,
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      // Zeroes the anchor box scale so the teeth run to both ends of every
      // clipped line and every ring closes (see END-OF-LINE SUPPRESSION) —
      // and it is ALSO what makes the anchor lattice width-independent:
      // with a non-zero text-size, `get_anchors.ts` folds the sprite's own
      // width back into the spacing (`spacing - labelLength < spacing / 4`),
      // and a split style's phase-free lattice REQUIRES anchors at exactly
      // 0, s, 2s, … regardless of each kind's sprite width.
      "text-size": 0,
    },
  }));

  // The marks draw over the pen they belong to, majority kind first.
  return [...pens, ...marks];
}

/** Three decimals: enough for a dash ratio, short enough to read in a diff. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
