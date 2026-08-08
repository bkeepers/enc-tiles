/**
 * Fixture runs of bin/generate-area-edges.
 *
 * The script is invoked the way bin/s57-to-tiles invokes it -- as a child
 * process over GeoJSON files -- because that is the whole of its contract.
 *
 * The defect it exists to remove, generalised from _MQUAL_EDGE/_BUAARE_EDGE:
 * every stroked area class was drawn ruled into boxes at chart borders -- a
 * restricted area continuing across cell seams drew its symbolized toothed
 * line at every one. The rule: an area boundary draws ONLY where the content
 * changes across it.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import createStyle from "@enc-tiles/styles";

const SCRIPT = fileURLToPath(
  new URL("../bin/generate-area-edges", import.meta.url),
);

let work;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "area-edges-"));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

/** The cell's own coverage: one CATCOV = 1 ring over the unit square. */
const CELL_RING = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
  [0, 0],
];

/** The two halves of the cell, sharing the meridian at x = 0.5. */
const WEST_HALF = [
  [0, 0],
  [0.5, 0],
  [0.5, 1],
  [0, 1],
  [0, 0],
];
const EAST_HALF = [
  [0.5, 0],
  [1, 0],
  [1, 1],
  [0.5, 1],
  [0.5, 0],
];

function writeCollection(name, features) {
  const path = join(work, name);
  writeFileSync(path, JSON.stringify({ type: "FeatureCollection", features }));
  return path;
}

function polygon(properties, ...rings) {
  return {
    type: "Feature",
    properties,
    geometry: { type: "Polygon", coordinates: rings },
  };
}

