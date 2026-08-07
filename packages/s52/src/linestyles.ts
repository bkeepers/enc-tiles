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

export interface LineStyle {
  description: string;
  /** Repeat length of the style, px. */
  interval: number;
  /** The pens drawn along the line, in draw order. */
  parts: LineStylePart[];
  /** Sprite key of the style's repeated marks. Absent for a pure dash schedule. */
  mark?: string;
}

export const linestyles = data as unknown as Record<
  string,
  LineStyle | undefined
>;
