import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { JSDOM } from "jsdom";
import { parse } from "css";

const mmToPx = (mm) => Math.round(mm * 3.7795275591);

// Anchored to the package rather than to process.cwd(): `vite build` runs with
// the package as its working directory, but the test runner and any standalone
// invocation of these helpers do not.
const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const resolve = (...parts) => join(PACKAGE_ROOT, ...parts);

const CATALOG = "data/S-101_Portrayal-Catalogue/PortrayalCatalog";

const SOURCES = [`${CATALOG}/Symbols`, "data/legacy-symbols"];

/**
 * S-101 keeps area fills and line styles as *definitions* rather than drawings:
 * an `af:symbolFill` gives a symbol reference plus the two lattice vectors that
 * repeat it, and an `ls:lineStyle` gives a pen, a dash schedule and symbol
 * placements along a repeat interval. Only the referenced symbols ship as SVG.
 */
const PATTERN_DEFINITIONS = `${CATALOG}/AreaFills`;
const LINESTYLE_DEFINITIONS = `${CATALOG}/LineStyles`;

/** Fallback repeat length (mm) for a line style that declares no interval. */
const DEFAULT_INTERVAL_LENGTH = 6.0;

const styles = {
  day: styleToAttrs(
    readFileSync(resolve(CATALOG, "Symbols/daySvgStyle.css"), "utf8"),
  ),
  dusk: styleToAttrs(
    readFileSync(resolve(CATALOG, "Symbols/duskSvgStyle.css"), "utf8"),
  ),
  night: styleToAttrs(
    readFileSync(resolve(CATALOG, "Symbols/nightSvgStyle.css"), "utf8"),
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

/** Read `<name>.svg` from the symbol source directories, or return undefined. */
export function readSymbolSvg(name) {
  for (const source of SOURCES) {
    try {
      return readFileSync(resolve(source, `${name}.svg`), "utf8");
    } catch (err) {
      // try the next source
    }
  }
  return undefined;
}

function parseXml(text) {
  const dom = new JSDOM(text, { contentType: "text/xml" });
  const document = dom.window.document;
  document._serializer = new dom.window.XMLSerializer();
  return document;
}

function number(element, fallback = 0) {
  if (!element) return fallback;
  const value = Number(element.textContent);
  return Number.isFinite(value) ? value : fallback;
}

/**
 * viewBox (millimetres, relative to the pivot at 0,0) and drawing content of a
 * referenced symbol.
 */
function symbolBox(name) {
  const svgText = readSymbolSvg(name);
  if (!svgText) throw new Error(`Missing symbol: ${name}`);
  const document = parseXml(svgText);
  const svg = document.querySelector("svg");
  const [minX, minY, width, height] = svg
    .getAttribute("viewBox")
    .split(/ |,/)
    .map(Number);
  const content = [...svg.children]
    .filter((node) => !["title", "desc", "metadata"].includes(node.nodeName))
    .map((node) => document._serializer.serializeToString(node))
    .join("");
  return { content, minX, minY, width, height };
}

function svgDocument({ minX, minY, width, height, title, desc, body }) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.2" baseProfile="tiny"` +
      ` xml:space="preserve" shape-rendering="geometricPrecision" fill-rule="evenodd"` +
      ` width="${roundToDecimal(width, 3)}mm" height="${roundToDecimal(height, 3)}mm"` +
      ` viewBox="${roundToDecimal(minX, 3)} ${roundToDecimal(minY, 3)} ${roundToDecimal(width, 3)} ${roundToDecimal(height, 3)}">`,
    `<title>${title}</title>`,
    `<desc>${desc}</desc>`,
    body,
    "</svg>",
  ].join("\n");
}

/**
 * How many lattice rows a pattern tile may span.
 *
 * Every extra row multiplies the rasterized sprite's height, so this is the
 * budget within which `patternLattice` looks for a vertical repeat. Eight rows
 * is the point where the tallest S-101 fill (SNDWAV01, 21.83 mm rows) reaches
 * ~175 mm — a 660 px sprite, the largest in the atlas but still ordinary.
 */
const MAX_PATTERN_ROWS = 8;

/** Leftover x (mm) below which a lattice row count is an exact repeat. */
const LATTICE_CLOSURE_TOLERANCE = 1e-9;

