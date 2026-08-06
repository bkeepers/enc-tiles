/**
 * Fixture runs of bin/generate-depare-edges.
 *
 * The script is invoked the way bin/s57-to-tiles invokes it -- as a child
 * process over GeoJSON files -- because that is the whole of its contract.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const SCRIPT = fileURLToPath(
  new URL("../bin/generate-depare-edges", import.meta.url),
);

let work;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "depare-edges-"));
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

/** A hole in the middle of the cell, wound the other way. */
const GAP_RING = [
  [0.2, 0.2],
  [0.2, 0.8],
  [0.8, 0.8],
  [0.8, 0.2],
  [0.2, 0.2],
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

describe("the cell's own M_COVR ring", () => {
  test("a depth area truncated by the cell edge is a seam, not land", () => {
    const depare = writeCollection("DEPARE.geojson", [
      polygon({ DRVAL1: 20 }, CELL_RING),
    ]);
    const cover = writeCollection("M_COVR.geojson", [
      polygon({ CATCOV: 1 }, CELL_RING),
    ]);

    const features = run("--depth-area", depare, "--cell-coverage", cover);

    expect(features.length).toBeGreaterThan(0);
    for (const feature of features) {
      expect(feature.properties.SEAM).toBe(1);
      expect(feature.properties).not.toHaveProperty("DRVAL_LO");
      expect(feature.properties.DRVAL_HI).toBe(20);
    }
  });

  test("without --cell-coverage the same edges are labelled land", () => {
    // The measured defect: every cell-ring edge came out DRVAL_LO = -1, which
    // is what painted the safety contour down the seam between cells.
    const depare = writeCollection("DEPARE.geojson", [
      polygon({ DRVAL1: 20 }, CELL_RING),
    ]);

    const features = run("--depth-area", depare);

    expect(features.length).toBeGreaterThan(0);
    for (const feature of features) {
      expect(feature.properties.DRVAL_LO).toBe(-1);
      expect(feature.properties).not.toHaveProperty("SEAM");
    }
  });

  test("a coastline touching the ring at ONE vertex keeps DRVAL_LO = -1", () => {
    // A headland running down to the cell border: two of its segments have an
    // endpoint on the ring, but neither lies ALONG it. Flagging those would
    // erase a real land boundary.
    const depare = writeCollection("DEPARE.geojson", [
      polygon({ DRVAL1: 20 }, [
        [0, 0],
        [1, 0],
        [1, 1],
        [0.5, 1], // on the ring's north edge
        [0.5, 0.5], // inland
        [0, 1], // on the ring's north-west corner
        [0, 0],
      ]),
    ]);
    const cover = writeCollection("M_COVR.geojson", [
      polygon({ CATCOV: 1 }, CELL_RING),
    ]);

    const features = run("--depth-area", depare, "--cell-coverage", cover);

    const land = features.filter((f) => f.properties.DRVAL_LO === -1);
    const seams = features.filter((f) => f.properties.SEAM === 1);

    expect(land).toHaveLength(1);
    expect(land[0].properties).not.toHaveProperty("SEAM");
    // The two coastline segments chain into one line through the apex.
    expect(land[0].geometry.coordinates).toContainEqual([0.5, 0.5]);

    expect(seams.length).toBeGreaterThan(0);
    for (const seam of seams) {
      expect(seam.properties).not.toHaveProperty("DRVAL_LO");
    }
  });

  test("a CATCOV = 2 gap inside the cell is not a coverage boundary", () => {
    // How a no-coverage area really arrives: a hole in the cell's CATCOV = 1
    // polygon, with a CATCOV = 2 polygon filling it. Rejecting the CATCOV = 2
    // feature is not enough on its own -- the hole is a ring of the ACCEPTED
    // polygon, so indexing it puts the same boundary back in and the depth
    // areas ending at the gap lose the safety contour along a real edge.
    const depare = writeCollection("DEPARE.geojson", [
      polygon({ DRVAL1: 20 }, CELL_RING, GAP_RING),
    ]);
    const cover = writeCollection("M_COVR.geojson", [
      polygon({ CATCOV: 1 }, CELL_RING, GAP_RING),
      polygon({ CATCOV: 2 }, GAP_RING),
    ]);

    const features = run("--depth-area", depare, "--cell-coverage", cover);

    const inGap = ([x, y]) => x >= 0.2 && x <= 0.8 && y >= 0.2 && y <= 0.8;
    const gapEdges = features.filter((f) =>
      f.geometry.coordinates.every(inGap),
    );
    const ringEdges = features.filter(
      (f) => !f.geometry.coordinates.every(inGap),
    );

    expect(gapEdges.length).toBeGreaterThan(0);
    for (const edge of gapEdges) {
      expect(edge.properties.DRVAL_LO).toBe(-1);
      expect(edge.properties).not.toHaveProperty("SEAM");
    }

    // The cell's own ring is still a seam, as it was before.
    expect(ringEdges.length).toBeGreaterThan(0);
    for (const edge of ringEdges) {
      expect(edge.properties.SEAM).toBe(1);
      expect(edge.properties).not.toHaveProperty("DRVAL_LO");
    }
  });

  test("a quilt-cut hole in the cell coverage is still a seam", () => {
    // The hole that --coverage owns: a higher-INTU chart cutting the middle
    // out of this one. Dropping holes from the CELL index must not lose it.
    const depare = writeCollection("DEPARE.geojson", [
      polygon({ DRVAL1: 20 }, CELL_RING, GAP_RING),
    ]);
    const cover = writeCollection("M_COVR.geojson", [
      polygon({ CATCOV: 1 }, CELL_RING, GAP_RING),
    ]);
    const higher = writeCollection("quilting_coverage.geojson", [
      polygon({ INTU: 6 }, GAP_RING),
    ]);

    const features = run(
      "--depth-area",
      depare,
      "--cell-coverage",
      cover,
      "--coverage",
      higher,
    );

    for (const feature of features) {
      expect(feature.properties.SEAM).toBe(1);
      expect(feature.properties).not.toHaveProperty("DRVAL_LO");
    }
  });
});

describe("quilt-clip seams still work", () => {
  test("an edge on higher-INTU coverage is flagged without --cell-coverage", () => {
    const hole = [
      [0.2, 0.2],
      [0.8, 0.2],
      [0.8, 0.8],
      [0.2, 0.8],
      [0.2, 0.2],
    ];
    const depare = writeCollection("DEPARE.geojson", [
      polygon({ DRVAL1: 20 }, CELL_RING, hole),
    ]);
    const coverage = writeCollection("quilting_coverage.geojson", [
      polygon({ INTU: 6 }, hole),
    ]);

    const features = run("--depth-area", depare, "--coverage", coverage);

    const seams = features.filter((f) => f.properties.SEAM === 1);
    const land = features.filter((f) => f.properties.DRVAL_LO === -1);
    // The hole is the quilt cut; the outer ring is still the edge of the cell,
    // which without --cell-coverage reads as land.
    expect(seams.length).toBeGreaterThan(0);
    expect(land.length).toBeGreaterThan(0);
    for (const seam of seams) {
      for (const [x, y] of seam.geometry.coordinates) {
        expect(x).toBeGreaterThanOrEqual(0.2);
        expect(x).toBeLessThanOrEqual(0.8);
        expect(y).toBeGreaterThanOrEqual(0.2);
        expect(y).toBeLessThanOrEqual(0.8);
      }
    }
  });

  test("both seam sources apply at once", () => {
    const hole = [
      [0.2, 0.2],
      [0.8, 0.2],
      [0.8, 0.8],
      [0.2, 0.8],
      [0.2, 0.2],
    ];
    const depare = writeCollection("DEPARE.geojson", [
      polygon({ DRVAL1: 20 }, CELL_RING, hole),
    ]);
    const coverage = writeCollection("quilting_coverage.geojson", [
      polygon({ INTU: 6 }, hole),
    ]);
    const cover = writeCollection("M_COVR.geojson", [
      polygon({ CATCOV: 1 }, CELL_RING),
    ]);

    const features = run(
      "--depth-area",
      depare,
      "--coverage",
      coverage,
      "--cell-coverage",
      cover,
    );

    expect(features.length).toBeGreaterThan(0);
    for (const feature of features) {
      expect(feature.properties.SEAM).toBe(1);
    }
  });
});

describe("real interfaces are untouched", () => {
  test("two adjacent depth areas still carry both depths", () => {
    const west = [
      [0, 0],
      [0.5, 0],
      [0.5, 1],
      [0, 1],
      [0, 0],
    ];
    const east = [
      [0.5, 0],
      [1, 0],
      [1, 1],
      [0.5, 1],
      [0.5, 0],
    ];
    const depare = writeCollection("DEPARE.geojson", [
      polygon({ DRVAL1: 5 }, west),
      polygon({ DRVAL1: 20 }, east),
    ]);
    const cover = writeCollection("M_COVR.geojson", [
      polygon({ CATCOV: 1 }, CELL_RING),
    ]);

    const features = run("--depth-area", depare, "--cell-coverage", cover);

    const shared = features.filter((f) => f.properties.DRVAL_LO === 5);
    expect(shared).toHaveLength(1);
    expect(shared[0].properties.DRVAL_HI).toBe(20);
    expect(shared[0].properties).not.toHaveProperty("SEAM");
  });
});
