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

describe("the zoom partition", () => {
  /** One zoom-range copy of a hazard, as bin/s57-to-tiles step 2b exports it. */
  function copy(lnam, valsou, lon, partition) {
    const feature = rock(lnam, valsou, lon);
    Object.assign(feature.properties, partition);
    return feature;
  }

  /** The stamped minzooms in document order; the copies share an LNAM. */
  function stamps(document) {
    return document.features.map((feature) => feature.tippecanoe?.minzoom);
  }

  test("the copies of one hazard do not compete against each other", () => {
    // Same rock, same position, same VALSOU, same LNAM: nothing in the ranking
    // can tell two copies apart, so without the interval the winner is whichever
    // one ogr2ogr exported first and the loser is stamped out of its own range.
    const copies = [
      copy("rock", 5, 0, { _QZMIN: 6, _QZMAX: 7 }),
      copy("rock", 5, 0, { _QZMIN: 8 }),
    ];
    const forward = run({ UWTROC: copies }).UWTROC;
    const reversed = run({ UWTROC: [...copies].reverse() }).UWTROC;

    expect(stamps(forward)).toEqual([6, 8]);
    expect(stamps(reversed)).toEqual([8, 6]);
  });

  test("a copy does not hold a grid cell at a zoom it does not serve", () => {
    // The shoal rock serves z9 up; the deep one serves everything. Without the
    // interval the shoal copy wins z0 and the deep rock -- the only hazard this
    // cell publishes down there -- is stamped out of its own range.
    const { UWTROC } = run({
      UWTROC: [
        copy("deep", 30, 0, {}),
        copy("shoal", 2, 0.0001, { _QZMIN: 9 }),
      ],
    });

    expect(stamps(UWTROC)).toEqual([0, 9]);
  });

  test("a capped copy competes below the cap and nowhere above it", () => {
    // A fallback continuation (_QFALL, capped at the cell's own floor) against
    // the whole copy of a deeper hazard that starts where the cap ends. The
    // promotion that reaches an overview zoom is the fallback one: nothing
    // coarser covers that water, which is the lone charted rock in open water.
    const { UWTROC } = run({
      UWTROC: [
        copy("fallback", 3, 0, { _QZMAX: 5, _QFALL: 1 }),
        copy("whole", 25, 0.0001, { _QZMIN: 6 }),
      ],
    });

    expect(stamps(UWTROC)).toEqual([0, 6]);
  });

  test("a copy that wins nothing inside its interval is stamped at the top", () => {
    // Both copies are capped at z8, so the deeper one never wins: it is stamped
    // with the band maxzoom, which composes against _QZMAX to an empty range
    // and publishes nothing in this interval. Another copy serves above it.
    const { UWTROC } = run({
      UWTROC: [
        copy("shoal", 4, 0, { _QZMIN: 6, _QZMAX: 8 }),
        copy("deep", 22, 0.0001, { _QZMIN: 6, _QZMAX: 8 }),
      ],
    });

    expect(stamps(UWTROC)).toEqual([6, 12]);
  });

  test("the partition properties are left for bin/stamp-quilt-zooms", () => {
    // Composing them here would stamp the partition floor twice and strip
    // nothing; the composition is that pass's job and it needs the properties.
    const { UWTROC } = run({
      UWTROC: [copy("whole", 5, 0, { _QZMIN: 6, _QZMAX: 8 })],
    });
    const [feature] = UWTROC.features;

    expect(feature.properties).toEqual({
      LNAM: "whole",
      VALSOU: 5,
      _QZMIN: 6,
      _QZMAX: 8,
    });
    expect(feature.tippecanoe).toEqual({ minzoom: 6 });
  });

  test("a null bound is an absent one", () => {
    // A GeoJSON export writes the column of an unstamped copy as null.
    const { UWTROC } = run({
      UWTROC: [
        copy("west", 9, -60, { _QZMIN: null, _QZMAX: null, _QFALL: null }),
        copy("east", 9, 60, { _QZMIN: null, _QZMAX: null, _QFALL: null }),
      ],
    });

    expect(stamps(UWTROC)).toEqual([0, 0]);
  });
});
