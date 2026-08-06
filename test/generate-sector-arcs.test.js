/**
 * Fixture runs of bin/generate-sector-arcs.
 *
 * Lights sit on the equator so `mmToMeters` carries no cos(latitude) factor and
 * the expected sizes are readable: one degree of latitude is 60 nautical miles
 * everywhere, and at the equator so is one degree of longitude.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const SCRIPT = fileURLToPath(
  new URL("../bin/generate-sector-arcs", import.meta.url),
);

// The generator's own constants, restated so a change to either is a test
// failure rather than a silent drift.
const OVERZOOM_LEVELS = 3;
const MAX_FIGURE_METRES = 50000;
const LEG_LENGTH_MM = 25;
const EARTH_CIRCUMFERENCE = 2 * Math.PI * 6378137;

function mmToMeters(mm, zoom, lat = 0) {
  const px = mm * (96 / 25.4);
  const metersPerPx =
    (EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180)) /
    (Math.pow(2, zoom) * 512);
  return px * metersPerPx;
}

let work;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "sector-arcs-"));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

function light(properties, lon = 0, lat = 0) {
  return {
    type: "Feature",
    properties,
    geometry: { type: "Point", coordinates: [lon, lat] },
  };
}

function run(features, { minzoom = 0, maxzoom = 12 } = {}) {
  const input = join(work, "LIGHTS.geojson");
  const output = join(work, "_LIGHTS_SECTORS.geojson");
  writeFileSync(input, JSON.stringify({ type: "FeatureCollection", features }));
  const result = spawnSync(
    process.execPath,
    [
      SCRIPT,
      input,
      output,
      "--minzoom",
      String(minzoom),
      "--maxzoom",
      String(maxzoom),
    ],
    { encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(readFileSync(output, "utf8"));
}

/** The length in metres of a two-point leg on the equator. */
function legMetres(feature) {
  const [[lon1, lat1], [lon2, lat2]] = feature.geometry.coordinates;
  const dLon = ((lon2 - lon1) * EARTH_CIRCUMFERENCE) / 360;
  const dLat = ((lat2 - lat1) * EARTH_CIRCUMFERENCE) / 360;
  return Math.hypot(dLon, dLat);
}

/** The radius in metres of an arc about a light at the origin. */
function arcMetres(feature) {
  const [lon, lat] = feature.geometry.coordinates[0];
  return Math.hypot(
    (lon * EARTH_CIRCUMFERENCE) / 360,
    (lat * EARTH_CIRCUMFERENCE) / 360,
  );
}

const SECTOR = { LNAM: "aaa", SECTR1: 10, SECTR2: 70, COLOUR: "3" };

describe("per-zoom copies", () => {
  test("one arc and two legs for every zoom in range", () => {
    const output = run([light(SECTOR)], { maxzoom: 12 });

    const byZoom = new Map();
    for (const feature of output.features) {
      const z = feature.properties._z;
      byZoom.set(z, (byZoom.get(z) ?? 0) + 1);
    }
    for (const count of byZoom.values()) expect(count).toBe(3);

    const zooms = [...byZoom.keys()].sort((a, b) => a - b);
    // The top is the band maxzoom plus the overzoom levels; the bottom is
    // wherever the 25 mm leg stops fitting inside MAX_FIGURE_METRES.
    expect(zooms[zooms.length - 1]).toBe(12 + OVERZOOM_LEVELS);
    expect(mmToMeters(LEG_LENGTH_MM, zooms[0])).toBeLessThanOrEqual(
      MAX_FIGURE_METRES,
    );
    expect(mmToMeters(LEG_LENGTH_MM, zooms[0] - 1)).toBeGreaterThan(
      MAX_FIGURE_METRES,
    );
    // Contiguous, so no zoom in the range is left without a figure.
    expect(zooms).toEqual(zooms.map((_, index) => zooms[0] + index));
  });

  test("each copy is sized for its own zoom, halving per level", () => {
    const output = run([light(SECTOR)], { maxzoom: 12 });
    const legs = output.features.filter((f) => f.properties._type === "leg");

    for (const leg of legs) {
      expect(legMetres(leg)).toBeCloseTo(
        mmToMeters(LEG_LENGTH_MM, leg.properties._z),
        3,
      );
    }
    const arcs = output.features.filter((f) => f.properties._type === "arc");
    for (const arc of arcs) {
      expect(arcMetres(arc)).toBeCloseTo(mmToMeters(20, arc.properties._z), 3);
    }
  });

  test("_EXTENDED_ARC widens the arc but not the leg", () => {
    const output = run([light({ ...SECTOR, _EXTENDED_ARC: 1 })], {
      maxzoom: 12,
    });
    const arc = output.features.find(
      (f) => f.properties._type === "arc" && f.properties._z === 12,
    );
    expect(arcMetres(arc)).toBeCloseTo(mmToMeters(25, 12), 3);
  });
});

