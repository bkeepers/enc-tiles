/**
 * Fixture runs of bin/extract-coverage against stub GDAL binaries.
 *
 * What is under test is the QFLOOR stamped on every coverage row: the rung
 * bin/s57-to-tiles then partitions against without re-deriving anything. A
 * floor that is one zoom off here is a gap or an overlap in that cell's copy
 * ladder, and neither is visible until a tile is missing content.
 *
 * The stub knobs are documented in test/fixtures/gdal-stub/ogrinfo.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const SCRIPT = fileURLToPath(
  new URL("../bin/extract-coverage", import.meta.url),
);
const STUB_SOURCE = fileURLToPath(
  new URL("./fixtures/gdal-stub", import.meta.url),
);

/** A bbox GDAL's `-so` prints, centred on `lat`. */
function extentAt(lat) {
  return `(-122.900000, ${(lat - 0.5).toFixed(6)}) - (-122.100000, ${(lat + 0.5).toFixed(6)})`;
}

let work;
let stubDir;
// The stubs append, so a test that runs the script twice needs two logs.
let runs;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "extract-coverage-"));
  runs = 0;
  stubDir = join(work, "stub");
  mkdirSync(stubDir);
  for (const name of readdirSync(STUB_SOURCE)) {
    const target = join(stubDir, name);
    copyFileSync(join(STUB_SOURCE, name), target);
    chmodSync(target, 0o755);
  }
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

function run(env = {}) {
  const input = join(work, "US5WA22M.000");
  const sqlLog = join(work, `sql-${runs++}.log`);
  writeFileSync(input, "");

  const result = spawnSync(
    "bash",
    [SCRIPT, join(work, "coverage.gpkg"), input],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${stubDir}:${process.env.PATH}`,
        STUB_SQL_LOG: sqlLog,
        STUB_EXTENT: extentAt(48.5),
        ...env,
      },
    },
  );
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    sql: existsSync(sqlLog) ? readFileSync(sqlLog, "utf8") : "",
  };
}

/** The columns the coverage rows were stamped with, or null if none were. */
function stamps(sql) {
  const match =
    /SELECT \*, (\d+) AS INTU, (\d+) AS CSCALE, (\d+) AS QFLOOR FROM M_COVR/.exec(
      sql,
    );
  if (!match) return null;
  return {
    intu: Number(match[1]),
    cscale: Number(match[2]),
    qfloor: Number(match[3]),
  };
}

describe("the rung stamped on each chart's coverage", () => {
  // The ladder the design pins at Puget latitude. Every one of these lands on
  // an integer rung, which is what makes the intra-band handovers (22k -> 12k,
  // 350k -> 180k) exact rather than a rounding artefact.
  test.each([
    [350000, 6],
    [180000, 7],
    [90000, 8],
    [45000, 9],
    [22000, 10],
    [12000, 11],
  ])("1:%i at Puget latitude floors at z%i", (cscale, floor) => {
    expect(stamps(run({ STUB_CSCALE: String(cscale) }).sql)).toEqual({
      intu: 5,
      cscale,
      qfloor: floor,
    });
  });

  test("the same scale floors lower in Zone III", () => {
    // The rung is computed at the chart's OWN mid-latitude: cos(70) is a third
    // of cos(48.5), which is a zoom and a half of difference on the same chart.
    const puget = stamps(run({ STUB_CSCALE: "22000" }).sql);
    const alaska = stamps(
      run({ STUB_CSCALE: "22000", STUB_EXTENT: extentAt(70) }).sql,
    );

    expect(puget.qfloor).toBe(10);
    expect(alaska.qfloor).toBe(9);
  });

  test("the floor is clamped into the PUBLISHED web ladder", () => {
    // Nothing below z0 exists to own, and the top of the ladder is the
    // published archive's maxzoom (11) rather than the deepest zoom any band
    // tiles to (12). A floor of 12 stamps content into z12 tiles that the
    // national join deletes, and the style then draws it at no zoom at all.
    expect(stamps(run({ STUB_CSCALE: "40000000" }).sql).qfloor).toBe(0);
    expect(stamps(run({ STUB_CSCALE: "500" }).sql).qfloor).toBe(11);
    // The shallowest scale that used to clamp past the cap at Puget latitude.
    expect(stamps(run({ STUB_CSCALE: "5000" }).sql).qfloor).toBe(11);
  });
});

describe("a chart whose DSID carries no DSPM_CSCL", () => {
  test("falls back to the COARSER rung of its INTU band's pair", () => {
    // 1:22k, not 1:12k: a legacy chart is floored no lower than the band it has
    // always been floored to, so an invocation predating the scale key keeps
    // producing the tiles it always did.
    const result = run({ STUB_CSCALE: "none", STUB_INTU: "5" });

    expect(stamps(result.sql)).toEqual({ intu: 5, cscale: 22000, qfloor: 10 });
    expect(result.stderr).toContain("no DSPM_CSCL");
  });

  test.each([
    [1, 10000000, 1],
    [2, 1500000, 4],
    [3, 350000, 6],
    [4, 90000, 8],
    // 1:4000 is z12 on the raw ladder and is clamped to the publication cap:
    // a band-6 fallback floored at 12 published into tiles the national join
    // deletes, so the content drew at NO zoom.
    [6, 4000, 11],
  ])("band %i falls back to 1:%i", (intu, cscale, floor) => {
    expect(
      stamps(run({ STUB_CSCALE: "none", STUB_INTU: String(intu) }).sql),
    ).toEqual({ intu, cscale, qfloor: floor });
  });
});

describe("charts that cannot be placed on the ladder", () => {
  test("no DSID_INTU is skipped, as it always was", () => {
    const result = run({ STUB_INTU: "" });

    expect(stamps(result.sql)).toBeNull();
    expect(result.status).not.toBe(0);
  });

  test("an unreadable M_COVR extent is skipped and said out loud", () => {
    // Guessing a latitude would stamp a floor that is quietly wrong in every
    // tile of every cell around it.
    const result = run({ STUB_EXTENT: "" });

    expect(stamps(result.sql)).toBeNull();
    expect(result.stderr).toContain("could not read the M_COVR extent");
  });

  test("an INTU outside the bands with no scale to fall back on is skipped", () => {
    const result = run({ STUB_CSCALE: "none", STUB_INTU: "9" });

    expect(stamps(result.sql)).toBeNull();
    expect(result.stderr).toContain("no DSPM_CSCL to key on");
  });
});

describe("what reaches the coverage table", () => {
  test("every chart, not only the finer ones", () => {
    // The copy ladder needs the finer rungs for its caps AND the coarser union
    // to decide where a cell keeps serving below its own floor, so the filter
    // that used to live here is gone: it is s57-to-tiles that selects a rung.
    const { sql } = run({ STUB_INTU: "2" });

    expect(sql).toContain("FROM M_COVR WHERE CATCOV=1");
    expect(sql).not.toContain("INTU >");
  });
});
