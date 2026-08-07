/**
 * Fixture runs of bin/stamp-prcare-tssnote.
 *
 * The companion .TXT files are written into a stand-in for the cell's own
 * directory in ENC_ROOT, which is what --enc-dir points at.
 */
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const SCRIPT = fileURLToPath(
  new URL("../bin/stamp-prcare-tssnote", import.meta.url),
);

let work;
let encDir;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "prcare-tssnote-"));
  encDir = join(work, "US5WA22M");
  mkdirSync(encDir, { recursive: true });
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

function area(properties) {
  return {
    type: "Feature",
    properties,
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [0.01, 0],
          [0.01, 0.01],
          [0, 0],
        ],
      ],
    },
  };
}

function note(name, body, encoding = "utf8") {
  writeFileSync(join(encDir, name), body, encoding);
}

function run(features) {
  const path = join(work, "PRCARE.geojson");
  writeFileSync(path, JSON.stringify({ type: "FeatureCollection", features }));
  const result = spawnSync(
    process.execPath,
    [SCRIPT, path, "--enc-dir", encDir],
    { encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(readFileSync(path, "utf8")).features;
}

describe("the evidence", () => {
  test("a cited note naming a traffic separation scheme stamps", () => {
    note(
      "US5WA22M001.TXT",
      "Vessels are advised that this is part of the Traffic Separation Scheme\n" +
        "in the Strait of Juan de Fuca.\n",
    );
    const [feature] = run([area({ LNAM: "aaa", TXTDSC: "US5WA22M001.TXT" })]);
    expect(feature.properties._TSSNOTE).toBe(1);
  });

  test("INFORM is enough on its own, with no file to read", () => {
    const [feature] = run([
      area({ LNAM: "bbb", INFORM: "Separation zone — see note" }),
    ]);
    expect(feature.properties._TSSNOTE).toBe(1);
  });

  test("a comma-separated TXTDSC list is followed to the end", () => {
    note("FIRST.TXT", "Anchorage regulations apply.\n");
    note("SECOND.TXT", "One-way traffic lane at the junction.\n");
    const [feature] = run([
      area({ LNAM: "ccc", TXTDSC: "FIRST.TXT,SECOND.TXT" }),
    ]);
    expect(feature.properties._TSSNOTE).toBe(1);
  });

  test("a note about something else does not stamp", () => {
    note("OTHER.TXT", "Submarines exercise in this area.\n");
    const [feature] = run([area({ LNAM: "ddd", TXTDSC: "OTHER.TXT" })]);
    expect(feature.properties).not.toHaveProperty("_TSSNOTE");
  });

  test("the object class alone is not evidence of a scheme", () => {
    // "Precautionary area" is what the feature IS, not what it belongs to: a
    // standalone caution area's own note says it too. Matching on it matched
    // the feature against its own name and grouped every such area with the
    // traffic scheme, where it hides with the scheme and takes its warning off
    // the chart.
    note("SELF.TXT", "This precautionary area surrounds the outfall.\n");
    const [cited, informed] = run([
      area({ LNAM: "hhh", TXTDSC: "SELF.TXT" }),
      area({ LNAM: "iii", INFORM: "Precautionary Area" }),
    ]);
    expect(cited.properties).not.toHaveProperty("_TSSNOTE");
    expect(informed.properties).not.toHaveProperty("_TSSNOTE");
  });
});

describe("never fatal", () => {
  test("a missing .TXT is no stamp, not a failure", () => {
    const [feature] = run([area({ LNAM: "eee", TXTDSC: "ABSENT.TXT" })]);
    expect(feature.properties).not.toHaveProperty("_TSSNOTE");
  });

  test("a feature with no TXTDSC and no INFORM is left alone", () => {
    const [feature] = run([area({ LNAM: "fff", CATPRA: "1" })]);
    expect(feature.properties).toEqual({ LNAM: "fff", CATPRA: "1" });
  });

  test("a note in a single-byte encoding is still read", () => {
    // A degree sign as latin-1 0xB0, which is not valid UTF-8 on its own.
    note(
      "LATIN.TXT",
      Buffer.from("Traffic separation scheme, 47\xB0 N.\n", "latin1").toString(
        "latin1",
      ),
      "latin1",
    );
    const [feature] = run([area({ LNAM: "ggg", TXTDSC: "LATIN.TXT" })]);
    expect(feature.properties._TSSNOTE).toBe(1);
  });
});

describe("the zoom partition", () => {
  test("each copy is tested on its own and keeps its interval", () => {
    note("TSS.TXT", "Traffic Separation Scheme approach.\n");
    const features = run([
      area({ LNAM: "aaa", TXTDSC: "TSS.TXT", _QZMIN: 6, _QZMAX: 8 }),
      area({ LNAM: "aaa", TXTDSC: "TSS.TXT", _QZMIN: 9 }),
      area({ LNAM: "bbb", _QZMIN: 9 }),
    ]);
    expect(features.map((f) => f.properties._TSSNOTE)).toEqual([
      1,
      1,
      undefined,
    ]);
    expect(features[0].properties._QZMIN).toBe(6);
    expect(features[0].properties._QZMAX).toBe(8);
    expect(features[1].properties._QZMIN).toBe(9);
  });

  test("the working properties are not this script's to strip", () => {
    const [feature] = run([area({ LNAM: "ccc", _QZMAX: 5, _QFALL: 1 })]);
    expect(feature.properties).toEqual({
      LNAM: "ccc",
      _QZMAX: 5,
      _QFALL: 1,
    });
  });
});

describe("shape of the output", () => {
  test("only the qualifying features gain the attribute", () => {
    note("TSS.TXT", "Traffic Separation Scheme approach.\n");
    note("PLAIN.TXT", "Fish haven markers.\n");
    const features = run([
      area({ LNAM: "aaa", TXTDSC: "TSS.TXT" }),
      area({ LNAM: "bbb", TXTDSC: "PLAIN.TXT" }),
      area({ LNAM: "ccc" }),
    ]);
    expect(features.map((f) => f.properties._TSSNOTE)).toEqual([
      1,
      undefined,
      undefined,
    ]);
  });
});
