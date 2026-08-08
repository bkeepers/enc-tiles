/**
 * Fixture runs of bin/generate-buaare-edges.
 *
 * The script is invoked the way bin/s57-to-tiles invokes it -- as a child
 * process over GeoJSON files -- because that is the whole of its contract.
 *
 * The defect it exists to remove: a town spanning two charts is drawn cut in
 * half down the cell border, because the import-time dissolve that unions the
 * fragments of one name can only see one cell at a time.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const SCRIPT = fileURLToPath(
  new URL("../bin/generate-buaare-edges", import.meta.url),
);

let work;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "buaare-edges-"));
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

/** Whether any emitted line runs ALONG the shared meridian. */
function hasMeridian(features) {
  return features.some((feature) => {
    const line = feature.geometry.coordinates;
    for (let i = 1; i < line.length; i++) {
      if (line[i - 1][0] === 0.5 && line[i][0] === 0.5) return true;
    }
    return false;
  });
}

describe("what counts as the same place", () => {
  test("two fragments of ONE town share no edge at all", () => {
    // The interior split the import-time dissolve is aimed at, proved here as
    // well: even undissolved, two fragments of one name draw no line between
    // them, and the outer ring is all cell boundary.
    const areas = writeCollection("BUAARE.geojson", [
      polygon({ OBJNAM: "Seattle" }, WEST_HALF),
      polygon({ OBJNAM: "Seattle" }, EAST_HALF),
    ]);
    const cover = writeCollection("M_COVR.geojson", [
      polygon({ CATCOV: 1 }, CELL_RING),
    ]);

    expect(run("--built-up", areas, "--cell-coverage", cover)).toEqual([]);
  });

  test("two DIFFERENTLY named towns keep the line between them", () => {
    const areas = writeCollection("BUAARE.geojson", [
      polygon({ OBJNAM: "Seattle" }, WEST_HALF),
      polygon({ OBJNAM: "Bellevue" }, EAST_HALF),
    ]);
    const cover = writeCollection("M_COVR.geojson", [
      polygon({ CATCOV: 1 }, CELL_RING),
    ]);

    const features = run("--built-up", areas, "--cell-coverage", cover);

    expect(features).toHaveLength(1);
    expect(features[0].geometry.coordinates).toEqual([
      [0.5, 0],
      [0.5, 1],
    ]);
  });

  test("NULL beside NULL is a line: two unnamed areas are not known-same", () => {
    // The rule the import-time dissolve states the other way round, by leaving
    // unnamed areas completely alone. "Both have no name" is not evidence.
    const areas = writeCollection("BUAARE.geojson", [
      polygon({}, WEST_HALF),
      polygon({ OBJNAM: null }, EAST_HALF),
    ]);
    const cover = writeCollection("M_COVR.geojson", [
      polygon({ CATCOV: 1 }, CELL_RING),
    ]);

    expect(
      hasMeridian(run("--built-up", areas, "--cell-coverage", cover)),
    ).toBe(true);
  });

  test("NULL beside a named area is a line too", () => {
    const areas = writeCollection("BUAARE.geojson", [
      polygon({ OBJNAM: "Seattle" }, WEST_HALF),
      polygon({ OBJNAM: "" }, EAST_HALF),
    ]);
    const cover = writeCollection("M_COVR.geojson", [
      polygon({ CATCOV: 1 }, CELL_RING),
    ]);

    expect(
      hasMeridian(run("--built-up", areas, "--cell-coverage", cover)),
    ).toBe(true);
  });

  test("a town beside no built-up area at all keeps its whole outline", () => {
    // Nearly all of this layer: the ordinary outline, with nothing on the far
    // side of it and no cell ring anywhere near.
    const areas = writeCollection("BUAARE.geojson", [
      polygon({ OBJNAM: "Seattle" }, WEST_HALF),
    ]);

    const features = run("--built-up", areas);

    expect(features).toHaveLength(1);
    expect(features[0].geometry.coordinates).toHaveLength(WEST_HALF.length);
  });
});

