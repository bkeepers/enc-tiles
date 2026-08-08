/**
 * Fixture runs of bin/stamp-quilt-zooms.
 *
 * The partition can only carry its zoom intervals as SQL columns, which become
 * GeoJSON properties; tippecanoe only reads them as a member on the Feature.
 * This is the conversion, and it is also where the partition's floors meet the
 * floors the generators upstream already decided. Getting the composition
 * backwards on the hazard classes goes wrong in both directions: a floor that
 * overrides the generator takes a charted rock off an overview chart, and a
 * generator stamp that overrides the floor puts every copy of that rock into
 * every tile from the promoted zoom up.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const SCRIPT = fileURLToPath(
  new URL("../bin/stamp-quilt-zooms", import.meta.url),
);

// The band-5 tiling ladder, which is what bin/s57-to-tiles passes down.
// Maxzoom 12: the offset-3 ladder floors a 1:12k cell at 12, so band 5 tiles
// z12 natively.
const BAND = ["--minzoom", "0", "--maxzoom", "12"];

let work;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "stamp-quilt-zooms-"));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

function point(properties, tippecanoe) {
  const feature = {
    type: "Feature",
    properties,
    geometry: { type: "Point", coordinates: [-122.5, 48.5] },
  };
  if (tippecanoe) feature.tippecanoe = tippecanoe;
  return feature;
}

/**
 * Writes one layer, runs the pass over it and reads it back. The layer name is
 * carried through so a case reads as the class it is about; the composition
 * itself is the same rule for every layer.
 */
function run(layer, features, args = BAND) {
  const path = join(work, `${layer}.geojson`);
  writeFileSync(path, JSON.stringify({ type: "FeatureCollection", features }));

  const result = spawnSync("node", [SCRIPT, ...args, path], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      result.stderr || `stamp-quilt-zooms exited ${result.status}`,
    );
  }
  return JSON.parse(readFileSync(path, "utf8")).features;
}

describe("the properties become a tippecanoe member", () => {
  test("a copy's interval is stamped and the working properties stripped", () => {
    const [feature] = run("DEPARE", [
      point({ OBJNAM: "Saratoga Passage", _QZMIN: 6, _QZMAX: 7 }),
    ]);

    // Beside `geometry`, never inside `properties`: tippecanoe does not read
    // zoom bounds off properties at all.
    expect(feature.tippecanoe).toEqual({ minzoom: 6, maxzoom: 7 });
    expect(feature.properties).toEqual({ OBJNAM: "Saratoga Passage" });
  });

  test("_QFALL survives: the style needs it", () => {
    // A fallback continuation draws a little earlier than its rung, and the
    // style scopes that relaxation to exactly these features.
    const [feature] = run("DEPARE", [point({ _QFALL: 1, _QZMAX: 5 })]);

    expect(feature.properties).toEqual({ _QFALL: 1 });
    expect(feature.tippecanoe).toEqual({ minzoom: 0, maxzoom: 5 });
  });

  test("an unbounded top copy runs to the band maxzoom", () => {
    const [feature] = run("DEPARE", [point({ _QZMIN: 10 })]);

    expect(feature.tippecanoe).toEqual({ minzoom: 10, maxzoom: 12 });
  });

  test("a feature the partition never touched is left alone", () => {
    // M_COVR is exempt from the ladder, and so is every cell built without a
    // coverage table.
    const [feature] = run("M_COVR", [point({ CATCOV: 1 })]);

    expect(feature.tippecanoe).toBeUndefined();
    expect(feature.properties).toEqual({ CATCOV: 1 });
  });
});

