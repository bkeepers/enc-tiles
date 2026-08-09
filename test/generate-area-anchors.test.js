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