describe("chart boundaries are dropped, not drawn", () => {
  test("a town truncated by the cell edge draws nothing along it", () => {
    // The whole defect. The town continues into the next cell, which draws its
    // half; the outline is deliberately left open at the border.
    const areas = writeCollection("BUAARE.geojson", [
      polygon({ OBJNAM: "Seattle" }, CELL_RING),
    ]);
    const cover = writeCollection("M_COVR.geojson", [
      polygon({ CATCOV: 1 }, CELL_RING),
    ]);

    expect(run("--built-up", areas, "--cell-coverage", cover)).toEqual([]);
  });

  test("an UNNAMED area truncated by the cell edge is dropped too", () => {
    // The rule is about evidence, not about names: with one owner and the far
    // side on another chart, this cell knows nothing either way. Documented
    // because it is the one place the NULL-vs-NULL rule does NOT apply -- there
    // is no second side here to be unequal to.
    const areas = writeCollection("BUAARE.geojson", [
      polygon({ OBJNAM: null }, CELL_RING),
    ]);
    const cover = writeCollection("M_COVR.geojson", [
      polygon({ CATCOV: 1 }, CELL_RING),
    ]);

    expect(run("--built-up", areas, "--cell-coverage", cover)).toEqual([]);
  });

  test("without --cell-coverage the same edges come back", () => {
    // The negative control: the drop is the coverage input doing its job, not
    // the classifier losing the segments some other way.
    const areas = writeCollection("BUAARE.geojson", [
      polygon({ OBJNAM: "Seattle" }, CELL_RING),
    ]);

    expect(run("--built-up", areas)).toHaveLength(1);
  });

  test("a border segment THIS cell holds both sides of keeps its line", () => {
    // Suppression is only for the segments the cell has no evidence about. Two
    // owners means both sides are in this export, and a coverage ring running
    // along an interior boundary does not take that evidence away.
    const areas = writeCollection("BUAARE.geojson", [
      polygon({ OBJNAM: "Seattle" }, WEST_HALF),
      polygon({ OBJNAM: "Bellevue" }, EAST_HALF),
    ]);
    const cover = writeCollection("M_COVR.geojson", [
      polygon({ CATCOV: 1 }, WEST_HALF),
    ]);

    expect(
      hasMeridian(run("--built-up", areas, "--cell-coverage", cover)),
    ).toBe(true);
  });

  test("a quilt cut against a finer chart is dropped too", () => {
    const areas = writeCollection("BUAARE.geojson", [
      polygon({ OBJNAM: "Seattle" }, WEST_HALF),
    ]);
    const coverage = writeCollection("quilting_coverage.geojson", [
      polygon({ INTU: 6 }, EAST_HALF),
    ]);

    const features = run("--built-up", areas, "--coverage", coverage);

    expect(features.length).toBeGreaterThan(0);
    expect(hasMeridian(features)).toBe(false);
  });

  test("a CATCOV = 2 gap is not a cell edge", () => {
    // The no-coverage ring is a real boundary, so an area that ends at it keeps
    // its line. Only CATCOV = 1 exteriors are indexed.
    const areas = writeCollection("BUAARE.geojson", [
      polygon({ OBJNAM: "Seattle" }, WEST_HALF),
    ]);
    const cover = writeCollection("M_COVR.geojson", [
      polygon({ CATCOV: 2 }, WEST_HALF),
    ]);

    expect(run("--built-up", areas, "--cell-coverage", cover)).toHaveLength(1);
  });
});

describe("the zoom partition", () => {
  test("each interval is classified and chained on its OWN segments", () => {
    // Two copies of one pair, one per interval of the copy ladder. A shared
    // hash would collect "Seattle" twice on the coincident meridian, read it as
    // one town on both sides, and delete the edge from BOTH intervals.
    const areas = writeCollection("BUAARE.geojson", [
      polygon({ OBJNAM: "Seattle", _QZMIN: 8, _QZMAX: 9 }, WEST_HALF),
      polygon({ OBJNAM: "Bellevue", _QZMIN: 8, _QZMAX: 9 }, EAST_HALF),
      polygon({ OBJNAM: "Seattle", _QZMIN: 10 }, WEST_HALF),
      polygon({ OBJNAM: "Bellevue", _QZMIN: 10 }, EAST_HALF),
    ]);
    const cover = writeCollection("M_COVR.geojson", [
      polygon({ CATCOV: 1 }, CELL_RING),
    ]);

    const features = run("--built-up", areas, "--cell-coverage", cover);

    expect(features).toHaveLength(2);
    // The range travels onto the output, for bin/stamp-quilt-zooms to convert.
    expect(
      features.map((f) => f.properties._QZMIN).sort((a, b) => a - b),
    ).toEqual([8, 10]);
    expect(
      features.find((f) => f.properties._QZMIN === 8).properties._QZMAX,
    ).toBe(9);
  });

  test("a fallback continuation carries _QFALL onto its edges", () => {
    const areas = writeCollection("BUAARE.geojson", [
      polygon({ OBJNAM: "Seattle", _QZMAX: 5, _QFALL: 1 }, WEST_HALF),
      polygon({ OBJNAM: "Bellevue", _QZMAX: 5, _QFALL: 1 }, EAST_HALF),
    ]);
    const cover = writeCollection("M_COVR.geojson", [
      polygon({ CATCOV: 1 }, CELL_RING),
    ]);

    const features = run("--built-up", areas, "--cell-coverage", cover);

    expect(features).toHaveLength(1);
    expect(features[0].properties._QFALL).toBe(1);
    expect(features[0].properties._QZMAX).toBe(5);
  });
});

describe("nothing to say", () => {
  test("a BUAARE file with no features writes an empty collection", () => {
    expect(run("--built-up", writeCollection("BUAARE.geojson", []))).toEqual(
      [],
    );
  });
});
