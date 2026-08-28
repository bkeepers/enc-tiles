/**
 * Fixture runs of bin/extract-analysis against stub GDAL binaries.
 *
 * What is under test is the finest-here clip: the analysis classes must be
 * differenced against the union of coverage STRICTLY FINER than the chart's
 * own rung floor — the same floor bin/quilt-rung.sh hands s57-to-tiles for the
 * top copy — and every path that cannot establish that floor must export
 * UNCLIPPED rather than guess. A wrong mask here is wrong safe/unsafe water in
 * the route check, which nothing downstream can notice.
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
  new URL("../bin/extract-analysis", import.meta.url),
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
let runs;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "extract-analysis-"));
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

function run(env = {}, { withCoverage = true } = {}) {
  const input = join(work, "US5WA22M.000");
  const outdir = join(work, "analysis");
  const sqlLog = join(work, `sql-${runs++}.log`);
  writeFileSync(input, "");

  const args = [SCRIPT, input, outdir];
  if (withCoverage) {
    const coverage = join(work, "coverage.gpkg");
    writeFileSync(coverage, "");
    args.push("--coverage", coverage);
  }

  const result = spawnSync("bash", args, {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${stubDir}:${process.env.PATH}`,
      STUB_SQL_LOG: sqlLog,
      STUB_EXTENT: extentAt(48.5),
      STUB_TABLES:
        "DEPARE LNDARE DEPCNT TESARE UWTROC OBSTRN WRECKS M_COVR SOUNDG",
      ...env,
    },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    outdir,
    sql: existsSync(sqlLog) ? readFileSync(sqlLog, "utf8") : "",
    exports: existsSync(outdir) ? readdirSync(outdir).sort() : [],
  };
}

describe("which classes are exported", () => {
  test("the analysis classes the chart carries, and nothing else", () => {
    const result = run();

    expect(result.status).toBe(0);
    // M_COVR and SOUNDG are in the chart but are not analysis classes.
    expect(result.exports).toEqual([
      "DEPARE.geojson",
      "DEPCNT.geojson",
      "LNDARE.geojson",
      "OBSTRN.geojson",
      "TESARE.geojson",
      "UWTROC.geojson",
      "WRECKS.geojson",
    ]);
  });

  test("a chart with only some classes exports only those", () => {
    const result = run({ STUB_TABLES: "DEPARE M_COVR" });

    expect(result.status).toBe(0);
    expect(result.exports).toEqual(["DEPARE.geojson"]);
  });

  test("ADMARE is an analysis class (the charted Three Nautical Mile Line)", () => {
    // The 3 NM line is charted as a named ADMARE (thin double-line area).
    // The class exports IN FULL — the nautical-mile name filter that keeps
    // state/border administration areas out of the products is pipeline-side.
    const result = run({ STUB_TABLES: "ADMARE LNDARE M_COVR" });

    expect(result.status).toBe(0);
    expect(result.exports).toEqual(["ADMARE.geojson", "LNDARE.geojson"]);
    expect(result.sql).toContain(
      'UPDATE "ADMARE" SET geom = ST_Difference("ADMARE".geom, (SELECT geom FROM quilt_mask))',
    );
  });

  test("the advisory-area classes are analysis classes (the areas product)", () => {
    // Caution, restricted, precautionary, military practice, sea-plane
    // landing and marine farm/culture areas export IN FULL — the attribute
    // allowlist (and the TXTDSC note-text resolution) is pipeline-side.
    const result = run({
      STUB_TABLES: "CTNARE RESARE PRCARE MIPARE SPLARE MARCUL M_COVR",
    });

    expect(result.status).toBe(0);
    expect(result.exports).toEqual([
      "CTNARE.geojson",
      "MARCUL.geojson",
      "MIPARE.geojson",
      "PRCARE.geojson",
      "RESARE.geojson",
      "SPLARE.geojson",
    ]);
    // The same finest-here clip every class gets, point renderings included
    // (a small-scale CTNARE is charted as a point).
    for (const cls of ["CTNARE", "RESARE", "MARCUL"]) {
      expect(result.sql).toContain(
        `UPDATE "${cls}" SET geom = ST_Difference("${cls}".geom, (SELECT geom FROM quilt_mask))`,
      );
      expect(result.sql).toContain(
        `ST_Within("${cls}".geom, (SELECT geom FROM quilt_mask))`,
      );
    }
    // Full-feature imports, no field trim: the class name is the invocation's
    // last argument (OBJNAM, INFORM, CATREA, RESTRN, STATUS, DATSTA, DATEND
    // and the TXTDSC file refs all ride along).
    expect(result.sql).toMatch(/US5WA22M\.000 RESARE( -append)?\n/);
  });

  test("a READABLE chart with no analysis class at all exits 0 with nothing", () => {
    const result = run({ STUB_TABLES: "M_COVR SOUNDG" });

    expect(result.status).toBe(0);
    expect(result.exports).toEqual([]);
    expect(result.stdout).toContain("no analysis class");
  });

  test("the class imports carry no -skipfailures and no stderr muzzle", () => {
    // A feature the driver cannot translate is a feature missing from
    // route-safety data: the import must fail loudly, never thin the class.
    const { sql, status } = run();

    expect(status).toBe(0);
    expect(sql).toContain("GPKG");
    expect(sql).not.toContain("-skipfailures");
  });
});

describe("an UNREADABLE chart is refused, never read as classless", () => {
  test("an ogrinfo failure on the layer listing exits 1", () => {
    const result = run({ STUB_LIST_FAILS: "1" });

    expect(result.status).toBe(1);
    expect(result.exports).toEqual([]);
    expect(result.stderr).toContain("could not read the chart");
    // GDAL's own diagnosis is passed through, not swallowed.
    expect(result.stderr).toContain("not recognized");
  });

  test("a chart with zero layers exits 1 (corrupt, not classless)", () => {
    const result = run({ STUB_TABLES: " " });

    expect(result.status).toBe(1);
    expect(result.exports).toEqual([]);
    expect(result.stderr).toContain("no readable layers");
    expect(result.stdout).not.toContain("no analysis class");
  });
});

describe("INTU is validated exactly as s57-to-tiles validates it", () => {
  test("an INTU off the band table is refused even with a compilation scale", () => {
    const result = run({ STUB_INTU: "9" });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Unknown INTU: 9");
    expect(result.exports).toEqual([]);
  });

  test("no compilation scale and an INTU outside the bands is refused too", () => {
    // This chart used to export UNCLIPPED; the tiler hard-fails it
    // (s57-to-tiles "Unknown INTU"), and the analysis extract now fails the
    // same way instead of quietly accepting what the tile build refuses.
    const result = run({ STUB_CSCALE: "none", STUB_INTU: "9" });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Unknown INTU: 9");
    expect(result.exports).toEqual([]);
  });

  test("a chart with no readable INTU at all is refused", () => {
    const result = run({ STUB_INTU: "" });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Unknown INTU");
    expect(result.exports).toEqual([]);
  });
});

describe("the finest-here clip", () => {
  test("selects coverage STRICTLY finer than this chart's own floor", () => {
    // 1:12k at Puget latitude floors at z13 on the offset-2 ladder — the same
    // rung extract-coverage stamps and s57-to-tiles partitions against.
    const { sql } = run({ STUB_CSCALE: "12000" });

    expect(sql).toContain("QFLOOR > 13");
    expect(sql).not.toContain("QFLOOR >=");
  });

  test("the floor moves with the chart's own scale and latitude", () => {
    const puget = run({ STUB_CSCALE: "22000" });
    const alaska = run({ STUB_CSCALE: "22000", STUB_EXTENT: extentAt(70) });

    expect(puget.sql).toContain("QFLOOR > 12");
    // cos(70) is a third of cos(48.5): same chart, one rung lower.
    expect(alaska.sql).toContain("QFLOOR > 11");
  });

  test("differences every class against the mask, un-cast", () => {
    const { sql, status } = run();

    expect(status).toBe(0);
    for (const cls of [
      "DEPARE",
      "LNDARE",
      "DEPCNT",
      "TESARE",
      "UWTROC",
      "OBSTRN",
      "WRECKS",
    ]) {
      expect(sql).toContain(
        `UPDATE "${cls}" SET geom = ST_Difference("${cls}".geom, (SELECT geom FROM quilt_mask))`,
      );
    }
    // The write-back must stay un-cast: AsGPB() of an already-GPKG blob is
    // NULL and the empty sweep would then erase the chart (see s57-to-tiles
    // step 2b and the pipeline Dockerfile probe).
    expect(sql).not.toContain("AsGPB");
    expect(sql).not.toContain("CastAutomagic");
  });

  test("an empty mask clips nothing", () => {
    // Coverage rows exist but their union came out NULL: differencing against
    // it would NULL every geometry and the sweep would erase the export.
    const { sql, status, exports } = run({ STUB_HAS_MASK: "0" });

    expect(status).toBe(0);
    expect(sql).not.toContain("ST_Difference");
    expect(exports).toContain("DEPARE.geojson");
  });
});

describe("the hazard classes ride the same finest-here clip", () => {
  test("hazard points are deleted where ST_Within the finer mask", () => {
    // UWTROC/OBSTRN/WRECKS are mostly POINT features: the areal
    // ST_Difference leaves points untouched, so the same per-class
    // point-delete every other class gets is what keeps a coarse chart's
    // rock from surviving underneath the finer chart that re-surveys it.
    const { sql, status } = run();

    expect(status).toBe(0);
    for (const cls of ["UWTROC", "OBSTRN", "WRECKS"]) {
      expect(sql).toContain(
        `ST_Within("${cls}".geom, (SELECT geom FROM quilt_mask))`,
      );
      expect(sql).toContain(`DELETE FROM "${cls}"`);
    }
  });

  test("a chart carrying only hazards exports only those", () => {
    const result = run({ STUB_TABLES: "UWTROC WRECKS M_COVR" });

    expect(result.status).toBe(0);
    expect(result.exports).toEqual(["UWTROC.geojson", "WRECKS.geojson"]);
  });
});

describe("charts that cannot be placed on the ladder export UNCLIPPED", () => {
  test("an unreadable M_COVR extent", () => {
    const result = run({ STUB_EXTENT: "" });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("exporting unclipped");
    expect(result.sql).not.toContain("ST_Difference");
    expect(result.exports).toContain("DEPARE.geojson");
  });

  test("no --coverage at all", () => {
    const result = run({}, { withCoverage: false });

    expect(result.status).toBe(0);
    expect(result.sql).not.toContain("ST_Difference");
    expect(result.exports).toContain("DEPARE.geojson");
  });
});

describe("a chart with no DSPM_CSCL", () => {
  test("falls back to the COARSER rung of its INTU band's pair", () => {
    // Same fallback extract-coverage applies: a legacy chart is floored no
    // lower than the band it has always been floored to (band 5 -> 1:22k,
    // z12 at Puget latitude).
    const { sql, status } = run({ STUB_CSCALE: "none", STUB_INTU: "5" });

    expect(status).toBe(0);
    expect(sql).toContain("QFLOOR > 12");
  });
});