describe("composing with what the generators already stamped", () => {
  test("two floors compose to the higher one", () => {
    // _LABELS and _TSS_ANCHORS stamp minzoom 0 to exempt themselves from
    // dot-dropping; the partition floor still has to bind.
    const [feature] = run("_LABELS", [point({ _QZMIN: 6 }, { minzoom: 0 })]);

    expect(feature.tippecanoe.minzoom).toBe(6);
  });

  test("two ceilings compose to the lower one", () => {
    const [feature] = run("_LIGHTS_SECTORS", [
      point({ _QZMIN: 6, _QZMAX: 9 }, { minzoom: 7, maxzoom: 7 }),
    ]);

    expect(feature.tippecanoe).toEqual({ minzoom: 7, maxzoom: 7 });
  });

  test("a generator member the partition does not bound is kept", () => {
    const [feature] = run("_LIGHTS_SECTORS", [
      point({ _QZMAX: 9 }, { minzoom: 4, maxzoom: 4 }),
    ]);

    expect(feature.tippecanoe).toEqual({ minzoom: 4, maxzoom: 4 });
  });

  test("other members of the stamp are carried across", () => {
    const [feature] = run("DEPARE", [
      point({ _QZMIN: 6 }, { layer: "DEPARE", minzoom: 0 }),
    ]);

    expect(feature.tippecanoe.layer).toBe("DEPARE");
  });
});

describe("the hazard classes are composed like everything else", () => {
  test.each(["UWTROC", "WRECKS", "OBSTRN"])(
    "%s keeps the minzoom the generator promoted it to",
    (layer) => {
      // A lone charted rock in open water on the FALLBACK copy: no coarser
      // chart covers that water, so the copy carries no _QZMIN and the
      // shoalest-wins promotion to z0 is the whole of its floor. This is where
      // the promotion that reaches an overview zoom lives.
      const [feature] = run(layer, [
        point({ VALSOU: 1.2, _QFALL: 1, _QZMAX: 10 }, { minzoom: 0 }),
      ]);

      expect(feature.tippecanoe).toEqual({ minzoom: 0, maxzoom: 10 });
    },
  );

  test.each(["UWTROC", "WRECKS", "OBSTRN"])(
    "a %s copy does not draw below the interval it serves",
    (layer) => {
      // bin/generate-hazard-minzooms competes a copy only inside its own
      // interval, so a stamp below the floor is a legacy one. Taking it would
      // put a 1:12k cell's rock (rung 12) on the overview tiles and leave it
      // there beside the top copy of the same rock.
      const [feature] = run(layer, [
        point({ VALSOU: 1.2, _QZMIN: 12 }, { minzoom: 6 }),
      ]);

      expect(feature.tippecanoe.minzoom).toBe(12);
    },
  );

  test("the copies of one promoted hazard stay disjoint", () => {
    // Whole [9..10] and top [11..] of the same rock. If the promotion pulled
    // either copy below its interval both would be in the z9 tile, one uncut
    // and one clipped -- the exactly-one-owner violation the partition exists
    // to prevent, on the class that is drawn at every scale.
    const kept = run("UWTROC", [
      point({ VALSOU: 1.2, _QZMIN: 9, _QZMAX: 10 }, { minzoom: 9 }),
      point({ VALSOU: 1.2, _QZMIN: 11 }, { minzoom: 6 }),
    ]);

    expect(kept.map((feature) => feature.tippecanoe)).toEqual([
      { minzoom: 9, maxzoom: 10 },
      { minzoom: 11, maxzoom: 12 },
    ]);
  });

  test("a hazard the generator did NOT promote still takes the floor", () => {
    const [feature] = run("WRECKS", [point({ _QZMIN: 8 })]);

    expect(feature.tippecanoe.minzoom).toBe(8);
  });

  test("the ceiling is composed the same way as everywhere else", () => {
    // A hazard copy stops where its interval stops, or the copy above it would
    // draw twice.
    const [feature] = run("WRECKS", [
      point({ _QZMIN: 6, _QZMAX: 7 }, { minzoom: 6 }),
    ]);

    expect(feature.tippecanoe).toEqual({ minzoom: 6, maxzoom: 7 });
  });
});

