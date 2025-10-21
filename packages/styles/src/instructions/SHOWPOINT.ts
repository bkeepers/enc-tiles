import { DataDrivenPropertyValueSpecification, SymbolLayerSpecification } from "maplibre-gl";
import { Reference } from "./parser";
import { symbols } from "@enc-tiles/s52";

/**
* SY – Showpoint, Show symbol command.
*
* Syntax:
*   SY(SYMBOL [, ROT]);
*
* The SY command displays a symbol at a given point on the display. The command
* takes a standard symbol name as its first mandatory argument. A second parameter can
* impose a rotation on the symbol about the pivot point. In the case of an area object the
* “SY” command is used to display a centred area symbol.
*
* Parameters:
* SYMBOL: The name of the symbol to be displayed, e.g. ISODGR01. This will be the name
* as defined in the vector description language SYNM field.
* ROT: An optional rotation parameter. The following notes apply to this parameter.
* 1. Symbols with no rotation must always be drawn upright with respect to the
* screen.
* 2. Symbols with a rotation instruction must be rotated with respect to the top of
* the screen (-y axis in figure 2 of section 8.1).
* 3. Symbols rotated by means of the six-character code of an S-57 attribute
* such as ORIENT must be rotated with respect to true north.
* 4. The symbol must always be rotated about its pivot point. Rotation angle is in
* degrees clockwise from 0 to 360. The default value is 0 degrees."
*/
export function SY(symbol: Reference, rot: number | Reference = 0): Pick<SymbolLayerSpecification, 'type' | 'layout'>[] {
  const rotate: DataDrivenPropertyValueSpecification<number> = typeof rot === 'number' ? rot : ['get', rot.name];

  const data = symbols[symbol.name];

  if (!data) {
    console.warn(`Missing symbol: ${symbol.name}`);
    return [];
  }

  return [{
    type: 'symbol',
    layout: {
      'symbol-placement': 'point',
      'icon-allow-overlap': true,
      'icon-image': symbol.name,
      'icon-offset': data.offset,
      ...(rotate !== 0 ? { 'icon-rotate': rotate } : {}),
    }
  }];
}
