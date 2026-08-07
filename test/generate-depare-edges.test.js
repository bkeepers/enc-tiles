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

describe("the zoom partition", () => {
  /** The features of one interval, keyed by its _QZMIN. */
  function byFloor(features) {
    const groups = new Map();
    for (const feature of features) {
      const floor = feature.properties._QZMIN ?? null;
      const bucket = groups.get(floor);
      if (bucket) bucket.push(feature);
      else groups.set(floor, [feature]);
    }
    return groups;
  }

  test("the copies of one depth area are hashed apart", () => {
    // Sharing one hash across the intervals is not a duplicate-output problem
    // but a silent deletion: the copies coincide wherever the finer mask did
    // not cut them, the shared segment collects DRVAL1 = 20 twice, reads as an
    // interface between two areas of equal depth, and is dropped -- taking the
    // cell-ring seam out of BOTH intervals at once.
    const depare = writeCollection("DEPARE.geojson", [
      polygon({ DRVAL1: 20, _QZMIN: 6, _QZMAX: 8 }, CELL_RING),
      polygon({ DRVAL1: 20, _QZMIN: 9 }, CELL_RING, GAP_RING),
    ]);
    const cover = writeCollection("M_COVR.geojson", [
      polygon({ CATCOV: 1 }, CELL_RING),
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

    const intervals = byFloor(features);
    expect([...intervals.keys()]).toEqual([6, 9]);
    for (const feature of features) {
      expect(feature.properties.SEAM).toBe(1);
      expect(feature.properties.DRVAL_HI).toBe(20);
      expect(feature.properties).not.toHaveProperty("DRVAL_LO");
    }
    for (const feature of intervals.get(6)) {
      expect(feature.properties._QZMAX).toBe(8);
    }
    for (const feature of intervals.get(9)) {
      expect(feature.properties).not.toHaveProperty("_QZMAX");
    }

    // The whole copy is uncut, so nothing of it lies inside the finer chart's
    // footprint; the top copy's cut boundary is exactly that ring.
    const inGap = ([x, y]) => x >= 0.2 && x <= 0.8 && y >= 0.2 && y <= 0.8;
    const cuts = (bucket) =>
      bucket.filter((f) => f.geometry.coordinates.every(inGap)).length;
    expect(cuts(intervals.get(6))).toBe(0);
    expect(cuts(intervals.get(9))).toBeGreaterThan(0);
  });

  test("the whole copy needs the cell ring UNCLIPPED", () => {
    // M_COVR is exempt from the ladder, so the ring arrives whole. The whole
    // copy is uncut and ends at the cell's own border even where a finer chart
    // overlaps it -- the stretch of border under `higher` here -- and a ring
    // clipped back off that stretch would read those edges as land and paint
    // the safety contour down them.
    const depare = writeCollection("DEPARE.geojson", [
      polygon({ DRVAL1: 20, _QZMIN: 6, _QZMAX: 8 }, CELL_RING),
    ]);
    const cover = writeCollection("M_COVR.geojson", [
      polygon({ CATCOV: 1 }, CELL_RING),
    ]);
    const higher = writeCollection("quilting_coverage.geojson", [
      polygon({ INTU: 6 }, [
        [0.4, -0.2],
        [0.6, -0.2],
        [0.6, 0.5],
        [0.4, 0.5],
        [0.4, -0.2],
      ]),
    ]);

    const features = run(
      "--depth-area",
      depare,
      "--cell-coverage",
      cover,
      "--coverage",
      higher,
    );

    expect(features.length).toBeGreaterThan(0);
    for (const feature of features) {
      expect(feature.properties.SEAM).toBe(1);
      expect(feature.properties._QZMIN).toBe(6);
    }
  });

  test("a coastline grazing a coverage ring keeps DRVAL_LO = -1", () => {
    // The coverage import widens under the partition to EVERY other chart, so
    // a ring can now cross this cell over land that no clip ever touched. The
    // midpoint of the southern edge here sits on such a ring; both endpoints
    // do not, and the segment is a real coastline.
    const depare = writeCollection("DEPARE.geojson", [
      polygon({ DRVAL1: 20 }, [
        [0.3, 0.5],
        [0.5, 0.5],
        [0.4, 0.7],
        [0.3, 0.5],
      ]),
    ]);
    const coverage = writeCollection("quilting_coverage.geojson", [
      polygon({ INTU: 3 }, [
        [0.4, 0.2],
        [0.6, 0.2],
        [0.6, 0.8],
        [0.4, 0.8],
        [0.4, 0.2],
      ]),
    ]);

    const features = run("--depth-area", depare, "--coverage", coverage);

    expect(features.length).toBeGreaterThan(0);
    for (const feature of features) {
      expect(feature.properties.DRVAL_LO).toBe(-1);
      expect(feature.properties).not.toHaveProperty("SEAM");
    }
  });

  test("a contour labels the edges of its own interval", () => {
    const depare = writeCollection("DEPARE.geojson", [
      polygon({ DRVAL1: 5, _QZMIN: 6, _QZMAX: 8 }, WEST_HALF),
      polygon({ DRVAL1: 20, _QZMIN: 6, _QZMAX: 8 }, EAST_HALF),
      polygon({ DRVAL1: 5, _QZMIN: 9 }, WEST_HALF),
      polygon({ DRVAL1: 20, _QZMIN: 9 }, EAST_HALF),
    ]);
    const depcnt = writeCollection("DEPCNT.geojson", [
      {
        type: "Feature",
        properties: { VALDCO: 10, _QZMIN: 9 },
        geometry: {
          type: "LineString",
          coordinates: [
            [0.5, 0],
            [0.5, 1],
          ],
        },
      },
    ]);
    const cover = writeCollection("M_COVR.geojson", [
      polygon({ CATCOV: 1 }, CELL_RING),
    ]);

    const features = run(
      "--depth-area",
      depare,
      "--contour",
      depcnt,
      "--cell-coverage",
      cover,
    );

    const interfaces = features.filter((f) => f.properties.DRVAL_LO === 5);
    expect(interfaces).toHaveLength(2);
    const labelled = interfaces.filter((f) => f.properties.VALDCO === 10);
    expect(labelled).toHaveLength(1);
    expect(labelled[0].properties._QZMIN).toBe(9);
  });

  test("an unpartitioned input carries nothing new", () => {
    const depare = writeCollection("DEPARE.geojson", [
      polygon({ DRVAL1: 20 }, CELL_RING),
    ]);
    const cover = writeCollection("M_COVR.geojson", [
      polygon({ CATCOV: 1 }, CELL_RING),
    ]);

    const features = run("--depth-area", depare, "--cell-coverage", cover);

    expect(features.length).toBeGreaterThan(0);
    for (const feature of features) {
      for (const name of ["_QZMIN", "_QZMAX", "_QFALL"]) {
        expect(feature.properties).not.toHaveProperty(name);
      }
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
