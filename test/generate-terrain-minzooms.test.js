/**
 * Fixture runs of bin/generate-terrain-minzooms.
 *
 * Peaks sit near the equator at 0 E so the Web Mercator cell arithmetic is
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
  new URL("../bin/generate-terrain-minzooms", import.meta.url),
);

let work;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "terrain-minzooms-"));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

/** A terrain point. `name` and `elevation` are omitted when null. */
function peak(lnam, { name = null, elevation = null, lon = 0, lat = 0 } = {}) {
  return {
    type: "Feature",
    properties: {
      LNAM: lnam,
      ...(name === null ? {} : { OBJNAM: name }),
      ...(elevation === null ? {} : { ELEVAT: elevation }),
    },
    geometry: { type: "Point", coordinates: [lon, lat] },
  };
}

/**
 * Write one layer file per class, run the generator, read everything back.
 *
 * `layers` maps a class name to its features; the return value maps the same
 * names to the rewritten documents, plus `_TERRAIN` for the emitted anchors.
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
  const terrainPath = join(work, "_TERRAIN.geojson");
  const result = spawnSync(
    process.execPath,
    [
      SCRIPT,
      terrainPath,
      "--minzoom",
      String(minzoom),
      "--maxzoom",
      String(maxzoom),
      ...Object.entries(paths).flatMap(([name, path]) => [
        "--class",
        `${name}:${path}`,
      ]),
    ],
    { encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
  const output = {};
  for (const [name, path] of Object.entries(paths)) {
    output[name] = JSON.parse(readFileSync(path, "utf8"));
  }
  output._TERRAIN = JSON.parse(readFileSync(terrainPath, "utf8"));
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

describe("keep-priority", () => {
  test("a named summit beats a higher unnamed one", () => {
    const { LNDELV } = run(
      {
        LNDELV: [
          peak("named", { name: "Lone Butte", elevation: 100 }),
          peak("unnamed", { elevation: 3000, lon: 0.0001 }),
        ],
      },
      { maxzoom: 12 },
    );
    expect(minzooms(LNDELV)["named"]).toBe(0);
    expect(minzooms(LNDELV)["unnamed"]).toBeGreaterThan(0);
  });

  test("missing ELEVAT loses -- the inverse of the hazard sentinel", () => {
    // A hazard with no VALSOU wins its cell; an elevation point with no
    // ELEVAT is not a height claim and must not displace one.
    const { LNDELV } = run(
      {
        LNDELV: [
          peak("measured", { elevation: 10 }),
          peak("unmeasured", { lon: 0.0001 }),
        ],
      },
      { maxzoom: 12 },
    );
    expect(minzooms(LNDELV)["measured"]).toBe(0);
    expect(minzooms(LNDELV)["unmeasured"]).toBeGreaterThan(0);
  });

  test("LNDELV outranks SLOGRD at equal rank", () => {
    // Both unnamed, neither with ELEVAT (SLOGRD never carries one): the
    // surveyed elevation point wins over the ground it stands on.
    const { LNDELV, SLOGRD } = run(
      {
        LNDELV: [peak("spot")],
        SLOGRD: [peak("ground", { lon: 0.0001 })],
      },
      { maxzoom: 12 },
    );
    expect(minzooms(LNDELV)["spot"]).toBe(0);
    expect(minzooms(SLOGRD)["ground"]).toBeGreaterThan(0);
  });

  test("equal ranks break on LNAM, whatever order they are exported in", () => {
    const features = [
      peak("bbb", { elevation: 5 }),
      peak("aaa", { elevation: 5, lon: 0.0001 }),
      peak("ccc", { elevation: 5, lon: 0.0002 }),
    ];
    const forward = minzooms(run({ LNDELV: features }).LNDELV);
    const reversed = minzooms(run({ LNDELV: [...features].reverse() }).LNDELV);
    expect(forward).toEqual(reversed);
    expect(forward["aaa"]).toBe(0);
  });
});

describe("a cluster thins to the named and the highest", () => {
  // Ten peaks inside a thousandth of a degree -- well under one 64 px cell at
  // any zoom this pipeline tiles.
  const cluster = Array.from({ length: 10 }, (_, index) =>
    peak(`peak-${index}`, { elevation: 100 + index, lon: 0.0001 * index }),
  );

  test("exactly one is present at the shallowest zoom", () => {
    const { LNDELV } = run({ LNDELV: cluster }, { maxzoom: 12 });
    const stamped = minzooms(LNDELV);
    const early = Object.entries(stamped).filter(([, z]) => z === 0);
    expect(early).toHaveLength(1);
    // 100 + 9 = 109 m, the highest of the ten.
    expect(early[0][0]).toBe("peak-9");
  });

  test("every one of them is back by the band maxzoom", () => {
    const { LNDELV } = run({ LNDELV: cluster }, { maxzoom: 12 });
    for (const z of Object.values(minzooms(LNDELV))) {
      expect(z).toBeLessThanOrEqual(12);
      expect(z).toBeGreaterThanOrEqual(0);
    }
    expect(Object.keys(minzooms(LNDELV))).toHaveLength(10);
  });

  test("the order they arrive in is highest first", () => {
    const { LNDELV } = run({ LNDELV: cluster }, { maxzoom: 12 });
    const stamped = minzooms(LNDELV);
    // peak-9 (109 m) is the highest, peak-0 (100 m) the lowest.
    expect(stamped["peak-9"]).toBeLessThanOrEqual(stamped["peak-5"]);
    expect(stamped["peak-5"]).toBeLessThanOrEqual(stamped["peak-0"]);
  });
});

describe("the coincident pair", () => {
  test("competes as one unit; both members take the representative's minzoom", () => {
    // The measured Dinglishna Hill pair: one summit digitised twice at
    // bit-identical coordinates. The group contests as one unit and the
    // SLOGRD twin shares the outcome -- the two symbols nest (the POSGEN04
    // dot inside HILTOP01's empty centre), so they arrive and leave together.
    const { LNDELV, SLOGRD, _TERRAIN } = run(
      {
        LNDELV: [
          peak("spot", {
            name: "Dinglishna Hill",
            elevation: 146,
            lon: -150.604019,
            lat: 61.440983,
          }),
        ],
        SLOGRD: [
          peak("ground", {
            name: "Dinglishna Hill",
            lon: -150.604019,
            lat: 61.440983,
          }),
        ],
      },
      { maxzoom: 12 },
    );
    expect(minzooms(LNDELV)["spot"]).toBe(0);
    expect(minzooms(SLOGRD)["ground"]).toBe(0);
    // One summit, one anchor.
    expect(_TERRAIN.features).toHaveLength(1);
    expect(_TERRAIN.features[0].properties).toMatchObject({
      OBJNAM: "Dinglishna Hill",
      CLASS: "LNDELV",
      ELEVAT: 146,
      LNAM: "spot",
    });
  });

  test("an unnamed coincident pair that loses the contest has BOTH members at the maxzoom", () => {
    // A named winning pair and, a ten-thousandth of a degree away, an UNNAMED
    // pair -- one 64 px cell at every zoom this run contests (the z11 cell is
    // ~0.022 degrees). The named pair holds the cell at every zoom, so the
    // unnamed one never wins and BOTH its members are stamped with the band
    // maxzoom: an unnamed unit loses together exactly as it wins together. (A
    // NAMED loser instead follows its label to minzoom 0 -- feedback #79 below.)
    const { LNDELV, SLOGRD } = run(
      {
        LNDELV: [
          peak("high-spot", { name: "High Hill", elevation: 500 }),
          peak("low-spot", { elevation: 100, lon: 0.0001 }),
        ],
        SLOGRD: [
          peak("high-ground", { name: "High Hill" }),
          peak("low-ground", { lon: 0.0001 }),
        ],
      },
      { maxzoom: 12 },
    );
    expect(minzooms(LNDELV)["high-spot"]).toBe(0);
    expect(minzooms(SLOGRD)["high-ground"]).toBe(0);
    expect(minzooms(LNDELV)["low-spot"]).toBe(12);
    expect(minzooms(SLOGRD)["low-ground"]).toBe(12);
  });

  test("a three-member group propagates the result to every member", () => {
    // LNDELV + SLOGRD + SLOGRD off one point: the grouping is not pairwise,
    // and every member -- named or not -- takes the representative's stamp.
    const { LNDELV, SLOGRD, _TERRAIN } = run(
      {
        LNDELV: [peak("spot", { name: "Round Top", elevation: 211 })],
        SLOGRD: [peak("ground-a", { name: "Round Top" }), peak("ground-b")],
      },
      { maxzoom: 12 },
    );
    expect(minzooms(LNDELV)["spot"]).toBe(0);
    expect(minzooms(SLOGRD)["ground-a"]).toBe(0);
    expect(minzooms(SLOGRD)["ground-b"]).toBe(0);
    // Three members, one summit, one anchor.
    expect(_TERRAIN.features).toHaveLength(1);
    expect(_TERRAIN.features[0].properties.OBJNAM).toBe("Round Top");
  });

  test("the anchor still carries ELEVAT off the representative", () => {
    // The style's combined name-plus-height label reads ELEVAT from the
    // anchor -- at zooms where no LNDELV feature reaches the tile it is the
    // ONLY carrier of the height -- so the pair must never cost it.
    const { _TERRAIN } = run(
      {
        LNDELV: [peak("spot", { name: "Dinglishna Hill", elevation: 146 })],
        SLOGRD: [peak("ground", { name: "Dinglishna Hill" })],
      },
      { maxzoom: 12 },
    );
    expect(_TERRAIN.features).toHaveLength(1);
    expect(_TERRAIN.features[0].properties.ELEVAT).toBe(146);
  });

  test("the name rides the representative when only the loser carries it", () => {
    // The measured Coach Butte pair: the name sits on the SLOGRD side. The
    // union makes the representative NAMED, so it also outranks the higher
    // unnamed peak beside it.
    const { LNDELV, SLOGRD, _TERRAIN } = run(
      {
        LNDELV: [
          peak("spot", { elevation: 148.7 }),
          peak("taller", { elevation: 3000, lon: 0.0001 }),
        ],
        SLOGRD: [peak("ground", { name: "Coach Butte" })],
      },
      { maxzoom: 12 },
    );
    expect(minzooms(LNDELV)["spot"]).toBe(0);
    expect(minzooms(LNDELV)["taller"]).toBeGreaterThan(0);
    expect(minzooms(SLOGRD)["ground"]).toBe(0);
    // The union is written back onto the rewritten class file too.
    expect(LNDELV.features[0].properties.OBJNAM).toBe("Coach Butte");
    expect(_TERRAIN.features).toHaveLength(1);
    expect(_TERRAIN.features[0].properties).toMatchObject({
      OBJNAM: "Coach Butte",
      CLASS: "LNDELV",
      ELEVAT: 148.7,
    });
  });

  test("two same-named peaks 250 km apart BOTH survive", () => {
    // "Saddle Mountain" exists twice in Alaska. The group key is position
    // first, name second -- never name alone -- so neither is collapsed into
    // the other, and each labels its own summit. 2.25 degrees is ~250 km at
    // the equator; a z5 thinning cell is 360/256 = 1.40625 degrees, so the
    // two are in separate cells from z5 at the latest.
    const { LNDELV, SLOGRD, _TERRAIN } = run(
      {
        LNDELV: [peak("south", { name: "Saddle Mountain", elevation: 372 })],
        SLOGRD: [peak("north", { name: "Saddle Mountain", lon: 2.25 })],
      },
      { maxzoom: 12 },
    );
    expect(minzooms(LNDELV)["south"]).toBe(0);
    expect(minzooms(SLOGRD)["north"]).toBeLessThanOrEqual(5);
    const names = _TERRAIN.features.map((f) => f.properties.OBJNAM);
    expect(names).toEqual(["Saddle Mountain", "Saddle Mountain"]);
  });
});

describe("_TERRAIN", () => {
  test("only named survivors get an anchor", () => {
    const { _TERRAIN } = run(
      {
        LNDELV: [
          peak("named", { name: "Mount Spurr", elevation: 3373.8 }),
          peak("unnamed", { elevation: 148.7, lon: 60 }),
        ],
      },
      { maxzoom: 12 },
    );
    expect(_TERRAIN.features).toHaveLength(1);
    expect(_TERRAIN.features[0].properties.OBJNAM).toBe("Mount Spurr");
    expect(_TERRAIN.features[0].geometry).toEqual({
      type: "Point",
      coordinates: [0, 0],
    });
  });

  test("an anchor is exempt from dot-dropping and carries the interval", () => {
    // ANCHOR_TIPPECANOE, not the thinning stamp: the label may name a summit
    // whose icon arrives later, and bin/stamp-quilt-zooms composes the range
    // properties into the anchor's real bounds.
    const feature = peak("copy", { name: "Mount Peulik", elevation: 1524 });
    Object.assign(feature.properties, { _QZMIN: 6, _QZMAX: 8, INTU: 3 });
    const { _TERRAIN } = run({ LNDELV: [feature] }, { maxzoom: 12 });
    const [anchor] = _TERRAIN.features;
    expect(anchor.tippecanoe).toEqual({ minzoom: 0 });
    expect(anchor.properties).toEqual({
      OBJNAM: "Mount Peulik",
      CLASS: "LNDELV",
      ELEVAT: 1524,
      LNAM: "copy",
      INTU: 3,
      _QZMIN: 6,
      _QZMAX: 8,
    });
  });
});

describe("scope", () => {
  test("the classes compete as one population", () => {
    // A named hill and a higher unnamed spot elevation in the same place: the
    // named one must survive, which cannot happen if each layer thins alone.
    const { LNDELV, SLOGRD } = run(
      {
        LNDELV: [peak("tall-spot", { elevation: 3000 })],
        SLOGRD: [peak("named-hill", { name: "Coach Butte", lon: 0.0001 })],
      },
      { maxzoom: 12 },
    );
    expect(minzooms(SLOGRD)["named-hill"]).toBe(0);
    expect(minzooms(LNDELV)["tall-spot"]).toBeGreaterThan(0);
  });

  test("a SLOTOP point competes too", () => {
    // Zero SLOTOP point features measured in the sampled archives; accepted
    // for safety, ranked after SLOGRD.
    const { SLOTOP } = run({ SLOTOP: [peak("topline")] }, { maxzoom: 12 });
    expect(minzooms(SLOTOP)["topline"]).toBe(0);
  });

  test("non-point members are left alone", () => {
    const contour = {
      type: "Feature",
      properties: { LNAM: "contour", ELEVAT: 100 },
      geometry: {
        type: "LineString",
        coordinates: [
          [0, 0],
          [0.01, 0.01],
        ],
      },
    };
    const { LNDELV } = run({
      LNDELV: [contour, peak("point", { elevation: 5, lon: 0.02 })],
    });
    const [rewritten] = LNDELV.features;
    expect(rewritten).not.toHaveProperty("tippecanoe");
    expect(LNDELV.features[1].tippecanoe.minzoom).toBe(0);
  });

  test("peaks far enough apart all survive the shallowest zoom", () => {
    // At z0 a cell is an eighth of the world in x, so 60 degrees apart is
    // three separate cells.
    const { LNDELV } = run(
      {
        LNDELV: [
          peak("west", { elevation: 5, lon: -60 }),
          peak("middle", { elevation: 5 }),
          peak("east", { elevation: 5, lon: 60 }),
        ],
      },
      { maxzoom: 12 },
    );
    expect(Object.values(minzooms(LNDELV))).toEqual([0, 0, 0]);
  });
});

describe("the zoom partition", () => {
  /** One zoom-range copy of a peak, as bin/s57-to-tiles step 2b exports it. */
  function copy(lnam, options, partition) {
    const feature = peak(lnam, options);
    Object.assign(feature.properties, partition);
    return feature;
  }

  /** The stamped minzooms in document order; the copies share an LNAM. */
  function stamps(document) {
    return document.features.map((feature) => feature.tippecanoe?.minzoom);
  }

  test("the copies of one summit do not compete against each other", () => {
    // Same peak, same position, same ELEVAT, same LNAM. The interval is also
    // part of the COINCIDENCE key: the two copies are exactly coincident by
    // construction, and collapsing them would stamp one out of its own range.
    const copies = [
      copy("peak", { elevation: 500 }, { _QZMIN: 6, _QZMAX: 7 }),
      copy("peak", { elevation: 500 }, { _QZMIN: 8 }),
    ];
    const forward = run({ LNDELV: copies }).LNDELV;
    const reversed = run({ LNDELV: [...copies].reverse() }).LNDELV;

    expect(stamps(forward)).toEqual([6, 8]);
    expect(stamps(reversed)).toEqual([8, 6]);
  });

  test("a copy does not hold a grid cell at a zoom it does not serve", () => {
    // The higher copy serves z9 up; the lower one serves everything. Without
    // the interval the higher copy wins z0 and the lower peak -- the only
    // terrain this cell publishes down there -- is stamped out of its range.
    // Both unnamed, so the feedback #79 name floor does not enter and this is
    // the interval alone doing its job in the contest; the name-plus-interval
    // interaction is exercised in the feedback #79 block below.
    const { LNDELV } = run({
      LNDELV: [
        copy("plain", { elevation: 300 }, {}),
        copy(
          "higher",
          { elevation: 900, lon: 0.0001 },
          {
            _QZMIN: 9,
          },
        ),
      ],
    });

    expect(stamps(LNDELV)).toEqual([0, 9]);
  });

  test("a copy that wins nothing inside its interval is stamped at the top", () => {
    // Both copies are capped at z8 and share every cell up there, so the
    // unnamed one never wins: it is stamped with the band maxzoom, which
    // composes against _QZMAX to an empty range and publishes nothing in
    // this interval. Another copy serves above it.
    const { LNDELV } = run({
      LNDELV: [
        copy("high", { elevation: 900 }, { _QZMIN: 6, _QZMAX: 8 }),
        copy("low", { elevation: 20, lon: 0.0001 }, { _QZMIN: 6, _QZMAX: 8 }),
      ],
    });

    expect(stamps(LNDELV)).toEqual([6, 12]);
  });

  test("the partition properties are left for bin/stamp-quilt-zooms", () => {
    // Composing them here would stamp the partition floor twice and strip
    // nothing; the composition is that pass's job and it needs the properties.
    const { LNDELV } = run({
      LNDELV: [copy("whole", { elevation: 42 }, { _QZMIN: 6, _QZMAX: 8 })],
    });
    const [feature] = LNDELV.features;

    expect(feature.properties).toEqual({
      LNAM: "whole",
      ELEVAT: 42,
      _QZMIN: 6,
      _QZMAX: 8,
    });
    expect(feature.tippecanoe).toEqual({ minzoom: 6 });
  });

  test("a null bound is an absent one", () => {
    // A GeoJSON export writes the column of an unstamped copy as null.
    const { LNDELV } = run({
      LNDELV: [
        copy(
          "west",
          { elevation: 9, lon: -60 },
          {
            _QZMIN: null,
            _QZMAX: null,
            _QFALL: null,
          },
        ),
        copy(
          "east",
          { elevation: 9, lon: 60 },
          {
            _QZMIN: null,
            _QZMAX: null,
            _QFALL: null,
          },
        ),
      ],
    });

    expect(stamps(LNDELV)).toEqual([0, 0]);
  });
});

