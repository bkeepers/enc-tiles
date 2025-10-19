import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { JSDOM } from 'jsdom';
import { parse } from 'css';

const mmToPx = (mm) => Math.round(mm * 3.7795275591);

const SOURCES = [
  "data/S-101_Portrayal-Catalogue/PortrayalCatalog/Symbols",
  "data/legacy-symbols"
]

const styles = {
  DAY: styleToAttrs(readFileSync('data/S-101_Portrayal-Catalogue/PortrayalCatalog/Symbols/daySvgStyle.css', 'utf8')),
  DUSK: styleToAttrs(readFileSync('data/S-101_Portrayal-Catalogue/PortrayalCatalog/Symbols/duskSvgStyle.css', 'utf8')),
  NIGHT: styleToAttrs(readFileSync('data/S-101_Portrayal-Catalogue/PortrayalCatalog/Symbols/nightSvgStyle.css', 'utf8')),
}

// Return a vite plugin that generates a symbols.json file and styled SVGs
export default {
  name: 'build-symbols',
  async buildStart() {
    console.log("Building symbols...");
    const symbols = {};

    const data = JSON.parse(readFileSync('data.json', 'utf8'));

    for (const symbol of data.symbols) {
      const name = symbol.symd.synm;

      let input;

      for (const source of SOURCES) {
        try {
          input = readFileSync(join(source, `${name}.svg`), 'utf8');
          break;
        } catch (err) {
          // ignore
        }
      }

      if (!input) {
        console.warn(`Missing symbol: ${name}`);
        continue;
      }

      for (const mode of Object.keys(styles)) {
        const output = process(input, [
          styles[mode],
          (svg) => {
            // This only needs extracted once
            if (symbols[name]) return;

            const [minX, minY, width, height] = svg.getAttribute('viewBox').split(/ |,/).map(Number).map(mmToPx);
            const offset = [
              roundToDecimal((width / 2) + minX, 3),
              roundToDecimal((height / 2) + minY, 3)
            ];

            symbols[name] = {
              description: svg.querySelector('desc')?.textContent ?? symbol.symd.syds,
              width,
              height,
              offset,
            };
          }
        ])
        mkdirSync(`symbols/${mode}`, { recursive: true });
        writeFileSync(`symbols/${mode}/${name}.svg`, output);
      }
    }

    writeFileSync('symbols.json', JSON.stringify(symbols, null, 2) + '\n');
  }
}

export function process(svgText, callbacks) {
  const dom = new JSDOM(svgText, { contentType: "image/svg+xml" });
  const svg = dom.window.document.querySelector('svg');
  callbacks.forEach(cb => cb(svg));
  return dom.serialize();
}

export function styleToAttrs(css) {
  const { stylesheet } = parse(css);

  return (svg) => {
    for (const rule of stylesheet?.rules || []) {
      if (rule.type !== 'rule') continue;
      for (const selector of rule?.selectors || []) {
        svg.querySelectorAll(selector).forEach((el) => {
          for (const decl of rule?.declarations || []) {
            if (decl.type === 'declaration' && decl.property) {
              if (decl.property === 'display') {
                // display:none is CSS only, so convert to visibility:hidden
                el.setAttribute('visibility', decl.value === 'none' ? 'hidden' : 'visible');
              } else {
                el.setAttribute(decl.property, decl.value);
              }
            }
          }
        });
      }
    }
  }
}

function roundToDecimal(num, places) {
  const factor = Math.pow(10, places);
  return Math.round(num * factor) / factor;
}
