import { LineLayerSpecification } from "maplibre-gl";
import theme from '../themes/index.js';
import { Reference } from "./parser.js";

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
export function LS(style: Reference, width: number, colour: Reference): Pick<LineLayerSpecification, 'type' | 'paint'> {
  const styles = {
    SOLD: {}, // (_________)
    DASH: { 'line-dasharray': [3.6, 1.8] }, // (-----) dash: 3.6 mm; space: 1.8 mm
    DOTT: { 'line-dasharray': [0.6, 1.2] }  // (.........) dot: 0.6 mm; space: 1.2 mm
  }

  return {
    type: 'line',
    paint: {
      ...styles[style.name],
      'line-width': width,
      'line-color': theme.DAY![colour.name],
    }
  }
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
export function LC(linnam: Reference): Pick<LineLayerSpecification, 'type' | 'paint'> {
  return {
    type: 'line',
    paint: {
      'line-pattern': linnam.name,
    }
  }
}
