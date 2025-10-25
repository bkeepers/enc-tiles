/**
 * Parses S-52 .dai presentation library files as described in S-52 PresLib e4.0.0 Part I, Ch.11.
 *
 * Full disclosure: this was originally written by ChatGPT and modified. There are a lot of opportunities to clean it up and optimize it.
 */

const UnitSep = "\x1F";

export interface DaiFile {
  lbid: LBID | null;
  colours: ColourTable[]; // COLS + CCIE*
  lookups: LookupEntry[]; // LUPT + ATTC* + INST + DISC + LUCM
  patterns: PatternModule[]; // PATT + PATD + (PXPO*) + PCRF + (PBTM*|PVCT*)
  symbols: SymbolModule[]; // SYMB + SYMD + (SXPO*) + SCRF + (SBTM*|SVCT*)
  linestyles: LinestyleModule[]; // LNST + LIND + (LXPO*) + LCRF + LVCT*
  unknown: ModuleRaw[]; // for forward compatibility
}

export interface ModuleRaw {
  tag: string; // first field tag encountered
  fields: FieldRaw[];
}
export interface FieldRaw {
  tag: string;
  raw: string;
}

// 11.1 LBID — Library Identification (single, non-repeating)
export interface LBID {
  rcid: number;
  expp: string; // "NEW" | "REV"
  ptyp: string; // typically "IHO"
  esid: string;
  edtn: string; // e.g. "04.0"
  codt: string; // YYYYMMDD
  coti: string; // HHMMSS
  vrdt: string; // YYYYMMDD
  prof: string; // "PN" | "PR"
  ocdt: string; // YYYYMMDD
  comt: string; // free text
}

// 11.4 Colours (COLS + CCIE*)
export interface ColourTable {
  rcid: number;
  stat: "NIL" | "ADD" | "MOD" | "DEL";
  ctus: string; // DAY_BRIGHT, NIGHT, etc.
  entries: ColourCIE[];
}
export interface ColourCIE {
  ctok: string; // 5-char token
  chrx: number; // x
  chry: number; // y
  clum: number; // L
  cuse: string; // usage text
}

// 11.2 Look-up table entry (LUPT (+ ATTC*) (+ INST) (+ DISC) (+ LUCM))
export interface LookupEntry {
  rcid: number;
  stat: "NIL" | "ADD" | "MOD" | "DEL";
  obcl: string; // object class (6 letters)
  ftyp: "A" | "L" | "P"; // area/line/point
  dpri: number; // display priority
  rpri: "O" | "S"; // radar priority
  tnam: string; // table set name
  attc: { attl: string; attv: string }[]; // repeating pairs
  inst: string | undefined; // symbology instruction string
  disc: string | undefined; // display category
  lucm: string | undefined; // comment
}

// 11.5 Pattern module
export interface PatternModule {
  rcid: number;
  stat: "NIL" | "ADD" | "MOD" | "DEL";
  patd: {
    panm: string;
    padf: "V" | "R";
    patp: "STG" | "LIN";
    pasp: "CON" | "SCL";
    pami: number;
    pama: number;
    pacl: number;
    parw: number;
    pahl: number;
    pavl: number;
    pbxc: number;
    pbxr: number;
  };
  pxpo: string[]; // optional exposition text rows
  pcrf: { [cidx: string]: string }; // letter -> CTOK mapping
  // exactly one of:
  pbtm?: string[]; // bitmap rows (length must equal pahl; row count equals pavl)
  pvct?: string[]; // vector command rows
}

// 11.6 Symbol module
export interface SymbolModule {
  rcid: number;
  stat: "NIL" | "ADD" | "MOD" | "DEL";
  symd: {
    synm: string;
    sydf: "V" | "R";
    sycl: number;
    syrw: number;
    syhl: number;
    syvl: number;
    sbxc: number;
    sbxr: number;
  };
  sxpo: string[];
  scrf: { [cidx: string]: string };
  sbtm?: string[];
  svct?: string[];
}

// 11.7 Linestyle module
export interface LinestyleModule {
  rcid: number;
  stat: "NIL" | "ADD" | "MOD" | "DEL";
  lind: {
    linm: string;
    licl: number;
    lirw: number;
    lihl: number;
    livl: number;
    lbxc: number;
    lbxr: number;
  };
  lxpo: string[];
  lcrf: { [cidx: string]: string };
  lvct: string[]; // vector rows
}

// ----------- Parser ------------

