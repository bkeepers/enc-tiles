/**
 * Fixture runs of bin/thin-lndare-points.
 *
 * The script is invoked the way bin/s57-to-tiles invokes it -- a child process
 * rewriting a LNDARE export in place -- because that is the whole of its
 * contract.
 *
 * The defect it exists to remove: LNDARE islet points draw at full density
 * from their band's arrival zoom (a carpet of land dots at z5 over islands
 * that are barely a pixel), because the partition's per-feature minzooms
 * exempt every point from tippecanoe's dot-dropping. The rule is
 * bin/thin-soundings' 64 px monotone grid with NAMED-first priority.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const SCRIPT = fileURLToPath(
  new URL("../bin/thin-lndare-points", import.meta.url),
);

let work;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "thin-lndare-"));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

function point(properties, lon, lat) {
  return {
    type: "Feature",
    properties,
    geometry: { type: "Point", coordinates: [lon, lat] },
  };
}

function polygon(properties, ring) {
  return {
    type: "Feature",
    properties,
    geometry: { type: "Polygon", coordinates: [ring] },
  };
}

/** Writes, runs in place, reads back. */
function thin(features, { minzoom = 0, maxzoom = 12 } = {}) {
  const path = join(work, "LNDARE.geojson");
  writeFileSync(path, JSON.stringify({ type: "FeatureCollection", features }));
  execFileSync(
    process.execPath,
    [SCRIPT, "--minzoom", String(minzoom), "--maxzoom", String(maxzoom), path],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  return JSON.parse(readFileSync(path, "utf8")).features;
}

const stamped = (feature) => feature.tippecanoe?.minzoom;

describe("the grid rule", () => {
  test("two crowded points: one wins the coarse zooms, the other waits", () => {
    // ~0.001 degrees apart: the same 64 px cell until deep zooms.
    const features = thin([
      point({ LNAM: "AA" }, -170.0, 52.0),
      point({ LNAM: "AB" }, -170.001, 52.0),
    ]);

    const zooms = features.map(stamped).sort((a, b) => a - b);
    expect(zooms[0]).toBe(0);
    expect(zooms[1]).toBeGreaterThan(0);
  });

  test("far-apart points each win their own cell from the floor", () => {
    // Opposite sides of the antimeridian-to-Greenwich span: different 64 px
    // cells even on the eight-cell z0 grid.
    const features = thin([
      point({ LNAM: "AA" }, -170, 52),
      point({ LNAM: "AB" }, 20, -30),
    ]);

    expect(features.map(stamped)).toEqual([0, 0]);
  });

  test("a NAMED islet beats an unnamed one in the same cell", () => {
    // The name is the priority, wherever the identity key would have sorted
    // it: AB > AA lexically, so the key alone would pick the unnamed AA.
    const features = thin([
      point({ LNAM: "AA" }, -170.0, 52.0),
      point({ LNAM: "AB", OBJNAM: "Amak Island" }, -170.001, 52.0),
    ]);

    const named = features.find((f) => f.properties.OBJNAM);
    const unnamed = features.find((f) => !f.properties.OBJNAM);
    expect(stamped(named)).toBe(0);
    expect(stamped(unnamed)).toBeGreaterThan(0);
  });

  test("a whitespace name is not a name", () => {
    const features = thin([
      point({ LNAM: "AA" }, -170.0, 52.0),
      point({ LNAM: "AB", OBJNAM: "   " }, -170.001, 52.0),
    ]);

    // Priority falls back to the key, and AA sorts first.
    expect(stamped(features[0])).toBe(0);
    expect(stamped(features[1])).toBeGreaterThan(0);
  });

  test("a loser is stamped the band maxzoom, never removed", () => {
    const features = thin(
      [
        point({ LNAM: "AA" }, -170.0, 52.0),
        point({ LNAM: "AB" }, -170.0000001, 52.0),
      ],
      { maxzoom: 8 },
    );

    // Effectively coincident: the loser never wins any zoom below the top.
    expect(features).toHaveLength(2);
    const zooms = features.map(stamped).sort((a, b) => a - b);
    expect(zooms).toEqual([0, 8]);
  });

  test("the release is monotone: no zoom has fewer survivors than the one before", () => {
    const cluster = [];
    for (let i = 0; i < 12; i++) {
      cluster.push(
        point({ LNAM: `A${i}` }, -170 + i * 0.0007, 52 + (i % 3) * 0.0004),
      );
    }
    const features = thin(cluster, { maxzoom: 10 });

    // Stamped minzooms are the release schedule; monotonicity means every
    // stamp is a real zoom in [0, maxzoom] and the counts accumulate.
    for (const feature of features) {
      expect(stamped(feature)).toBeGreaterThanOrEqual(0);
      expect(stamped(feature)).toBeLessThanOrEqual(10);
    }
    const first = features.filter((f) => stamped(f) === 0);
    expect(first.length).toBeGreaterThan(0);
    expect(first.length).toBeLessThan(features.length);
  });
});

describe("determinism", () => {
  test("input order does not move a single stamp", () => {
    const cluster = [
      point({ LNAM: "AA" }, -170.0, 52.0),
      point({ LNAM: "AB", OBJNAM: "Amak Island" }, -170.001, 52.0),
      point({ LNAM: "AC" }, -170.0005, 52.0005),
      point({ LNAM: "AD", OBJNAM: "Sea Lion Rock" }, -169.999, 51.9995),
    ];
    const forward = thin(cluster);

    rmSync(join(work, "LNDARE.geojson"));
    const reversed = thin(cluster.slice().reverse());

    const byLnam = (features) =>
      Object.fromEntries(features.map((f) => [f.properties.LNAM, stamped(f)]));
    expect(byLnam(reversed)).toEqual(byLnam(forward));
  });
});

describe("the copy ladder", () => {
  test("copies compete only inside their own intervals", () => {
    // One islet as two disjoint copies and a rival beside it. In [0..4] the
    // rival's copy is alone in the contest at z0 and wins the cell from the
    // floor; the islet's [0..4] copy loses to it (no name, later key) and is
    // stamped the band top -- an empty range once composed, which is the
    // thinning decision. The [5..] copies compete only from z5 up, so the
    // stamp respects each copy's own floor.
    const features = thin([
      point({ LNAM: "ZZ", _QZMIN: 0, _QZMAX: 4 }, -170.0, 52.0),
      point({ LNAM: "ZZ", _QZMIN: 5 }, -170.0, 52.0),
      point({ LNAM: "AA", _QZMIN: 0, _QZMAX: 4 }, -170.0001, 52.0),
      point({ LNAM: "AA", _QZMIN: 5 }, -170.0001, 52.0),
    ]);

    const of = (lnam, qzmin) =>
      features.find(
        (f) => f.properties.LNAM === lnam && f.properties._QZMIN === qzmin,
      );
    // AA wins both intervals from each interval's own floor.
    expect(stamped(of("AA", 0))).toBe(0);
    expect(stamped(of("AA", 5))).toBe(5);
    // ZZ never beats AA in a shared cell: its low copy is stamped the band
    // top (composes empty -- nothing duplicates across ranges), and its high
    // copy waits for a deeper grid inside ITS interval.
    expect(stamped(of("ZZ", 0))).toBe(12);
    expect(stamped(of("ZZ", 5))).toBeGreaterThan(5);
  });

  test("a stamp never lands below the copy's own floor", () => {
    const features = thin([
      point({ LNAM: "AA", _QZMIN: 6, _QZMAX: 9 }, -170, 52),
    ]);

    expect(stamped(features[0])).toBe(6);
  });

  test("legacy inputs with no interval stamps behave as one interval", () => {
    const features = thin([
      point({ LNAM: "AA" }, -170, 52),
      point({ LNAM: "AB" }, -170.001, 52),
    ]);

    expect(features.map(stamped).sort((a, b) => a - b)[0]).toBe(0);
  });
});

describe("only the points", () => {
  test("polygons and lines pass through byte-identical, points are stamped", () => {
    const ring = [
      [-170, 52],
      [-169, 52],
      [-169, 53],
      [-170, 53],
      [-170, 52],
    ];
    const features = thin([
      polygon({ LNAM: "PP" }, ring),
      {
        type: "Feature",
        properties: { LNAM: "LL" },
        geometry: {
          type: "LineString",
          coordinates: [
            [-170, 52],
            [-169, 52],
          ],
        },
      },
      point({ LNAM: "AA" }, -170.5, 52.5),
    ]);

    expect(features[0].tippecanoe).toBeUndefined();
    expect(features[1].tippecanoe).toBeUndefined();
    expect(features[2].tippecanoe).toEqual({ minzoom: 0 });
  });

  test("an existing tippecanoe member is composed onto, not replaced", () => {
    const feature = point({ LNAM: "AA" }, -170, 52);
    feature.tippecanoe = { maxzoom: 9 };
    const features = thin([feature]);

    expect(features[0].tippecanoe).toEqual({ maxzoom: 9, minzoom: 0 });
  });
});
