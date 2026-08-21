/**
 * Fixture runs of bin/generate-area-anchors.
 *
 * The script is invoked the way bin/s57-to-tiles invokes it -- as a child
 * process over GeoJSON files -- because that is the whole of its contract.
 *
 * The defect it exists to remove: tippecanoe clips each area polygon into
 * every tile it touches and MapLibre draws the centred symbol once per
 * fragment whose pole of inaccessibility is in-tile, so a pilot boarding
 * area straddling a tile corner arrives as up to four identical diamonds.
 * One anchor per (CLASS, LNAM, interval), inside the largest fragment, is
 * the fix.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const SCRIPT = fileURLToPath(
  new URL("../bin/generate-area-anchors", import.meta.url),
);

let work;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "area-anchors-"));
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

/** One class file, the way s57-to-tiles calls it. */
function anchors(features, { className = "CTNARE" } = {}) {
  const path = writeCollection(`${className}.geojson`, features);
  return run("--class", `${className}:${path}`);
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
      ({ className = "CTNARE", content = {}, dsnm, floor = 8, ring }) =>
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
  { className = "CTNARE", dsnm, cellFloor = 8, evidence = [] } = {},
) {
  const path = writeCollection(`${className}.geojson`, features);
  return run(
    "--class",
    `${className}:${path}`,
    "--area-evidence",
    roster(evidence),
    "--dsnm",
    dsnm,
    "--cell-floor",
    String(cellFloor),
  );
}

/**
 * The lattice step the emitted grid stands on, read back off the anchors.
 *
 * The nodes are integer multiples of the step counted from (0, 0), so the
 * smallest gap between distinct coordinates IS the step. The guaranteed
 * pointOnSurface anchor is always the FIRST feature of a group and is not on
 * the lattice, so it is dropped before measuring.
 */
function latticeStep(features) {
  const smallestGap = (values) => {
    const unique = [...new Set(values)].sort((a, b) => a - b);
    let smallest = Infinity;
    for (let i = 1; i < unique.length; i++) {
      smallest = Math.min(smallest, unique[i] - unique[i - 1]);
    }
    return smallest;
  };
  const nodes = features
    .slice(1)
    .map((feature) => feature.geometry.coordinates);
  return {
    lon: smallestGap(nodes.map(([x]) => x)),
    lat: smallestGap(nodes.map(([, y]) => y)),
  };
}

