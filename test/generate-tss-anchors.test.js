/**
 * Fixture runs of bin/generate-tss-anchors.
 *
 * Coordinates sit near the equator so a degree of longitude and a degree of
 * latitude are the same length and the expected spacings are readable: one
 * degree of latitude is 60 nautical miles everywhere.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const SCRIPT = fileURLToPath(
  new URL("../bin/generate-tss-anchors", import.meta.url),
);

let work;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "tss-anchors-"));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

/** An axis-aligned rectangular lane fragment. */
function box(properties, west, south, east, north) {
  return {
    type: "Feature",
    properties,
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [west, south],
          [east, south],
          [east, north],
          [west, north],
          [west, south],
        ],
      ],
    },
  };
}

/**
 * A rectangular lane fragment laid out ALONG a bearing.
 *
 * `t` runs along the bearing and `s` across it, both in degrees of latitude,
 * which near the equator is also degrees of longitude. Fragments of one lane
 * are built from the same bearing whatever ORIENT each of them carries: an
 * encoder quantises the ATTRIBUTE per part, it does not rotate the geometry.
 */
function lane(properties, bearing, tStart, tEnd, halfWidth) {
  const radians = (bearing * Math.PI) / 180;
  const sin = Math.sin(radians);
  const cos = Math.cos(radians);
  const at = (t, s) => [t * sin + s * cos, t * cos - s * sin];
  return {
    type: "Feature",
    properties,
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          at(tStart, -halfWidth),
          at(tEnd, -halfWidth),
          at(tEnd, halfWidth),
          at(tStart, halfWidth),
          at(tStart, -halfWidth),
        ],
      ],
    },
  };
}

/** Where a point falls along `bearing`, for spacing assertions. */
function alongAxis([longitude, latitude], bearing) {
  const radians = (bearing * Math.PI) / 180;
  return longitude * Math.sin(radians) + latitude * Math.cos(radians);
}

