import { create } from "xmlbuilder2";
import { writeFile } from "fs/promises";
import { cieToRgb } from "./colours.js";

const TYPE_MAPPING = {
  A: "Area",
  L: "Line",
  P: "Point",
};

const TABLE_NAME_MAPPING = {
  LINES: "Lines",
  PAPER_CHART: "Paper",
  PLAIN_BOUNDARIES: "Plain",
  SIMPLIFIED: "Simplified",
  SYMBOLIZED_BOUNDARIES: "Symbolized",
};

const DISPLAY_CATEGORY_MAPPING = {
  DISPLAYBASE: "Displaybase",
  "MARINERS OTHER": "Mariners",
  "MARINERS STANDARD": "Mariners",
  OTHER: "Other",
  STANDARD: "Standard",
};

const RADAR_PRIORITY_MAPPING = {
  S: "Suppressed",
  O: "On Top",
};

const DISPLAY_PRIORITY_MAPPING = {
  /*
  TODO: PresLib uses 0-9, OCPN uses:
  * Area 1
  * Area 2
  * Area Symbol
  * Group 1
  * Hazards
  * Line Symbol
  * Mariners
  * No data
  * Point Symbol
  * Routing
  */
};

export default {
  name: "generate-chartsymbols",
  async buildStart() {
    // Load chart symbol data
    const s52 = (await import("../data.json", { with: { type: "json" } }))
      .default;

    console.log("Generating chartsymbols.xml");
    const root = create().ele("chartsymbols");

    const colors = root.ele("color-tables");
    s52.colours.forEach((c) => {
      const color = colors.ele("color-table", { name: c.ctus });
      color.ele("graphics-file", { name: `${c.ctus.toLowerCase()}.png` });
      c.entries.forEach((ce) => {
        const [r, g, b] = cieToRgb(ce.chrx, ce.chry, ce.clum);
        color.ele("color", { name: ce.ctok, r, g, b });
      });
    });

    const lookups = root.ele("lookups");
    s52.lookups.forEach((l, id) => {
      const node = lookups.ele("lookup", { id, RCID: l.rcid, name: l.obcl });
      node.ele("type").txt(TYPE_MAPPING[l.ftyp]);
      // TODO: mapping
      node.ele("disp-prio").txt(DISPLAY_PRIORITY_MAPPING[l.dpri]);
      node.ele("radar-prio").txt(RADAR_PRIORITY_MAPPING[l.rpri]);
      node.ele("table-name").txt(TABLE_NAME_MAPPING[l.tnam]);
      l.attc.forEach(({ attl, attv }, index) => {
        node.ele("attrib-code", { index }).txt(`${attl}${attv}`);
      });
      node.ele("instruction").txt(l.inst);
      node.ele("display-cat").txt(DISPLAY_CATEGORY_MAPPING[l.disc]);
      node.ele("comment").txt(l.lucm);
    });

    const lines = root.ele("line-styles");
    s52.linestyles.forEach((ls) => {
      const node = lines.ele("line-style", { RCID: ls.rcid });
      node.ele("name").txt(ls.lind.linm);
      node
        .ele("vector", { width: ls.lind.lihl, height: ls.lind.livl })
        .ele("distance", { min: 0, max: 0 })
        .up()
        .ele("pivot", { x: ls.lind.licl, y: ls.lind.lirw })
        .up()
        .ele("origin", { x: ls.lind.lbxc, y: ls.lind.lbxr });

      // FIXME: update dai parser single string for these fields
      node.ele("description").txt(ls.lxpo.join(" "));
      node.ele("HPGL").txt(ls.lvct.join(""));

      Object.entries(ls.lcrf).forEach((e) => {
        node.ele("color-ref").txt(e.join(""));
      });
    });

    const patterns = root.ele("patterns");
    s52.patterns.forEach((p) => {
      const node = patterns.ele("pattern", { RCID: p.rcid });
      node.ele("name").txt(p.patd.panm);
      node.ele("definition").txt(p.patd.padf);
      node.ele("filltype").txt(p.patd.patp.slice(0, 1));
      node.ele("spacing").txt(p.patd.pasp.slice(0, 1));

      node
        .ele("vector", { width: p.patd.pahl, height: p.patd.pavl })
        .ele("distance", { min: p.patd.pami, max: p.patd.pama })
        .up()
        .ele("pivot", { x: p.patd.pacl, y: p.patd.parw })
        .up()
        .ele("origin", { x: p.patd.pbxc, y: p.patd.pbxr });

      // // FIXME: update dai parser single string for these fields
      node.ele("description").txt(p.pxpo.join(" "));
      node.ele("HPGL").txt(p.pvct.join(""));

      Object.entries(p.pcrf).forEach((e) => {
        node.ele("color-ref").txt(e.join(""));
      });
    });

    const sprites = (
      await import("../sprites/day.json", { with: { type: "json" } })
    ).default;
    const symdefs = (
      await import("../symbols.json", { with: { type: "json" } })
    ).default;
    const symbols = root.ele("symbols");
    s52.symbols.forEach((s) => {
      const name = s.symd.synm;
      const sprite = sprites[name];
      const def = symdefs[name];

      const node = symbols.ele("symbol", { RCID: s.rcid });
      node.ele("name").txt(name);
      // FIXME: update dai parser single string for these fields
      node.ele("description").txt(s.sxpo.join(" "));
      node
        .ele("bitmap", { width: sprite.width, height: sprite.height })
        .ele("distance", { min: 0, max: 0 })
        .up()
        .ele("pivot", {
          x: def.width / 2 + def.offset[0],
          y: def.height / 2 + def.offset[1],
        })
        .up()
        .ele("origin", { x: 0, y: 0 })
        .up()
        .ele("graphics-location", { x: sprite.x, y: sprite.y });

      Object.entries(s.scrf).forEach((e) => {
        node.ele("color-ref").txt(e.join(""));
      });

      node
        .ele("vector", { width: s.symd.syhl, height: s.symd.syvl })
        .ele("distance", { min: 0, max: 0 })
        .up()
        .ele("pivot", { x: s.symd.sycl, y: s.symd.syrw })
        .up()
        .ele("origin", { x: s.symd.sbxc, y: s.symd.sbxr })
        .ele("HPGL")
        .txt(s.svct.join(""));

      node.ele("definition").txt(s.symd.sydf);
    });

    await writeFile("chartsymbols.xml", root.end({ prettyPrint: true }));
  },
};
