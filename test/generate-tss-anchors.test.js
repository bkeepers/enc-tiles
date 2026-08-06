/**
 * Fixture runs of bin/generate-tss-anchors.
 *
 * Coordinates sit near the equator so a degree of longitude and a degree of
 * latitude are the same length and the expected spacings are readable: one
 * degree of latitude is 60 nautical miles everywhere.
 */
import { execFileSync } from "node:child_process";
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

function run(classes) {
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
  execFileSync(process.execPath, [SCRIPT, output, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(readFileSync(output, "utf8")).features;
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
