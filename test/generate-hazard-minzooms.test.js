/**
 * Fixture runs of bin/generate-hazard-minzooms.
 *
 * Hazards sit near the equator at 0 E so the Web Mercator cell arithmetic is
 * readable: the normalized x of a longitude is (lon + 180) / 360, and at the
 * equator y is exactly 0.5.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const SCRIPT = fileURLToPath(
  new URL("../bin/generate-hazard-minzooms", import.meta.url),
);

let work;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "hazard-minzooms-"));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

function rock(lnam, valsou, lon, lat = 0) {
  return {
    type: "Feature",
    properties:
      valsou === null ? { LNAM: lnam } : { LNAM: lnam, VALSOU: valsou },
    geometry: { type: "Point", coordinates: [lon, lat] },
  };
}

/**
 * Write one layer file, run the generator over the named layers, read back.
 *
 * `layers` maps a layer name to its features; the return value maps the same
 * names to the rewritten documents.
 */
function run(layers, { minzoom = 0, maxzoom = 12 } = {}) {
  const paths = {};
  for (const [name, features] of Object.entries(layers)) {
    paths[name] = join(work, `${name}.geojson`);
    writeFileSync(
      paths[name],
      JSON.stringify({ type: "FeatureCollection", features }),
    );
  }
  const result = spawnSync(
    process.execPath,
    [
      SCRIPT,
      "--minzoom",
      String(minzoom),
      "--maxzoom",
      String(maxzoom),
      ...Object.values(paths),
    ],
    { encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
  const output = {};
  for (const [name, path] of Object.entries(paths)) {
    output[name] = JSON.parse(readFileSync(path, "utf8"));
  }
  return output;
}

/** LNAM -> stamped minzoom, for one rewritten document. */
function minzooms(document) {
  return Object.fromEntries(
    document.features.map((feature) => [
      feature.properties.LNAM,
      feature.tippecanoe?.minzoom,
    ]),
  );
}

describe("a cluster thins to the shoalest", () => {
  // Ten rocks inside a thousandth of a degree — well under one 64 px cell at
  // any zoom this pipeline tiles.
  const cluster = Array.from({ length: 10 }, (_, index) =>
    rock(`rock-${index}`, 20 - index, 0.0001 * index),
  );

  test("exactly one is present at the shallowest zoom", () => {
    const { UWTROC } = run({ UWTROC: cluster }, { maxzoom: 12 });
    const stamped = minzooms(UWTROC);
    const early = Object.entries(stamped).filter(([, z]) => z === 0);
    expect(early).toHaveLength(1);
    // 20 - 9 = 11 m, the shallowest of the ten.
    expect(early[0][0]).toBe("rock-9");
  });

  test("every one of them is back by the band maxzoom", () => {
    const { UWTROC } = run({ UWTROC: cluster }, { maxzoom: 12 });
    for (const z of Object.values(minzooms(UWTROC))) {
      expect(z).toBeLessThanOrEqual(12);
      expect(z).toBeGreaterThanOrEqual(0);
    }
    expect(Object.keys(minzooms(UWTROC))).toHaveLength(10);
  });

  test("the order they arrive in is shoalest first", () => {
    const { UWTROC } = run({ UWTROC: cluster }, { maxzoom: 12 });
    const stamped = minzooms(UWTROC);
    // rock-9 (11 m) is the shoalest, rock-0 (20 m) the deepest.
    expect(stamped["rock-9"]).toBeLessThanOrEqual(stamped["rock-5"]);
    expect(stamped["rock-5"]).toBeLessThanOrEqual(stamped["rock-0"]);
  });
});

describe("effective depth", () => {
  test("no VALSOU outranks every sounded hazard", () => {
    const { UWTROC } = run(
      {
        UWTROC: [
          rock("sounded-shoal", 0.5, 0),
          rock("unsounded", null, 0.0001),
          rock("sounded-deep", 30, 0.0002),
        ],
      },
      { maxzoom: 12 },
    );
    expect(minzooms(UWTROC)["unsounded"]).toBe(0);
  });

  test("a drying height outranks anything wet", () => {
    const { UWTROC } = run(
      {
        UWTROC: [rock("drying", -1.5, 0), rock("awash", 0, 0.0001)],
      },
      { maxzoom: 12 },
    );
    expect(minzooms(UWTROC)["drying"]).toBe(0);
    expect(minzooms(UWTROC)["awash"]).toBeGreaterThan(0);
  });
});

describe("determinism", () => {
  test("equal depths break on LNAM, whatever order they are exported in", () => {
    const features = [
      rock("bbb", 5, 0),
      rock("aaa", 5, 0.0001),
      rock("ccc", 5, 0.0002),
    ];
    const forward = minzooms(run({ UWTROC: features }).UWTROC);
    const reversed = minzooms(run({ UWTROC: [...features].reverse() }).UWTROC);
    expect(forward).toEqual(reversed);
    expect(forward["aaa"]).toBe(0);
  });
});

describe("scope", () => {
  test("the three classes compete as one population", () => {
    // A deep rock and a shoal wreck in the same place: the wreck must be the
    // one that survives, which cannot happen if each layer thins alone.
    const { UWTROC, WRECKS } = run(
      {
        UWTROC: [rock("deep-rock", 25, 0)],
        WRECKS: [rock("shoal-wreck", 2, 0.0001)],
      },
      { maxzoom: 12 },
    );
    expect(minzooms(WRECKS)["shoal-wreck"]).toBe(0);
    expect(minzooms(UWTROC)["deep-rock"]).toBeGreaterThan(0);
  });

  test("non-point members are left alone", () => {
    const area = {
      type: "Feature",
      properties: { LNAM: "area-obstruction" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [0.01, 0],
            [0.01, 0.01],
            [0, 0.01],
            [0, 0],
          ],
        ],
      },
    };
    const { OBSTRN } = run({ OBSTRN: [area, rock("point", 5, 0.02)] });
    const [rewritten] = OBSTRN.features;
    expect(rewritten).not.toHaveProperty("tippecanoe");
    expect(OBSTRN.features[1].tippecanoe.minzoom).toBe(0);
  });

  test("hazards far enough apart all survive the shallowest zoom", () => {
    // At z0 a cell is an eighth of the world in x, so 60 degrees apart is
    // three separate cells.
    const { UWTROC } = run(
      {
        UWTROC: [
          rock("west", 5, -60),
          rock("middle", 5, 0),
          rock("east", 5, 60),
        ],
      },
      { maxzoom: 12 },
    );
    expect(Object.values(minzooms(UWTROC))).toEqual([0, 0, 0]);
  });
});
