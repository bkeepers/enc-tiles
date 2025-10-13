import s52 from "@enc-tiles/s52";
import { cieToRgb, rgbToHex } from "./colors.js";

export enum Mode {
  DAY = "DAY",
  DUSK = "DUSK",
  NIGHT = "NIGHT",
}

export type Colors = Record<string, string>;
export type Theme = Record<string, Colors>;

// Convert PresLib colors to hex strings
const theme = Object.fromEntries(s52.colours.map(({ ctus, entries }) => {
  return [ctus, Object.fromEntries(entries.map((color) => {
    return [color.ctok, rgbToHex(cieToRgb(color.chrx, color.chry, color.clum))]
  }))]
}));

export default theme as Theme;
