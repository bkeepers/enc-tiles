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

/** Shoelace of a closed line in lon/lat: > 0 counter-clockwise. */
function shoelace(line) {
  let sum = 0;
  for (let i = 1; i < line.length; i++)
    sum += line[i - 1][0] * line[i][1] - line[i][0] * line[i - 1][1];
  return sum / 2;
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

  test("each side's copy faces its own interior", () => {
    // The S-52 line marks point INTO the filled side, and MapLibre puts a line
    // symbol's image-down on the RIGHT of travel -- so each copy walks the
    // meridian with ITS interior on the right: the west copy down, the east
    // copy up. Same segment, opposite directions, and neither is the fixture's
    // own (CCW) winding.
    const areas = writeCollection("RESARE.geojson", [
      polygon({ RESTRN: "7" }, WEST_HALF),
      polygon({ RESTRN: "1" }, EAST_HALF),
    ]);

    const features = run("--area", `RESARE:${areas}`);

    const west = features.find((f) => f.properties.RESTRN === "7");
    const east = features.find((f) => f.properties.RESTRN === "1");
    const [westRun] = meridianRuns(west);
    const [eastRun] = meridianRuns(east);
    expect(westRun[1][1]).toBeLessThan(westRun[0][1]); // down: west on the right
    expect(eastRun[1][1]).toBeGreaterThan(eastRun[0][1]); // up: east on the right
  });

  test("emitted directions are independent of the SOURCE winding", () => {
    // GDAL leaves S-57 ring winding arbitrary (~50/50 measured on Puget
    // Sound), so the same halves must come out identically however each ring
    // arrived -- the regression behind the round-10 outward-marks defect.
    const reversed = (ring) => ring.slice().reverse();
    for (const [west, east] of [
      [reversed(WEST_HALF), EAST_HALF],
      [WEST_HALF, reversed(EAST_HALF)],
      [reversed(WEST_HALF), reversed(EAST_HALF)],
    ]) {
      const areas = writeCollection("RESARE.geojson", [
        polygon({ RESTRN: "7" }, west),
        polygon({ RESTRN: "1" }, east),
      ]);

      const features = run("--area", `RESARE:${areas}`);

      const [westRun] = meridianRuns(
        features.find((f) => f.properties.RESTRN === "7"),
      );
      const [eastRun] = meridianRuns(
        features.find((f) => f.properties.RESTRN === "1"),
      );
      expect(westRun[1][1]).toBeLessThan(westRun[0][1]); // down, unchanged
      expect(eastRun[1][1]).toBeGreaterThan(eastRun[0][1]); // up, unchanged
    }
  });

  test("a hole supplied SAME-handed as its exterior still faces the fill", () => {
    // Real cells do not honour the OGC hole rule (measured 66 same-handed vs
    // 29 opposite), so orientation is decided per ring ROLE: filled side on
    // the right of travel is exterior clockwise, hole counter-clockwise.
    const HOLE = [
      [0.2, 0.2],
      [0.3, 0.2],
      [0.3, 0.3],
      [0.2, 0.3],
      [0.2, 0.2],
    ]; // CCW, same-handed as the CCW WEST_HALF fixture
    const areas = writeCollection("RESARE.geojson", [
      polygon({ RESTRN: "7" }, WEST_HALF, HOLE),
    ]);

    const features = run("--area", `RESARE:${areas}`);

    // Outline and hole chain into separate closed loops of one signature.
    expect(features).toHaveLength(2);
    const isHole = (f) =>
      f.geometry.coordinates.every(([x]) => x >= 0.2 && x <= 0.3);
    const hole = features.find(isHole);
    const outline = features.find((f) => !isHole(f));
    expect(shoelace(hole.geometry.coordinates)).toBeGreaterThan(0); // CCW
    expect(shoelace(outline.geometry.coordinates)).toBeLessThan(0); // CW
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

describe("overlapping areas truncated together (the one-sided multi-owner seam)", () => {
  // The measured US1GLBDC/US1GLBEA defect: nested jurisdiction areas -- the
  // state ADMARE under the national one -- are truncated by the SAME cell
  // edge into bit-identical border segments. Two owners, differing content,
  // but every interior on the SAME side: the segment is a truncation, not an
  // interface, and on a chart border the cell has no evidence of a change.

  test("their shared truncation at the cell edge draws nothing along it", () => {
    // Two coincident WEST_HALF areas of differing content; the cell's own ring
    // IS the west half, so the whole outline lies on the chart border.
    const areas = writeCollection("ADMARE.geojson", [
      polygon({ JRSDTN: 2, NATION: "US" }, WEST_HALF),
      polygon({ JRSDTN: 3, INFORM: "Alaska" }, WEST_HALF),
    ]);
    const cover = writeCollection("M_COVR.geojson", [
      polygon({ CATCOV: 1 }, WEST_HALF),
    ]);

    expect(run("--area", `ADMARE:${areas}`, "--cell-coverage", cover)).toEqual(
      [],
    );
  });

  test("inland, the same pair keeps its per-side edges (the negative)", () => {
    // Not on any seam, the coincident boundary of two differing areas is a
    // real statement -- outside them is neither -- and each side keeps its own
    // presentation, exactly as before the seam rule learned about ownership
    // sides.
    const areas = writeCollection("ADMARE.geojson", [
      polygon({ JRSDTN: 2, NATION: "US" }, WEST_HALF),
      polygon({ JRSDTN: 3, INFORM: "Alaska" }, WEST_HALF),
    ]);

    const features = run("--area", `ADMARE:${areas}`);

    expect(features).toHaveLength(2);
    const national = features.find((f) => f.properties.NATION === "US");
    const state = features.find((f) => f.properties.INFORM === "Alaska");
    expect(national).toBeDefined();
    expect(state).toBeDefined();
    expect(meridianRuns(national).length).toBeGreaterThan(0);
    expect(meridianRuns(state).length).toBeGreaterThan(0);
  });

  test("a genuine interface on the ring is still never suppressed", () => {
    // The attribute-mismatch negative, restated under the one-sided rule: two
    // owners FACING each other across the meridian are an interface however
    // the coverage rings run, because the cell holds both sides' evidence.
    const areas = writeCollection("ADMARE.geojson", [
      polygon({ JRSDTN: 2, NATION: "US" }, WEST_HALF),
      polygon({ JRSDTN: 2, NATION: "CA" }, EAST_HALF),
    ]);
    const cover = writeCollection("M_COVR.geojson", [
      polygon({ CATCOV: 1 }, WEST_HALF),
    ]);
    const neighbors = writeCollection("quilting_neighbors.geojson", [
      polygon({ QFLOOR: 4 }, EAST_HALF),
    ]);

    expect(
      hasMeridian(
        run(
          "--area",
          `ADMARE:${areas}`,
          "--cell-coverage",
          cover,
          "--neighbor-coverage",
          neighbors,
        ),
      ),
    ).toBe(true);
  });
});

describe("the edge of all charted data (--neighbor-coverage)", () => {
  // The measured Bering Strait defect: US2ARCEC's data limit follows the
  // US/Russia treaty line, its EXEZNE (EEZ) boundary is bit-identical with
  // it, and the unconditional cell-ring drop erased the EEZ line from the map
  // entirely -- there is no chart west of that line for the area to continue
  // into. With the neighbour roster supplied, the drop keeps only the borders
  // some chart actually continues across.

  test("a truncated boundary STANDS where no chart lies beyond", () => {
    // The cell's ring is the west half; a neighbour continues across the
    // MERIDIAN only. The area's western edge (x = 0) faces void: it is the
    // charted end of the area and keeps its line. The meridian edge is a
    // real chart border and stays dropped.
    const areas = writeCollection("EXEZNE.geojson", [
      polygon({ NATION: "US" }, WEST_HALF),
    ]);
    const cover = writeCollection("M_COVR.geojson", [
      polygon({ CATCOV: 1 }, WEST_HALF),
    ]);
    const neighbors = writeCollection("quilting_neighbors.geojson", [
      polygon({ QFLOOR: 4 }, EAST_HALF),
    ]);

    const features = run(
      "--area",
      `EXEZNE:${areas}`,
      "--cell-coverage",
      cover,
      "--neighbor-coverage",
      neighbors,
    );

    expect(hasMeridian(features)).toBe(false);
    const westRuns = features.flatMap((f) => {
      const line = f.geometry.coordinates;
      const runs = [];
      for (let i = 1; i < line.length; i++) {
        if (line[i - 1][0] === 0 && line[i][0] === 0) runs.push(1);
      }
      return runs;
    });
    expect(westRuns.length).toBeGreaterThan(0);
    expect(features.every((f) => f.properties.CLASS === "EXEZNE")).toBe(true);
  });

  test("the cell's OWN rows in the roster change nothing", () => {
    // s57-to-tiles exports the region roster unfiltered, own cell included.
    // The probe steps OUTSIDE the ring it stands on, so the own polygon can
    // never claim continuation across its own edge.
    const areas = writeCollection("EXEZNE.geojson", [
      polygon({ NATION: "US" }, WEST_HALF),
    ]);
    const cover = writeCollection("M_COVR.geojson", [
      polygon({ CATCOV: 1 }, WEST_HALF),
    ]);
    const neighbors = writeCollection("quilting_neighbors.geojson", [
      polygon({ QFLOOR: 5 }, WEST_HALF), // the cell itself
      polygon({ QFLOOR: 4 }, EAST_HALF), // the real neighbour
    ]);

    const features = run(
      "--area",
      `EXEZNE:${areas}`,
      "--cell-coverage",
      cover,
      "--neighbor-coverage",
      neighbors,
    );

    expect(hasMeridian(features)).toBe(false);
    expect(features.length).toBeGreaterThan(0);
  });

  test("one-sided multi-owner truncations obey the same refinement", () => {
    // The two rules compose: overlapping owners truncated together drop at a
    // border a chart continues across, and stand where nothing does.
    const areas = writeCollection("ADMARE.geojson", [
      polygon({ JRSDTN: 2, NATION: "US" }, WEST_HALF),
      polygon({ JRSDTN: 3, INFORM: "Alaska" }, WEST_HALF),
    ]);
    const cover = writeCollection("M_COVR.geojson", [
      polygon({ CATCOV: 1 }, WEST_HALF),
    ]);
    const neighbors = writeCollection("quilting_neighbors.geojson", [
      polygon({ QFLOOR: 4 }, EAST_HALF),
    ]);

    const features = run(
      "--area",
      `ADMARE:${areas}`,
      "--cell-coverage",
      cover,
      "--neighbor-coverage",
      neighbors,
    );

    // The meridian is continued into by the neighbour: dropped. The west,
    // north and south runs face void: kept, once per side.
    expect(hasMeridian(features)).toBe(false);
    expect(features).toHaveLength(2);
    expect(features.map((f) => f.properties.JRSDTN).sort()).toEqual([2, 3]);
  });

  test("without the roster the drop stays unconditional (legacy)", () => {
    const areas = writeCollection("EXEZNE.geojson", [
      polygon({ NATION: "US" }, WEST_HALF),
    ]);
    const cover = writeCollection("M_COVR.geojson", [
      polygon({ CATCOV: 1 }, WEST_HALF),
    ]);

    expect(run("--area", `EXEZNE:${areas}`, "--cell-coverage", cover)).toEqual(
      [],
    );
  });

  test("a genuine quilt cut still drops: the finer chart is in the roster", () => {
    // The clip put the finer chart on the far side of the cut, so the probe
    // finds it and the drop holds exactly as it did unconditionally.
    const areas = writeCollection("RESARE.geojson", [
      polygon({ RESTRN: "7" }, WEST_HALF),
    ]);
    const coverage = writeCollection("quilting_coverage.geojson", [
      polygon({ INTU: 6, QFLOOR: 9 }, EAST_HALF),
    ]);
    const neighbors = writeCollection("quilting_neighbors.geojson", [
      polygon({ QFLOOR: 9 }, EAST_HALF),
    ]);

    const features = run(
      "--area",
      `RESARE:${areas}`,
      "--coverage",
      coverage,
      "--neighbor-coverage",
      neighbors,
    );

    expect(features.length).toBeGreaterThan(0);
    expect(hasMeridian(features)).toBe(false);
  });

  test("a finer ring along the SAME charted end keeps the line (US3AK89M)", () => {
    // The finer chart's coverage stops at the same real limit this cell's
    // area does -- the treaty-line coincidence between US3AK89M and
    // US2ARCEC's EXEZNE. The segment lies along the finer ring, but void is
    // beyond it: a charted end, not a cut.
    const areas = writeCollection("EXEZNE.geojson", [
      polygon({ NATION: "US" }, WEST_HALF),
    ]);
    const coverage = writeCollection("quilting_coverage.geojson", [
      polygon({ INTU: 6, QFLOOR: 9 }, WEST_HALF),
    ]);
    const neighbors = writeCollection("quilting_neighbors.geojson", [
      polygon({ QFLOOR: 9 }, WEST_HALF),
    ]);

    const features = run(
      "--area",
      `EXEZNE:${areas}`,
      "--coverage",
      coverage,
      "--neighbor-coverage",
      neighbors,
    );

    // Nothing lies beyond any edge of the shared footprint: the whole outline
    // stands.
    expect(features).toHaveLength(1);
    expect(hasMeridian(features)).toBe(true);
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

  test("the maritime jurisdiction limits are styled AND participate", () => {
    // The Bering Strait regression, pinned by name: the EEZ and its sibling
    // zone limits are AREA classes whose whole presentation is the boundary
    // line, so if one drops out of the style or out of the participating set
    // the limit vanishes from the map entirely -- the facade latches the
    // per-polygon originals dark wherever _AREA_EDGE exists. STSLNE is the
    // family's LINE class (the baseline itself), drawn from its own layer and
    // deliberately NOT a participant.
    const MARITIME_LIMITS = [
      "ADMARE",
      "CONZNE",
      "COSARE",
      "CUSZNE",
      "EXEZNE",
      "FSHZNE",
      "TESARE",
    ];
    const listed = execFileSync(process.execPath, [SCRIPT, "--list-classes"], {
      encoding: "utf8",
    })
      .trim()
      .split("\n");
    for (const obcl of MARITIME_LIMITS) {
      expect(listed).toContain(obcl);
    }
    expect(listed).not.toContain("STSLNE");

    for (const boundaries of ["plain", "symbolized"]) {
      const style = createStyle({
        source: { type: "vector", url: "unused" },
        boundaries,
      });
      for (const obcl of MARITIME_LIMITS) {
        const lines = style.layers.filter(
          (layer) =>
            layer.metadata?.s52?.obcl === obcl && layer.type === "line",
        );
        expect([boundaries, obcl, lines.length > 0]).toEqual([
          boundaries,
          obcl,
          true,
        ]);
      }
      // The baseline draws too, from its own line layer.
      expect(
        style.layers.some(
          (layer) =>
            layer.metadata?.s52?.obcl === "STSLNE" && layer.type === "line",
        ),
      ).toBe(true);
    }
  });
});
