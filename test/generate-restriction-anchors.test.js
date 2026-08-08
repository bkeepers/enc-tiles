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
