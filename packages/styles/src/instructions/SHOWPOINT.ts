import { CircleLayerSpecification, DataDrivenPropertyValueSpecification, LayerSpecification } from "maplibre-gl";
import { Reference } from "./parser";
import s52 from "@enc-tiles/s52";

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
export function SY(symbol: Reference, rot: number | Reference = 0): Partial<LayerSpecification>[] {
  const rotate: DataDrivenPropertyValueSpecification<number> = typeof rot === 'number' ? rot : ['get', rot.name];

  const def = s52.symbols.find(s => s.symd.synm === symbol.name);
  if (!def) {
    console.warn(`SY: symbol not found ${symbol.name}`);
    // return [];
  }

  // const pivot = { x: def?.symd.sycl, y: def?.symd.syrw };
  // const width = def?.symd.syhl;
  // const height = def?.symd.syvl;
  // const top = def?.symd.sbxr;
  // const left = def?.symd.sbxc;

  // SYCL I(5) /* pivot-point's column-number;
  // SYCL is counted from the top,
  // left corner of the vector/raster space to the right;
  // -9999(left)<= SYCL <=32767(right)*/
  // SYRW I(5) /* pivot-point's row-number;
  // PROW is counted from the top, left
  // corner of the vector/raster space
  // to the bottom ;
  // -9999(top)<= SYRW <= 32767(bottom) */
  // SYHL I(5) /* width of bounding box;
  // where 1<= PAHL <=128 for raster and
  // where 1<= PAHL <=32767 for vector
  // Note: does not include vector line
  // width */
  // SYVL I(5) /* height of bounding box;
  // where 1<= PAVL <=128 for raster and
  // where 1<= PAGL <=32767 for vector
  // Note: does not include vector line
  // width */
  // SBXC I(5) /* bounding box upper left column number;
  // where 1<= SBXC <=128 for raster and
  // where 1<= SBXC <=32767 for vector */
  // SBXR I(5) /* bounding box upper left row number;
  // where 1<= SBXR <=128 for raster and
  // where 1<= SBXR <=32767 for vector */

  return [
    {
      type: 'symbol',
      layout: {
        'symbol-placement': 'point',
        'icon-allow-overlap': true,
        'icon-image': symbol.name,
        ...(rotate !== 0 ? { 'icon-rotate': rotate } : {}),
      }
    },
    ...(true ? [{
      type: 'circle',
      filter: ['==', '$type', 'Point'],
      paint: {
        'circle-radius': 1,
        'circle-color': 'green',
      }
    } as Partial<CircleLayerSpecification>] : [])
  ]
}