/**
 * Rows (and the whole number of v1 steps they span) that close an
 * `af:symbolFill` lattice vertically.
 *
 * The tile is one v1 wide, so its vertical period must be a lattice vector
 * that is purely vertical: `rows*v2 - columns*v1 = (0, rows*v2.y)`, which needs
 * `rows*v2.x == columns*v1.x` for whole `rows` and `columns`. That is the
 * denominator of `v2.x / v1.x` as a fraction in lowest terms.
 *
 * Only 4 of the 21 synthesized fills have a ratio whose denominator is small.
 * The rest are ratios of two 2-decimal millimetre figures that reduce to
 * denominators in the thousands (DQUALA11's 16.97/30.97 is 1697/3097, already
 * in lowest terms), so an exact repeat is not reachable at any sane tile size.
 * We therefore take the best rational approximation within
 * MAX_PATTERN_ROWS and SNAP the row stagger onto it — the returned `step` is
 * v2 with its x moved by up to a few tenths of a millimetre so the lattice
 * closes exactly.
 *
 * Snapping is the cheap error. Rounding `v1.x / v2.x` to whole rows (what this
 * did before) leaves the tile's vertical period off the lattice entirely, so
 * the fill shears sideways by the leftover at EVERY vertical repeat — a
 * visible 1.00 mm jog in MARSHES1 and 5.22 mm in FSHFAC04, repeating forever
 * down the area. Moving the stagger instead keeps a true lattice; it is just a
 * marginally different one from the published portrayal, and the difference is
 * invisible in a scattered decorative fill.
 */
function latticeRows(v1x, v2x) {
  let best = { rows: 1, columns: 0, residual: Infinity };
  for (let rows = 1; rows <= MAX_PATTERN_ROWS; rows++) {
    const columns = Math.round((rows * v2x) / v1x);
    const residual = Math.abs(rows * v2x - columns * v1x);
    if (residual < best.residual) best = { rows, columns, residual };
    if (best.residual <= LATTICE_CLOSURE_TOLERANCE) break;
  }
  return best;
}

/**
 * The lattice of one `af:symbolFill` pattern and the tile derived from it.
 *
 * v1 is normalized to point right and v2 to point down (negating a basis
 * vector spans the same lattice), so the tile is `v1.x` wide and `rows` rows
 * tall. `step` is the snapped v2 that placements must use — see `latticeRows`.
 *
 * Exported so the sprite tests can assert the tile actually closes.
 */
export function patternLattice(name) {
  const definition = parseXml(
    readFileSync(resolve(PATTERN_DEFINITIONS, `${name}.xml`), "utf8"),
  );

  const reference = definition
    .querySelector("symbol")
    ?.getAttribute("reference");
  if (!reference) {
    throw new Error(`Pattern ${name} references no symbol`);
  }

  const [rawV1, rawV2] = ["v1", "v2"].map((tag) => {
    const element = definition.querySelector(tag);
    return {
      x: number(element?.querySelector("x")),
      y: number(element?.querySelector("y")),
    };
  });
  const v1 = rawV1.x < 0 ? { x: -rawV1.x, y: -rawV1.y } : rawV1;
  const v2 = rawV2.y < 0 ? { x: -rawV2.x, y: -rawV2.y } : rawV2;

  const box = symbolBox(reference);
  if (!(box.width > 0) || !(box.height > 0)) {
    throw new Error(`Pattern ${name} references an empty symbol: ${reference}`);
  }

  // A degenerate lattice (no horizontal vector, or no vertical one) has no
  // period to close; fall back to the symbol's own extent, as before.
  const horizontal = v1.x > 0.001;
  const tileWidth = horizontal ? v1.x : box.width;
  const rowHeight = v2.y > 0.001 ? v2.y : box.height;
  const { rows, columns } = horizontal
    ? latticeRows(tileWidth, v2.x)
    : { rows: 1, columns: 0 };

  return {
    ...box,
    reference,
    v1: horizontal ? v1 : { x: 0, y: 0 },
    // rows*step.x is columns*v1.x exactly, so (0, rows*step.y) is a lattice
    // vector and the tile's top edge lands on the same x positions as its
    // bottom edge.
    step: { x: horizontal ? (columns * tileWidth) / rows : 0, y: rowHeight },
    rows,
    tileWidth,
    tileHeight: rows * rowHeight,
  };
}

