/**
 * Fixture runs of bin/generate-mqual-labels.
 *
 * The script is invoked the way bin/s57-to-tiles invokes it -- as a child
 * process over GeoJSON files -- because that is the whole of its contract.
 *
 * The defect it exists to remove: the CATZOC letter drawn once per M_QUAL
 * POLYGON, so one survey digitised as four patches is lettered "A2" four times
 * inside what _MQUAL_EDGE has just shown the reader is one unbroken zone.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const SCRIPT = fileURLToPath(
  new URL("../bin/generate-mqual-labels", import.meta.url),
);

let work;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "mqual-labels-"));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

/** A rectangle, as a closed ring. */
function box(x0, y0, x1, y1) {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
  ];
}

/** The two halves of the unit square, sharing the meridian at x = 0.5. */
const WEST_HALF = box(0, 0, 0.5, 1);
const EAST_HALF = box(0.5, 0, 1, 1);

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
  const output = join(work, "labels.geojson");
  execFileSync(process.execPath, [SCRIPT, output, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(readFileSync(output, "utf8")).features;
}

function labels(features) {
  const path = writeCollection("M_QUAL.geojson", features);
  return run("--quality", path);
}

/** Ray-casting point-in-ring, written here so the test proves it independently. */
function inRing(point, ring) {
  let inside = false;
  for (let i = 1; i < ring.length; i++) {
    const [x0, y0] = ring[i - 1];
    const [x1, y1] = ring[i];
    if (y0 > point[1] !== y1 > point[1]) {
      const x = x0 + ((point[1] - y0) * (x1 - x0)) / (y1 - y0);
      if (x > point[0]) inside = !inside;
    }
  }
  return inside;
}

describe("one letter per zone, not per polygon", () => {
  test("two touching fragments of one CATZOC are one anchor", () => {
    // The whole defect: one survey, two polygons, and the letter drawn twice.
    const features = labels([
      polygon({ CATZOC: 2 }, WEST_HALF),
      polygon({ CATZOC: 2 }, EAST_HALF),
    ]);

    expect(features).toHaveLength(1);
    expect(features[0].properties.CATZOC).toBe(2);
  });

  test("a CHAIN of touching fragments is still one anchor", () => {
    // Contiguity is transitive: the first and last thirds do not touch each
    // other at all, and the union-find is what joins them through the middle.
    const features = labels([
      polygon({ CATZOC: 3 }, box(0, 0, 1, 1)),
      polygon({ CATZOC: 3 }, box(1, 0, 2, 1)),
      polygon({ CATZOC: 3 }, box(2, 0, 3, 1)),
    ]);

    expect(features).toHaveLength(1);
  });

  test("touching zones of DIFFERENT CATZOC are two anchors", () => {
    const features = labels([
      polygon({ CATZOC: 1 }, WEST_HALF),
      polygon({ CATZOC: 4 }, EAST_HALF),
    ]);

    expect(features).toHaveLength(2);
    expect(features.map((f) => f.properties.CATZOC).sort()).toEqual([1, 4]);
  });

  test("two SEPARATE surveys of one CATZOC are two anchors", () => {
    // Equal CATZOC is not enough. Two A2 surveys at opposite ends of the cell
    // are two zones, and the reader needs the letter on each of them.
    const features = labels([
      polygon({ CATZOC: 2 }, box(0, 0, 1, 1)),
      polygon({ CATZOC: 2 }, box(5, 5, 6, 6)),
    ]);

    expect(features).toHaveLength(2);
  });
});

describe("where the anchor goes", () => {
  test("inside the LARGEST member of the group", () => {
    // Not the average of the fragments, which for a ragged zone lands outside
    // all of them; bin/generate-labels makes the same choice for a name.
    const features = labels([
      polygon({ CATZOC: 2 }, box(0, 0, 0.2, 1)),
      polygon({ CATZOC: 2 }, box(0.2, 0, 1, 1)),
    ]);

    expect(features).toHaveLength(1);
    const [x, y] = features[0].geometry.coordinates;
    expect(x).toBeGreaterThan(0.2);
    expect(x).toBeLessThan(1);
    expect(y).toBeCloseTo(0.5, 6);
  });

  test("inside a member the centroid falls outside of", () => {
    // A U-shaped zone: the signed-area centroid lands in the notch between the
    // arms, and the widest-horizontal-span fallback is what puts the anchor
    // back on the polygon. The property under test is exactly that -- the
    // letter is drawn ON the zone it names -- so it is asserted as such.
    const u = [
      [0, 0],
      [3, 0],
      [3, 3],
      [2, 3],
      [2, 1],
      [1, 1],
      [1, 3],
      [0, 3],
      [0, 0],
    ];
    const features = labels([polygon({ CATZOC: 5 }, u)]);

    expect(features).toHaveLength(1);
    const anchor = features[0].geometry.coordinates;
    expect(inRing(anchor, u), `${anchor} is on the zone`).toBe(true);
    // ... and the naive centroid is not, which is what makes this a test.
    expect(inRing([1.5, 1.357142857142857], u)).toBe(false);
  });

  test("AREA is the SUMMED area of the whole group", () => {
    const one = labels([polygon({ CATZOC: 2 }, WEST_HALF)])[0].properties.AREA;
    const both = labels([
      polygon({ CATZOC: 2 }, WEST_HALF),
      polygon({ CATZOC: 2 }, EAST_HALF),
    ])[0].properties.AREA;

    expect(both).toBeCloseTo(one * 2, 6);
  });
});

describe("a zone that states no confidence", () => {
  test("emits an anchor with the CATZOC property ABSENT", () => {
    // Absent, not a sentinel: the style's own fallback letter is what has to
    // draw, and a made-up number here would defeat it.
    const features = labels([polygon({}, WEST_HALF)]);

    expect(features).toHaveLength(1);
    expect(features[0].properties).not.toHaveProperty("CATZOC");
  });

  test("does not merge with an assessed zone it touches", () => {
    const features = labels([
      polygon({ CATZOC: 2 }, WEST_HALF),
      polygon({}, EAST_HALF),
    ]);

    expect(features).toHaveLength(2);
  });
});

describe("the zoom partition", () => {
  test("each interval is its own group, and carries its range", () => {
    // Two copies of one zone, one per interval of the copy ladder. Merged into
    // a single group they would produce one anchor stamped for no interval at
    // all, which draws at every zoom.
    const features = labels([
      polygon({ CATZOC: 2, _QZMIN: 8, _QZMAX: 9 }, WEST_HALF),
      polygon({ CATZOC: 2, _QZMIN: 10 }, WEST_HALF),
    ]);

    expect(features).toHaveLength(2);
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

  test("a fallback continuation carries _QFALL onto its anchor", () => {
    const features = labels([
      polygon({ CATZOC: 2, _QZMAX: 5, _QFALL: 1 }, WEST_HALF),
    ]);

    expect(features).toHaveLength(1);
    expect(features[0].properties._QFALL).toBe(1);
    expect(features[0].properties._QZMAX).toBe(5);
  });

  test("copies of one interval still merge across fragments", () => {
    const features = labels([
      polygon({ CATZOC: 2, _QZMIN: 8 }, WEST_HALF),
      polygon({ CATZOC: 2, _QZMIN: 8 }, EAST_HALF),
    ]);

    expect(features).toHaveLength(1);
  });
});

describe("the tippecanoe member", () => {
  test("every anchor is exempt from dot-dropping", () => {
    // There is exactly ONE anchor per zone. Dropped, the zone loses its letter
    // at that zoom with nothing to fall back on. See bin/s57-to-tiles step 4.
    const features = labels([polygon({ CATZOC: 2 }, WEST_HALF)]);

    expect(features[0].tippecanoe).toEqual({ minzoom: 0 });
  });
});

describe("nothing to say", () => {
  test("an M_QUAL file with no features writes an empty collection", () => {
    expect(labels([])).toEqual([]);
  });
});
