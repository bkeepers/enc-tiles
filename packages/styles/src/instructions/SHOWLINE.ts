import { LineLayerSpecification } from "maplibre-gl";
import { colour, ColourName, symbols } from "@enc-tiles/s52";
import { Reference } from "./parser.js";
import type { LayerConfig } from "../symbolology/index.js";

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
 * Sprite-sheet key of a complex line style.
 *
 * S-52's symbol, pattern and line-style name spaces collapse into MapLibre's
 * single sprite name space and 17 line styles share a name with a symbol, so
 * the sprite build files line styles under this prefix — see `SPRITE_PREFIX`
 * in `@enc-tiles/s52`'s `build/symbols.ts`. Without it `LC(CTNARE51)` resolved
 * to the CTNARE51 *point* icon and tiled it along the boundary.
 */
export function lineStyleImage(linnam: string): string {
  return `LC_${linnam}`;
}

/**
 * LC – Showline (simple linestyle).
 *
 * Syntax:
 *   LC(LINNAM);
 *
 * Parameters:
 * LINNAM: Name of complex linestyle. This parameter will symbolise the line using the
 * complex linestyle named by the LINNAM parameter.
 */
export function LC(
  _config: LayerConfig,
  linnam: Reference,
): Pick<LineLayerSpecification, "type" | "paint">[] {
  const image = lineStyleImage(linnam.name);
  const sprite = symbols[image];

  if (!sprite) {
    // Emitting the layer anyway would be worse than dropping it: MapLibre
    // resolves an unknown line-pattern to an arbitrary image from the atlas.
    console.warn(`Missing line style: ${linnam.name}`);
    return [];
  }

  return [
    {
      type: "line",
      paint: {
        "line-pattern": image,
        // MapLibre stretches the pattern across the full line width, so the
        // line has to be as wide as the tile is tall or the style is squashed
        // (or, at the 1px default, smeared into a coloured haze). The tile is
        // centred on the line axis, so this width also puts the axis on the
        // line. `line-floorwidth` — what the shader divides by — is the
        // floor of this, and the sprite height is already a whole number of
        // pixels, so the pattern comes out at exactly its design scale.
        "line-width": sprite.height,
      },
    },
  ];
}
