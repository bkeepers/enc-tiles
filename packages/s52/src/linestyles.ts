import data from "../linestyles.json" with { type: "json" };

/**
 * The complex line styles (`LC()`), decomposed into a pen with a dash schedule
 * and a repeated mark sprite.
 *
 * Built by `build/symbols.ts` (`lineStyleMetrics`) alongside `symbols.json`,
 * which only carries sprite boxes — the LINE half of a complex line style is
 * not a sprite at all any more.
 *
 * Units are CSS pixels at the 96 dpi scale the sprites are rasterized at, so
 * `symbol-spacing` and the mark sprite agree. `dash` is an absolute pixel
 * schedule summing to `interval`; MapLibre's `line-dasharray` is in units of
 * the line width, so `LC()` divides it by the part's `width`.
 */
export interface LineStylePart {
  /** Perpendicular offset from the line axis, px. Positive is into the area. */
  offset: number;
  /** Pen width, px. */
  width: number;
  /** S-52 colour token. */
  colour: string;
  /**
   * Alternating dash/gap run lengths in px, summing to the interval. Absent
   * for a solid pen — MapLibre draws NOTHING for an empty `line-dasharray`, so
   * "solid" has to be the absence of the property rather than an empty list.
   */
  dash?: number[];
}

/** One glyph kind of a SPLIT line style — one symbol layer's worth of marks. */
export interface LineStyleMark {
  /** Sprite key of this kind's single-glyph sprite (`LM_<NAME>`, `LM_<NAME>_2`, …). */
  mark: string;
  /**
   * `symbol-spacing` for this kind's layer, px. The repeated kind carries the
   * style's uniform lattice pitch (interval/n); a once-per-interval kind
   * carries the interval itself. Both lattices start at anchor 0, which is
   * what makes the split phase-free — see `lineMarkKinds` in the sprite build.
   */
  spacing: number;
}

export interface LineStyle {
  description: string;
  /** Repeat length of the style, px. */
  interval: number;
  /** The pens drawn along the line, in draw order. */
  parts: LineStylePart[];
  /**
   * The mark half comes in exactly one of two shapes, told apart by which key
   * is present — never both:
   *
   * `mark` — an UNSPLIT style's single packed sprite, holding every glyph of
   * the repeat interval, spaced at `interval`.
   */
  mark?: string;
  /**
   * `marks` — a SPLIT style's per-glyph-kind sprites (`SPLIT_LINEMARK_STYLES`
   * in the sprite build), one line-placed symbol layer each, majority kind
   * first. Absent, like `mark`, for a pure dash schedule.
   */
  marks?: LineStyleMark[];
}

export const linestyles = data as unknown as Record<
  string,
  LineStyle | undefined
>;