export function parse(text: string): DaiFile {
  const modules = splitModules(text);
  const out: DaiFile = {
    lbid: null,
    colours: [],
    lookups: [],
    patterns: [],
    symbols: [],
    linestyles: [],
    unknown: [],
  };

  for (const mod of modules) {
    const fields = collectFields(mod);
    if (!fields[0]) continue;
    const firstTag = fields[0].tag;

    switch (firstTag) {
      case "LBID": {
        out.lbid = parseLBID(fields[0].raw);
        break;
      }
      case "COLS": {
        out.colours.push(parseColourTable(fields));
        break;
      }
      case "LUPT": {
        out.lookups.push(parseLookup(fields));
        break;
      }
      case "PATT": {
        out.patterns.push(parsePattern(fields));
        break;
      }
      case "SYMB": {
        out.symbols.push(parseSymbol(fields));
        break;
      }
      case "LNST": {
        out.linestyles.push(parseLinestyle(fields));
        break;
      }
      default:
        out.unknown.push({ tag: firstTag, fields });
    }
  }
  return out;
}

// --- low-level helpers ---

function splitModules(text: string): string[] {
  // modules separated by lines starting with "****" (spec)
  const parts = text.split(/^(\*{4}.*)$/m); // keep delimiters, but we’ll rejoin between them
  // group into chunks not including "****" lines
  const chunks: string[] = [];
  let buf: string[] = [];
  for (const p of parts) {
    if (p.startsWith("****")) {
      chunks.push(buf.join("").trim());
      buf = [];
    } else {
      buf.push(p);
    }
  }
  // last chunk (if file doesn’t end with ****)
  const tail = buf.join("").trim();
  if (tail) chunks.push(tail);
  return chunks.map(normalizeLines);
}

function normalizeLines(s: string) {
  return s.replace(/\r\n?/g, "\n");
}

function collectFields(moduleText: string): FieldRaw[] {
  const lines = moduleText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const fields: FieldRaw[] = [];
  for (const ln of lines) {
    // Skip numeric-only lines like "0001    500001" that occur in the dataset
    if (/^[0-9\s]+$/.test(ln)) continue;
    // Field tag is first 4 chars; remainder is payload (length + data)
    const tag = ln.slice(0, 4);
    if (!/^[A-Z*]{4}$/i.test(tag)) continue; // safety
    let payload = ln.slice(4).trim();
    payload = payload.replace(/^\d+/, "").trim(); // Strip leading length number, if present
    payload = payload.replace(/\x1F+$/g, ""); // remove trailing US
    fields.push({ tag: tag.toUpperCase(), raw: payload });
  }
  return fields;
}

function takeFixed(s: string, n: number): [string, string] {
  return [s.slice(0, n), s.slice(n)];
}

function parseUSList(payload: string): string[] {
  return (payload.endsWith(UnitSep) ? payload.slice(0, -1) : payload).split(
    UnitSep,
  );
}

const Variable = 0;

/**
 * Parses a line based on the provided field-length definition.
 */
function parseLine<Definition extends { [key: string]: number }>(
  definition: Definition,
  raw: string,
) {
  let start = 0;
  return Object.fromEntries(
    Object.entries(definition).map(([key, len]) => {
      let value: string;
      if (len === Variable) {
        let end = raw.indexOf(UnitSep, start);
        if (end === -1) end = raw.length;

        value = raw.slice(start, end).trim();
        start = end + UnitSep.length;
      } else {
        value = raw.slice(start, (start += len)).trim();
      }
      return [key, value];
    }),
  ) as { [K in keyof Definition]: string };
}

// --- field parsers ---

// 11.1.2 LBID
function parseLBID(raw: string): LBID {
  const { rcid, ...rest } = parseLine(
    {
      modn: 2,
      rcid: 5,
      expp: 3,
      ptyp: Variable,
      esid: Variable,
      edtn: Variable,
      codt: 8,
      coti: 6,
      vrdt: 8,
      prof: 2,
      ocdt: 8,
      comt: Variable,
    },
    raw,
  );

  return {
    rcid: parseInt(rcid, 10),
    ...rest,
  };
}

// 11.4 Colour table: COLS + CCIE*
function parseColourTable(fields: FieldRaw[]): ColourTable {
  const cols = fields.find((f) => f.tag === "COLS")!;

  const { rcid, stat, ctus } = parseLine(
    {
      modn: 2,
      rcid: 5,
      stat: 3,
      ctus: Variable,
    },
    cols.raw,
  );

  const entries: ColourCIE[] = [];
  for (const f of fields) {
    if (f.tag !== "CCIE") continue;

    const { ctok, chrx, chry, clum, cuse } = parseLine(
      {
        ctok: 5,
        chrx: Variable,
        chry: Variable,
        clum: Variable,
        cuse: Variable,
      },
      f.raw,
    );

    entries.push({
      ctok,
      chrx: parseFloat(chrx),
      chry: parseFloat(chry),
      clum: parseFloat(clum),
      cuse,
    });
  }
  return {
    rcid: parseInt(rcid, 10),
    stat: stat as ColourTable["stat"],
    ctus,
    entries,
  };
}