describe("a named summit's icon shows wherever its name does (feedback #79)", () => {
  test("a named pair that loses the contest still shows its icon at the label minzoom", () => {
    // The _TERRAIN anchor enters the pyramid at ANCHOR_TIPPECANOE.minzoom (0)
    // whatever the density contest decided, so a NAMED summit that loses its
    // low-zoom cells must publish its icon there too -- otherwise the name draws
    // with no peak mark under it (measured over Alaska z8-9, "Mount Hamlet
    // 620 m" as text). "High Hill" holds every shared cell, yet the losing
    // named pair "Low Hill" is stamped at 0, both members together.
    const { LNDELV, SLOGRD, _TERRAIN } = run(
      {
        LNDELV: [
          peak("high-spot", { name: "High Hill", elevation: 500 }),
          peak("low-spot", { name: "Low Hill", elevation: 100, lon: 0.0001 }),
        ],
        SLOGRD: [
          peak("high-ground", { name: "High Hill" }),
          peak("low-ground", { name: "Low Hill", lon: 0.0001 }),
        ],
      },
      { maxzoom: 12 },
    );
    // The losing named summit's icon rides its label to minzoom 0...
    expect(minzooms(LNDELV)["low-spot"]).toBe(0);
    // ...and its coincident SLOGRD ground shares that stamp, so the nested
    // dot-and-starburst arrives with the name as one summit.
    expect(minzooms(SLOGRD)["low-ground"]).toBe(0);
    // Each named summit still gets exactly one anchor.
    const names = _TERRAIN.features.map((f) => f.properties.OBJNAM).sort();
    expect(names).toEqual(["High Hill", "Low Hill"]);
  });

  test("an unnamed summit that loses keeps its competed minzoom", () => {
    // The fix touches named representatives only. An unnamed loser sharing a
    // cell with a named winner at every contested zoom stays at the band
    // maxzoom -- no new low-zoom clutter.
    const { LNDELV } = run(
      {
        LNDELV: [
          peak("named", { name: "Beacon Hill", elevation: 200 }),
          peak("unnamed", { elevation: 900, lon: 0.0001 }),
        ],
      },
      { maxzoom: 12 },
    );
    expect(minzooms(LNDELV)["named"]).toBe(0);
    expect(minzooms(LNDELV)["unnamed"]).toBe(12);
  });

  test("a named partitioned copy stamps the thinning floor, leaving _QZMIN for stamp-quilt-zooms", () => {
    // The name floor is the THINNING stamp alone: a copy serving z9 up is
    // stamped 0 here, and bin/stamp-quilt-zooms composes max(0, _QZMIN) = 9
    // later -- exactly as it does for the anchor -- so the copy is not published
    // below its own range. The interval property is left untouched for that
    // pass, and the anchor carries the same {minzoom: 0}.
    const feature = peak("copy", { name: "Mount Peulik", elevation: 1524 });
    Object.assign(feature.properties, { _QZMIN: 9, _QZMAX: 11 });
    const { LNDELV, _TERRAIN } = run({ LNDELV: [feature] }, { maxzoom: 12 });
    const [icon] = LNDELV.features;
    expect(icon.tippecanoe.minzoom).toBe(0);
    // _QZMIN survives as a property for bin/stamp-quilt-zooms to compose.
    expect(icon.properties._QZMIN).toBe(9);
    // Icon and anchor enter the pyramid on the same floor.
    expect(_TERRAIN.features[0].tippecanoe).toEqual({ minzoom: 0 });
  });
});
