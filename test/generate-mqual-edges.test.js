/**
 * Fixture runs of bin/generate-mqual-edges.
 *
 * The script is invoked the way bin/s57-to-tiles invokes it -- as a child
 * process over GeoJSON files -- because that is the whole of its contract.
 *
 * The defect it exists to remove: identical-quality zones split at a chart
 * boundary drew a line down the split, so one survey came out ruled into one
 * box per cell.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const SCRIPT = fileURLToPath(
  new URL("../bin/generate-mqual-edges", import.meta.url),
);

let work;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "mqual-edges-"));
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

/** The only thing the layer says, as a comparable pair. */
const zoc = (feature) => [
  feature.properties.CATZOC_LO,
  feature.properties.CATZOC_HI,
];

describe("only a change in confidence is an edge", () => {
  test("two zones of the SAME CATZOC share no edge at all", () => {
    // The interior split: one survey digitised as two polygons. Every segment
    // of the shared meridian is owned twice at CATZOC 2, and the outer ring is
    // all cell boundary.
    const quality = writeCollection("M_QUAL.geojson", [
      polygon({ CATZOC: 2 }, WEST_HALF),
      polygon({ CATZOC: 2 }, EAST_HALF),
    ]);
    const cover = writeCollection("M_COVR.geojson", [
      polygon({ CATCOV: 1 }, CELL_RING),
    ]);

    expect(run("--quality", quality, "--cell-coverage", cover)).toEqual([]);
  });

  test("two zones of DIFFERENT CATZOC share one, carrying both values", () => {
    const quality = writeCollection("M_QUAL.geojson", [
      polygon({ CATZOC: 1 }, WEST_HALF),
      polygon({ CATZOC: 4 }, EAST_HALF),
    ]);
    const cover = writeCollection("M_COVR.geojson", [
      polygon({ CATCOV: 1 }, CELL_RING),
    ]);

    const features = run("--quality", quality, "--cell-coverage", cover);

    expect(features).toHaveLength(1);
    // Chained back into the whole meridian, not left as loose segments.
    expect(features[0].geometry.coordinates).toEqual([
      [0.5, 0],
      [0.5, 1],
    ]);
    // LO is the better-surveyed side, which is the LOWER S-57 number.
    expect(zoc(features[0])).toEqual([1, 4]);
  });

  test("a zone beside no zone at all keeps its edge, with LO absent", () => {
    // Nothing is unsurveyed here by accident: the far side of this boundary
    // carries no M_QUAL, and -1 is how the layer says so.
    const quality = writeCollection("M_QUAL.geojson", [
      polygon({ CATZOC: 3 }, WEST_HALF),
    ]);

    const features = run("--quality", quality);

    expect(features).toHaveLength(1);
    expect(zoc(features[0])).toEqual([-1, 3]);
  });

  test("a zone with no CATZOC states the same nothing as no zone", () => {
    // Two unassessed polygons side by side both read -1, agree, and draw no
    // line between them -- while the assessed neighbour of an unassessed one
    // still gets its boundary.
    const quality = writeCollection("M_QUAL.geojson", [
      polygon({}, WEST_HALF),
      polygon({}, EAST_HALF),
    ]);
    const cover = writeCollection("M_COVR.geojson", [
      polygon({ CATCOV: 1 }, CELL_RING),
    ]);

    expect(run("--quality", quality, "--cell-coverage", cover)).toEqual([]);
  });
});

