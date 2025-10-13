import { ExpressionSpecification, SymbolLayerSpecification } from "maplibre-gl";
import theme from "../themes/index.js";
import sprintf from "./sprintf.js";
import { Reference } from "./parser.js";

export type TextLayerSpecification = Pick<SymbolLayerSpecification, 'type' | 'layout' | 'paint' | 'metadata'>;

export enum HJUST {
  /** 1. CENTRE – The pivot point is located at the centre of the overall length of text string */
  CENTRE = 1,
  /** 2. RIGHT - The pivot point is located at the right side of the last character of text string */
  RIGHT = 2,
  /** 3. LEFT (default) - This is the default value.The pivot point is located at the left side of the first character of text string */
  LEFT = 3
}

export enum VJUST {
  /** 1. BOTTOM(default) - This is the default value.The pivot point is located at the bottom line of the text string */
  BOTTOM = 1,
  /** 2. CENTRE - The pivot point is located at the centre line of the text string */
  CENTRE = 2,
  /** 3. TOP The pivot point is located at the top line of the text string */
  TOP = 3
}

export enum SPACE {
  /** 1. Fit (not used) - The text string must be expanded or condensed to fit  between the first and last position in a spatial object */
  FIT = 1,

  /** 2. Standard (default) - The standard spacing in accordance with the typeface given in CHARS must be used */
  STANDARD = 2,

  /** 3. Standard (with word wrap) - the standard spacing in accordance with the typeface given in CHARS must be used; text longer than 8 characters
   must be broken into separate lines by whole words. */
  WRAP = 3
}
/**
 * Parameters:
 *
 * @param string: Represents the alphanumeric string to be displayed on the display. The STRING parameter passes a text
 * string in single quotes that shall be written on the ECDIS screen. For example: TX('DR',2,3,2,'15110',-1,1,CHBLK,50);
 * Note: the six character acronym of a valid S-57 attribute (e.g. LITVES, OBJNAM)
 * can also be passed as a parameter to STRING parameter. If the attribute is either
 * of an enumeration type or list type (e.g. COLOUR), then the enumeration value
 * must be converted into the respective text string from the attribute definition in the
 * object catalogue. If the attribute is of a numerical type, it may just be written as a
 * string. If the attribute is an L-type attribute (e.g. SBDARE, NATSUR) the text
 * equivalent of the listed attribute values must be written sequentially separated by
 * a space with no punctuation marks. If the attribute or character string named in a
 * text command is not included in the SENC object, the text command must be
 * disregarded. If the symbology instruction for an object includes more than one
 * text command, only the text command whose attribute value or character string is
 * missing must be disregarded; the other text command must be implemented.
 *
 * @param HJUST: Horizontal justification parameter
 *
 * @param VJUST: Vertical justification parameter.
 *
 * @param SPACE: Character spacing parameter

 * @param CHARS: Font specification parameter. This defines the font to be used for the text display.
 * There are four numeric components to this parameter and they are concatenated
 * together and enclosed in single quotes in order to be passed as a single value,
 * e.g. ‘15110’. The format is therefore ‘abcdd’ where :
 * a = 1, a plain serif font.
 * b = 4, 5 or 6 for light, medium or bold text. The default is medium.
 * c = 1, meaning upright, non-italic text.
 * d = Body size given in pica points (1 point = 0.351 mm) that specify the height of
 * an uppercase character. The smallest size to be used is pica 10, and this is
 * also the default size. Larger sizes may be used.
 *
 * @param XOFFS: X offset parameter: defines the X-offset of the pivot point given in units of BODY
 * SIZE (see CHARS parameter) relative to the position of the spatial object (0 is
 * default if XOFFS is not given or undefined); positive x-offset extends to the right
 * (the "units of BODYSIZE" means that if for example, the body size is 10 pica
 * points each unit of offset is 10 (0.351) = 3.51 mm).
 *
 * @param YOFFS Y offset parameter: defines the y-offset of the pivot point given in units of BODY
 * SIZE (see CHARS parameter) relative to the position of the spatial object (0 is
 * default if YOFFS is not given or undefined); positive y-offset extends downwards.
 *
 * @param COLOUR Text colour parameter: colour token as described in section 7 and 15.
 * 48
 *
 * @param DISPLAY Text display parameter: defines which text grouping the string belongs to.
 */

