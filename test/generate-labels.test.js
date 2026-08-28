/**
 * Fixture runs of bin/generate-labels.
 *
 * The script is invoked the way bin/s57-to-tiles invokes it -- as a child
 * process over one GeoJSON file per class -- because that is the whole of its
 * contract.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const SCRIPT = fileURLToPath(
  new URL("../bin/generate-labels", import.meta.url),
);

let work;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "labels-"));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

/** A square island of `size` degrees with its south-west corner at (x, y). */
function island(properties, x = 0, y = 0, size = 0.1) {
  return {
    type: "Feature",
    properties,
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [x, y],
          [x + size, y],
          [x + size, y + size],
          [x, y + size],
          [x, y],
        ],
      ],
    },
  };
}

function run(classes) {
  const output = join(work, "_LABELS.geojson");
  const args = [];
  for (const [className, features] of Object.entries(classes)) {
    const path = join(work, `${className}.geojson`);
    writeFileSync(
      path,
      JSON.stringify({ type: "FeatureCollection", features }),
    );
    args.push("--class", `${className}:${path}`);
  }
  const result = spawnSync(process.execPath, [SCRIPT, output, ...args], {
    encoding: "utf8",
  });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(readFileSync(output, "utf8")).features;
}

describe("one anchor per name per chart", () => {
  test("the parts of one named area share a single anchor", () => {
    const features = run({
      LNDARE: [
        island({ OBJNAM: "Blake Island", INTU: 5 }, 0, 0),
        island({ OBJNAM: "Blake Island", INTU: 5 }, 0.2, 0),
      ],
    });
    expect(features).toHaveLength(1);
    expect(features[0].properties.OBJNAM).toBe("Blake Island");
    // The summed area of both parts, which the style ranks the text by.
    expect(features[0].properties.AREA).toBeCloseTo(0.02, 6);
  });

  test("two bands of the same name keep their own labelling", () => {
    const features = run({
      LNDARE: [
        island({ OBJNAM: "Blake Island", INTU: 4 }, 0, 0),
        island({ OBJNAM: "Blake Island", INTU: 5 }, 0, 0),
      ],
    });
    expect(features.map((f) => f.properties.INTU)).toEqual([4, 5]);
  });

  test("an unnamed area gets no label", () => {
    expect(run({ LNDARE: [island({ INTU: 5 })] })).toHaveLength(0);
  });
});

describe("the zoom partition", () => {
  test("the copies of one area label their own intervals", () => {
    // The copy ladder for a cell floored at z9: a whole copy over z6-z8 and a
    // top copy from z9 up. Ungrouped, the two merge into one anchor carrying
    // no interval, which is the multi-band duplicate this removes.
    const features = run({
      LNDARE: [
        island({ OBJNAM: "Blake Island", INTU: 5, _QZMIN: 6, _QZMAX: 8 }),
        island({ OBJNAM: "Blake Island", INTU: 5, _QZMIN: 9 }),
      ],
    });
    expect(features).toHaveLength(2);
    expect(features.map((f) => f.properties._QZMIN)).toEqual([6, 9]);
    expect(features[0].properties._QZMAX).toBe(8);
    expect(features[1].properties).not.toHaveProperty("_QZMAX");
    // Each interval's own area, not the sum over the ladder.
    for (const feature of features) {
      expect(feature.properties.AREA).toBeCloseTo(0.01, 6);
    }
  });

  test("a fallback continuation carries _QFALL onto its label", () => {
    const [feature] = run({
      SEAARE: [island({ OBJNAM: "Saratoga Passage", _QZMAX: 5, _QFALL: 1 })],
    });
    expect(feature.properties._QZMAX).toBe(5);
    expect(feature.properties._QFALL).toBe(1);
    expect(feature.properties).not.toHaveProperty("_QZMIN");
  });

  test("the parts of one interval still share an anchor", () => {
    const features = run({
      LNDARE: [
        island({ OBJNAM: "Blake Island", _QZMIN: 9 }, 0, 0),
        island({ OBJNAM: "Blake Island", _QZMIN: 9 }, 0.2, 0),
      ],
    });
    expect(features).toHaveLength(1);
    expect(features[0].properties._QZMIN).toBe(9);
  });

  test("an unpartitioned input carries nothing new", () => {
    const [feature] = run({ LNDARE: [island({ OBJNAM: "Blake Island" })] });
    expect(feature.properties).toEqual({
      OBJNAM: "Blake Island",
      CLASS: "LNDARE",
      AREA: feature.properties.AREA,
      // Nothing else: a legacy invocation is one interval and stamps no range.
    });
    expect(feature.tippecanoe).toEqual({ minzoom: 0 });
  });
});