/**
 * Build a repeating tile for an `af:symbolFill` area pattern.
 *
 * The definition places one symbol at every point of the lattice spanned by v1
 * and v2. MapLibre's `fill-pattern` repeats a rectangle, so the tile is one v1
 * wide and `rows` lattice rows tall — `patternLattice` picks `rows` so that
 * the tile's height is itself a lattice vector. Neighbouring lattice points are
 * drawn as well and clipped by the SVG viewport, so symbols that straddle a
 * tile edge reappear on the opposite one.
 */
export function buildPatternSvg(pattern) {
  const {
    content,
    minX,
    minY,
    width,
    height,
    v1,
    step,
    tileWidth,
    tileHeight,
  } = patternLattice(pattern.name);

  // Solve the index range per row instead of guessing a fixed spread: a tile
  // several rows tall puts its top row many v1 steps from the origin, and a
  // fixed i-window dropped every symbol in those rows.
  const placements = [];
  const jMin = Math.floor((-minY - height) / step.y) - 1;
  const jMax = Math.ceil((tileHeight - minY) / step.y) + 1;
  for (let j = jMin; j <= jMax; j++) {
    const rowX = j * step.x;
    const iMin = v1.x ? Math.floor((-minX - width - rowX) / v1.x) - 1 : 0;
    const iMax = v1.x ? Math.ceil((tileWidth - minX - rowX) / v1.x) + 1 : 0;
    for (let i = iMin; i <= iMax; i++) {
      const x = i * v1.x + rowX;
      const y = i * v1.y + j * step.y;
      if (x + minX > tileWidth || x + minX + width < 0) continue;
      if (y + minY > tileHeight || y + minY + height < 0) continue;
      placements.push(
        `<g transform="translate(${roundToDecimal(x, 3)},${roundToDecimal(y, 3)})">${content}</g>`,
      );
    }
  }

  return svgDocument({
    minX: 0,
    minY: 0,
    width: tileWidth,
    height: tileHeight,
    title: pattern.name,
    desc: pattern.description,
    body: placements.join("\n"),
  });
}

/** The sub-styles of an `ls:lineStyle` or `ls:compositeLineStyle`. */
function lineStyleParts(definition) {
  const root = definition.documentElement;
  const composite = [...root.children].filter(
    (child) =>
      child.nodeName === "lineStyle" || child.localName === "lineStyle",
  );
  const elements = composite.length > 0 ? composite : [root];

  return elements.map((element) => ({
    offset: Number(element.getAttribute("offset") ?? 0) || 0,
    intervalLength: number(
      element.querySelector("intervalLength"),
      DEFAULT_INTERVAL_LENGTH,
    ),
    penWidth: Number(
      element.querySelector("pen")?.getAttribute("width") ?? 0.32,
    ),
    colour:
      element.querySelector("pen > color")?.textContent?.trim() ?? "CHBLK",
    dashes: [...element.querySelectorAll("dash")].map((dash) => ({
      start: number(dash.querySelector("start")),
      length: number(dash.querySelector("length")),
    })),
    symbols: [...element.querySelectorAll("symbol")].map((symbol) => ({
      reference: symbol.getAttribute("reference"),
      position: number(symbol.querySelector("position")),
    })),
  }));
}

/**
 * Build a repeating tile for an `ls:lineStyle` complex line style.
 *
 * The tile is one repeat interval long and centred on the line, so MapLibre's
 * `line-pattern` reproduces the dash schedule and the symbols placed along it.
 */
export function buildLineStyleSvg(linestyle) {
  const definition = parseXml(
    readFileSync(
      resolve(LINESTYLE_DEFINITIONS, `${linestyle.name}.xml`),
      "utf8",
    ),
  );
  const parts = lineStyleParts(definition);

  const length = Math.max(
    ...parts.map((part) => part.intervalLength),
    DEFAULT_INTERVAL_LENGTH,
  );

  let top = 0;
  let bottom = 0;
  const body = [];

  for (const part of parts) {
    top = Math.min(top, part.offset - part.penWidth / 2);
    bottom = Math.max(bottom, part.offset + part.penWidth / 2);

    const y = roundToDecimal(part.offset, 3);
    const segments =
      part.dashes.length > 0
        ? part.dashes
        : [{ start: 0, length: part.intervalLength || length }];

    for (const dash of segments) {
      const x1 = roundToDecimal(dash.start, 3);
      const x2 = roundToDecimal(dash.start + dash.length, 3);
      body.push(
        `<path d=" M ${x1},${y} L ${x2},${y}" class="sl f0 s${part.colour}"` +
          ` stroke-width="${part.penWidth}" />`,
      );
    }

    for (const placement of part.symbols) {
      const box = symbolBox(placement.reference);
      top = Math.min(top, part.offset + box.minY);
      bottom = Math.max(bottom, part.offset + box.minY + box.height);
      body.push(
        `<g transform="translate(${roundToDecimal(placement.position, 3)},${y})">` +
          `${box.content}</g>`,
      );
    }
  }

  return svgDocument({
    minX: 0,
    minY: top,
    width: length,
    height: bottom - top,
    title: linestyle.name,
    desc: linestyle.description,
    body: body.join("\n"),
  });
}

