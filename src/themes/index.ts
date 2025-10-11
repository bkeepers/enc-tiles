import preslib from "../../data/PresLib_e4.0.0.json" with { type: 'json' };
import { cieToRgb, rgbToHex } from "./colors.js";

export enum Mode {
  DAY = "DAY",
  DUSK = "DUSK",
  NIGHT = "NIGHT",
}

export type Colors = Record<string, string>;
export type Theme = Record<string, Colors>;

// Convert PresLib colors to hex strings
const theme = Object.fromEntries(preslib.colours.map(({ ctus, entries }) => {
  return [ctus, Object.fromEntries(entries.map((color) => {
    return [color.ctok, rgbToHex(cieToRgb(color.chrx, color.chry, color.clum))]
  }))]
}));

export default theme as Theme;