/** GRID_SPACING_PIXELS' worth of longitude at `zoom`, the generator's step. */
function stepAt(zoom) {
  return (512 * 360) / (512 * 2 ** zoom);
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

describe("largest-fragment placement", () => {
  test("the anchor is the plain interior point of the fragment", () => {
    // No water-side pass here, deliberately: these classes are drawn to the
    // water they regulate, so the natural label point is already right.
    const features = anchors([polygon({ LNAM: "0001" }, box(0, 0, 2, 1))]);

    expect(features).toHaveLength(1);
    expect(features[0].geometry.coordinates).toEqual([1, 0.5]);
  });

  test("a multi-part feature anchors in its LARGEST part", () => {
    // classifyRings gives a multi-part area one symbol per part, so the parts
    // are a duplication source of their own; the anchor picks the biggest,
    // exactly as bin/generate-labels places a name.
    const big = box(0, 0, 3, 3);
    const features = anchors([
      multiPolygon({ LNAM: "0002" }, [big], [box(5, 0, 6, 1)]),
    ]);

    expect(features).toHaveLength(1);
    expect(inRing(features[0].geometry.coordinates, big)).toBe(true);
  });

  test("fragments split across FEATURES still anchor in the largest", () => {
    // The quilt clip hands one LNAM back as several features; the group is
    // the feature, and the anchor sits in the biggest surviving fragment.
    const big = box(2, 0, 5, 2);
    const features = anchors([
      polygon({ LNAM: "0003" }, box(0, 0, 1, 1)),
      polygon({ LNAM: "0003" }, big),
    ]);

    expect(features).toHaveLength(1);
    expect(inRing(features[0].geometry.coordinates, big)).toBe(true);
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
    // LNAM is the identity: two abutting but distinct areas keep their own
    // symbols, which is why this is not a contiguity grouping.
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
    // interval at all, which draws at every zoom. RESARE, a FILLED class, so
    // each interval keeps exactly ONE anchor -- a no-fill class would grid
    // (see "the no-fill grid repeat" below).
    const features = anchors(
      [
        polygon({ LNAM: "AA", _QZMIN: 8, _QZMAX: 9 }, box(0, 0, 1, 1)),
        polygon({ LNAM: "AA", _QZMIN: 10 }, box(0, 0, 1, 1)),
      ],
      { className: "RESARE" },
    );

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
  test("the WHOLE property bag of the fragment, verbatim", () => {
    // The retargeted layers' filters branch on each class's own attributes
    // (CATPIL here, CATBRG/WATLEV/CONRAD elsewhere), so nothing short of the
    // whole bag keeps every branch fed. SCAMIN/SCAMAX are the one deliberate
    // exception: PILBOP is a no-fill grid class, and for those the interval
    // floor owns scale gating -- see "the no-fill grid repeat" below.
    const features = anchors(
      [
        polygon(
          {
            LNAM: "AA",
            CATPIL: 1,
            OBJNAM: "Port Angeles pilot boarding",
            SCAMIN: 119999,
            INTU: 4,
            CSCALE: 45000,
          },
          box(0, 0, 1, 1),
        ),
      ],
      { className: "PILBOP" },
    );

    expect(features).toHaveLength(1);
    expect(features[0].properties).toMatchObject({
      CLASS: "PILBOP",
      LNAM: "AA",
      CATPIL: 1,
      OBJNAM: "Port Angeles pilot boarding",
      INTU: 4,
      CSCALE: 45000,
    });
    expect(features[0].properties).not.toHaveProperty("SCAMIN");
  });

  test("the bag comes from the LARGEST fragment", () => {
    // Where the quilt's copies of one feature disagree, the fragment that
    // supplies the anchor point supplies the attributes too.
    const features = anchors([
      polygon({ LNAM: "AA", WATLEV: 3 }, box(0, 0, 1, 1)),
      polygon({ LNAM: "AA", WATLEV: 2 }, box(2, 0, 5, 2)),
    ]);

    expect(features).toHaveLength(1);
    expect(features[0].properties.WATLEV).toBe(2);
  });

  test("underscore properties do not ride the bag; the interval does", () => {
    // _QZMIN/_QZMAX/_QFALL are re-added deliberately as the group's range;
    // any other pipeline-internal property stays off the anchor. RESARE, a
    // filled class, so the interval stamp does not also turn on the grid.
    const features = anchors(
      [
        polygon(
          { LNAM: "AA", CATREA: "9", _QZMIN: 8, _MARK: 1 },
          box(0, 0, 1, 1),
        ),
      ],
      { className: "RESARE" },
    );

    expect(features).toHaveLength(1);
    expect(features[0].properties).toMatchObject({ CATREA: "9", _QZMIN: 8 });
    expect(features[0].properties).not.toHaveProperty("_MARK");
  });

  test("absent attributes stay ABSENT, not sentinels", () => {
    // The retargeted filters read presence; a made-up value here would push
    // the anchor into the wrong branch. GDAL's null columns carry nothing.
    const features = anchors([
      polygon({ LNAM: "AA", CATPIL: null }, box(0, 0, 1, 1)),
    ]);

    expect(features[0].properties).not.toHaveProperty("CATPIL");
    expect(features[0].properties).not.toHaveProperty("RESTRN");
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
   * LNAM is issued PER CELL, so an area split by a chart border is several
   * features with several LNAMs and drew a stack of centred symbols per cell it
   * reaches -- a PIPARE at the US5OR2JC/JD/KC/KD corner came out as eight. The
   * cached roster is what lets each cell see the other parts; the smallest DSNM
   * in the component emits and the rest stand down. See bin/quilt-election.mjs.
   */
  const CAUTION = { INFORM: "Caution: submarine exercise area" };

  /** This cell's own half of one area, east of the shared border. */
  const east = [polygon({ LNAM: "AA", ...CAUTION }, box(1, 0, 2, 1))];

  test("the smallest DSNM in the component emits its anchor", () => {
    const features = elect(east, {
      dsnm: "US5OR2AA",
      evidence: [{ content: CAUTION, dsnm: "US5OR2KC", ring: box(0, 0, 1, 1) }],
    });

    expect(features).toHaveLength(1);
  });

  test("...and the cells it beat emit nothing", () => {
    const features = elect(east, {
      dsnm: "US5OR2KC",
      evidence: [{ content: CAUTION, dsnm: "US5OR2AA", ring: box(0, 0, 1, 1) }],
    });

    expect(features).toEqual([]);
  });

  test("the elected anchor carries the WHOLE component's area", () => {
    // AREA is what the style's screen-size floor reads, and the elected cell's
    // own share can be a corner offcut a few metres across.
    const alone = elect(east, { dsnm: "US5OR2AA" })[0].properties.AREA;
    const whole = elect(east, {
      dsnm: "US5OR2AA",
      evidence: [
        { content: CAUTION, dsnm: "US5OR2KC", ring: box(0, 0, 1, 1) },
        { content: CAUTION, dsnm: "US5OR2ZZ", ring: box(2, 0, 3, 1) },
      ],
    })[0].properties.AREA;

    expect(whole).toBeCloseTo(alone * 3, 6);
  });

  test("the elected cell places its anchor over the WHOLE component", () => {
    // The elected cell is frequently the one holding the corner offcut -- a
    // sliver of an area that mostly lies on the neighbour -- and an anchor
    // placed inside the sliver sits at the extreme edge of the physical area,
    // at overzoom visibly outside it. The largest fragment is chosen among this
    // cell's parts AND the component's parts in the other cells.
    const sliver = box(1, 0, 1.02, 1);
    const rest = box(0, 0, 1, 1);
    const features = elect([polygon({ LNAM: "AA", ...CAUTION }, sliver)], {
      dsnm: "US5OR2AA",
      evidence: [{ content: CAUTION, dsnm: "US5OR2KC", ring: rest }],
    });

    expect(features).toHaveLength(1);
    const point = features[0].geometry.coordinates;
    expect(inRing(point, rest)).toBe(true);
    expect(inRing(point, sliver)).toBe(false);

    // ...and it is still MEASURED as the whole component, not as the sliver.
    const sliverAlone = elect([polygon({ LNAM: "AA", ...CAUTION }, sliver)], {
      dsnm: "US5OR2AA",
    })[0].properties.AREA;
    const restAlone = elect([polygon({ LNAM: "AA", ...CAUTION }, rest)], {
      dsnm: "US5OR2AA",
    })[0].properties.AREA;
    expect(features[0].properties.AREA).toBeCloseTo(sliverAlone + restAlone, 6);
  });

  test("...but the property bag stays THIS cell's", () => {
    // Only the placement polygon may be a neighbour's: the attributes are this
    // chart's compilation of the area, and the roster carries no bag at all --
    // its own columns (DSNM, QFLOOR, CONTENT) must never reach an anchor.
    const sliver = box(1, 0, 1.02, 1);
    const rest = box(0, 0, 1, 1);
    const features = elect(
      [polygon({ LNAM: "AA", CATCTS: 4, ...CAUTION }, sliver)],
      {
        dsnm: "US5OR2AA",
        evidence: [
          {
            content: { ...CAUTION, CATCTS: 4 },
            dsnm: "US5OR2KC",
            ring: rest,
          },
        ],
      },
    );

    expect(features).toHaveLength(1);
    expect(inRing(features[0].geometry.coordinates, rest)).toBe(true);
    expect(features[0].properties.CATCTS).toBe(4);
    expect(features[0].properties).not.toHaveProperty("DSNM");
    expect(features[0].properties).not.toHaveProperty("QFLOOR");
    expect(features[0].properties).not.toHaveProperty("CONTENT");
  });

  test("disjoint components elect independently", () => {
    const features = elect(
      [
        polygon({ LNAM: "AA", ...CAUTION }, box(1, 0, 2, 1)),
        polygon({ LNAM: "BB", ...CAUTION }, box(10, 0, 11, 1)),
      ],
      {
        dsnm: "US5OR2KC",
        evidence: [
          { content: CAUTION, dsnm: "US5OR2AA", ring: box(0, 0, 1, 1) },
        ],
      },
    );

    expect(features).toHaveLength(1);
    expect(features[0].properties.LNAM).toBe("BB");
  });

  test("a neighbour with different content, class or rung is another area", () => {
    for (const entry of [
      { content: { INFORM: "Something else" }, dsnm: "US5OR2AA" },
      { className: "PILBOP", content: CAUTION, dsnm: "US5OR2AA" },
      { content: CAUTION, dsnm: "US4OR1AA", floor: 6 },
    ]) {
      const features = elect(east, {
        dsnm: "US5OR2KC",
        evidence: [{ ...entry, ring: box(0, 0, 1, 1) }],
      });

      expect(features, JSON.stringify(entry)).toHaveLength(1);
    }
  });

  test("an elected component keeps ONE anchor PER INTERVAL", () => {
    // A partitioned cell exports each feature as zoom-range COPIES, one per
    // rung of the copy ladder, and they draw at zooms none of the others
    // cover. The election is per interval for exactly that reason: a rule
    // keeping one group per component kept the lowest rung alone, and the
    // area lost its symbol above it -- measured on US4OR1IF, whose band-4
    // anchors went 19 -> 0 at z12 with the polygons still there. RESARE, a
    // FILLED class, so each interval is exactly one anchor and the geometry
    // comparison below holds; a no-fill class grids per interval instead.
    const features = elect(
      [
        polygon(
          { LNAM: "AA", _QZMIN: 11, _QZMAX: 11, ...CAUTION },
          box(1, 0, 2, 1),
        ),
        polygon({ LNAM: "AA", _QZMIN: 12, ...CAUTION }, box(1, 0, 2, 1)),
      ],
      {
        className: "RESARE",
        // This cell wins the component, so what it emits is all there is.
        dsnm: "US5OR2AA",
        evidence: [
          {
            className: "RESARE",
            content: CAUTION,
            dsnm: "US5OR2AA",
            ring: box(1, 0, 2.1, 1),
          },
          {
            className: "RESARE",
            content: CAUTION,
            dsnm: "US5OR2KC",
            ring: box(0, 0, 1, 1),
          },
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

  test("with no roster at all every group keeps its own anchor", () => {
    expect(anchors(east)).toHaveLength(1);
  });
});

describe("the no-fill grid repeat", () => {
  /**
   * The classes nothing paints -- no AC()/AP() fill in either vendored
   * boundary table, no plotroom-owned ground -- have only their centred
   * symbol to say the area exists, and ONE point per elected component left
   * it tens of km off-screen on a multi-cell swept area at high zoom. Those
   * classes (GRID_REPEAT_CLASSES) emit a lattice of anchors instead: global
   * (multiples of the step from lon/lat 0, so every cell derives the same
   * grid), spaced ~512 px of screen at the DEEPEST zoom the copy serves,
   * capped, and always joined by the guaranteed pointOnSurface anchor.
   * SWPARE -- the motivating class, `SY(SWPARE51);TE('swept to %5.1lf',...)`,
   * no fill -- plays the grid side; RESARE (plotroom's restricted-area tint)
   * the filled side.
   */

  test("a large component grids: many points, all inside, order-blind", () => {
    // 512 px at the z11 floor is ~0.176 deg of longitude; two fragments of
    // one LNAM spanning 2.5 x 1 deg hold dozens of lattice nodes.
    const west = box(0, 0, 1, 1);
    const east = box(1, 0, 2.5, 1);
    const parts = [
      polygon({ LNAM: "AA", DRVAL1: 18.2, _QZMIN: 11 }, west),
      polygon({ LNAM: "AA", DRVAL1: 18.2, _QZMIN: 11 }, east),
    ];
    const forward = anchors(parts, { className: "SWPARE" });
    const reversed = anchors([...parts].reverse(), { className: "SWPARE" });

    expect(forward.length).toBeGreaterThan(1);
    for (const feature of forward) {
      const point = feature.geometry.coordinates;
      expect(inRing(point, west) || inRing(point, east)).toBe(true);
      // The whole bag rides on EVERY point: the "swept to X" text companion
      // binds per anchor client-side.
      expect(feature.properties.CLASS).toBe("SWPARE");
      expect(feature.properties.DRVAL1).toBe(18.2);
      expect(feature.properties._QZMIN).toBe(11);
      expect(feature.tippecanoe).toEqual({ minzoom: 0 });
    }
    // The lattice is GLOBAL -- integer multiples of the step -- so the node
    // set survives any input order.
    const keys = (features) =>
      features.map((f) => f.geometry.coordinates.join(",")).sort();
    expect(keys(reversed)).toEqual(keys(forward));
  });

  test("a small component keeps exactly ONE symbol: the guaranteed point", () => {
    // Far smaller than the z12 step (~0.088 deg), so the lattice puts no
    // node inside and the pointOnSurface fallback is the whole answer.
    const small = box(0.4, 0.4, 0.41, 0.41);
    const features = anchors([polygon({ LNAM: "AA", _QZMIN: 12 }, small)], {
      className: "SWPARE",
    });

    expect(features).toHaveLength(1);
    expect(inRing(features[0].geometry.coordinates, small)).toBe(true);
  });

  test("grid classes drop SCAMIN/SCAMAX; filled classes keep them", () => {
    // The interval floor owns scale gating for the no-fill classes:
    // rescheme-era cells stamp SCAMIN ~1.1x CSCALE, which gates ~1.6 zooms
    // later than the floor the copy serves -- a band where the copy is in
    // the tile and its only symbol is hidden. Class-scoped, so it holds on
    // the single-anchor path too. Filled classes inherit exactly as before.
    const bag = { LNAM: "AA", SCAMIN: 119999, SCAMAX: 21999 };
    const swept = anchors([polygon(bag, box(0, 0, 1, 1))], {
      className: "SWPARE",
    });
    expect(swept).toHaveLength(1);
    expect(swept[0].properties).not.toHaveProperty("SCAMIN");
    expect(swept[0].properties).not.toHaveProperty("SCAMAX");

    const restricted = anchors([polygon(bag, box(0, 0, 1, 1))], {
      className: "RESARE",
    });
    expect(restricted).toHaveLength(1);
    expect(restricted[0].properties).toMatchObject({
      SCAMIN: 119999,
      SCAMAX: 21999,
    });
  });

  test("a runaway component is coarsened to the point cap", () => {
    // The z14 step is ~0.022 deg, so 2 x 2 deg is ~8000 lattice nodes; the
    // step doubles (still a global lattice, so coverage stays even) until
    // the total -- guaranteed point included -- fits the 256 cap.
    const big = box(0, 0, 2, 2);
    const features = anchors([polygon({ LNAM: "AA", _QZMIN: 14 }, big)], {
      className: "SWPARE",
    });

    expect(features.length).toBeGreaterThan(1);
    expect(features.length).toBeLessThanOrEqual(256);
    for (const feature of features) {
      expect(inRing(feature.geometry.coordinates, big)).toBe(true);
    }
  });

  test("a BOUNDED interval is sized at its ceiling, not its floor", () => {
    // A ground step spans MORE screen pixels the deeper the zoom, so the
    // sparsest the lattice ever looks is at the interval's CEILING -- that is
    // where the ~512 px target has to be met, and sizing at the floor met it
    // only at the one zoom where the copy looked its best.
    const ring = box(0, 44, 2, 45);
    const whole = latticeStep(
      anchors([polygon({ LNAM: "AA", _QZMIN: 10, _QZMAX: 11 }, ring)], {
        className: "SWPARE",
      }),
    );
    const ceiling = latticeStep(
      anchors([polygon({ LNAM: "AA", _QZMIN: 11, _QZMAX: 11 }, ring)], {
        className: "SWPARE",
      }),
    );
    const floor = latticeStep(
      anchors([polygon({ LNAM: "AA", _QZMIN: 10, _QZMAX: 10 }, ring)], {
        className: "SWPARE",
      }),
    );

    // [10..11] is sized exactly as [11..11] -- one zoom finer than the floor
    // sizing it used to get, which is 2x the points along each axis.
    expect(whole.lon).toBeCloseTo(ceiling.lon, 9);
    expect(whole.lon).toBeCloseTo(stepAt(11), 9);
    expect(floor.lon).toBeCloseTo(whole.lon * 2, 9);
  });

  test("an open-ended top copy is sized two zooms below its floor", () => {
    // The top copy has no ceiling: it runs to the tiling maxzoom and past it
    // through overzoom. Two zooms down is the representative deep zoom --
    // past that the spacing passes ~2048 px, which the pyramid cap below
    // makes moot.
    const ring = box(0, 44, 2, 45);
    const open = latticeStep(
      anchors([polygon({ LNAM: "AA", _QZMIN: 9 }, ring)], {
        className: "SWPARE",
      }),
    );

    expect(open.lon).toBeCloseTo(stepAt(11), 9);
  });

  test("no interval is sized past the top of the tile pyramid", () => {
    // Deeper than z13 there is no tile to be sparse in: the client overzooms
    // the deepest one, which stretches the anchors already inside it. A copy
    // floored at 12 or 13 therefore sizes at 13, not 14 or 15.
    const ring = box(0, 0, 0.5, 0.3);
    const deep = latticeStep(
      anchors([polygon({ LNAM: "AA", _QZMIN: 12 }, ring)], {
        className: "SWPARE",
      }),
    );
    const deeper = latticeStep(
      anchors([polygon({ LNAM: "AA", _QZMIN: 13 }, ring)], {
        className: "SWPARE",
      }),
    );
    // ...and a bounded copy whose ceiling is above the pyramid is capped the
    // same way, rather than minting four times the points for tiles that do
    // not exist.
    const bounded = latticeStep(
      anchors([polygon({ LNAM: "AA", _QZMIN: 12, _QZMAX: 15 }, ring)], {
        className: "SWPARE",
      }),
    );

    expect(deep.lon).toBeCloseTo(stepAt(13), 9);
    expect(deeper.lon).toBeCloseTo(stepAt(13), 9);
    expect(bounded.lon).toBeCloseTo(stepAt(13), 9);
  });

  test("the latitude step is quantized to a 5-degree cos band", () => {
    // The lattice is exactly global in LONGITUDE -- the step is a function of
    // the sizing zoom alone -- but the latitude step carries a cos(latitude)
    // factor, and the latitude it was taken at was the joint bbox of this
    // cell's parts PLUS the component roster. Five classes are never in that
    // roster (BERTHS, CHKPNT, HRBFAC, MAGVAR, RCTLPT) and every ALONE or
    // degraded group has an empty one, so the mid-latitude was per CELL and
    // the rows drifted across the seam (47.0274 against 47.0564, measured).
    // Rounded to a 5-degree band, two cells of one component agree unless
    // they fall either side of a band edge.
    const range = { LNAM: "AA", _QZMIN: 11, _QZMAX: 11 };
    const south = anchors([polygon(range, box(0, 43.5, 2, 44.5))], {
      className: "HRBFAC",
    });
    const north = anchors([polygon(range, box(2, 46.0, 4, 47.0))], {
      className: "HRBFAC",
    });

    // Same band (45), so the same step...
    const step = latticeStep(south).lat;
    expect(step).toBeCloseTo(latticeStep(north).lat, 12);
    expect(step).toBeCloseTo(stepAt(11) * Math.cos((45 * Math.PI) / 180), 9);
    // ...and, being multiples of it from zero, the same ROWS: the two halves
    // of a component sit on one lattice however the bboxes differ.
    for (const features of [south, north]) {
      for (const feature of features.slice(1)) {
        const rows = feature.geometry.coordinates[1] / step;
        expect(Math.abs(rows - Math.round(rows))).toBeLessThan(1e-9);
      }
    }
  });

  test("a lattice node UNDER the guaranteed anchor is dropped, not stacked", () => {
    // The guaranteed pointOnSurface anchor rides on top of the lattice, and a
    // node a symbol's width away from it is one symbol drawn twice, not two
    // statements about the area. The old test was 1e-9 degrees -- a tenth of
    // a millimetre, which only ever caught the exact hit.
    const step = stepAt(11);
    // The centre of the box, and so its pointOnSurface, offset from the node
    // at 5 steps by a twentieth of a step: far outside 1e-9, well inside the
    // quarter-step tolerance.
    const centre = 5 * step + step / 20;
    const ring = box(centre - 0.4, centre - 0.4, centre + 0.4, centre + 0.4);
    const features = anchors(
      [polygon({ LNAM: "AA", _QZMIN: 11, _QZMAX: 11 }, ring)],
      { className: "SWPARE" },
    );

    const [guaranteed, ...lattice] = features.map(
      (feature) => feature.geometry.coordinates,
    );
    expect(guaranteed[0]).toBeCloseTo(centre, 9);
    // The bbox holds a 5 x 5 block of nodes; 24 of them survive.
    expect(lattice).toHaveLength(24);
    for (const [x, y] of lattice) {
      const near =
        Math.abs(x - guaranteed[0]) < step / 4 &&
        Math.abs(y - guaranteed[1]) < step / 4;
      expect(near).toBe(false);
    }
  });

  test("a fallback continuation grids at the quilt floor minus one", () => {
    // The _QFALL copy serves the open-ended band BELOW the cell's quilt
    // floor; the deepest zoom it actually serves -- floor - 1 -- keys the
    // spacing. cellFloor 12 -> effective floor 11 -> step ~0.176 deg.
    const features = elect(
      [polygon({ LNAM: "AA", _QFALL: 1, _QZMAX: 11 }, box(0, 0, 1, 1))],
      { className: "SWPARE", dsnm: "US5WA2AA", cellFloor: 12 },
    );
    expect(features.length).toBeGreaterThan(1);
    // The same step a bounded copy sized at 11 gets: the fallback's deep end
    // IS the quilt floor minus one, so this arm needs no cap and no change.
    expect(latticeStep(features).lon).toBeCloseTo(
      latticeStep(
        anchors(
          [polygon({ LNAM: "AA", _QZMIN: 11, _QZMAX: 11 }, box(0, 0, 1, 1))],
          {
            className: "SWPARE",
          },
        ),
      ).lon,
      9,
    );

    // ...but WITHOUT --cell-floor (an unpartitioned legacy run) there is no
    // floor to size a screenful by, and the single anchor stands.
    const legacy = anchors(
      [polygon({ LNAM: "AA", _QFALL: 1, _QZMAX: 11 }, box(0, 0, 1, 1))],
      { className: "SWPARE" },
    );
    expect(legacy).toHaveLength(1);
  });
});

describe("the directed-leg split", () => {
  /**
   * RCTLPT with ORIENT is a traffic leg: bin/generate-tss-anchors stitches its
   * parts back into one lane and repeats an arrow along it, where this
   * generator's per-(CLASS, LNAM, interval) grouping drew one arrow per CELL
   * COPY -- eight, measured, on one lane through the Strait of Juan de Fuca.
   * Without ORIENT there is no leg and the plain SY(RTLDEF51) mark is this
   * generator's. See ORIENT_LEG_CLASSES in bin/quilt-anchors.mjs.
   */
  test("an ORIENT-carrying RCTLPT is left to the TSS anchors", () => {
    const features = anchors(
      [polygon({ LNAM: "AA", ORIENT: 285 }, box(0, 0, 1, 1))],
      {
        className: "RCTLPT",
      },
    );

    expect(features).toEqual([]);
  });

  test("an RCTLPT with no ORIENT keeps its centred mark here", () => {
    const features = anchors([polygon({ LNAM: "AA" }, box(0, 0, 1, 1))], {
      className: "RCTLPT",
    });

    expect(features).toHaveLength(1);
    expect(features[0].properties.CLASS).toBe("RCTLPT");
  });

  test("a NULL ORIENT is no direction at all, not north", () => {
    // GDAL spells an unset column as JSON null and Number(null) is 0 -- a lane
    // pointing due north. Both generators reject the empty spellings the same
    // way, or the feature falls through both of them.
    const features = anchors(
      [polygon({ LNAM: "AA", ORIENT: null }, box(0, 0, 1, 1))],
      {
        className: "RCTLPT",
      },
    );

    expect(features).toHaveLength(1);
  });

  test("the lane classes that draw BOTH keep their anchor here", () => {
    // TSSLPT is in both generators on purpose: its arrow and its own centred
    // symbol (TSLDEF51) are two presentations of one feature.
    const features = anchors(
      [polygon({ LNAM: "AA", ORIENT: 285 }, box(0, 0, 1, 1))],
      {
        className: "TSSLPT",
      },
    );

    expect(features).toHaveLength(1);
  });
});

describe("several classes in one run", () => {
  test("each class file keeps its own CLASS on its anchors", () => {
    const ctnare = writeCollection("CTNARE.geojson", [
      polygon({ LNAM: "AA" }, box(0, 0, 1, 1)),
    ]);
    const pilbop = writeCollection("PILBOP.geojson", [
      polygon({ LNAM: "BB" }, box(5, 5, 6, 6)),
    ]);
    const features = run(
      "--class",
      `CTNARE:${ctnare}`,
      "--class",
      `PILBOP:${pilbop}`,
    );

    expect(features.map((f) => f.properties.CLASS).sort()).toEqual([
      "CTNARE",
      "PILBOP",
    ]);
  });
});

describe("the class set", () => {
  test("a class outside AREA_ANCHOR_CLASSES is refused", () => {
    // The shipped set is the policy: widening it is an edit to the constant
    // (and to the bin/s57-to-tiles step), not an invocation.
    const path = writeCollection("MIPARE.geojson", [
      polygon({ LNAM: "AA" }, box(0, 0, 1, 1)),
    ]);

    expect(() => run("--class", `MIPARE:${path}`)).toThrow(
      /AREA_ANCHOR_CLASSES/,
    );
  });

  test("--list-classes is the ship-narrow ten plus the widening round", () => {
    // The roster, pinned verbatim: the ship-narrow ten of the first round and
    // the deferred own-symbol classes the widening round admitted. A drift in
    // the constant -- a class slipping in or out -- fails here with its name.
    const listed = execFileSync(process.execPath, [SCRIPT, "--list-classes"], {
      encoding: "utf8",
    })
      .trim()
      .split("\n");

    expect([...listed].sort()).toEqual(
      [
        // The ship-narrow ten.
        "CTNARE",
        "PILBOP",
        "CBLARE",
        "RESARE",
        "DWRTPT",
        "ISTZNE",
        "PRCARE",
        "TSSCRS",
        "TSSLPT",
        "TSSRON",
        // The widening round.
        "ACHBRT",
        "BERTHS",
        "BRIDGE",
        "CHKPNT",
        "CONVYR",
        "CTSARE",
        "FERYRT",
        "FSHFAC",
        "FSHGRD",
        "HRBFAC",
        "LOCMAG",
        "LOGPON",
        "MAGVAR",
        "NEWOBJ",
        "PRDARE",
        "RCTLPT",
        "RECTRC",
        "SMCFAC",
        "SWPARE",
        "WATTUR",
        "WEDKLP",
      ].sort(),
    );
    // The deliberate exclusions, so they cannot creep back in unremarked:
    // ACHARE by user ruling, OBSTRN with the hazard family (isolated-danger
    // precedence and the stripped _DEPARE_* columns), ###### never names a
    // tile source-layer, and MIPARE's own symbol is already a cascade member
    // the _RESTR_ANCHORS retarget covers.
    for (const excluded of ["ACHARE", "OBSTRN", "######", "MIPARE"]) {
      expect(listed).not.toContain(excluded);
    }
  });

  test("every anchor class is classified: grid or fill, never neither", () => {
    // GRID_REPEAT_CLASSES is written out POSITIVELY. Derived as the anchor set
    // minus the filled one it FAILED OPEN: a class added to AREA_ANCHOR_CLASSES
    // landed in the grid set by default and silently took the riskier
    // treatment -- a repeated symbol and a stripped vendor SCAMIN -- with
    // nobody having asked whether its interior is painted. Positive, the drift
    // fails HERE instead, with the unclassified class named.
    //
    // The two Sets are not on the command line, so they are read off the
    // source; the roster the parser returns for AREA_ANCHOR_CLASSES is checked
    // against --list-classes first, so a parser that quietly matched nothing
    // cannot pass this test.
    const source = readFileSync(SCRIPT, "utf8");
    const classesOf = (name) => {
      const start = source.indexOf(`const ${name} = `);
      expect(start).toBeGreaterThan(-1);
      const body = source.slice(start, source.indexOf("\n]", start));
      return [...body.matchAll(/"([A-Z0-9#]+)"/g)].map(([, entry]) => entry);
    };
    const listed = execFileSync(process.execPath, [SCRIPT, "--list-classes"], {
      encoding: "utf8",
    })
      .trim()
      .split("\n");

    const anchorClasses = classesOf("AREA_ANCHOR_CLASSES");
    expect([...anchorClasses].sort()).toEqual([...listed].sort());

    const grid = classesOf("GRID_REPEAT_CLASSES");
    const fill = classesOf("AREA_FILL_CLASSES");

    // Disjoint: no class both repeats its symbol and paints its interior.
    expect(grid.filter((name) => fill.includes(name))).toEqual([]);
    // Exhaustive: their union IS the anchor set. Classify any class you add
    // here explicitly -- there is no default any more.
    expect([...grid, ...fill].sort()).toEqual([...anchorClasses].sort());
    // The shipped split, pinned so a silent move between the two shows up.
    expect(grid).toHaveLength(23);
    expect(fill).toHaveLength(8);
  });
});

describe("nothing to say", () => {
  test("a class file with no features writes an empty collection", () => {
    expect(anchors([])).toEqual([]);
  });

  test("a missing class file is tolerated", () => {
    const features = run(
      "--class",
      `CTNARE:${join(work, "no-such-CTNARE.geojson")}`,
    );

    expect(features).toEqual([]);
  });
});