/**
 * Everything the sprite sheet has to contain, in one list.
 *
 * `data.symbols` alone is not enough: `AP(NODATA03)` and `LC(MARSYS51)` name
 * area fills and line styles, and MapLibre substitutes an arbitrary image from
 * the atlas for a `fill-pattern`/`line-pattern` it cannot resolve -- which is
 * how unsurveyed areas ended up tiled with the MARCUL02 fish.
 *
 * Symbols come first because S-52's three name spaces (symbol / pattern /
 * line style) collapse into MapLibre's single sprite name space, and 21 names
 * appear in two of them (AIRARE02, MARCUL02, ACHARE51, ...). The build keeps
 * the first entry for a name, so those keep the symbol drawing they have
 * always had; only names that were entirely absent are added.
 */
export function spriteSources(data) {
  return [
    ...data.symbols.map((symbol) => ({
      name: symbol.symd.synm,
      description: symbol.sxpo?.[0] ?? symbol.symd.syds,
      kind: "symbol",
    })),
    ...data.patterns.map((pattern) => ({
      name: pattern.patd.panm,
      description: pattern.pxpo?.[0] ?? pattern.patd.panm,
      kind: "pattern",
    })),
    ...data.linestyles.map((linestyle) => ({
      name: linestyle.lind.linm,
      description: linestyle.lxpo?.[0] ?? linestyle.lind.linm,
      kind: "linestyle",
    })),
  ];
}

/**
 * The unstyled SVG for one sprite source, drawn or synthesized.
 *
 * Returns undefined when S-101 carries neither a drawing nor a definition for
 * it. That is exactly one entry today (LOWACC11, which the DAI still lists but
 * the S-101 portrayal catalogue dropped) and nothing in the style references
 * it; synthesizing a stand-in would put a wrong image in the atlas rather than
 * an absent one.
 */
export function sourceSvg(source) {
  // A pattern or line style that ships as a drawing is used as-is; the rest are
  // built from their S-101 definitions.
  const drawn = readSymbolSvg(source.name);
  if (drawn) return drawn;
  if (source.kind === "symbol")
    throw new Error(`Missing symbol: ${source.name}`);

  const definitions =
    source.kind === "pattern" ? PATTERN_DEFINITIONS : LINESTYLE_DEFINITIONS;
  if (!existsSync(resolve(definitions, `${source.name}.xml`))) return undefined;

  return source.kind === "pattern"
    ? buildPatternSvg(source)
    : buildLineStyleSvg(source);
}

// Return a vite plugin that generates a symbols.json file and styled SVGs
export default {
  name: "build-symbols",
  async buildStart() {
    console.log("Building symbols...");
    const symbols = {};

    const data = JSON.parse(readFileSync(resolve("data.json"), "utf8"));

    for (const source of spriteSources(data)) {
      const name = source.name;
      if (symbols[name]) continue;

      const input = sourceSvg(source);
      if (!input) {
        console.warn(`Skipping ${source.kind} with no drawing: ${name}`);
        continue;
      }

      for (const mode of Object.keys(styles)) {
        const output = process(input, [
          styles[mode],
          // Legibility fix-up, day/dusk only — see FLARE_SYMBOLS above. It is
          // scoped to the four flare symbols and must never reach a pattern or
          // line style, which is automatic: none of them are named there.
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
                svg.querySelector("desc")?.textContent ?? source.description,
              width,
              height,
              offset,
            };
          },
        ]);
        mkdirSync(resolve(`symbols/${mode}`), { recursive: true });
        writeFileSync(resolve(`symbols/${mode}/${name}.svg`), output);
      }
    }

    writeFileSync(
      resolve("symbols.json"),
      JSON.stringify(symbols, null, 2) + "\n",
    );
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
