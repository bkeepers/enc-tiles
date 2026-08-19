/**
 * Fixture runs of bin/generate-restriction-anchors.
 *
 * The script is invoked the way bin/s57-to-tiles invokes it -- as a child
 * process over GeoJSON files -- because that is the whole of its contract.
 *
 * The defect it exists to remove: the centred restriction symbol (crossed
 * anchor et al.) drawn once per polygon per tile with no zoom or size gate,
 * and -- because restriction polygons are drawn to their legal boundary
 * rather than to the shoreline -- sitting ON LAND for 28% of the polygons at
 * z7. One anchor per feature, on the water side of it, is the fix.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const SCRIPT = fileURLToPath(
  new URL("../bin/generate-restriction-anchors", import.meta.url),
);

let work;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "restr-anchors-"));
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

function multiPolygon(properties, ...polygons) {
  return {
    type: "Feature",
    properties,
    geometry: { type: "MultiPolygon", coordinates: polygons },
  };
}

function run(...args) {
  const output = join(work, "anchors.geojson");
  execFileSync(process.execPath, [SCRIPT, output, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(readFileSync(output, "utf8")).features;
}

/** One class file plus an optional land file, the way s57-to-tiles calls it. */
function anchors(features, { className = "RESARE", land = null } = {}) {
  const path = writeCollection(`${className}.geojson`, features);
  const args = ["--class", `${className}:${path}`];
  if (land) {
    args.push("--land", writeCollection("LNDARE.geojson", land));
  }
  return run(...args);
}

/**
 * The OTHER cells' semantic roster, exactly as bin/extract-coverage caches it
 * and bin/s57-to-tiles exports it back out: one polygon per area, carrying the
 * producing chart, its rung and the canonical CONTENT identity.
 */
function roster(entries) {
  return writeCollection(
    "area_evidence.geojson",
    entries.map(
      ({ className = "DMPGRD", content = {}, dsnm, floor = 8, ring }) =>
        polygon(
          {
            CLASS: className,
            CONTENT: JSON.stringify(content),
            DSNM: dsnm,
            QFLOOR: floor,
          },
          ring,
        ),
    ),
  );
}