describe("chart boundaries are dropped, not drawn", () => {
  test("a zone truncated by the cell edge draws nothing along it", () => {
    // The whole defect. The survey continues into the next cell at the same
    // CATZOC; this cell cannot see that, and must not assert a change.
    const quality = writeCollection("M_QUAL.geojson", [
      polygon({ CATZOC: 2 }, CELL_RING),
    ]);
    const cover = writeCollection("M_COVR.geojson", [
      polygon({ CATCOV: 1 }, CELL_RING),
    ]);

    expect(run("--quality", quality, "--cell-coverage", cover)).toEqual([]);
  });

  test("without --cell-coverage the same edges come back", () => {
    // The negative control: the drop is the coverage input doing its job, not
    // the classifier losing the segments some other way.
    const quality = writeCollection("M_QUAL.geojson", [
      polygon({ CATZOC: 2 }, CELL_RING),
    ]);

    const features = run("--quality", quality);

    expect(features).toHaveLength(1);
    expect(zoc(features[0])).toEqual([-1, 2]);
  });

  test("a quilt cut against a finer chart is dropped too", () => {
    const quality = writeCollection("M_QUAL.geojson", [
      polygon({ CATZOC: 2 }, WEST_HALF),
    ]);
    // The finer chart's ring runs along the meridian the clip cut.
    const coverage = writeCollection("quilting_coverage.geojson", [
      polygon({ INTU: 6 }, EAST_HALF),
    ]);

    const features = run("--quality", quality, "--coverage", coverage);

    // Three sides of the west half are on no ring and survive -- their ends
    // still touch x = 0.5 -- but the meridian itself is the cut and is gone.
    expect(features.length).toBeGreaterThan(0);
    for (const feature of features) {
      const line = feature.geometry.coordinates;
      for (let i = 1; i < line.length; i++) {
        expect([line[i - 1][0], line[i][0]]).not.toEqual([0.5, 0.5]);
      }
    }
  });

  test("a boundary that only TOUCHES the cell ring keeps its line", () => {
    // A zone boundary running INTO the cell from its border is real. Only a
    // segment lying ALONG the ring -- both ends and its midpoint -- is a chart
    // artefact, which is why the midpoint is tested at all.
    const quality = writeCollection("M_QUAL.geojson", [
      polygon({ CATZOC: 1 }, WEST_HALF),
      polygon({ CATZOC: 5 }, EAST_HALF),
    ]);
    const cover = writeCollection("M_COVR.geojson", [
      polygon({ CATCOV: 1 }, CELL_RING),
    ]);

    const features = run("--quality", quality, "--cell-coverage", cover);

    // The meridian touches the ring at both of its ENDS and is kept anyway.
    expect(features).toHaveLength(1);
    expect(zoc(features[0])).toEqual([1, 5]);
  });

  test("a CATCOV = 2 gap is not a cell edge", () => {
    // The no-coverage ring is a real boundary of the survey, so a zone that
    // ends at it keeps its line. Only CATCOV = 1 exteriors are indexed.
    const quality = writeCollection("M_QUAL.geojson", [
      polygon({ CATZOC: 2 }, WEST_HALF),
    ]);
    const cover = writeCollection("M_COVR.geojson", [
      polygon({ CATCOV: 2 }, WEST_HALF),
    ]);

    const features = run("--quality", quality, "--cell-coverage", cover);

    expect(features).toHaveLength(1);
    expect(zoc(features[0])).toEqual([-1, 2]);
  });
});

describe("the zoom partition", () => {
  test("each interval is classified and chained on its OWN segments", () => {
    // Two copies of one zone pair, one per interval of the copy ladder. Shared
    // hashing would collect CATZOC 1 twice on the coincident meridian, read it
    // as an interface of equal quality, and delete the edge from BOTH.
    const quality = writeCollection("M_QUAL.geojson", [
      polygon({ CATZOC: 1, _QZMIN: 8, _QZMAX: 9 }, WEST_HALF),
      polygon({ CATZOC: 4, _QZMIN: 8, _QZMAX: 9 }, EAST_HALF),
      polygon({ CATZOC: 1, _QZMIN: 10 }, WEST_HALF),
      polygon({ CATZOC: 4, _QZMIN: 10 }, EAST_HALF),
    ]);
    const cover = writeCollection("M_COVR.geojson", [
      polygon({ CATCOV: 1 }, CELL_RING),
    ]);

    const features = run("--quality", quality, "--cell-coverage", cover);

    expect(features).toHaveLength(2);
    for (const feature of features) {
      expect(zoc(feature)).toEqual([1, 4]);
    }
    // The range travels onto the output, for bin/stamp-quilt-zooms to convert.
    expect(
      features.map((f) => f.properties._QZMIN).sort((a, b) => a - b),
    ).toEqual([8, 10]);
    expect(
      features.find((f) => f.properties._QZMIN === 8).properties._QZMAX,
    ).toBe(9);
    expect(
      features.find((f) => f.properties._QZMIN === 10).properties,
    ).not.toHaveProperty("_QZMAX");
  });

  test("a fallback continuation carries _QFALL onto its edges", () => {
    const quality = writeCollection("M_QUAL.geojson", [
      polygon({ CATZOC: 2, _QZMAX: 5, _QFALL: 1 }, WEST_HALF),
      polygon({ CATZOC: 6, _QZMAX: 5, _QFALL: 1 }, EAST_HALF),
    ]);
    const cover = writeCollection("M_COVR.geojson", [
      polygon({ CATCOV: 1 }, CELL_RING),
    ]);

    const features = run("--quality", quality, "--cell-coverage", cover);

    expect(features).toHaveLength(1);
    expect(features[0].properties._QFALL).toBe(1);
    expect(features[0].properties._QZMAX).toBe(5);
  });
});

describe("nothing to say", () => {
  test("an M_QUAL file with no features writes an empty collection", () => {
    const quality = writeCollection("M_QUAL.geojson", []);

    expect(run("--quality", quality)).toEqual([]);
  });
});
