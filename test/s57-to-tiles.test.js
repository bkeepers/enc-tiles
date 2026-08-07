/**
 * Exit-code runs of bin/s57-to-tiles against stub GDAL binaries.
 *
 * Exit 65 ("fully covered by larger-scale charts") is a PERMANENT verdict --
 * the pipeline records the cell as handled and never builds it again -- so the
 * conditions that produce it, and every near miss that must NOT produce it,
 * are pinned here. None of them is reachable with a real chart: each needs a
 * specific failure of the import, the clip or the export.
 *
 * The stubs stand in for ogrinfo/ogr2ogr/tippecanoe/node on PATH; their knobs
 * are documented in test/fixtures/gdal-stub/ogrinfo.
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

const SCRIPT = fileURLToPath(new URL("../bin/s57-to-tiles", import.meta.url));
const STUB_SOURCE = fileURLToPath(
  new URL("./fixtures/gdal-stub", import.meta.url),
);

const FULLY_COVERED = 65;

let work;
let stubDir;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "s57-to-tiles-"));
  // Copied rather than used in place so the executable bit is set here, on a
  // checkout that may not have preserved it (Windows, an unpacked archive).
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

/**
 * Runs the script over an empty .000 and an empty coverage GPKG -- the stubs
 * never read either -- with the given stub knobs in the environment.
 *
 * `coverage: false` drops the flag entirely, which is the legacy invocation:
 * no coverage table, so no ladder to place the cell on.
 */