export function showText(
  text: string | Reference | ExpressionSpecification,
  hjust: HJUST = HJUST.LEFT,
  vjust: VJUST = VJUST.BOTTOM,
  space: SPACE = SPACE.STANDARD,
  chars: string = '15110',
  xoffs: number = 0,
  yoffs: number = 0,
  colour?: Reference,
  display?: string
): TextLayerSpecification {
  // TODO: make configurable
  const fonts: Record<string, string[]> = {
    '141': ['Metropolis Light'],
    '151': ['Metropolis Regular'],
    '161': ['Metropolis Bold'],

    // '241': 'TODO Sans Serif Light',
    // '251': 'TODO Sans Serif Medium',
    // '261': 'TODO Sans Serif Bold',
    '242': ['Metropolis Light Italic'],
  };

  let font = fonts[chars.slice(0, 3)];
  const fontSize = parseInt(chars.slice(3), 10);

  if (!font) {
    console.warn(`Unknown font code: ${chars}`);
    font = fonts['151'];
  }

  let textField: string | ExpressionSpecification;
  if (typeof text === 'string') {
    textField = text;
  } else if (text instanceof Reference) {
    textField = ['get', text.name];
  } else {
    textField = text as ExpressionSpecification;
  }

  return {
    type: 'symbol',
    metadata: {
      // MapLibre doesn't have the notion of layer groups, so just pass as metadata for now and allow
      // client implementations to use this.
      's52:display': display
    },
    layout: {
      'text-field': textField,
      'text-anchor': textAnchor(hjust, vjust),
      'text-font': font!,
      'text-size': isNaN(fontSize) ? 10 : fontSize,
      'text-offset': [xoffs ?? 0, yoffs ?? 0],
      'symbol-placement': 'point',
      ...(space === SPACE.WRAP ? { 'text-max-width': 8 } : {}),
    },
    paint: {
      // FIXME: make theme configurable
      'text-color': theme.DAY![colour?.name ?? 'CHBLK']!,
      'text-halo-color': 'rgba(255, 255, 255, 0.5)',
      'text-halo-width': 2,
    },
  };
}
// Type is not exposed, so have to reach in to get it
type TextAnchor = Required<Required<SymbolLayerSpecification>['layout']>['text-anchor'];
/* Translate HJUST and VJUST to maplibre-gl text-anchor values */
function textAnchor(hjust: HJUST, vjust: VJUST): TextAnchor {
  const h = hjust === HJUST.LEFT ? 'left' : hjust === HJUST.CENTRE ? 'center' : 'right';
  const v = vjust === VJUST.TOP ? 'top' : vjust === VJUST.CENTRE ? 'center' : 'bottom';

  if (h === 'center' && v === 'center') {
    return 'center';
  } else if (h === 'center') {
    return v;
  } else if (v === 'center') {
    return h;
  } else {
    return `${v}-${h}`;
  }
}

export function TX(string: string | Reference, ...args: any[]): TextLayerSpecification {
  return showText(string, ...args);
}

export function TE(
  format: string,
  attribute: string,
  ...args: any[]
): TextLayerSpecification {
  const textField = formatAttribute(format, attribute);
  return showText(textField, ...args);
}

export function formatAttribute(format: string, attribute: string): string | ExpressionSpecification {
  const parts = sprintf(format).map(token => {
    if (token.type === "text") {
      return token.value;
    } else {
      if (token.specifier === 's') {
        return ['get', attribute] as ExpressionSpecification;
      } else {
        return [
          'number-format',
          ['get', attribute],
          { 'min-fraction-digits': token.precision, 'max-fraction-digits': token.precision }
        ] as ExpressionSpecification;
      }
    }
  });

  return (parts.length === 1 && parts[0]) ? parts[0] : ['format', ...parts];
}