/** One class file plus the election inputs, the way s57-to-tiles calls it. */
function elect(
  features,
  {
    className = "DMPGRD",
    dsnm,
    cellFloor = 8,
    evidence = [],
    land = null,
  } = {},
) {
  const path = writeCollection(`${className}.geojson`, features);
  const args = [
    "--class",
    `${className}:${path}`,
    "--area-evidence",
    roster(evidence),
    "--dsnm",
    dsnm,
    "--cell-floor",
    String(cellFloor),
  ];
  // --land covers THIS cell only, which is the whole of what the water-side
  // pass can know about a neighbour's part of the component.
  if (land) args.push("--land", writeCollection("LNDARE.geojson", land));
  return run(...args);
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

describe("water-side placement", () => {
  test("a polygon half on land anchors on the water half", () => {
    // The whole defect: the feature's own interior point is the shoreline (or
    // ashore), and the "do not anchor here" mark sat on a hillside.
    const feature = box(0, 0, 2, 1);
    const landRing = box(0, 0, 1, 1);
    const features = anchors([polygon({ LNAM: "0001" }, feature)], {
      land: [polygon({}, landRing)],
    });

    expect(features).toHaveLength(1);
    const anchor = features[0].geometry.coordinates;
    expect(inRing(anchor, feature), `${anchor} is on the feature`).toBe(true);
    expect(inRing(anchor, landRing), `${anchor} is off the land`).toBe(false);
    // ...and genuinely on the water side, not on the shoreline at x = 1.
    expect(anchor[0]).toBeGreaterThan(1);
  });

  test("the LARGEST WATER-SIDE part wins, not the largest part", () => {
    // A big part entirely ashore and a small one entirely afloat: the plain
    // largest-part rule would put the symbol on land, which is the failure
    // this generator exists to remove.
    const landRing = box(-1, -1, 4, 4);
    const features = anchors(
      [multiPolygon({ LNAM: "0002" }, [box(0, 0, 3, 3)], [box(5, 0, 6, 1)])],
      { land: [polygon({}, landRing)] },
    );

    expect(features).toHaveLength(1);
    const anchor = features[0].geometry.coordinates;
    expect(inRing(anchor, box(5, 0, 6, 1))).toBe(true);
  });

  test("a fully landlocked feature falls back to the plain interior point", () => {
    // The requirement is "not on land when the feature has ANY water". With no
    // water at all the symbol still has to draw somewhere, and the plain
    // largest-part interior point is the documented fallback.
    const feature = box(0, 0, 2, 1);
    const features = anchors([polygon({ LNAM: "0003" }, feature)], {
      land: [polygon({}, box(-1, -1, 3, 2))],
    });

    expect(features).toHaveLength(1);
    expect(inRing(features[0].geometry.coordinates, feature)).toBe(true);
  });

  test("no --land at all is the plain interior point too", () => {
    const feature = box(0, 0, 2, 1);
    const features = anchors([polygon({ LNAM: "0004" }, feature)]);

    expect(features).toHaveLength(1);
    expect(features[0].geometry.coordinates).toEqual([1, 0.5]);
  });

  test("a HOLE in the land is honoured as water", () => {
    // Holes wind the other way and the even-odd walk has to honour them: land
    // ringed around a lagoon covers the whole feature's outer extent, and the
    // lagoon is the only water the feature has. An outer-ring-only land test
    // would call the feature landlocked and fall back to a point ashore.
    const feature = box(0, 0, 4, 1);
    const lagoon = box(1, 0.25, 3, 0.75);
    const features = anchors([polygon({ LNAM: "0005" }, feature)], {
      land: [polygon({}, box(-1, -1, 5, 2), lagoon)],
    });

    expect(features).toHaveLength(1);
    const anchor = features[0].geometry.coordinates;
    expect(inRing(anchor, lagoon), `${anchor} is on the lagoon`).toBe(true);
  });
});

describe("one anchor per feature, per interval", () => {
  test("two fragments of one LNAM are one anchor", () => {
    const features = anchors([
      polygon({ LNAM: "AA" }, box(0, 0, 1, 1)),
      polygon({ LNAM: "AA" }, box(1, 0, 2, 1)),
    ]);

    expect(features).toHaveLength(1);
  });

  test("two features of different LNAM are two anchors, even touching", () => {
    // LNAM is the identity: two abutting but distinct regulated areas keep
    // their own symbols, which is why this is not a contiguity grouping.
    const features = anchors([
      polygon({ LNAM: "AA" }, box(0, 0, 1, 1)),
      polygon({ LNAM: "BB" }, box(1, 0, 2, 1)),
    ]);

    expect(features).toHaveLength(2);
  });

  test("features with no LNAM are each their own anchor", () => {
    const features = anchors([
      polygon({}, box(0, 0, 1, 1)),
      polygon({}, box(0, 0, 1, 1)),
    ]);

    expect(features).toHaveLength(2);
  });

  test("each interval is its own group, and carries its range", () => {
    // Two copies of one feature, one per interval of the copy ladder. Merged
    // into a single group they would produce one anchor stamped for no
    // interval at all, which draws at every zoom.
    const features = anchors([
      polygon({ LNAM: "AA", _QZMIN: 8, _QZMAX: 9 }, box(0, 0, 1, 1)),
      polygon({ LNAM: "AA", _QZMIN: 10 }, box(0, 0, 1, 1)),
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
    const features = anchors([
      polygon({ LNAM: "AA", _QZMAX: 5, _QFALL: 1 }, box(0, 0, 1, 1)),
    ]);

    expect(features).toHaveLength(1);
    expect(features[0].properties._QFALL).toBe(1);
    expect(features[0].properties._QZMAX).toBe(5);
  });
});

describe("what the anchor carries", () => {
  test("CLASS, RESTRN, CATREA, INTU and CSCALE, verbatim", () => {
    const features = anchors(
      [
        polygon(
          { LNAM: "AA", RESTRN: "1,2", CATREA: "9", INTU: 4, CSCALE: 80000 },
          box(0, 0, 1, 1),
        ),
      ],
      { className: "MIPARE" },
    );

    expect(features).toHaveLength(1);
    expect(features[0].properties).toMatchObject({
      CLASS: "MIPARE",
      RESTRN: "1,2",
      CATREA: "9",
      INTU: 4,
      CSCALE: 80000,
    });
  });

  test("absent attributes stay ABSENT, not sentinels", () => {
    // The style's RESTRN/CATREA branch filters read presence; a made-up value
    // here would push the anchor into the wrong branch.
    const features = anchors([polygon({ LNAM: "AA" }, box(0, 0, 1, 1))]);

    expect(features[0].properties).not.toHaveProperty("RESTRN");
    expect(features[0].properties).not.toHaveProperty("CATREA");
    expect(features[0].properties).not.toHaveProperty("INTU");
  });

  test("AREA is the SUMMED area of the whole group", () => {
    const one = anchors([polygon({ LNAM: "AA" }, box(0, 0, 1, 1))])[0]
      .properties.AREA;
    const both = anchors([
      polygon({ LNAM: "BB" }, box(0, 0, 1, 1)),
      polygon({ LNAM: "BB" }, box(1, 0, 2, 1)),
    ])[0].properties.AREA;

    expect(both).toBeCloseTo(one * 2, 6);
  });

  test("every anchor is exempt from dot-dropping", () => {
    // There is exactly ONE anchor per feature. Dropped, the feature loses its
    // symbol at that zoom with nothing to fall back on. See bin/s57-to-tiles
    // step 4.
    const features = anchors([polygon({ LNAM: "AA" }, box(0, 0, 1, 1))]);

    expect(features[0].tippecanoe).toEqual({ minzoom: 0 });
  });
});

describe("the cross-cell election", () => {
  /**
   * The measured defect: LNAM is issued PER CELL, so one dumping ground
   * digitised across US5OR2JC/US5OR2KC/US4OR1IF is three features with three
   * LNAMs and drew three stacks of crossed anchors on one physical area. The
   * cached roster is what lets each cell see the other parts; the smallest
   * DSNM in the component emits and the rest stand down.
   */
  const SPOIL = { CATDPG: "1", INFORM: "Spoil ground" };

  /** This cell's own half of one dumping ground, east of the shared border. */
  const east = [
    polygon(
      // LNAM and the per-cell TXTDSC differ between the halves by construction
      // and are excluded from the identity, which is the whole reason the two
      // cells recognise each other's part at all.
      { LNAM: "AA", TXTDSC: "US5OR2KC.TXT", ...SPOIL },
      box(1, 0, 2, 1),
    ),
  ];

  test("the smallest DSNM in the component emits its anchor", () => {
    const features = elect(east, {
      dsnm: "US5OR2AA",
      evidence: [{ content: SPOIL, dsnm: "US5OR2KC", ring: box(0, 0, 1, 1) }],
    });

    expect(features).toHaveLength(1);
  });

  test("...and the cells it beat emit nothing", () => {
    const features = elect(east, {
      dsnm: "US5OR2KC",
      evidence: [{ content: SPOIL, dsnm: "US5OR2AA", ring: box(0, 0, 1, 1) }],
    });

    expect(features).toEqual([]);
  });

  test("the elected anchor carries the WHOLE component's area", () => {
    // AREA is what the style's screen-size floor reads. The elected cell's own
    // share can be a corner offcut a few metres across, and the surviving
    // anchor stands for the whole feature.
    const alone = elect(east, { dsnm: "US5OR2AA" })[0].properties.AREA;
    const whole = elect(east, {
      dsnm: "US5OR2AA",
      evidence: [
        { content: SPOIL, dsnm: "US5OR2KC", ring: box(0, 0, 1, 1) },
        { content: SPOIL, dsnm: "US5OR2ZZ", ring: box(2, 0, 3, 1) },
      ],
    })[0].properties.AREA;

    expect(whole).toBeCloseTo(alone * 3, 6);
  });

  test("the elected cell places its anchor over the WHOLE component", () => {
    // The defect this replaced: the elected cell is frequently the one holding
    // the corner offcut -- US5OR2KC's sliver of a PIPARE that mostly lies on
    // US5OR2KD -- and the one surviving symbol sat inside that sliver, at the
    // extreme edge of the physical area and at overzoom visibly outside it.
    // The anchor is placed over the component, not over this cell's share.
    const sliver = box(1, 0, 1.02, 1);
    const rest = box(0, 0, 1, 1);
    const features = elect([polygon({ LNAM: "AA", ...SPOIL }, sliver)], {
      dsnm: "US5OR2AA",
      evidence: [{ content: SPOIL, dsnm: "US5OR2KC", ring: rest }],
    });

    expect(features).toHaveLength(1);
    const point = features[0].geometry.coordinates;
    expect(inRing(point, rest)).toBe(true);
    expect(inRing(point, sliver)).toBe(false);

    // ...and it is still MEASURED as the whole component, not as the sliver.
    const sliverAlone = elect([polygon({ LNAM: "AA", ...SPOIL }, sliver)], {
      dsnm: "US5OR2AA",
    })[0].properties.AREA;
    const restAlone = elect([polygon({ LNAM: "AA", ...SPOIL }, rest)], {
      dsnm: "US5OR2AA",
    })[0].properties.AREA;
    expect(features[0].properties.AREA).toBeCloseTo(sliverAlone + restAlone, 6);
  });

  test("the water-side rule ranks over the component's parts too", () => {
    // The largest WATER-SIDE part of the whole physical area, not of this
    // cell's share of it: here the sliver is nine tenths ashore. --land covers
    // this cell only, so a neighbour's part beyond this cell's LNDARE measures
    // as all water -- accepted deliberately, since that is exactly what the
    // neighbour knew when it placed its own anchor before the election existed.
    const sliver = box(1, 0, 1.02, 1);
    const rest = box(0, 0, 1, 1);
    const features = elect([polygon({ LNAM: "AA", ...SPOIL }, sliver)], {
      dsnm: "US5OR2AA",
      evidence: [{ content: SPOIL, dsnm: "US5OR2KC", ring: rest }],
      land: [polygon({}, box(1, 0, 1.02, 0.9))],
    });

    expect(features).toHaveLength(1);
    expect(inRing(features[0].geometry.coordinates, rest)).toBe(true);
    expect(inRing(features[0].geometry.coordinates, sliver)).toBe(false);
  });

  test("a component is followed THROUGH the cells that bridge it", () => {
    // This cell touches only US5OR2KC, but US5OR2KC touches US4OR1AA, so all
    // four parts are one area and the smallest name of the four wins. Every
    // cell is handed the same roster, so every cell reaches this same verdict
    // from its own viewpoint -- which is what an election with no
    // communication needs.
    const features = elect(east, {
      dsnm: "US5OR2KC",
      evidence: [
        { content: SPOIL, dsnm: "US5OR2ZZ", ring: box(0, 0, 1, 1) },
        { content: SPOIL, dsnm: "US4OR1AA", ring: box(-1, 0, 0, 1) },
      ],
    });

    expect(features).toEqual([]);
  });

  test("disjoint components elect independently", () => {
    // Two separate physical areas that happen to state the same thing: the one
    // continued by a smaller-named chart stands down, the one that continues
    // nowhere keeps its anchor.
    const features = elect(
      [
        polygon({ LNAM: "AA", ...SPOIL }, box(1, 0, 2, 1)),
        polygon({ LNAM: "BB", ...SPOIL }, box(10, 0, 11, 1)),
      ],
      {
        dsnm: "US5OR2KC",
        evidence: [{ content: SPOIL, dsnm: "US5OR2AA", ring: box(0, 0, 1, 1) }],
      },
    );

    expect(features).toHaveLength(1);
    expect(features[0].geometry.coordinates[0]).toBeGreaterThan(9);
  });

  test("a neighbour with DIFFERENT content is a different area", () => {
    // Any surviving attribute difference and they are two areas, whatever the
    // topology did -- the same rule the boundary merge applies to a seam.
    const features = elect(east, {
      dsnm: "US5OR2KC",
      evidence: [
        {
          content: { ...SPOIL, INFORM: "Disused" },
          dsnm: "US5OR2AA",
          ring: box(0, 0, 1, 1),
        },
      ],
    });

    expect(features).toHaveLength(1);
  });

  test("a neighbour of another CLASS is a different area", () => {
    const features = elect(east, {
      dsnm: "US5OR2KC",
      evidence: [
        {
          className: "PIPARE",
          content: SPOIL,
          dsnm: "US5OR2AA",
          ring: box(0, 0, 1, 1),
        },
      ],
    });

    expect(features).toHaveLength(1);
  });

  test("a neighbour on another RUNG is a different compilation", () => {
    // Same band only: a coarser edition's copy of an area is not a part of the
    // finer one's, and the copy ladder already keeps their zooms apart.
    const features = elect(east, {
      dsnm: "US5OR2KC",
      evidence: [
        { content: SPOIL, dsnm: "US4OR1AA", ring: box(0, 0, 1, 1), floor: 6 },
      ],
    });

    expect(features).toHaveLength(1);
  });

  test("a neighbour nowhere near this cell's parts is not its component", () => {
    const features = elect(east, {
      dsnm: "US5OR2KC",
      evidence: [{ content: SPOIL, dsnm: "US5OR2AA", ring: box(20, 0, 21, 1) }],
    });

    expect(features).toHaveLength(1);
    expect(features[0].properties.AREA).toBeCloseTo(
      elect(east, { dsnm: "US5OR2KC" })[0].properties.AREA,
      6,
    );
  });

  test("a neighbour OVERLAPPING this cell's part counts as one area", () => {
    // The roster holds each cell's UNCLIPPED geometry while this cell's parts
    // have been through the quilt clip, and cell coverages are not a perfect
    // tiling: a part swallowed inside a neighbour's copy has no vertex
    // anywhere near an edge of it, so touching alone would miss it.
    const features = elect(
      [polygon({ LNAM: "AA", ...SPOIL }, box(1, 0, 2, 1))],
      {
        dsnm: "US5OR2KC",
        evidence: [{ content: SPOIL, dsnm: "US5OR2AA", ring: box(0, 0, 3, 2) }],
      },
    );

    expect(features).toEqual([]);
  });

  test("with no roster at all every group keeps its own anchor", () => {
    // An unpartitioned cell, or an older cache: the election is inert and the
    // behaviour is exactly what shipped before it existed.
    expect(anchors(east, { className: "DMPGRD" })).toHaveLength(1);
  });

  test("a roster with no name or no rung to compare on is inert", () => {
    const path = writeCollection("DMPGRD.geojson", east);
    const evidence = roster([
      { content: SPOIL, dsnm: "US5OR2AA", ring: box(0, 0, 1, 1) },
    ]);

    // Without --dsnm this cell cannot know which candidate it is; without
    // --cell-floor it cannot tell a same-band neighbour from another edition.
    expect(
      run(
        "--class",
        `DMPGRD:${path}`,
        "--area-evidence",
        evidence,
        "--cell-floor",
        "8",
      ),
    ).toHaveLength(1);
    expect(
      run(
        "--class",
        `DMPGRD:${path}`,
        "--area-evidence",
        evidence,
        "--dsnm",
        "US5OR2KC",
      ),
    ).toHaveLength(1);
  });

  test("an elected component keeps ONE anchor PER INTERVAL", () => {
    // A partitioned cell exports each feature as zoom-range COPIES, one per
    // rung of the copy ladder, and they draw at zooms none of the others
    // cover. The election is per interval for exactly that reason: a rule
    // keeping one group per component kept the lowest rung alone, and the
    // area lost its symbol above it -- measured on US4OR1IF, whose band-4
    // anchors went 19 -> 0 at z12 with the polygons still there.
    const features = elect(
      [
        polygon(
          { LNAM: "AA", _QZMIN: 11, _QZMAX: 11, ...SPOIL },
          box(1, 0, 2, 1),
        ),
        polygon({ LNAM: "AA", _QZMIN: 12, ...SPOIL }, box(1, 0, 2, 1)),
      ],
      {
        // This cell wins the component, so what it emits is all there is.
        dsnm: "US5OR2AA",
        evidence: [
          { content: SPOIL, dsnm: "US5OR2AA", ring: box(1, 0, 2.1, 1) },
          { content: SPOIL, dsnm: "US5OR2KC", ring: box(0, 0, 1, 1) },
        ],
      },
    );

    expect(features).toHaveLength(2);
    // Each carries its own range, so bin/stamp-quilt-zooms gives the two
    // anchors the disjoint zoom bounds their source copies had.
    expect(
      features.map((f) => f.properties._QZMIN).sort((a, b) => a - b),
    ).toEqual([11, 12]);
    expect(
      features.find((f) => f.properties._QZMIN === 11).properties._QZMAX,
    ).toBe(11);
    expect(
      features.find((f) => f.properties._QZMIN === 12).properties,
    ).not.toHaveProperty("_QZMAX");
    // Both are the same elected anchor: one area, measured and placed as the
    // whole component at each of its ranges.
    expect(features[0].geometry).toEqual(features[1].geometry);
    expect(features[0].properties.AREA).toBeCloseTo(
      features[1].properties.AREA,
      12,
    );
  });

  test("each interval is elected on its own, and all of them the same way", () => {
    // The roster is interval-agnostic, so the copy ladder's copies of one
    // suppressed feature are suppressed together: a copy that survived would
    // draw the duplicate symbol at its own zooms only.
    const features = elect(
      [
        polygon(
          { LNAM: "AA", _QZMIN: 8, _QZMAX: 9, ...SPOIL },
          box(1, 0, 2, 1),
        ),
        polygon({ LNAM: "AA", _QZMIN: 10, ...SPOIL }, box(1, 0, 2, 1)),
      ],
      {
        dsnm: "US5OR2KC",
        evidence: [{ content: SPOIL, dsnm: "US5OR2AA", ring: box(0, 0, 1, 1) }],
      },
    );

    expect(features).toEqual([]);
  });
});

describe("several classes in one run", () => {
  test("each class file keeps its own CLASS on its anchors", () => {
    const resare = writeCollection("RESARE.geojson", [
      polygon({ LNAM: "AA" }, box(0, 0, 1, 1)),
    ]);
    const cblare = writeCollection("CBLARE.geojson", [
      polygon({ LNAM: "BB" }, box(5, 5, 6, 6)),
    ]);
    const features = run(
      "--class",
      `RESARE:${resare}`,
      "--class",
      `CBLARE:${cblare}`,
    );

    expect(features.map((f) => f.properties.CLASS).sort()).toEqual([
      "CBLARE",
      "RESARE",
    ]);
  });
});

describe("nothing to say", () => {
  test("a class file with no features writes an empty collection", () => {
    expect(anchors([])).toEqual([]);
  });

  test("a missing land file is tolerated", () => {
    const path = writeCollection("RESARE.geojson", [
      polygon({ LNAM: "AA" }, box(0, 0, 1, 1)),
    ]);
    const features = run(
      "--class",
      `RESARE:${path}`,
      "--land",
      join(work, "no-such-LNDARE.geojson"),
    );

    expect(features).toHaveLength(1);
  });
});