describe("tippecanoe confinement", () => {
  test("a copy at or below the band maxzoom lives in its own zoom only", () => {
    const output = run([light(SECTOR)], { maxzoom: 12 });
    for (const feature of output.features) {
      const z = feature.properties._z;
      if (z > 12) continue;
      // NOT a property: tippecanoe reads the member off the Feature itself.
      expect(feature.tippecanoe).toEqual({ minzoom: z, maxzoom: z });
      expect(feature.properties).not.toHaveProperty("tippecanoe");
    }
  });

  test("copies past the band maxzoom ride the deepest real tile", () => {
    const output = run([light(SECTOR)], { maxzoom: 12 });
    const overzoomed = output.features.filter((f) => f.properties._z > 12);
    expect(overzoomed.length).toBe(3 * OVERZOOM_LEVELS);
    for (const feature of overzoomed) {
      // There is no z13 tile to be confined to, so it goes in the z12 one and
      // is told apart from the z12 copy by _z at draw time.
      expect(feature.tippecanoe).toEqual({ minzoom: 12, maxzoom: 12 });
    }
  });

  test("_zmax is the deepest copy, so the style can clamp to it", () => {
    const output = run([light(SECTOR)], { maxzoom: 11 });
    for (const feature of output.features) {
      expect(feature.properties._zmax).toBe(11 + OVERZOOM_LEVELS);
    }
  });
});

describe("the band no longer decides the size", () => {
  test("two bands agree on the figure at a zoom they share", () => {
    const band3 = run([light(SECTOR)], { maxzoom: 8 });
    const band5 = run([light(SECTOR)], { maxzoom: 11 });

    const at = (output, z) =>
      output.features.find(
        (f) => f.properties._type === "leg" && f.properties._z === z,
      );
    // z8 is native to one and well inside the other. Before this, the same leg
    // was 19.1 km on the band-3 cell and 2.4 km on the band-5 one.
    expect(legMetres(at(band3, 8))).toBeCloseTo(legMetres(at(band5, 8)), 6);
  });
});

describe("directional lights", () => {
  const DIRECTIONAL = { LNAM: "bbb", CATLIT: "1", ORIENT: 90 };

  test("a VALNMR leg is geographic: one copy, no _z", () => {
    const output = run([light({ ...DIRECTIONAL, VALNMR: 10 })], {
      maxzoom: 12,
    });
    expect(output.features).toHaveLength(1);
    const [leg] = output.features;
    expect(leg.properties).not.toHaveProperty("_z");
    expect(leg).not.toHaveProperty("tippecanoe");
    expect(legMetres(leg)).toBeCloseTo(10 * 1852, 3);
  });

  test("without VALNMR the leg falls back to the screen-size convention", () => {
    const output = run([light(DIRECTIONAL)], { maxzoom: 12 });
    expect(output.features.length).toBeGreaterThan(1);
    for (const leg of output.features) {
      expect(legMetres(leg)).toBeCloseTo(
        mmToMeters(LEG_LENGTH_MM, leg.properties._z),
        3,
      );
    }
  });
});

describe("attributes carried through", () => {
  test("every copy keeps the light's own attributes and its style tokens", () => {
    const output = run(
      [
        light({
          ...SECTOR,
          SCAMIN: 45000,
          INTU: 5,
          COLOUR: "1,3",
          LITVIS: "3",
        }),
      ],
      { maxzoom: 12 },
    );
    for (const feature of output.features) {
      expect(feature.properties.LNAM).toBe("aaa");
      expect(feature.properties.SCAMIN).toBe(45000);
      expect(feature.properties.INTU).toBe(5);
    }
    const arcs = output.features.filter((f) => f.properties._type === "arc");
    expect(arcs.length).toBeGreaterThan(0);
    for (const arc of arcs) {
      expect(arc.properties._colour).toBe("LITRD");
      expect(arc.properties._style).toBe("DASH");
    }
  });

  test("a light with no sector and no ORIENT emits nothing", () => {
    const output = run([light({ LNAM: "ccc", SECTR1: 0, SECTR2: 0 })]);
    expect(output.features).toHaveLength(0);
  });
});