// 11.2 Look-Up Table Entry (LUPT + ATTC* + INST + DISC + LUCM)
function parseLookup(fields: FieldRaw[]): LookupEntry {
  const lu = fields.find((f) => f.tag === "LUPT")!;

  const { rcid, stat, obcl, ftyp, dpri, rpri, tnam } = parseLine(
    {
      modn: 2,
      rcid: 5,
      stat: 3,
      obcl: 6,
      ftyp: 1,
      dpri: 5,
      rpri: 1,
      tnam: Variable,
    },
    lu.raw,
  );

  const attc: { attl: string; attv: string }[] = [];

  for (const f of fields) {
    if (f.tag !== "ATTC") continue;
    if (!f.raw) continue;
    for (const token of parseUSList(f.raw)) {
      if (!token) continue;
      const [attl, attv] = takeFixed(token, 6);
      attc.push({ attl, attv });
    }
  }
  const inst = fields.find((f) => f.tag === "INST")?.raw ?? undefined; // symbology instruction string
  const disc = fields.find((f) => f.tag === "DISC")?.raw ?? undefined; // category name
  const lucm = fields.find((f) => f.tag === "LUCM")?.raw ?? undefined; // comment

  return {
    rcid: parseInt(rcid, 10),
    stat: stat as LookupEntry["stat"],
    obcl,
    ftyp: ftyp as LookupEntry["ftyp"],
    dpri: parseInt(dpri, 10),
    rpri: rpri as LookupEntry["rpri"],
    tnam,
    attc,
    inst,
    disc,
    lucm,
  };
}

// 11.5 Pattern module
function parsePattern(fields: FieldRaw[]): PatternModule {
  const id = fields.find((f) => f.tag === "PATT")!;
  const { rcid, stat } = parseLine({ modn: 2, rcid: 5, stat: 3 }, id.raw);

  const patdRaw = fields.find((f) => f.tag === "PATD")?.raw ?? "";
  // PATD: PANM(8), PADF(1), PATP(3), PASP(3), PAMI(5), PAMA(5), PACL(5), PARW(5), PAHL(5), PAVL(5), PBXC(5), PBXR(5)
  let q = patdRaw;
  const patd = {
    panm: takeFixed(q, 8)[0], // name
    padf: ((q = takeFixed(q, 8)[1]), takeFixed(q, 1)[0]) as "V" | "R",
    patp: ((q = takeFixed(q, 1)[1]), takeFixed(q, 3)[0]) as "STG" | "LIN",
    pasp: ((q = takeFixed(q, 3)[1]), takeFixed(q, 3)[0]) as "CON" | "SCL",
    pami: parseInt(((q = takeFixed(q, 3)[1]), takeFixed(q, 5)[0]), 10),
    pama: parseInt(((q = takeFixed(q, 5)[1]), takeFixed(q, 5)[0]), 10),
    pacl: parseInt(((q = takeFixed(q, 5)[1]), takeFixed(q, 5)[0]), 10),
    parw: parseInt(((q = takeFixed(q, 5)[1]), takeFixed(q, 5)[0]), 10),
    pahl: parseInt(((q = takeFixed(q, 5)[1]), takeFixed(q, 5)[0]), 10),
    pavl: parseInt(((q = takeFixed(q, 5)[1]), takeFixed(q, 5)[0]), 10),
    pbxc: parseInt(((q = takeFixed(q, 5)[1]), takeFixed(q, 5)[0]), 10),
    pbxr: parseInt(((q = takeFixed(q, 5)[1]), takeFixed(q, 5)[0]), 10),
  };

  const pxpo = fields
    .filter((f) => f.tag === "PXPO")
    .map((f) => f.raw.replace(/\x1F+$/, ""));
  const pcrf = parseColourRef(fields.find((f) => f.tag === "PCRF")?.raw ?? "");
  const pbtmRows = fields
    .filter((f) => f.tag === "PBTM")
    .map((f) => f.raw.replace(/\x1F+$/, ""));
  const pvctRows = fields
    .filter((f) => f.tag === "PVCT")
    .map((f) => f.raw.replace(/\x1F+$/, ""));

  const mod: PatternModule = {
    rcid: parseInt(rcid, 10),
    stat: stat as PatternModule["stat"],
    patd,
    pxpo,
    pcrf: pcrf || {},
  };
  if (pbtmRows.length) mod.pbtm = pbtmRows;
  else if (pvctRows.length) mod.pvct = pvctRows;
  return mod;
}