function run(env = {}, { coverage: withCoverage = true } = {}) {
  const input = join(work, "in.000");
  const coverage = join(work, "cov.gpkg");
  const sqlLog = join(work, "sql.log");
  const nodeLog = join(work, "node.log");
  writeFileSync(input, "");
  writeFileSync(coverage, "");

  const result = spawnSync(
    "bash",
    [
      SCRIPT,
      input,
      join(work, "out.pmtiles"),
      ...(withCoverage ? ["--coverage", coverage] : []),
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${stubDir}:${process.env.PATH}`,
        STUB_STATE: join(work, "count-sequence"),
        STUB_SQL_LOG: sqlLog,
        STUB_NODE_LOG: nodeLog,
        ...env,
      },
    },
  );
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    tiled: (result.stdout ?? "").includes("TIPPECANOE RAN"),
    // Every statement the stubs were handed, which is the only place the copy
    // ladder is observable: the geometry it partitions does not exist here.
    sql: existsSync(sqlLog) ? readFileSync(sqlLog, "utf8") : "",
    // Every generator invocation, argv per line: the arguments are the only
    // place the wiring between this script and bin/ is observable here.
    node: existsSync(nodeLog) ? readFileSync(nodeLog, "utf8") : "",
  };
}

/** The recorded invocations, one per entry; the stubs delimit them. */
function statements(sql) {
  return sql.split("\n--\n");
}

/** "NULL" is an unbounded end of an interval, not a zoom. */
function zoom(token) {
  return token === "NULL" ? null : Number(token);
}

/**
 * The zoom intervals the script built for one table, read back off the SQL.
 *
 * Every copy but one is an INSERT that stamps the interval it serves; the
 * remaining one is the UNCUT original, stamped in place by the closing UPDATE.
 * Returned lowest-first, an unbounded end as null.
 */
function ladder(sql, table) {
  const intervals = [];
  const copy = new RegExp(
    `SELECT [^\\n]*geom, ([^,\\s]+), ([^,\\s]+), ([^,\\s]+) FROM "${table}"`,
    "g",
  );
  for (const match of sql.matchAll(copy)) {
    intervals.push({
      min: zoom(match[1]),
      max: zoom(match[2]),
      fallback: match[3] === "1",
    });
  }
  const whole = new RegExp(
    `UPDATE "${table}" SET _QZMIN = ([^,\\s]+), _QZMAX = ([^,\\s]+)`,
  ).exec(sql);
  if (whole) {
    intervals.push({
      min: zoom(whole[1]),
      max: zoom(whole[2]),
      fallback: false,
      whole: true,
    });
  }
  return intervals.sort((a, b) => (a.min ?? 0) - (b.min ?? 0));
}

describe("a cell the quilt empties", () => {
  test("rows before the clip, none after, mask applied: exit 65", () => {
    const result = run({
      STUB_HAS_MASK: "1",
      STUB_PRE_TOTAL: "9",
      STUB_TOTAL: "0",
    });

    expect(result.status).toBe(FULLY_COVERED);
    expect(result.stdout).toContain("fully covered by larger-scale charts");
    expect(result.tiled).toBe(false);
  });

  test("a cell with features still tiles", () => {
    const result = run({
      STUB_HAS_MASK: "1",
      STUB_PRE_TOTAL: "9",
      STUB_TOTAL: "7",
    });

    expect(result.status).toBe(0);
    expect(result.tiled).toBe(true);
  });

  test("an Integer64 count is read, not misparsed into a covered cell", () => {
    const result = run({
      STUB_HAS_MASK: "1",
      STUB_PRE_TOTAL: "12",
      STUB_TOTAL: "12",
      STUB_COUNT_TYPE: "Integer64",
    });

    expect(result.status).toBe(0);
    expect(result.tiled).toBe(true);
  });
});

describe("what must NOT be recorded as covered", () => {
  test("an import that yielded empty tables is a failure, not a covered cell", () => {
    // -skipfailures on the S57 read leaves structurally valid, entirely empty
    // tables behind. The quilt mask exists -- the neighbours are real -- but
    // this cell never had anything for the clip to remove.
    const result = run({
      STUB_HAS_MASK: "1",
      STUB_PRE_TOTAL: "0",
      STUB_TOTAL: "0",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("No features found");
    expect(result.stdout).not.toContain("fully covered");
  });

  test("a cell with no feature tables at all is a failure", () => {
    const result = run({
      STUB_HAS_MASK: "1",
      STUB_TABLES: " ",
      STUB_TOTAL: "0",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("No features found");
  });

  test("rows lost with no quilt mask applied is a failure", () => {
    const result = run({
      STUB_HAS_MASK: "0",
      STUB_PRE_TOTAL: "9",
      STUB_TOTAL: "0",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no quilt mask applied");
    expect(result.stdout).not.toContain("fully covered");
  });

  test("an export that wrote zero-byte files with rows present is a failure", () => {
    // The defect exit 65 hid: the GPKG still holds the chart, the GeoJSONs are
    // empty, and the cell would have been written off as covered forever.
    const result = run({
      STUB_HAS_MASK: "1",
      STUB_PRE_TOTAL: "7",
      STUB_TOTAL: "7",
      STUB_EXPORT_EMPTY_FILES: "1",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no usable GeoJSON export");
    expect(result.tiled).toBe(false);
  });

  test("the same export failure without a mask is also a failure", () => {
    const result = run({
      STUB_HAS_MASK: "0",
      STUB_PRE_TOTAL: "7",
      STUB_TOTAL: "7",
      STUB_EXPORT_EMPTY_FILES: "1",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no usable GeoJSON export");
  });
});

/**
 * A cell compiled at 1:350k whose ground is covered by charts on two finer
 * rungs, with a coarser chart beneath it. Its own floor is 6 at the stub's
 * latitude, so the ladder is fallback [0..5], whole [6..7], [8..9], [10..].
 */
const THREE_RUNG_CELL = {
  STUB_CSCALE: "350000",
  STUB_FINER_FLOORS: "8 10",
  STUB_HAS_COARSER: "1",
  STUB_HAS_MASK: "1",
  STUB_PRE_TOTAL: "9",
  STUB_TOTAL: "9",
};

describe("the copy ladder", () => {
  test("the copies tile every zoom exactly once", () => {
    const intervals = ladder(run(THREE_RUNG_CELL).sql, "DEPARE");

    // Exactly-one-owner: the intervals meet end to end from z0 with no gap and
    // no overlap, and the last one is unbounded.
    expect(intervals.length).toBeGreaterThan(1);
    expect(intervals[0].min ?? 0).toBe(0);
    for (let i = 0; i < intervals.length - 1; i++) {
      expect(intervals[i].max).toBe((intervals[i + 1].min ?? 0) - 1);
    }
    expect(intervals[intervals.length - 1].max).toBeNull();
  });

  test("each copy is capped one BELOW the rung that takes over", () => {
    const intervals = ladder(run(THREE_RUNG_CELL).sql, "DEPARE");

    // tile-join --overzoom lifts TILES and not features, so a cap AT the zoom
    // the finer chart arrives is a no-op and both copies draw there.
    expect(intervals).toEqual([
      { min: null, max: 5, fallback: true },
      { min: 6, max: 7, fallback: false, whole: true },
      { min: 8, max: 9, fallback: false },
      { min: 10, max: null, fallback: false },
    ]);
  });

  test("the whole copy is the UNCUT original over the cell's own rung", () => {
    const { sql } = run(THREE_RUNG_CELL);

    expect(sql).toContain('UPDATE "DEPARE" SET _QZMIN = 6, _QZMAX = 7');

    // Every difference is scoped to a copy, so nothing ever cuts the rows the
    // closing UPDATE goes on to stamp. This is also what makes exit 65
    // unreachable: the uncut copy always survives.
    const cuts = statements(sql).filter((statement) =>
      statement.includes('UPDATE "DEPARE" SET geom = ST_Difference'),
    );
    expect(cuts).toHaveLength(3);
    for (const cut of cuts) {
      expect(cut).toMatch(/WHERE (_QZMIN = \d+|_QFALL = 1)\b/);
    }
  });

  test("copies CARRY the table's attribute columns, not geometry alone", () => {
    const { sql } = run(THREE_RUNG_CELL);

    // The column list comes from `ogrinfo -so` WITHOUT -q: GDAL 3.13 prints
    // nothing under -q (the stub mirrors that), and an empty list once
    // shipped — every ladder and fallback copy inserted as bare geometry,
    // NULL in every attribute: gray depth areas, picks with nothing but the
    // post-partition CSCALE stamp. The stub's default column set is
    // OBJNAM/INTU; every copy INSERT must enumerate them.
    const inserts = sql.match(
      /INSERT INTO "DEPARE"[\s\S]*?WHERE _QZMIN IS NULL AND _QFALL IS NULL/g,
    );
    expect(inserts).not.toBeNull();
    for (const insert of inserts) {
      expect(insert).toContain('"OBJNAM"');
      expect(insert).toContain('"INTU"');
      expect(insert).toMatch(/INSERT INTO "DEPARE" \("OBJNAM", "INTU", geom/);
    }
  });

  test("copies are cut from the original, not from the copy below", () => {
    const { sql } = run(THREE_RUNG_CELL);

    // Every INSERT reads the still-unstamped rows, so interval i's geometry is
    // the ORIGINAL minus mask i rather than the previous interval's leftovers.
    const inserts = sql.match(
      /INSERT INTO "DEPARE"[\s\S]*?WHERE _QZMIN IS NULL AND _QFALL IS NULL/g,
    );
    expect(inserts).toHaveLength(3);
  });

  test("the cell's own rung clips nothing, in either direction", () => {
    const { sql } = run(THREE_RUNG_CELL);

    // Its own M_COVR row sits at its own floor. Peers at that rung are the
    // quilt-mates it tiles beside, not charts that cover it.
    expect(sql).toContain("-where QFLOOR <> 6");
    expect(sql).toContain(
      "CREATE TABLE quilt_mask AS SELECT ST_Union(geom) as geom FROM quilting WHERE QFLOOR > 6",
    );
    expect(sql).toContain(
      "CREATE TABLE quilt_mask_coarser AS SELECT ST_Union(geom) as geom FROM quilting WHERE QFLOOR < 6",
    );
  });

  test("the ladder masks are cumulative", () => {
    const { sql } = run(THREE_RUNG_CELL);

    expect(sql).toContain(
      "CREATE TABLE quilt_mask_8 AS SELECT ST_Union(geom) as geom FROM quilting WHERE QFLOOR > 6 AND QFLOOR <= 8",
    );
    expect(sql).toContain(
      "CREATE TABLE quilt_mask_10 AS SELECT ST_Union(geom) as geom FROM quilting WHERE QFLOOR > 6 AND QFLOOR <= 10",
    );
  });

  test("a cell nothing finer covers is one unbounded whole copy", () => {
    const { sql } = run({
      ...THREE_RUNG_CELL,
      STUB_FINER_FLOORS: "",
      STUB_HAS_MASK: "0",
    });

    expect(ladder(sql, "DEPARE")).toEqual([
      { min: null, max: 5, fallback: true },
      { min: 6, max: null, fallback: false, whole: true },
    ]);
  });

  test("the un-cast SQL convention survives the rewrite", () => {
    const { sql } = run(THREE_RUNG_CELL);

    // Commit 57f5373: AsGPB() of an already-GPKG blob is NULL, so a cast
    // write-back makes the empty sweep delete every row the clip touched.
    // plotroom's pipeline/Dockerfile probes these exact shapes at image build.
    expect(sql).toMatch(
      /UPDATE "DEPARE" SET geom = ST_Difference\("DEPARE"\.geom, \(SELECT geom FROM quilt_mask_8\)\)/,
    );
    expect(sql).toMatch(
      /ST_Within\("DEPARE"\.geom, \(SELECT geom FROM quilt_mask_8\)\)/,
    );
    expect(sql).not.toContain("AsGPB");
    expect(sql).not.toMatch(/CastAutomagic\([^)]*quilt_mask/);
  });
});

/**
 * A 1:90k cell of band 4, which tiles to z10. Its own floor is 8, and it is
 * overlapped by 1:22k (floor 10) and 1:12k (floor 11) charts -- the second of
 * which starts BELOW the deepest tile this cell has.
 */
const CELL_UNDER_DEEPER_RUNGS = {
  STUB_INTU: "4",
  STUB_CSCALE: "90000",
  STUB_FINER_FLOORS: "10 11",
  STUB_HAS_COARSER: "1",
  STUB_HAS_MASK: "1",
  STUB_PRE_TOTAL: "9",
  STUB_TOTAL: "9",
};

describe("rungs deeper than the cell's own tiles", () => {
  test("a rung below the deepest tile folds into the top copy", () => {
    const intervals = ladder(run(CELL_UNDER_DEEPER_RUNGS).sql, "DEPARE");

    // No interval starts above z10: there is no tile of this cell to serve one
    // in, and a copy built for it is dropped before tippecanoe sees it.
    expect(intervals).toEqual([
      { min: null, max: 7, fallback: true },
      { min: 8, max: 9, fallback: false, whole: true },
      { min: 10, max: null, fallback: false },
    ]);
  });

  test("the top copy is cut against ALL finer coverage", () => {
    const { sql } = run(CELL_UNDER_DEEPER_RUNGS);

    // The deepest tile is what `tile-join --overzoom` lifts over every finer
    // chart, so cutting it against the floor-10 coverage alone would put this
    // 1:90k cell's coastline over the 1:12k harbour charts at z11 -- the
    // published cap, and the defect the quilt exists to remove.
    const cut = statements(sql).find(
      (statement) =>
        statement.includes('UPDATE "DEPARE" SET geom = ST_Difference') &&
        statement.includes("WHERE _QZMIN = 10"),
    );
    expect(cut).toMatch(/\(SELECT geom FROM quilt_mask\)/);
    expect(sql).not.toContain("quilt_mask_11");
  });

  test("a cell whose finer neighbours ALL start deeper still cuts its deepest tile", () => {
    // A band-3 cell tiles to z8; the 1:45k, 1:22k and 1:12k charts over it
    // floor at 9, 10 and 11. Every one of them folds into one top copy at z8.
    const { sql } = run({
      ...CELL_UNDER_DEEPER_RUNGS,
      STUB_INTU: "3",
      STUB_CSCALE: "350000",
      STUB_FINER_FLOORS: "9 10 11",
    });

    expect(ladder(sql, "DEPARE")).toEqual([
      { min: null, max: 5, fallback: true },
      { min: 6, max: 7, fallback: false, whole: true },
      { min: 8, max: null, fallback: false },
    ]);
    expect(sql).not.toContain("quilt_mask_9");
  });

  test("a cell with no uncut interval left publishes the top copy alone", () => {
    // A 1:12k cell floors at 11 and tiles to 11: one tile zoom, and a berthing
    // chart over it folds onto that same zoom. The whole copy would be [11..10]
    // -- an empty interval -- so it is removed rather than stamped, which is
    // what keeps a fully-covered cell reaching the exit-65 guard.
    const { sql } = run({
      ...CELL_UNDER_DEEPER_RUNGS,
      STUB_INTU: "5",
      STUB_CSCALE: "12000",
      STUB_FINER_FLOORS: "12",
    });

    expect(ladder(sql, "DEPARE")).toEqual([
      { min: null, max: 10, fallback: true },
      { min: 11, max: null, fallback: false },
    ]);
    expect(sql).not.toMatch(/UPDATE "DEPARE" SET _QZMIN/);
    expect(sql).toContain(
      'DELETE FROM "DEPARE" WHERE _QZMIN IS NULL AND _QFALL IS NULL',
    );
  });
});

describe("a cell the partition cannot place", () => {
  test("no coverage table publishes as a fallback continuation", () => {
    const { sql, status } = run(
      { STUB_PRE_TOTAL: "9", STUB_TOTAL: "9" },
      { coverage: false },
    );

    // The tileset's meta says the tiles carry the scale gating, and the style
    // stands its own INTU floors down on the strength of it -- keeping only the
    // reduced floor it scopes to _QFALL. Publishing this cell with no stamp of
    // any kind would draw it from z0 with no floor at either end.
    expect(status).toBe(0);
    expect(sql).toContain('ALTER TABLE "DEPARE" ADD COLUMN _QFALL INTEGER');
    expect(sql).toContain('UPDATE "DEPARE" SET _QFALL = 1');
    expect(sql).not.toContain('INSERT INTO "DEPARE"');
  });

  test("an unreadable M_COVR extent publishes as a fallback continuation", () => {
    const { sql, stderr } = run({
      STUB_EXTENT: "",
      STUB_HAS_MASK: "1",
      STUB_PRE_TOTAL: "9",
      STUB_TOTAL: "9",
    });

    expect(stderr).toContain("publishing unpartitioned");
    expect(sql).toContain('UPDATE "DEPARE" SET _QFALL = 1');
  });

  test("M_COVR is exempt from the marking too", () => {
    const { sql } = run(
      { STUB_PRE_TOTAL: "9", STUB_TOTAL: "9" },
      { coverage: false },
    );

    // The pick/status/overzoom keeper describes the cell's coverage at every
    // zoom the cell reaches, and a floor on it would gate that.
    expect(sql).not.toContain('UPDATE "M_COVR" SET _QFALL = 1');
  });

  test("a partitioned cell is not marked as a continuation", () => {
    const { sql } = run(THREE_RUNG_CELL);

    // The ladder placed every zoom with an owner; only the copy BELOW the
    // cell's own rung is a stand-in, and step 2b stamps that one itself.
    expect(sql).not.toContain('UPDATE "DEPARE" SET _QFALL = 1');
  });
});

describe("the fallback continuation", () => {
  test("is cut against the union of everything coarser", () => {
    const { sql } = run(THREE_RUNG_CELL);

    // It has to survive only where no coarser chart lies beneath, which is the
    // difference; where one does, the sweep takes the copy away.
    expect(sql).toMatch(
      /UPDATE "DEPARE" SET geom = ST_Difference\("DEPARE"\.geom, \(SELECT geom FROM quilt_mask_coarser\)\)[\s\S]*?WHERE _QFALL = 1/,
    );
    expect(sql).toContain(
      'DELETE FROM "DEPARE" WHERE _QFALL = 1 AND (geom IS NULL OR ST_IsEmpty(geom) = 1)',
    );
  });

  test("carries _QFALL and NO _QZMIN", () => {
    const [fallback] = ladder(run(THREE_RUNG_CELL).sql, "DEPARE");

    // The style keys its reduced floor on the ABSENCE of a stamped minzoom;
    // stamping one would gate the stand-in at the rung it is standing in for.
    expect(fallback).toEqual({ min: null, max: 5, fallback: true });
  });

  test("with nothing coarser beneath, the copy is left uncut", () => {
    const { sql } = run({ ...THREE_RUNG_CELL, STUB_HAS_COARSER: "0" });

    // Someone must own the overview. Differencing against a NULL union would
    // return NULL geometry and the sweep would then delete the whole copy.
    expect(ladder(sql, "DEPARE")[0]).toEqual({
      min: null,
      max: 5,
      fallback: true,
    });
    expect(sql).not.toContain("FROM quilt_mask_coarser)");
  });

  test("a cell already on the coarsest rung gets no fallback copy", () => {
    // 1:20M floors at z0 -- there is nothing below it to continue into.
    const { sql } = run({ ...THREE_RUNG_CELL, STUB_CSCALE: "20000000" });

    expect(ladder(sql, "DEPARE")).toEqual([
      { min: 0, max: 7, fallback: false, whole: true },
      { min: 8, max: 9, fallback: false },
      { min: 10, max: null, fallback: false },
    ]);
  });
});

describe("M_COVR is exempt from the ladder", () => {
  test("it is neither copied nor stamped", () => {
    const { sql } = run(THREE_RUNG_CELL);

    // The pick/status/overzoom keeper has to describe the cell's coverage at
    // every zoom the cell reaches, so it stays a single copy with no bounds.
    expect(sql).not.toContain('INSERT INTO "M_COVR"');
    expect(sql).not.toContain('ALTER TABLE "M_COVR" ADD COLUMN _QZMIN');
    expect(sql).not.toMatch(/UPDATE "M_COVR" SET _QZMIN/);
  });

  test("and it is no longer clipped either", () => {
    const { sql } = run(THREE_RUNG_CELL);

    // A coverage ring with a finer chart's footprint cut out of it stops being
    // the cell's coverage.
    expect(sql).not.toContain('UPDATE "M_COVR" SET geom = ST_Difference');
    expect(sql).not.toMatch(/DELETE FROM "M_COVR"/);
  });
});

describe("the census key reaches the tiles", () => {
  test("the cell's compilation scale is handed to the stamping pass", () => {
    // Nothing else in a tile identifies the rung, so the census -- the
    // partition's proof harness -- is dead without this argument.
    const { node } = run(THREE_RUNG_CELL);

    expect(node).toMatch(/stamp-quilt-zooms .*--cscale 350000/);
  });

  test("a cell keyed off its band's scale still stamps that scale", () => {
    // No DSPM_CSCL: the floor falls back to the coarser rung of the INTU band's
    // pair (band 5 → 1:22k), and the stamp has to be the number the floor was
    // derived from or the census reads the cell onto a rung it does not own.
    const { node } = run({ ...THREE_RUNG_CELL, STUB_CSCALE: "none" });

    expect(node).toMatch(/stamp-quilt-zooms .*--cscale 22000/);
  });
});

describe("counts that cannot be read", () => {
  test("a failed post-clip count is exit 1, never a count of zero", () => {
    const result = run({
      STUB_HAS_MASK: "1",
      STUB_PRE_TOTAL: "9",
      STUB_COUNT_FAILS: "1",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("post-clip feature count");
    expect(result.stdout).not.toContain("fully covered");
  });

  test("a post-clip count with no integer in it is exit 1", () => {
    const result = run({
      STUB_HAS_MASK: "1",
      STUB_PRE_TOTAL: "9",
      STUB_COUNT_GARBAGE: "1",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("could not read a count");
    expect(result.stdout).not.toContain("fully covered");
  });

  test("a failed pre-clip count is exit 1 before anything is clipped", () => {
    const result = run({ STUB_HAS_MASK: "1", STUB_PRE_COUNT_FAILS: "1" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("pre-clip feature count");
    expect(result.tiled).toBe(false);
  });
});