function run(...args) {
  const output = join(work, "edges.geojson");
  execFileSync(process.execPath, [SCRIPT, output, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(readFileSync(output, "utf8")).features;
}

/** The meridian segments of one feature's line, in traversal order. */
function meridianRuns(feature) {
  const runs = [];
  const line = feature.geometry.coordinates;
  for (let i = 1; i < line.length; i++) {
    if (line[i - 1][0] === 0.5 && line[i][0] === 0.5) {
      runs.push([line[i - 1], line[i]]);
    }
  }
  return runs;
}

/** Whether any emitted line runs ALONG the shared meridian. */
function hasMeridian(features) {
  return features.some((feature) => meridianRuns(feature).length > 0);
}

describe("the merge rule", () => {
  test("two fragments of IDENTICAL content share no edge at all", () => {
    // The general statement of the town/survey merge: same class, same
    // content, no line between them -- the outer ring is all cell boundary.
    const areas = writeCollection("RESARE.geojson", [
      polygon({ RESTRN: "7" }, WEST_HALF),
      polygon({ RESTRN: "7" }, EAST_HALF),
    ]);
    const cover = writeCollection("M_COVR.geojson", [
      polygon({ CATCOV: 1 }, CELL_RING),
    ]);

    expect(run("--area", `RESARE:${areas}`, "--cell-coverage", cover)).toEqual(
      [],
    );
  });

  test("differing content keeps the boundary, ONCE PER SIDE with its own attrs", () => {
    const areas = writeCollection("RESARE.geojson", [
      polygon({ RESTRN: "7" }, WEST_HALF),
      polygon({ RESTRN: "1" }, EAST_HALF),
    ]);
    const cover = writeCollection("M_COVR.geojson", [
      polygon({ CATCOV: 1 }, CELL_RING),
    ]);

    const features = run("--area", `RESARE:${areas}`, "--cell-coverage", cover);

    // One boundary per side (each side's whole ring, less the cell border,
    // chained with its own interior-facing copy of the meridian).
    const west = features.find((f) => f.properties.RESTRN === "7");
    const east = features.find((f) => f.properties.RESTRN === "1");
    expect(west).toBeDefined();
    expect(east).toBeDefined();
    expect(west.properties.CLASS).toBe("RESARE");
    expect(east.properties.CLASS).toBe("RESARE");
    expect(meridianRuns(west).length).toBeGreaterThan(0);
    expect(meridianRuns(east).length).toBeGreaterThan(0);
  });

  test("each side's copy keeps ITS OWN ring orientation", () => {
    // The S-52 line marks point INTO the filled side, and MapLibre reads that
    // off the line's direction -- so the west copy must walk the meridian the
    // way the west ring does (up), and the east copy the way the east ring
    // does (down). Same segment, opposite directions.
    const areas = writeCollection("RESARE.geojson", [
      polygon({ RESTRN: "7" }, WEST_HALF),
      polygon({ RESTRN: "1" }, EAST_HALF),
    ]);

    const features = run("--area", `RESARE:${areas}`);

    const west = features.find((f) => f.properties.RESTRN === "7");
    const east = features.find((f) => f.properties.RESTRN === "1");
    const [westRun] = meridianRuns(west);
    const [eastRun] = meridianRuns(east);
    expect(westRun[1][1]).toBeGreaterThan(westRun[0][1]); // up
    expect(eastRun[1][1]).toBeLessThan(eastRun[0][1]); // down
  });

  test("an INTERIOR differ edge is kept: coverage rings never silence a two-owner segment", () => {
    // Suppression is only for the segments the cell has no evidence about.
    // Both sides are in this export, so the boundary stands even though the
    // coverage ring runs along it.
    const areas = writeCollection("RESARE.geojson", [
      polygon({ RESTRN: "7" }, WEST_HALF),
      polygon({ RESTRN: "1" }, EAST_HALF),
    ]);
    const cover = writeCollection("M_COVR.geojson", [
      polygon({ CATCOV: 1 }, WEST_HALF),
    ]);

    expect(
      hasMeridian(run("--area", `RESARE:${areas}`, "--cell-coverage", cover)),
    ).toBe(true);
  });

  test("an area beside NOTHING keeps its whole outline, with its attrs", () => {
    const areas = writeCollection("CTNARE.geojson", [
      polygon({ INFORM: "note" }, WEST_HALF),
    ]);

    const features = run("--area", `CTNARE:${areas}`);

    expect(features).toHaveLength(1);
    expect(features[0].properties).toEqual({
      CLASS: "CTNARE",
      INFORM: "note",
    });
    expect(features[0].geometry.coordinates).toHaveLength(WEST_HALF.length);
  });

  test("two attribute-LESS fragments merge: same class, same (empty) content", () => {
    // Unlike _BUAARE_EDGE's unnamed towns, an area class with no attributes
    // set states the same thing on both sides -- the class itself -- so the
    // split is topological and the line goes.
    const areas = writeCollection("DRYDOC.geojson", [
      polygon({}, WEST_HALF),
      polygon({}, EAST_HALF),
    ]);

    expect(hasMeridian(run("--area", `DRYDOC:${areas}`))).toBe(false);
  });
});

describe("the identity exclusions", () => {
  test("fragments differing ONLY in bookkeeping merge", () => {
    // LNAM, the source/record dates, the scale gates and the copy-ladder
    // stamps identify the RECORD, not the content. Two fragments differing in
    // nothing else are one area.
    const areas = writeCollection("RESARE.geojson", [
      polygon(
        {
          RESTRN: "7",
          LNAM: "0226DDE21F1A",
          FIDN: 1001,
          RCID: 5,
          SCAMIN: 89999,
          SORDAT: "20190101",
          SORIND: "US,US,graph,chart 18445",
          RECDAT: "20200101",
          RECIND: "a",
          INTU: 5,
          CSCALE: 22000,
        },
        WEST_HALF,
      ),
      polygon(
        {
          RESTRN: "7",
          LNAM: "0226DDE21F1B",
          FIDN: 1002,
          RCID: 6,
          SCAMIN: 44999,
          SORDAT: "20210101",
          SORIND: "US,US,graph,chart 18446",
          RECDAT: "20220101",
          RECIND: "b",
          INTU: 6,
          CSCALE: 12000,
        },
        EAST_HALF,
      ),
    ]);

    const features = run("--area", `RESARE:${areas}`);

    expect(hasMeridian(features)).toBe(false);
    // ...and none of the bookkeeping travels onto the merged outline.
    for (const feature of features) {
      expect(Object.keys(feature.properties).sort()).toEqual([
        "CLASS",
        "RESTRN",
      ]);
    }
  });

  test("a null attribute is the same content as an absent one", () => {
    const areas = writeCollection("RESARE.geojson", [
      polygon({ RESTRN: "7", CATREA: null }, WEST_HALF),
      polygon({ RESTRN: "7" }, EAST_HALF),
    ]);

    expect(hasMeridian(run("--area", `RESARE:${areas}`))).toBe(false);
  });

  test("a REAL attribute difference is content: OBJNAM keeps the line", () => {
    const areas = writeCollection("RESARE.geojson", [
      polygon({ RESTRN: "7", OBJNAM: "Area A" }, WEST_HALF),
      polygon({ RESTRN: "7", OBJNAM: "Area B" }, EAST_HALF),
    ]);

    expect(hasMeridian(run("--area", `RESARE:${areas}`))).toBe(true);
  });
});

describe("chart boundaries are dropped, not drawn", () => {
  test("an area truncated by the cell edge draws nothing along it", () => {
    // The live defect: the restricted area continues onto the next chart,
    // which draws its half; the boundary is deliberately left open here.
    const areas = writeCollection("RESARE.geojson", [
      polygon({ RESTRN: "7" }, CELL_RING),
    ]);
    const cover = writeCollection("M_COVR.geojson", [
      polygon({ CATCOV: 1 }, CELL_RING),
    ]);

    expect(run("--area", `RESARE:${areas}`, "--cell-coverage", cover)).toEqual(
      [],
    );
  });

  test("without --cell-coverage the same edges come back", () => {
    // The negative control: the drop is the coverage input doing its job.
    const areas = writeCollection("RESARE.geojson", [
      polygon({ RESTRN: "7" }, CELL_RING),
    ]);

    expect(run("--area", `RESARE:${areas}`)).toHaveLength(1);
  });

  test("a quilt cut against a finer chart is dropped too", () => {
    const areas = writeCollection("RESARE.geojson", [
      polygon({ RESTRN: "7" }, WEST_HALF),
    ]);
    const coverage = writeCollection("quilting_coverage.geojson", [
      polygon({ INTU: 6 }, EAST_HALF),
    ]);

    const features = run("--area", `RESARE:${areas}`, "--coverage", coverage);

    expect(features.length).toBeGreaterThan(0);
    expect(hasMeridian(features)).toBe(false);
  });

  test("a CATCOV = 2 gap is not a cell edge", () => {
    const areas = writeCollection("RESARE.geojson", [
      polygon({ RESTRN: "7" }, WEST_HALF),
    ]);
    const cover = writeCollection("M_COVR.geojson", [
      polygon({ CATCOV: 2 }, WEST_HALF),
    ]);

    expect(
      run("--area", `RESARE:${areas}`, "--cell-coverage", cover),
    ).toHaveLength(1);
  });
});

describe("the zoom partition", () => {
  test("each interval is classified and chained on its OWN segments", () => {
    // Two copies of one differing pair, one per interval of the copy ladder. A
    // shared hash would collect four owners on the coincident meridian and
    // misread the interface entirely.
    const areas = writeCollection("RESARE.geojson", [
      polygon({ RESTRN: "7", _QZMIN: 8, _QZMAX: 9 }, WEST_HALF),
      polygon({ RESTRN: "1", _QZMIN: 8, _QZMAX: 9 }, EAST_HALF),
      polygon({ RESTRN: "7", _QZMIN: 10 }, WEST_HALF),
      polygon({ RESTRN: "1", _QZMIN: 10 }, EAST_HALF),
    ]);
    const cover = writeCollection("M_COVR.geojson", [
      polygon({ CATCOV: 1 }, CELL_RING),
    ]);

    const features = run("--area", `RESARE:${areas}`, "--cell-coverage", cover);

    // Two sides per interval, two intervals.
    expect(features).toHaveLength(4);
    const low = features.filter((f) => f.properties._QZMIN === 8);
    const high = features.filter((f) => f.properties._QZMIN === 10);
    expect(low).toHaveLength(2);
    expect(high).toHaveLength(2);
    expect(low.every((f) => f.properties._QZMAX === 9)).toBe(true);
  });

  test("a fallback continuation carries _QFALL onto its edges", () => {
    const areas = writeCollection("RESARE.geojson", [
      polygon({ RESTRN: "7", _QZMAX: 5, _QFALL: 1 }, WEST_HALF),
    ]);

    const features = run("--area", `RESARE:${areas}`);

    expect(features).toHaveLength(1);
    expect(features[0].properties._QFALL).toBe(1);
    expect(features[0].properties._QZMAX).toBe(5);
    // The stamps are the copy ladder's, never the identity's.
    expect(features[0].properties.CLASS).toBe("RESARE");
  });
});

describe("a multi-class run", () => {
  test("classes are derived independently and tagged with CLASS", () => {
    // RESARE beside CTNARE at the meridian: neither class sees the other, so
    // EACH keeps its own full outline there -- the merge rule is about content
    // of ONE class, never about two classes covering the same water.
    const resare = writeCollection("RESARE.geojson", [
      polygon({ RESTRN: "7" }, WEST_HALF),
    ]);
    const ctnare = writeCollection("CTNARE.geojson", [
      polygon({ INFORM: "note" }, EAST_HALF),
    ]);

    const features = run(
      "--area",
      `RESARE:${resare}`,
      "--area",
      `CTNARE:${ctnare}`,
    );

    expect(features).toHaveLength(2);
    const byClass = Object.fromEntries(
      features.map((f) => [f.properties.CLASS, f]),
    );
    expect(meridianRuns(byClass.RESARE).length).toBeGreaterThan(0);
    expect(meridianRuns(byClass.CTNARE).length).toBeGreaterThan(0);
  });
});

describe("nothing to say", () => {
  test("empty class files write an empty collection", () => {
    expect(
      run("--area", `RESARE:${writeCollection("RESARE.geojson", [])}`),
    ).toEqual([]);
  });
});

describe("the participating class list", () => {
  /**
   * Classes with a derived edge layer of their own, or none the facade draws.
   * The exclusions the generator's header documents -- kept in the test too,
   * so a drift in either place fails here.
   */
  const HANDLED_ELSEWHERE = new Set([
    "BUAARE", // _BUAARE_EDGE
    "DEPARE", // _DEPARE_EDGE
    "DRGARE", // _DEPARE_EDGE (its only stroked presentation is the depth boundary)
    "M_QUAL", // _MQUAL_EDGE
    "M_NPUB", // cell metadata; the facade drops the class's presentation
    "M_NSYS", // cell metadata; likewise
  ]);

  /** A real S-57 acronym: the pseudo classes never name a tile source-layer. */
  const S57_CLASS = /^[A-Z][A-Z0-9_]{5}$/;

  test("--list-classes is exactly the classes the style strokes", () => {
    // Re-derive the list from the style generator, both boundary modes: every
    // AREA class emitting a boundary LINE presentation -- a line layer over
    // Polygon geometry, or a line-placed LM_ mark layer -- minus the classes
    // another derived layer already owns.
    const requiresGeom = (filter, type) => {
      if (!Array.isArray(filter)) return false;
      if (
        filter.length === 3 &&
        filter[0] === "==" &&
        Array.isArray(filter[1]) &&
        filter[1][0] === "geometry-type"
      ) {
        return filter[2] === type;
      }
      return filter.some((node) => requiresGeom(node, type));
    };

    const stroked = new Set();
    for (const boundaries of ["plain", "symbolized"]) {
      const style = createStyle({
        source: { type: "vector", url: "unused" },
        boundaries,
      });
      for (const layer of style.layers) {
        const obcl = layer.metadata?.s52?.obcl;
        if (!obcl || !S57_CLASS.test(obcl)) continue;
        if (HANDLED_ELSEWHERE.has(obcl)) continue;
        if (!requiresGeom(layer.filter, "Polygon")) continue;
        const icon = layer.layout?.["icon-image"];
        const mark =
          layer.type === "symbol" &&
          layer.layout?.["symbol-placement"] === "line" &&
          typeof icon === "string" &&
          icon.startsWith("LM_");
        if (layer.type === "line" || mark) stroked.add(obcl);
      }
    }

    const listed = execFileSync(process.execPath, [SCRIPT, "--list-classes"], {
      encoding: "utf8",
    })
      .trim()
      .split("\n");

    expect(listed).toEqual([...stroked].sort());
  });
});
