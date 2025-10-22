import { FillLayerSpecification } from "maplibre-gl";
import { colours } from "@enc-tiles/s52";
import { Reference } from "./parser.js";

/**
 * AP – Showarea (area fill)
 *
 * Syntax:
 *   AP(PATTERN)
 *
 * Description:
 *   The two showarea commands are used for symbolising area objects (often in
 *   conjunction with linestlyes for border rendering). There are two types of colour fill:
 *   1. area fill with a basic colour using one of the standard colour tokens.
 *   2. pattern fill using a pattern to fill areas.
 *
 * Parameters:
 * PATTERN: the name of the pattern
 */
export function AP(
  pattern: Reference,
): Pick<FillLayerSpecification, "type" | "paint"> {
  return {
    type: "fill",
    paint: {
      "fill-pattern": pattern.name,
    },
  };
}

/** Map TRANSP values to their corresponding opacity. */
export const TRANSP = {
  0: 1.0,
  1: 0.75,
  2: 0.5,
  3: 0.25,
};

/**
 * Showarea (pattern fill).
 *
 * Syntax:
 *   AC(COLOUR [,TRANSP] )
 *
 * Parameters:
 * COLOUR: colour fill parameter. A valid colour token as described in section 7
 * TRANSP: Transparency, an optional parameter for colour fills used to make a fill partially
 * transparent. If the transparency parameter is not set then the default value is 0%,
 * i.e. an opaque colour fill. There are three permissible values:
 * 1(25)% where 1 out of every 4 pixels use TRNSP
 * 2(50)% where 2 out of every 4 pixels use TRNSP
 * 3(75)% where 3 out of every 4 pixels use TRNSP
 */
export function AC(
  colour: Reference,
  transp: number = 0,
): Pick<FillLayerSpecification, "type" | "paint"> {
  const opacity = TRANSP[transp] ?? 1.0;
  return {
    type: "fill",
    paint: {
      "fill-color": colours.DAY[colour.name],
      "fill-opacity": opacity,
    },
  };
}
