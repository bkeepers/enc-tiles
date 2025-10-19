import { writeFile } from "fs/promises";
import s52 from "../data.json" with { type: "json" };
const data = s52.colours;

type RGB = [number, number, number];

/** Convert CIE (x, y, L) to sRGB [0–255, 0–255, 0–255] */
function cieToRgb(x: number, y: number, L: number): RGB {
  if (y === 0) return [0, 0, 0]; // avoid div/0

  // xyL -> XYZ
  const Y = L / 100;
  const X = (x / y) * Y;
  const Z = ((1 - x - y) / y) * Y;

  // XYZ -> linear RGB
  const rgb = [
    3.2406 * X - 1.5372 * Y - 0.4986 * Z,
    -0.9689 * X + 1.8758 * Y + 0.0415 * Z,
    0.0557 * X - 0.2040 * Y + 1.0570 * Z,
  ]

  return rgb.map((i) => {
    // clamp negative
    let c = Math.max(0, i);
    // gamma correct
    c = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    // scale to 8-bit
    return Math.round(Math.min(1, c) * 255)
  }) as RGB;
}

function rgbToHex([r, g, b]: RGB): string {
  return `#${[r, g, b].map(v => v.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

// Return a vite plugin that generates a colours.json file
export default {
  name: "generate-colours",
  async buildStart() {
    // Convert PresLib colors to hex strings
    const colours = Object.fromEntries(data.map(({ ctus, entries }) => {
      return [ctus, Object.fromEntries(entries.map((color) => {
        return [color.ctok, rgbToHex(cieToRgb(color.chrx, color.chry, color.clum))]
      }))]
    }));

    await writeFile("colours.json", JSON.stringify(colours, null, 2));
  },
};