// 11.6 Symbol module
function parseSymbol(fields: FieldRaw[]): SymbolModule {
  const id = fields.find((f) => f.tag === "SYMB")!;

  const { rcid, stat } = parseLine({ modn: 2, rcid: 5, stat: 3 }, id.raw);

  const sd = fields.find((f) => f.tag === "SYMD")?.raw ?? "";
  let q = sd;
  const synm = takeFixed(q, 8)[0];
  const sydf = ((q = takeFixed(q, 8)[1]), takeFixed(q, 1)[0]) as "V" | "R";
  const sycl = parseInt(((q = takeFixed(q, 1)[1]), takeFixed(q, 5)[0]), 10);
  const syrw = parseInt(((q = takeFixed(q, 5)[1]), takeFixed(q, 5)[0]), 10);
  const syhl = parseInt(((q = takeFixed(q, 5)[1]), takeFixed(q, 5)[0]), 10);
  const syvl = parseInt(((q = takeFixed(q, 5)[1]), takeFixed(q, 5)[0]), 10);
  const sbxc = parseInt(((q = takeFixed(q, 5)[1]), takeFixed(q, 5)[0]), 10);
  const sbxr = parseInt(((q = takeFixed(q, 5)[1]), takeFixed(q, 5)[0]), 10);

  const sxpo = fields
    .filter((f) => f.tag === "SXPO")
    .map((f) => f.raw.replace(/\x1F+$/, ""));
  const scrf = parseColourRef(fields.find((f) => f.tag === "SCRF")?.raw ?? "");
  const sbtm = fields
    .filter((f) => f.tag === "SBTM")
    .map((f) => f.raw.replace(/\x1F+$/, ""));
  const svct = fields
    .filter((f) => f.tag === "SVCT")
    .map((f) => f.raw.replace(/\x1F+$/, ""));

  const sym: SymbolModule = {
    rcid: parseInt(rcid, 10),
    stat: stat as SymbolModule["stat"],
    symd: { synm, sydf, sycl, syrw, syhl, syvl, sbxc, sbxr },
    sxpo,
    scrf: scrf || {},
  };
  if (sbtm.length) sym.sbtm = sbtm;
  else if (svct.length) sym.svct = svct;
  return sym;
}

// 11.7 Linestyle module (LNST/LIND/LCRF/LVCT; LXPO like PXPO)
function parseLinestyle(fields: FieldRaw[]): LinestyleModule {
  const id = fields.find((f) => f.tag === "LNST")!;
  const { rcid, stat } = parseLine({ modn: 2, rcid: 5, stat: 3 }, id.raw);

  const ld = fields.find((f) => f.tag === "LIND")?.raw ?? "";
  let q = ld;
  const linm = takeFixed(q, 8)[0];
  const licl = parseInt(((q = takeFixed(q, 8)[1]), takeFixed(q, 5)[0]), 10);
  const lirw = parseInt(((q = takeFixed(q, 5)[1]), takeFixed(q, 5)[0]), 10);
  const lihl = parseInt(((q = takeFixed(q, 5)[1]), takeFixed(q, 5)[0]), 10);
  const livl = parseInt(((q = takeFixed(q, 5)[1]), takeFixed(q, 5)[0]), 10);
  const lbxc = parseInt(((q = takeFixed(q, 5)[1]), takeFixed(q, 5)[0]), 10);
  const lbxr = parseInt(((q = takeFixed(q, 5)[1]), takeFixed(q, 5)[0]), 10);

  const lxpo = fields
    .filter((f) => f.tag === "LXPO")
    .map((f) => f.raw.replace(/\x1F+$/, ""));
  const lcrf = parseColourRef(fields.find((f) => f.tag === "LCRF")?.raw ?? "");
  const lvct = fields
    .filter((f) => f.tag === "LVCT")
    .map((f) => f.raw.replace(/\x1F+$/, ""));

  return {
    rcid: parseInt(rcid, 10),
    stat: stat as LinestyleModule["stat"],
    lind: { linm, licl, lirw, lihl, livl, lbxc, lbxr },
    lxpo,
    lcrf: lcrf || {},
    lvct,
  };
}

// PCRF/SCRF/LCRF repeating (CIDX + CTOK)
function parseColourRef(raw: string): Record<string, string> {
  const s = raw.replace(/\x1F+$/, "");
  // content is one or more 6-char groups: CIDX(1) + CTOK(5); occasionally multiple groups concatenated
  const map: Record<string, string> = {};
  for (let i = 0; i + 6 <= s.length; i += 6) {
    const cidx = s[i]!;
    const ctok = s.slice(i + 1, i + 6);
    map[cidx] = ctok;
  }
  return map;
}
