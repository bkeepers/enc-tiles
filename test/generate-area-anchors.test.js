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
  test("the WHOLE property bag of the fragment, verbatim", () => {
    // The retargeted layers' filters branch on each class's own attributes
    // (CATPIL here, CATBRG/WATLEV/CONRAD elsewhere), so nothing short of the
    // whole bag keeps every branch fed.
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
      SCAMIN: 119999,
      INTU: 4,
      CSCALE: 45000,
    });
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
    // any other pipeline-internal property stays off the anchor.
    const features = anchors([
      polygon(
        { LNAM: "AA", CATREA: "9", _QZMIN: 8, _MARK: 1 },
        box(0, 0, 1, 1),
      ),
    ]);

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

  test("with no roster at all every group keeps its own anchor", () => {
    expect(anchors(east)).toHaveLength(1);
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
