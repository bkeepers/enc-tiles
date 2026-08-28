import data from "../symbols.json" with { type: "json" };

/**
 * The sprite metrics of one S-52 symbol, px at the 96 dpi scale the sprites
 * are rasterized at.
 *
 * Built by `build/symbols.ts` from the S-101 catalogue drawing, whose viewBox
 * spans the symbol's PIVOT as well as its glyph — several of the area symbols
 * are drawn well away from the pivot, so a sprite is usually bigger than the
 * ink in it.
 */
export interface SymbolMetrics {
  description: string;
  /** Sprite width, px. */
  width: number;
  /** Sprite height, px. */
  height: number;
  /**
   * The sprite's centre relative to the pivot, px — `icon-offset` for an icon
   * anchored at the feature's own position.
   */
  offset: [number, number];
  /**
   * Where the DRAWING sits inside the sprite: `[dx, dy, w, h]` px, `dx`/`dy`
   * from the sprite's centre to the glyph box's centre and `w`/`h` the glyph
   * box's size.
   *
   * S-52 draws the cascading area symbols as a cluster around one pivot
   * (INFARE51's "i" hangs 14–22 mm to the RIGHT of it, ACHRES51's fouled
   * anchor right-and-below, ENTRES51's entry sign left), so centring the
   * SPRITE on the pivot — what `offset` does — is what puts the vendor
   * cascade where S-52 wants it. A consumer that draws ONE symbol per area
   * instead wants the GLYPH over its anchor, and subtracting `box`'s `dx`/`dy`
   * from `offset` is what gets it there.
   *
   * Absent for a sprite with no glyph box of its own: the generated pattern
   * tiles and line marks, whose boxes belong to a lattice cell rather than to
   * this sprite.
   */
  box?: [number, number, number, number];
}

export const symbols = data as unknown as Record<
  string,
  SymbolMetrics | undefined
>;
