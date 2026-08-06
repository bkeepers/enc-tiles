import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "fs";
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
 *
 * Memoized: one embedded symbol is placed several times in a line style and
 * hundreds of times across a pattern lattice, and re-parsing its SVG each time
 * dominated both the build and the sprite tests.
 */
const symbolBoxes = new Map();
function symbolBox(name) {
  const cached = symbolBoxes.get(name);
  if (cached) return cached;
  const box = readSymbolBox(name);
  symbolBoxes.set(name, box);
  return box;
}

function readSymbolBox(name) {
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
 * The tile is one repeat interval long and carries the dash schedule plus the
 * symbols placed along it. Two properties of the emitted viewBox are dictated
 * by how MapLibre samples a `line-pattern`, not by S-101:
 *
 * 1. CENTRING. MapLibre stretches the image across the *whole* line width with
 *    the image's vertical centre on the line, so the line axis — y = 0 in an
 *    S-101 line style — has to sit at the middle of the viewBox. This used to
 *    set `minY` to the topmost ink, which put the axis at the very top of the
 *    sprite: the style was drawn wholly to one side of the line and every tick
 *    hung half outside the area it was bounding.
 *
 * 2. MIRRORING. The tile is emitted flipped about the line axis. Derivation:
 *
 *    a. `line_pattern.fragment.glsl` samples the sprite at
 *       `y = 0.5 * v_normal.y + 0.5`, mixing from the image's top-left corner
 *       (`pattern_tl`, the low row of the atlas, i.e. the viewBox's minY edge)
 *       at y = 0 to its bottom-right at y = 1. The atlas is uploaded without
 *       `UNPACK_FLIP_Y_WEBGL`, so atlas row 0 really is the image's top.
 *    b. `v_normal.y` is +1 on the half-vertex `line_bucket` extrudes by
 *       `-perp(direction)` and -1 on the one it extrudes by `+perp(direction)`
 *       (`addCurrentVertex` passes `up = true` for the former). So the image's
 *       TOP edge is drawn on the `+perp` side and its BOTTOM edge on `-perp`.
 *    c. `perp((x, y)) = (-y, x)`. Tile space has y down, so for a line running
 *       east — direction (1, 0) — `+perp` is (0, 1): south on screen, which is
 *       the RIGHT of travel. Image top → right of travel.
 *    d. MVT winds exterior rings clockwise in that same y-down tile space: the
 *       square (0,0) (10,0) (10,10) (0,10) has shoelace area +200 and its
 *       interior is at +y from the (0,0)→(10,0) edge — the `+perp` side, the
 *       right of travel. Interior rings are wound the other way and the filled
 *       side is on their right too, so "inside is to the right of travel" holds
 *       for every ring. Measured over the tiler's own output: 37,306 rings,
 *       zero exceptions.
 *    e. Therefore the inside of an area is painted from the image's TOP, while
 *       S-101 draws the inward-facing ticks at +y — the image's BOTTOM
 *       (ACHARE51, CTNARE51, ENTRES51, RESARE51 … all hang their EMAREMG1 /
 *       EMACHRE2 ticks below the axis and nothing but the pen half-width
 *       above it).
 *
 *    Flipping the tile puts the ticks inside the area, and because the flip is
 *    exactly the one the renderer applies it also cancels it: embedded symbols
 *    that are not y-symmetric — the "A" and "B" of MARSYS51 — come out upright
 *    on screen instead of upside down.
 */
export function buildLineStyleSvg(linestyle) {
  const { length, top, bottom, body } = lineStyleGeometry(linestyle.name);

  // Symmetric about y = 0 so the line axis lands on the middle of the sprite,
  // which is where MapLibre puts the line — see (1) above.
  const half = Math.max(-top, bottom);

  return svgDocument({
    minX: 0,
    minY: -half,
    width: length,
    height: 2 * half,
    title: linestyle.name,
    desc: linestyle.description,
    // Mirrored about the line axis — see (2) above. A scale of magnitude 1 in
    // both axes leaves stroke widths alone.
    body: `<g transform="scale(1,-1)">\n${body.join("\n")}\n</g>`,
  });
}

/**
 * One line style's repeat length, ink extent and drawing, in the definition's
 * own coordinates: y = 0 on the line axis, +y on the side S-101 draws the
 * inward-facing ticks.
 *
 * Split out of `buildLineStyleSvg` so the sprite tests can assert the centring
 * and the tick side against the unmirrored figures.
 */
export function lineStyleGeometry(name) {
  const definition = parseXml(
    readFileSync(resolve(LINESTYLE_DEFINITIONS, `${name}.xml`), "utf8"),
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

  return { length, top, bottom, body };
}

/**
 * Sprite-sheet key prefix per S-52 name space.
 *
 * S-52 has three independent name spaces — symbol (`SY`), pattern (`AP`) and
 * line style (`LC`) — and 21 names live in two of them, one (QUESMRK1) in all
 * three. MapLibre has exactly one sprite name space, so the collisions have to
 * be broken here or a `fill-pattern`/`line-pattern` silently resolves to the
 * point symbol of the same name. That is what happened: `LC(CTNARE51)` and the
 * 16 other colliding line styles tiled their centred point icon along the
 * boundary instead of the boundary style, and `AP(AIRARE02)` filled airport
 * areas with the icon captioned "symbol for airport as a point".
 *
 * Symbols keep the bare name — they are what the rest of the style, the
 * frontend legend and the sprite CSS already reference — and the other two
 * name spaces take the prefix of the instruction that reads them.
 */
export const SPRITE_PREFIX = {
  symbol: "",
  pattern: "AP_",
  linestyle: "LC_",
};

/** The sprite-sheet key (and SVG file name) for one sprite source. */
export function spriteKey(source) {
  return `${SPRITE_PREFIX[source.kind]}${source.name}`;
}

/**
 * Everything the sprite sheet has to contain, in one list.
 *
 * `data.symbols` alone is not enough: `AP(NODATA03)` and `LC(MARSYS51)` name
 * area fills and line styles, and MapLibre substitutes an arbitrary image from
 * the atlas for a `fill-pattern`/`line-pattern` it cannot resolve -- which is
 * how unsurveyed areas ended up tiled with the MARCUL02 fish.
 *
 * Every source carries the prefixed `key` it is filed under — see
 * SPRITE_PREFIX for why patterns and line styles are not filed under their
 * bare name.
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
  ].map((source) => ({ ...source, key: spriteKey(source) }));
}

/**
 * The line styles that are legitimately their own drawing.
 *
 * Both are dash patterns the S-101 portrayal catalogue never gave a `LineStyle`
 * definition to, and for both the same-named `Symbols/<name>.svg` IS the line
 * style rather than a point icon that happens to share the name. They are named
 * here, one by one, because the same "fall back to the drawing" branch applied
 * to anything else silently substitutes a POINT SYMBOL for a line style — see
 * `sourceSvg`.
 */
const DRAWN_LINESTYLES = new Set(["LOWACC01", "NEWOBJ01"]);

/**
 * The unstyled SVG for one sprite source, drawn or synthesized.
 *
 * Returns undefined when neither an S-101 definition nor a drawing this may
 * legitimately take is available. That is exactly one entry today (LOWACC11,
 * which the DAI still lists but the S-101 portrayal catalogue dropped) and
 * nothing in the style references it; synthesizing a stand-in would put a wrong
 * image in the atlas rather than an absent one, and an absent one is what the
 * build's "no drawing" warning is for.
 */
export function sourceSvg(source) {
  if (source.kind === "symbol") {
    const drawn = readSymbolSvg(source.name);
    if (!drawn) throw new Error(`Missing symbol: ${source.name}`);
    return drawn;
  }

  // A pattern or line style is built from its own S-101 definition. The name
  // spaces overlap (see SPRITE_PREFIX), so `<name>.svg` for a pattern or line
  // style is normally the *symbol* of that name: taking it was the second half
  // of the shadowing bug. `Symbols/AIRARE02.svg` describes itself as "symbol
  // for airport as a point" and was being tiled edge to edge over airport areas
  // in place of the 38.24 x 38.04 mm AIRARE02P lattice, and all 15 line styles
  // that share a name with a symbol drew that symbol.
  //
  // WHICH IS WHY THE FALLBACK IS AN ALLOW-LIST AND NOT A CATCH-ALL. Reaching
  // for the drawing whenever a definition is missing is silent in exactly the
  // wrong way: a point symbol used as a line style or an area fill is a
  // well-formed SVG with a plausible viewBox, so it passes every check the
  // build makes, and it is the point-symbol geometry — not centred on the line,
  // not mirrored along it, not on the lattice — that ships. An unlisted source
  // with no definition therefore returns undefined and trips the build's
  // missing-sprite warning, where a human decides whether the drawing is really
  // the line style (DRAWN_LINESTYLES) or the catalogue lost an entry.
  const definitions =
    source.kind === "pattern" ? PATTERN_DEFINITIONS : LINESTYLE_DEFINITIONS;
  if (!existsSync(resolve(definitions, `${source.name}.xml`))) {
    return source.kind === "linestyle" && DRAWN_LINESTYLES.has(source.name)
      ? readSymbolSvg(source.name)
      : undefined;
  }

  return source.kind === "pattern"
    ? buildPatternSvg(source)
    : buildLineStyleSvg(source);
}

// Return a vite plugin that generates a symbols.json file and styled SVGs
export default {
  name: "build-symbols",
  async buildStart() {
    console.log("Building symbols...");
    // spreet takes every SVG in the directory, so a file left over from an
    // earlier run under a name the build no longer emits would keep its sprite
    // in the atlas -- which is how a stale image gets picked up for a pattern
    // name. Start from an empty tree.
    rmSync(resolve("symbols"), { recursive: true, force: true });
    const symbols = {};

    const data = JSON.parse(readFileSync(resolve("data.json"), "utf8"));

    for (const source of spriteSources(data)) {
      // The sprite key, not the S-52 name: patterns and line styles are filed
      // under a prefix so they cannot shadow (or be shadowed by) the symbol of
      // the same name. `name` still selects the flare fix-up, which is scoped
      // to four symbols.
      const { key, name } = source;
      if (symbols[key]) continue;

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
            if (symbols[key]) return;

            const [minX, minY, width, height] = svg
              .getAttribute("viewBox")
              .split(/ |,/)
              .map(Number)
              .map(mmToPx);
            const offset = [
              roundToDecimal(width / 2 + minX, 3),
              roundToDecimal(height / 2 + minY, 3),
            ];

            symbols[key] = {
              description:
                svg.querySelector("desc")?.textContent ?? source.description,
              width,
              height,
              offset,
            };
          },
        ]);
        mkdirSync(resolve(`symbols/${mode}`), { recursive: true });
        writeFileSync(resolve(`symbols/${mode}/${key}.svg`), output);
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