describe("copies with no tile to live in", () => {
  test("an interval above the band's tiling range is dropped", () => {
    // A band-3 cell tiles to z8; a copy that starts at z10 has no tile of this
    // cell to be in. Clamping it into range instead would leave two copies of
    // the feature in the z8 tile, one uncut and one clipped.
    const kept = run(
      "DEPARE",
      [point({ _QZMIN: 10 }), point({ _QZMIN: 6, _QZMAX: 7 })],
      ["--minzoom", "0", "--maxzoom", "8"],
    );

    expect(kept).toHaveLength(1);
    expect(kept[0].tippecanoe).toEqual({ minzoom: 6, maxzoom: 7 });
  });

  test("an interval that ends below the band's tiling range is dropped", () => {
    const kept = run(
      "DEPARE",
      [point({ _QZMAX: 3 })],
      ["--minzoom", "5", "--maxzoom", "11"],
    );

    expect(kept).toHaveLength(0);
  });

  test("a pinned copy outside its interval is dropped, not stretched", () => {
    // generate-sector-arcs pins one copy per zoom. The copy for z4 does not
    // belong to the interval that starts at z6; the interval's own copy does.
    const kept = run("_LIGHTS_SECTORS", [
      point({ _QZMIN: 6 }, { minzoom: 4, maxzoom: 4 }),
      point({ _QZMIN: 6 }, { minzoom: 7, maxzoom: 7 }),
    ]);

    expect(kept).toHaveLength(1);
    expect(kept[0].tippecanoe).toEqual({ minzoom: 7, maxzoom: 7 });
  });

  test("an interval that only partly reaches the band is clamped to it", () => {
    const [feature] = run(
      "DEPARE",
      [point({ _QZMIN: 6, _QZMAX: 20 })],
      ["--minzoom", "0", "--maxzoom", "8"],
    );

    expect(feature.tippecanoe).toEqual({ minzoom: 6, maxzoom: 8 });
  });
});

describe("the census key", () => {
  const SCALED = [...BAND, "--cscale", "12000"];

  test("every feature carries the cell's compilation scale", () => {
    // The only per-feature key the census can group built tiles by: INTU names
    // the band, and no band tells 1:12k from 1:22k inside band 5.
    const [feature] = run("DEPARE", [point({ _QZMIN: 12 })], SCALED);

    expect(feature.properties).toEqual({ CSCALE: 12000 });
  });

  test("a derived layer's features carry it too", () => {
    // _LABELS and the other generators whitelist the properties they copy over,
    // so a stamp before them reaches the source layers only.
    const [feature] = run(
      "_LABELS",
      [point({ OBJNAM: "Elliott Bay" })],
      SCALED,
    );

    expect(feature.properties.CSCALE).toBe(12000);
  });

  test("a feature the partition never touched is stamped and kept", () => {
    // M_COVR is exempt from the ladder, not from the census.
    const [feature] = run("M_COVR", [point({ CATCOV: 1 })], SCALED);

    expect(feature.properties).toEqual({ CATCOV: 1, CSCALE: 12000 });
    expect(feature.tippecanoe).toBeUndefined();
  });

  test("a dropped copy is not resurrected by the stamp", () => {
    const kept = run(
      "DEPARE",
      [point({ _QZMAX: 3 })],
      ["--minzoom", "5", "--maxzoom", "11", "--cscale", "12000"],
    );

    expect(kept).toHaveLength(0);
  });

  test("a cell with no usable scale stamps nothing rather than a zero", () => {
    // A 0 divides in the rung function; an absent class fails every floor
    // assertion, which is the honest reading of "this cell is unplaced".
    const [feature] = run(
      "DEPARE",
      [point({ OBJNAM: "x" })],
      [...BAND, "--cscale", "0"],
    );

    expect(feature.properties).toEqual({ OBJNAM: "x" });
  });
});
