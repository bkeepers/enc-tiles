import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { JSDOM } from "jsdom";
import { parse } from "css";

const mmToPx = (mm) => Math.round(mm * 3.7795275591);

const SOURCES = [
  "data/S-101_Portrayal-Catalogue/PortrayalCatalog/Symbols",
  "data/legacy-symbols",
];

const styles = {
  day: styleToAttrs(
    readFileSync(
      "data/S-101_Portrayal-Catalogue/PortrayalCatalog/Symbols/daySvgStyle.css",
      "utf8",
    ),
  ),
  dusk: styleToAttrs(
    readFileSync(
      "data/S-101_Portrayal-Catalogue/PortrayalCatalog/Symbols/duskSvgStyle.css",
      "utf8",
    ),
  ),
  night: styleToAttrs(
    readFileSync(
      "data/S-101_Portrayal-Catalogue/PortrayalCatalog/Symbols/nightSvgStyle.css",
      "utf8",
    ),
  ),
};

/**
 * DELIBERATE DEVIATION FROM THE STOCK S-101 PORTRAYAL — light flare legibility.
 *
 * The S-101 light flares are built as a 50%-opacity colour fill plus a fully
 * opaque black OUTLW outline stroked at 0.32 mm. The flare is a long, thin
 * teardrop, so its outline is enormous relative to its area: at the stock
 * values the black outline lays down slightly MORE ink than the colour
 * (perimeter 15.75 mm x 0.32 mm = 5.04 vs area 9.27 mm^2 x 0.5 = 4.63).
 * Rasterized to a 10 x 28 px sprite that reads as a gray sliver — red, green
 * and yellow flares are indistinguishable from each other over the pale DAY
 * chart background.
 *
 * We therefore thin the outline and raise the fill opacity for the flare
 * symbols in DAY and DUSK, which puts ~4.4x more colour than black in the
 * sprite while keeping a hairline edge so the flare still reads against light
 * water. NIGHT is left stock: its background is dark, the outline provides the
 * separation the fill cannot, and the flares are legible as shipped.
 *
 * Scope is exactly the four symbols built this way. LIGHTS81/82 are in the
 * LIGHTS family but are plain unfilled CHMGD strokes, so they are untouched.
 */
const FLARE_SYMBOLS = new Set(["LIGHTS11", "LIGHTS12", "LIGHTS13", "LITDEF11"]);
const FLARE_OUTLINE_STROKE_WIDTH = "0.12";
const FLARE_FILL_OPACITY = "0.9";

function flareLegibility(svg) {
  svg
    .querySelectorAll("[fill-opacity]")
    .forEach((el) => el.setAttribute("fill-opacity", FLARE_FILL_OPACITY));
  svg
    .querySelectorAll(".sOUTLW[stroke-width]")
    .forEach((el) =>
      el.setAttribute("stroke-width", FLARE_OUTLINE_STROKE_WIDTH),
    );
}

// Return a vite plugin that generates a symbols.json file and styled SVGs
export default {
  name: "build-symbols",
  async buildStart() {
    console.log("Building symbols...");
    const symbols = {};

    const data = JSON.parse(readFileSync("data.json", "utf8"));

    for (const symbol of data.symbols) {
      const name = symbol.symd.synm;

      let input;

      for (const source of SOURCES) {
        try {
          input = readFileSync(join(source, `${name}.svg`), "utf8");
          break;
        } catch (err) {
          // ignore
        }
      }

      if (!input) throw new Error(`Missing symbol: ${name}`);

      for (const mode of Object.keys(styles)) {
        const output = process(input, [
          styles[mode],
          // Legibility fix-up, day/dusk only — see FLARE_SYMBOLS above.
          ...(mode !== "night" && FLARE_SYMBOLS.has(name)
            ? [flareLegibility]
            : []),
          (svg) => {
            // This only needs extracted once
            if (symbols[name]) return;

            const [minX, minY, width, height] = svg
              .getAttribute("viewBox")
              .split(/ |,/)
              .map(Number)
              .map(mmToPx);
            const offset = [
              roundToDecimal(width / 2 + minX, 3),
              roundToDecimal(height / 2 + minY, 3),
            ];

            symbols[name] = {
              description:
                svg.querySelector("desc")?.textContent ?? symbol.symd.syds,
              width,
              height,
              offset,
            };
          },
        ]);
        mkdirSync(`symbols/${mode}`, { recursive: true });
        writeFileSync(`symbols/${mode}/${name}.svg`, output);
      }
    }

    writeFileSync("symbols.json", JSON.stringify(symbols, null, 2) + "\n");
  },
};

export function process(svgText, callbacks) {
  const dom = new JSDOM(svgText, { contentType: "image/svg+xml" });
  const svg = dom.window.document.querySelector("svg");
  callbacks.forEach((cb) => cb(svg));
  return dom.serialize();
}

export function styleToAttrs(css) {
  const { stylesheet } = parse(css);

  return (svg) => {
    for (const rule of stylesheet?.rules || []) {
      if (rule.type !== "rule") continue;
      for (const selector of rule?.selectors || []) {
        svg.querySelectorAll(selector).forEach((el) => {
          for (const decl of rule?.declarations || []) {
            if (decl.type === "declaration" && decl.property) {
              if (decl.property === "display") {
                // display:none is CSS only, so convert to visibility:hidden
                el.setAttribute(
                  "visibility",
                  decl.value === "none" ? "hidden" : "visible",
                );
              } else {
                el.setAttribute(decl.property, decl.value);
              }
            }
          }
        });
      }
    }
  };
}

function roundToDecimal(num, places) {
  const factor = Math.pow(10, places);
  return Math.round(num * factor) / factor;
}
