/**
 * Fixture runs of bin/thin-soundings.
 *
 * Soundings sit near the equator at 0 E so the Web Mercator cell arithmetic is
 * readable: the normalized x of a longitude is (lon + 180) / 360, and at the
 * equator y is exactly 0.5. A thinning cell is a 64th of a 512 px tile, so at
 * zoom z there are 2^z * 8 of them across the world -- 45 degrees wide at z0.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const SCRIPT = fileURLToPath(new URL("../bin/thin-soundings", import.meta.url));

let work;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "thin-soundings-"));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

/** One sounding. A null depth is a feature the export gave no DEPTH at all. */
function sounding(lnam, depth, lon, properties = {}) {
  return {
    type: "Feature",
    properties: {
      LNAM: lnam,
      ...(depth === null ? {} : { DEPTH: depth }),
      ...properties,
    },
    geometry: { type: "Point", coordinates: [lon, 0] },
  };
}

function run(features, { minzoom = 0, maxzoom = 12 } = {}) {
  const path = join(work, "SOUNDG.geojson");
  writeFileSync(path, JSON.stringify({ type: "FeatureCollection", features }));
  const result = spawnSync(
    process.execPath,
    [SCRIPT, path, "--minzoom", String(minzoom), "--maxzoom", String(maxzoom)],
    { encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(readFileSync(path, "utf8"));
}

/** LNAM -> stamped minzoom, for a document whose LNAMs are unique. */
function minzooms(document) {
  return Object.fromEntries(
    document.features.map((feature) => [
      feature.properties.LNAM,
      feature.tippecanoe?.minzoom,
    ]),
  );
}

/** The stamps in file order, for a document holding several copies per LNAM. */
function stamps(document) {
  return document.features.map((feature) => feature.tippecanoe?.minzoom);
}

/** Ten soundings inside a thousandth of a degree: one 64 px cell at any zoom. */
function cluster() {
  return Array.from({ length: 10 }, (_, index) =>
    sounding(`sounding-${index}`, 20 - index, 0.0001 * index),
  );
}

describe("shoalest wins", () => {
  test("exactly one of a cluster is present at the shallowest zoom", () => {
    const stamped = minzooms(run(cluster()));
    const early = Object.entries(stamped).filter(([, z]) => z === 0);
    expect(early).toHaveLength(1);
    // 20 - 9 = 11 m, the shoalest of the ten.
    expect(early[0][0]).toBe("sounding-9");
  });

  test("the order they arrive in is shoalest first", () => {
    const stamped = minzooms(run(cluster()));
    expect(stamped["sounding-9"]).toBeLessThanOrEqual(stamped["sounding-5"]);
    expect(stamped["sounding-5"]).toBeLessThanOrEqual(stamped["sounding-0"]);
  });

  test("a drying height outranks anything wet", () => {
    const stamped = minzooms(
      run([sounding("drying", -1.2, 0), sounding("awash", 0, 0.0001)]),
    );
    expect(stamped["drying"]).toBe(0);
    expect(stamped["awash"]).toBeGreaterThan(0);
  });

  test("a sounding with no DEPTH cannot displace one that has it", () => {
    // The opposite of the hazard rule: an unsounded wreck is the dangerous
    // case, an unlabelled sounding is not a shoal claim at all.
    const stamped = minzooms(
      run([sounding("unreadable", null, 0), sounding("deep", 40, 0.0001)]),
    );
    expect(stamped["deep"]).toBe(0);
    expect(stamped["unreadable"]).toBe(12);
  });

  test("soundings far enough apart all survive the shallowest zoom", () => {
    // At z0 a cell is 45 degrees wide, so 60 degrees apart is three cells.
    const stamped = minzooms(
      run([
        sounding("west", 5, -60),
        sounding("middle", 5, 0),
        sounding("east", 5, 60),
      ]),
    );
    expect(Object.values(stamped)).toEqual([0, 0, 0]);
  });
});

describe("zoom monotonicity", () => {
  // Spread far enough apart that the grid separates them at different zooms:
  // 0.5 degrees is one z0 cell, several cells by z8.
  const spread = Array.from({ length: 12 }, (_, index) =>
    sounding(`sounding-${index}`, 30 - index, index * 0.5),
  );

  test("the survivor set at a zoom contains the one below it", () => {
    const stamped = Object.entries(minzooms(run(spread)));
    const survivors = (zoom) =>
      new Set(stamped.filter(([, z]) => z <= zoom).map(([lnam]) => lnam));

    for (let zoom = 1; zoom <= 12; zoom++) {
      for (const lnam of survivors(zoom - 1)) {
        expect([...survivors(zoom)], `z${zoom} keeps z${zoom - 1}`).toContain(
          lnam,
        );
      }
    }
    expect(survivors(0).size).toBe(1);
    expect(survivors(12).size).toBe(spread.length);
    // Not one jump at the top: a coarser grid really does hold fewer.
    expect(survivors(6).size).toBeGreaterThan(survivors(0).size);
    expect(survivors(6).size).toBeLessThan(survivors(12).size);
  });
});

describe("determinism", () => {
  test("equal depths break the same way whatever order they arrive in", () => {
    const features = [
      sounding("bbb", 5, 0),
      sounding("aaa", 5, 0.0001),
      sounding("ccc", 5, 0.0002),
    ];
    const forward = minzooms(run(features));
    const reversed = minzooms(run([...features].reverse()));
    expect(forward).toEqual(reversed);
    expect(forward["aaa"]).toBe(0);
  });

  test("soundings sharing one LNAM break on position, not on export order", () => {
    // SPLIT_MULTIPOINT=ON gives every point of one S-57 sounding record the
    // record's LNAM, so a tie on LNAM is the ordinary case.
    const features = [
      sounding("record", 7, 0.0002),
      sounding("record", 7, 0),
      sounding("record", 7, 0.0001),
    ];
    const forward = run(features);
    const reversed = run([...features].reverse());
    const byLongitude = (document) =>
      document.features
        .map((feature) => [
          feature.geometry.coordinates[0],
          feature.tippecanoe.minzoom,
        ])
        .sort((a, b) => a[0] - b[0]);
    expect(byLongitude(forward)).toEqual(byLongitude(reversed));
    // The westernmost sorts first on the position tie-break.
    expect(byLongitude(forward)[0][1]).toBe(0);
  });

  test("the rewrite keeps the features in the order they arrived", () => {
    const document = run(cluster());
    expect(document.features.map((f) => f.properties.LNAM)).toEqual(
      cluster().map((f) => f.properties.LNAM),
    );
  });
});

describe("the zoom partition", () => {
  test("each copy of a sounding is stamped for its own interval", () => {
    // The copy ladder for a cell floored at z9 under a coarser chart: a whole
    // copy over z6-z8 and a top copy from z9 up. Nothing tells the two apart
    // but their interval -- same position, same DEPTH, same LNAM.
    const document = run([
      sounding("split", 12, 0, { _QZMIN: 6, _QZMAX: 8 }),
      sounding("split", 12, 0, { _QZMIN: 9 }),
    ]);
    expect(stamps(document)).toEqual([6, 9]);
  });

  test("a copy does not hold a grid cell at a zoom it does not serve", () => {
    // The shoal sounding serves z9 up; the deep one serves everything. Without
    // the interval the shoal copy wins z0 and the deep sounding -- the only
    // one this cell publishes down there -- is stamped out of its own range.
    const document = run([
      sounding("deep", 30, 0),
      sounding("shoal", 2, 0.0001, { _QZMIN: 9 }),
    ]);
    expect(stamps(document)).toEqual([0, 9]);
  });

  test("a capped copy competes below the cap and nowhere above it", () => {
    // A fallback continuation (_QFALL, capped at the cell's own floor) against
    // the whole copy of a deeper sounding that starts where the cap ends.
    const document = run([
      sounding("fallback", 3, 0, { _QZMAX: 5, _QFALL: 1 }),
      sounding("whole", 25, 0.0001, { _QZMIN: 6 }),
    ]);
    expect(stamps(document)).toEqual([0, 6]);
  });

  test("a copy that wins nothing inside its interval is stamped at the top", () => {
    // Two soundings in one cell, both capped at z8: the deeper never wins, so
    // it is stamped with the band maxzoom, which composes against _QZMAX to an
    // empty range and publishes nothing in this interval.
    const document = run([
      sounding("shoal", 4, 0, { _QZMIN: 6, _QZMAX: 8 }),
      sounding("deep", 22, 0.0001, { _QZMIN: 6, _QZMAX: 8 }),
    ]);
    expect(stamps(document)).toEqual([6, 12]);
  });

  test("the partition properties are left for bin/stamp-quilt-zooms", () => {
    // Only the thinning part is written, and it is written where tippecanoe
    // reads it: on the Feature, not in the properties.
    const document = run([sounding("whole", 5, 0, { _QZMIN: 6, _QZMAX: 8 })]);
    const [feature] = document.features;
    expect(feature.properties).toEqual({
      LNAM: "whole",
      DEPTH: 5,
      _QZMIN: 6,
      _QZMAX: 8,
    });
    expect(feature.tippecanoe).toEqual({ minzoom: 6 });
  });

  test("a null bound is an absent one", () => {
    // A GeoJSON export writes the column of an unstamped copy as null.
    const document = run([
      sounding("west", 9, -60, { _QZMIN: null, _QZMAX: null, _QFALL: null }),
      sounding("east", 9, 60, { _QZMIN: null, _QZMAX: null, _QFALL: null }),
    ]);
    expect(stamps(document)).toEqual([0, 0]);
  });
});

describe("scope", () => {
  test("non-point members are left alone", () => {
    const area = {
      type: "Feature",
      properties: { LNAM: "multipoint" },
      geometry: {
        type: "MultiPoint",
        coordinates: [
          [0, 0],
          [0.001, 0],
        ],
      },
    };
    const document = run([area, sounding("point", 5, 0.02)]);
    expect(document.features[0]).not.toHaveProperty("tippecanoe");
    expect(document.features[1].tippecanoe.minzoom).toBe(0);
  });

  test("a run with no soundings is not a failure", () => {
    const document = run([]);
    expect(document.features).toEqual([]);
  });
});