function runWithLog(classes) {
  const args = [];
  for (const [className, features] of Object.entries(classes)) {
    const path = join(work, `${className}.geojson`);
    writeFileSync(
      path,
      JSON.stringify({ type: "FeatureCollection", features }),
    );
    args.push("--class", `${className}:${path}`);
  }
  const output = join(work, "anchors.geojson");
  const result = spawnSync(process.execPath, [SCRIPT, output, ...args], {
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return {
    features: JSON.parse(readFileSync(output, "utf8")).features,
    log: result.stderr ?? "",
  };
}

function run(classes) {
  return runWithLog(classes).features;
}

describe("one anchor per lane leg", () => {
  test("two touching fragments with the same ORIENT collapse to one anchor", () => {
    // The defect this layer exists for: S-57 splits one leg into parts with
    // DIFFERENT LNAMs, so nothing downstream can tell they are one lane.
    const features = run({
      TSSLPT: [
        box({ ORIENT: 0 }, 0, 0, 0.01, 0.04),
        box({ ORIENT: 0 }, 0, 0.04, 0.01, 0.1),
      ],
    });

    expect(features).toHaveLength(1);
    expect(features[0].properties.CLASS).toBe("TSSLPT");
    expect(features[0].properties.ORIENT).toBe(0);
    // The summed area of both fragments, not just the one it was placed on.
    expect(features[0].properties.AREA).toBeCloseTo(0.001, 6);
    const [longitude, latitude] = features[0].geometry.coordinates;
    expect(longitude).toBeCloseTo(0.005, 6);
    expect(latitude).toBeCloseTo(0.05, 6);
  });

  test("a near-integer ORIENT difference is still one leg", () => {
    // Encoders leave per-part jitter on a split leg; the key rounds it away.
    const features = run({
      TSSLPT: [
        box({ ORIENT: 0.2 }, 0, 0, 0.01, 0.04),
        box({ ORIENT: 359.8 }, 0, 0.04, 0.01, 0.1),
      ],
    });
    expect(features).toHaveLength(1);
    expect(features[0].properties.ORIENT).toBe(0);
  });

  test("touching fragments with different ORIENT stay two legs", () => {
    // The two lanes of a separation scheme abut and run opposite ways.
    const features = run({
      TSSLPT: [
        box({ ORIENT: 0 }, 0, 0, 0.01, 0.1),
        box({ ORIENT: 180 }, 0.01, 0, 0.02, 0.1),
      ],
    });

    expect(features).toHaveLength(2);
    expect(features.map((f) => f.properties.ORIENT).sort()).toEqual([0, 180]);
  });

  test("fragments that do not touch stay two legs", () => {
    const features = run({
      TSSLPT: [
        box({ ORIENT: 0 }, 0, 0, 0.01, 0.04),
        box({ ORIENT: 0 }, 0, 0.5, 0.01, 0.54),
      ],
    });
    expect(features).toHaveLength(2);
  });

  test("each class is grouped and labelled on its own", () => {
    const features = run({
      TSSLPT: [box({ ORIENT: 90 }, 0, 0, 0.1, 0.01)],
      DWRTPT: [box({ ORIENT: 90 }, 0.1, 0, 0.2, 0.01)],
    });
    expect(features).toHaveLength(2);
    expect(features.map((f) => f.properties.CLASS).sort()).toEqual([
      "DWRTPT",
      "TSSLPT",
    ]);
  });

  test("a feature with no ORIENT still gets exactly one anchor", () => {
    // TSSRON (roundabout) has no traffic direction, so there is no axis to
    // repeat along.
    const features = run({ TSSRON: [box({}, 0, 0, 0.5, 0.5)] });
    expect(features).toHaveLength(1);
    expect(features[0].properties).not.toHaveProperty("ORIENT");
    expect(features[0].properties.CLASS).toBe("TSSRON");
  });
});

describe("long legs repeat their arrow", () => {
  test("a 30 nm lane gets evenly spaced anchors along its axis", () => {
    // 0.5 degrees of latitude = 30 nm; at one anchor per ~8 nm that rounds to
    // four, 7.5 nm apart.
    const features = run({
      TSSLPT: [box({ ORIENT: 0 }, 0, 0, 0.005, 0.5)],
    });

    expect(features).toHaveLength(4);

    const latitudes = features
      .map((f) => f.geometry.coordinates[1])
      .sort((a, b) => a - b);
    const gaps = latitudes.slice(1).map((lat, i) => lat - latitudes[i]);
    for (const gap of gaps) expect(gap).toBeCloseTo(0.125, 6);
    // Half a gap in from each end, so no arrow sits on the lane's mouth.
    expect(latitudes[0]).toBeCloseTo(0.0625, 6);
    expect(latitudes[3]).toBeCloseTo(0.4375, 6);

    for (const feature of features) {
      const [longitude] = feature.geometry.coordinates;
      expect(longitude).toBeGreaterThan(0);
      expect(longitude).toBeLessThan(0.005);
      expect(feature.properties.ORIENT).toBe(0);
    }
  });

  test("the repeat follows ORIENT, not the coordinate axes", () => {
    // The same lane running east: the long axis is now longitude, and ORIENT
    // 90 is what tells the generator so.
    const features = run({
      TSSLPT: [box({ ORIENT: 90 }, 0, 0, 0.5, 0.005)],
    });

    expect(features).toHaveLength(4);
    const longitudes = features
      .map((f) => f.geometry.coordinates[0])
      .sort((a, b) => a - b);
    const gaps = longitudes.slice(1).map((lon, i) => lon - longitudes[i]);
    for (const gap of gaps) expect(gap).toBeCloseTo(0.125, 5);
  });

  test("a leg spanning several fragments repeats across all of them", () => {
    const features = run({
      TSSLPT: [
        box({ ORIENT: 0 }, 0, 0, 0.005, 0.25),
        box({ ORIENT: 0 }, 0, 0.25, 0.005, 0.5),
      ],
    });

    expect(features).toHaveLength(4);
    const latitudes = features.map((f) => f.geometry.coordinates[1]);
    // Anchors on both halves, not four on whichever fragment came first.
    expect(latitudes.some((lat) => lat < 0.25)).toBe(true);
    expect(latitudes.some((lat) => lat > 0.25)).toBe(true);
  });

  test("a short leg gets exactly one anchor", () => {
    const features = run({
      TSSLPT: [box({ ORIENT: 0 }, 0, 0, 0.005, 0.02)],
    });
    expect(features).toHaveLength(1);
  });
});

describe("ORIENT is compared, not bucketed", () => {
  test("a 285/285/286/285 chain is ONE evenly-spaced leg", () => {
    // The deployed defect: bucketing on the rounded integer put 286 in its own
    // bucket and left the 285 runs either side of it no longer contiguous, so
    // one Santa Barbara lane drew three arrows at uneven spacing.
    const parts = [285, 285, 286, 285].map((orient, index) =>
      lane({ ORIENT: orient }, 285, index * 0.125, (index + 1) * 0.125, 0.0025),
    );
    const features = run({ TSSLPT: parts });

    // 0.5 degrees of axis = 30 nm, one anchor per ~8 nm.
    expect(features).toHaveLength(4);

    // One group: every anchor carries the whole chain's area and one ORIENT.
    const areas = new Set(features.map((f) => f.properties.AREA));
    expect(areas.size).toBe(1);
    expect(features[0].properties.AREA).toBeCloseTo(4 * 0.125 * 0.005, 6);

    // The area-weighted circular mean of 285, 285, 286, 285.
    for (const feature of features) {
      expect(feature.properties.ORIENT).toBe(285);
    }

    const stations = features
      .map((f) => alongAxis(f.geometry.coordinates, 285))
      .sort((a, b) => a - b);
    for (const [index, station] of stations.slice(1).entries()) {
      expect(station - stations[index]).toBeCloseTo(0.125, 5);
    }
  });

  test("a lane running north through 0 degrees averages to north, not south", () => {
    // 359.8 and 0.2 average arithmetically to 180 -- the exact opposite of the
    // way the traffic goes.
    const features = run({
      TSSLPT: [
        box({ ORIENT: 359.8 }, 0, 0, 0.01, 0.04),
        box({ ORIENT: 0.2 }, 0, 0.04, 0.01, 0.1),
      ],
    });

    expect(features).toHaveLength(1);
    expect(features[0].properties.ORIENT).toBe(0);
  });

  test("a difference beyond the tolerance is still two legs", () => {
    const features = run({
      TSSLPT: [
        box({ ORIENT: 0 }, 0, 0, 0.01, 0.04),
        box({ ORIENT: 5 }, 0, 0.04, 0.01, 0.1),
      ],
    });
    expect(features).toHaveLength(2);
  });

  test("the mean follows the larger part, not the first one", () => {
    // A clipped stub must not pull the arrow off the lane's own direction.
    const features = run({
      TSSLPT: [
        box({ ORIENT: 2 }, 0, 0, 0.01, 0.005),
        box({ ORIENT: 0 }, 0, 0.005, 0.01, 0.1),
      ],
    });
    expect(features).toHaveLength(1);
    expect(features[0].properties.ORIENT).toBe(0);
  });
});

describe("INTU", () => {
  test("the same lane in two bands stays two legs, each labelled", () => {
    // Deployed evidence: one lane duplicated across an INTU 2 and an INTU 4
    // cell drew two arrows on top of each other at z9, because the anchors
    // carried no INTU for the style's band floor to filter on.
    const features = run({
      TSSLPT: [
        box({ ORIENT: 0, INTU: 2 }, 0, 0, 0.01, 0.1),
        box({ ORIENT: 0, INTU: 4 }, 0, 0, 0.01, 0.1),
      ],
    });

    expect(features).toHaveLength(2);
    expect(features.map((f) => f.properties.INTU).sort()).toEqual([2, 4]);
  });

  test("a source with no INTU emits no INTU", () => {
    const features = run({ TSSLPT: [box({ ORIENT: 0 }, 0, 0, 0.01, 0.1)] });
    expect(features[0].properties).not.toHaveProperty("INTU");
  });
});

describe("stations that land in a gap", () => {
  test("a sub-tolerance gap at a station does not lose the arrow", () => {
    // Grouping joins parts that come within TOUCH_TOLERANCE, so a lane with a
    // hairline gap is one group with nothing across it at that line. The
    // station at 0.0625 lands exactly there.
    const gap = 2.5e-7;
    const features = run({
      TSSLPT: [
        box({ ORIENT: 0 }, 0, 0, 0.005, 0.0625 - gap),
        box({ ORIENT: 0 }, 0, 0.0625 + gap, 0.005, 0.5),
      ],
    });

    expect(features).toHaveLength(4);
    const latitudes = features.map((f) => f.geometry.coordinates[1]);
    // Moved off the gap, but by less than half a station spacing (0.0625).
    const nearest = latitudes.reduce((best, lat) =>
      Math.abs(lat - 0.0625) < Math.abs(best - 0.0625) ? lat : best,
    );
    expect(nearest).not.toBeCloseTo(0.0625, 9);
    expect(Math.abs(nearest - 0.0625)).toBeLessThan(0.0625);
  });

  test("a lane with no gaps places every station exactly and warns about none", () => {
    const { features, log } = runWithLog({
      TSSLPT: [box({ ORIENT: 0 }, 0, 0, 0.005, 0.5)],
    });
    expect(features).toHaveLength(4);
    expect(log).not.toContain("WARNING");
  });
});

describe("slivers", () => {
  test("a fragment below the minimum leg length is dropped and reported", () => {
    // What a quilt clip grazing a lane's corner leaves behind: a group, and so
    // an arrow the same size as the one on the 30 nm lane beside it.
    const { features, log } = runWithLog({
      TSSLPT: [
        box({ ORIENT: 0 }, 0, 0, 0.005, 0.5),
        box({ ORIENT: 0 }, 1, 1, 1.002, 1.002),
      ],
    });

    expect(features).toHaveLength(4);
    for (const feature of features) {
      expect(feature.geometry.coordinates[1]).toBeLessThan(1);
    }
    expect(log).toContain("1 sliver group(s) dropped");
  });

  test("a short but wide leg keeps its arrow", () => {
    // Only groups small in EVERY direction are slivers; how large a leg has to
    // be to be worth drawing at a given zoom is the style's call, from AREA.
    const features = run({ TSSLPT: [box({ ORIENT: 0 }, 0, 0, 0.05, 0.005)] });
    expect(features).toHaveLength(1);
  });
});

describe("degenerate input", () => {
  test("no features in, no anchors out", () => {
    expect(run({ TSSLPT: [] })).toEqual([]);
  });

  test("a feature with no geometry is skipped rather than throwing", () => {
    const features = run({
      TSSLPT: [
        { type: "Feature", properties: { ORIENT: 0 }, geometry: null },
        box({ ORIENT: 0 }, 0, 0, 0.01, 0.02),
      ],
    });
    expect(features).toHaveLength(1);
  });
});
