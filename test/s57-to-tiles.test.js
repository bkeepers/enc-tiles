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
    // tippecanoe's own argv, which is where the cell's tiling range is stated.
    tippecanoe:
      /^TIPPECANOE ARGV (.*)$/m.exec(result.stdout ?? "")?.[1] ?? null,
  };
}

/** The tiling range tippecanoe was actually asked for, or null if it never ran. */
function tilingRange(tippecanoe) {
  if (tippecanoe === null) return null;
  const min = /--minimum-zoom=(\d+)/.exec(tippecanoe);
  const max = /--maximum-zoom=(\d+)/.exec(tippecanoe);
  if (!min || !max) return null;
  return { min: Number(min[1]), max: Number(max[1]) };
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
 * rungs, with a coarser chart beneath it. Its own floor is 7 at the stub's
 * latitude (offset-3 ladder), so the ladder is fallback [0..6], whole [7..8],
 * [9..10], [11..].
 */
const THREE_RUNG_CELL = {
  STUB_CSCALE: "350000",
  STUB_FINER_FLOORS: "9 11",
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
      { min: null, max: 6, fallback: true },
      { min: 7, max: 8, fallback: false, whole: true },
      { min: 9, max: 10, fallback: false },
      { min: 11, max: null, fallback: false },
    ]);
  });

  test("the whole copy is the UNCUT original over the cell's own rung", () => {
    const { sql } = run(THREE_RUNG_CELL);

    expect(sql).toContain('UPDATE "DEPARE" SET _QZMIN = 7, _QZMAX = 8');

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
    expect(sql).toContain("-where QFLOOR <> 7");
    expect(sql).toContain(
      "CREATE TABLE quilt_mask AS SELECT ST_Union(geom) as geom FROM quilting WHERE QFLOOR > 7",
    );
    expect(sql).toContain(
      "CREATE TABLE quilt_mask_coarser AS SELECT ST_Union(geom) as geom FROM quilting WHERE QFLOOR < 7",
    );
  });

  test("the ladder masks are cumulative", () => {
    const { sql } = run(THREE_RUNG_CELL);

    expect(sql).toContain(
      "CREATE TABLE quilt_mask_9 AS SELECT ST_Union(geom) as geom FROM quilting WHERE QFLOOR > 7 AND QFLOOR <= 9",
    );
    expect(sql).toContain(
      "CREATE TABLE quilt_mask_11 AS SELECT ST_Union(geom) as geom FROM quilting WHERE QFLOOR > 7 AND QFLOOR <= 11",
    );
  });

  test("a cell nothing finer covers is one unbounded whole copy", () => {
    const { sql } = run({
      ...THREE_RUNG_CELL,
      STUB_FINER_FLOORS: "",
      STUB_HAS_MASK: "0",
    });

    expect(ladder(sql, "DEPARE")).toEqual([
      { min: null, max: 6, fallback: true },
      { min: 7, max: null, fallback: false, whole: true },
    ]);
  });

  test("the un-cast SQL convention survives the rewrite", () => {
    const { sql } = run(THREE_RUNG_CELL);

    // Commit 57f5373: AsGPB() of an already-GPKG blob is NULL, so a cast
    // write-back makes the empty sweep delete every row the clip touched.
    // plotroom's pipeline/Dockerfile probes these exact shapes at image build.
    expect(sql).toMatch(
      /UPDATE "DEPARE" SET geom = ST_Difference\("DEPARE"\.geom, \(SELECT geom FROM quilt_mask_9\)\)/,
    );
    expect(sql).toMatch(
      /ST_Within\("DEPARE"\.geom, \(SELECT geom FROM quilt_mask_9\)\)/,
    );
    expect(sql).not.toContain("AsGPB");
    expect(sql).not.toMatch(/CastAutomagic\([^)]*quilt_mask/);
  });
});

/**
 * A 1:90k cell of band 4, whose BAND alone would tile it to z10. Its own floor
 * is 9 (offset-3 ladder), and it is overlapped by 1:22k (floor 11) and 1:12k
 * (floor 12) charts -- both of which floor deeper than that band maxzoom.
 */
const CELL_UNDER_DEEPER_RUNGS = {
  STUB_INTU: "4",
  STUB_CSCALE: "90000",
  STUB_FINER_FLOORS: "11 12",
  STUB_HAS_COARSER: "1",
  STUB_HAS_MASK: "1",
  STUB_PRE_TOTAL: "9",
  STUB_TOTAL: "9",
};

describe("rungs deeper than the cell's own band", () => {
  test("a rung deeper than the band gets its own interval, not a fold", () => {
    const intervals = ladder(run(CELL_UNDER_DEEPER_RUNGS).sql, "DEPARE");

    // Folding {11, 12} onto the band maxzoom 10 would collapse this to a whole
    // copy of [9..9] and a top copy of [10..] cut against BOTH rungs -- so at
    // z10 the coarse chart would be cut away for the sake of 1:12k charts that
    // do not start serving until z12, and the tile would come back all but
    // empty. Each rung is cut against only the coverage that has actually
    // arrived.
    expect(intervals).toEqual([
      { min: null, max: 8, fallback: true },
      { min: 9, max: 10, fallback: false, whole: true },
      { min: 11, max: 11, fallback: false },
      { min: 12, max: null, fallback: false },
    ]);
  });

  test("the cell is tiled to the publication cap, covering its deepest rung", () => {
    const result = run(CELL_UNDER_DEEPER_RUNGS);

    // A ladder interval needs a tile to live in: tippecanoe writes nothing
    // above --maximum-zoom, and bin/stamp-quilt-zooms drops any copy whose
    // interval falls entirely outside the tiling range. Band 4 alone stops at
    // z10; the cap raise is what gives the [12..] top copy its tiles.
    expect(tilingRange(result.tippecanoe)).toEqual({ min: 0, max: 12 });

    // --full-detail stays pinned: one extent, every tile, every band.
    expect(result.tippecanoe).toContain("--full-detail=14");
    expect(result.tippecanoe).toContain("--low-detail=14");
    expect(result.tippecanoe).toContain("--minimum-detail=14");
  });

  test("a cell with NO deeper rungs is raised to the cap all the same", () => {
    // The raise is the region join's uniformity invariant, not a consequence
    // of the ladder: every join input must share one native maxzoom, or
    // tile-join synthesizes the missing zooms for the shallow inputs across
    // their whole footprint -- the alaska_western_arctic 32 GiB OOM, where 255
    // band-raised cells stopped at z11 beside six z12 harbour cells.
    const { tippecanoe } = run({
      ...CELL_UNDER_DEEPER_RUNGS,
      STUB_FINER_FLOORS: "",
      STUB_HAS_MASK: "0",
    });

    expect(tilingRange(tippecanoe)).toEqual({ min: 0, max: 12 });
  });

  test("the top copy is cut against ALL finer coverage", () => {
    const { sql } = run(CELL_UNDER_DEEPER_RUNGS);

    // The deepest tile is what `tile-join --overzoom` lifts over every finer
    // chart, so cutting it against the floor-11 coverage alone would put this
    // 1:90k cell's coastline over the 1:12k harbour charts at z12 -- the
    // published cap, and the defect the quilt exists to remove.
    const cut = statements(sql).find(
      (statement) =>
        statement.includes('UPDATE "DEPARE" SET geom = ST_Difference') &&
        statement.includes("WHERE _QZMIN = 12"),
    );
    expect(cut).toMatch(/\(SELECT geom FROM quilt_mask\)/);

    // And the rung BELOW it is cut against its own cumulative mask alone.
    const rung = statements(sql).find(
      (statement) =>
        statement.includes('UPDATE "DEPARE" SET geom = ST_Difference') &&
        statement.includes("WHERE _QZMIN = 11"),
    );
    expect(rung).toMatch(/\(SELECT geom FROM quilt_mask_11\)/);
  });

  test("a cell whose finer neighbours ALL start deeper keeps every rung", () => {
    // A 1:180k cell floors at 8 and its band tiles to z8; the 1:45k, 1:22k and
    // 1:12k charts over it floor at 10, 11 and 12. This is the acceptance
    // shape of the offset-3 shift: US3WA1DF owns [8..9] -- it fills the
    // viewport through z9 -- and hands to the 1:45k charts at z10. (Under the
    // old fold, all three rungs folded onto z8, the whole copy shrank to one
    // zoom, and the deepest band tile -- cut against the full finer union --
    // came back with 6 DEPARE features over the whole Puget basin against
    // 1791 one zoom above it.)
    const { sql, tippecanoe } = run({
      ...CELL_UNDER_DEEPER_RUNGS,
      STUB_INTU: "3",
      STUB_CSCALE: "180000",
      STUB_FINER_FLOORS: "10 11 12",
    });

    const intervals = ladder(sql, "DEPARE");
    expect(intervals).toEqual([
      { min: null, max: 7, fallback: true },
      { min: 8, max: 9, fallback: false, whole: true },
      { min: 10, max: 10, fallback: false },
      { min: 11, max: 11, fallback: false },
      { min: 12, max: null, fallback: false },
    ]);

    // Exactly-one-owner over the whole tiling range: the intervals meet end to
    // end from z0, the last is unbounded, and every zoom the cell now tiles is
    // inside one of them.
    expect(intervals[0].min ?? 0).toBe(0);
    for (let i = 0; i < intervals.length - 1; i++) {
      expect(intervals[i].max).toBe((intervals[i + 1].min ?? 0) - 1);
    }
    expect(intervals[intervals.length - 1].max).toBeNull();

    // A cumulative mask per rung, none of them folded away.
    for (const floor of [10, 11, 12]) {
      expect(sql).toContain(
        `CREATE TABLE quilt_mask_${floor} AS SELECT ST_Union(geom) as geom ` +
          `FROM quilting WHERE QFLOOR > 8 AND QFLOOR <= ${floor}`,
      );
    }

    // And a tile for every one of them.
    expect(tilingRange(tippecanoe)).toEqual({ min: 0, max: 12 });
  });

  test("the whole copy is never an empty interval", () => {
    // The fold could land a rung on the cell's OWN floor, leaving [f0..f0-1] --
    // the one geometry that made exit 65 reachable, and why bin/s57-to-tiles
    // deletes the unstamped rows rather than stamping them. Ladder floors come
    // straight off `QFLOOR > f0` now, so the first is at least f0+1 and the
    // whole copy always holds at least its own rung. The guard is kept as
    // insurance; nothing self-consistent reaches it.
    const { sql } = run({
      ...CELL_UNDER_DEEPER_RUNGS,
      STUB_INTU: "5",
      STUB_CSCALE: "12000",
      // 1:12k floors at 12, which is the publication cap and therefore the
      // finest rung the ladder has: nothing can be finer than this cell.
      STUB_FINER_FLOORS: "",
      STUB_HAS_MASK: "0",
    });

    expect(ladder(sql, "DEPARE")).toEqual([
      { min: null, max: 11, fallback: true },
      { min: 12, max: null, fallback: false, whole: true },
    ]);
    expect(sql).toContain("-where QFLOOR <> 12");
    expect(sql).not.toContain(
      'DELETE FROM "DEPARE" WHERE _QZMIN IS NULL AND _QFALL IS NULL',
    );
  });

  test("the band-6 fallback scale floors at the publication cap", () => {
    // 1:4000 is z13 on the raw offset-3 ladder; bin/quilt-rung.sh clamps it to
    // the cap (12) and both consumers of it must agree. Band 6 tiles z12
    // natively, so the clamped floor names a tile the archive actually holds
    // -- the old cap-11 defect (content stamped into deleted z12 tiles) is
    // what the clamp still guards against.
    const { sql } = run({
      ...THREE_RUNG_CELL,
      STUB_CSCALE: "4000",
      // Nothing can floor finer than the cap, so this cell has no finer rungs.
      STUB_FINER_FLOORS: "",
    });

    expect(sql).toContain("-where QFLOOR <> 12");
    expect(sql).toContain(
      "CREATE TABLE quilt_mask AS SELECT ST_Union(geom) as geom FROM quilting WHERE QFLOOR > 12",
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

  test("it is tiled to the publication cap all the same", () => {
    // The uniformity invariant is the REGION JOIN's, and an unpartitioned cell
    // is an input of that join like any other: a band-4 cell that skipped the
    // ladder must not hand it a z10 archive beside the z12 ones, or tile-join
    // synthesizes z11 and z12 across its whole footprint -- the merge that
    // OOM'd alaska_western_arctic. Both unpartitioned paths, since the raise
    // used to sit inside the guards that these two skip.
    const band4 = { STUB_INTU: "4", STUB_PRE_TOTAL: "9", STUB_TOTAL: "9" };

    const noCoverage = run(band4, { coverage: false });
    expect(tilingRange(noCoverage.tippecanoe)).toEqual({ min: 0, max: 12 });

    const offLadder = run({ ...band4, STUB_EXTENT: "", STUB_HAS_MASK: "1" });
    expect(offLadder.stderr).toContain("publishing unpartitioned");
    expect(tilingRange(offLadder.tippecanoe)).toEqual({ min: 0, max: 12 });
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
    expect(fallback).toEqual({ min: null, max: 6, fallback: true });
  });

  test("with nothing coarser beneath, the copy is left uncut", () => {
    const { sql } = run({ ...THREE_RUNG_CELL, STUB_HAS_COARSER: "0" });

    // Someone must own the overview. Differencing against a NULL union would
    // return NULL geometry and the sweep would then delete the whole copy.
    expect(ladder(sql, "DEPARE")[0]).toEqual({
      min: null,
      max: 6,
      fallback: true,
    });
    expect(sql).not.toContain("FROM quilt_mask_coarser)");
  });

  test("a cell already on the coarsest rung gets no fallback copy", () => {
    // 1:40M floors at z0 -- there is nothing below it to continue into.
    // (1:20M no longer does: the offset-3 ladder puts it at z1.)
    const { sql } = run({ ...THREE_RUNG_CELL, STUB_CSCALE: "40000000" });

    expect(ladder(sql, "DEPARE")).toEqual([
      { min: 0, max: 8, fallback: false, whole: true },
      { min: 9, max: 10, fallback: false },
      { min: 11, max: null, fallback: false },
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

describe("the chart's own name", () => {
  /** A cell whose tables include the ones the new step-2 work touches. */
  const NAMED_CELL = {
    ...THREE_RUNG_CELL,
    STUB_TABLES: "DEPARE M_COVR BUAARE M_QUAL",
  };

  test("DSNM is stamped on M_COVR, and on nothing else", () => {
    // The pick resolves the covering chart through the coverage polygon, so
    // that is the one feature that carries the name. On every layer it would
    // be one string per feature in every tile.
    const { sql } = run(NAMED_CELL);

    expect(sql).toContain("ALTER TABLE M_COVR ADD COLUMN DSNM TEXT");
    expect(sql).toContain("UPDATE M_COVR SET DSNM = 'US5WA22M'");
    expect(sql).not.toMatch(/ALTER TABLE "?DEPARE"? ADD COLUMN DSNM/);
    expect(sql).not.toMatch(/ALTER TABLE "?BUAARE"? ADD COLUMN DSNM/);
  });

  test("the .000 extension is stripped, and an update file names its cell", () => {
    // DSID_DSNM is the DATASET name: `.000` is the base cell and `.001`, ...
    // are its updates. All of them are the same chart.
    const { sql } = run({ ...NAMED_CELL, STUB_DSNM: "US3AK1FP.004" });

    expect(sql).toContain("UPDATE M_COVR SET DSNM = 'US3AK1FP'");
  });

  test("a chart with no readable DSNM still tiles, unstamped", () => {
    // Advisory: the name is a label, and nothing the rung, the clip or the
    // census does depends on it.
    const result = run({ ...NAMED_CELL, STUB_DSNM: "none" });

    expect(result.status).toBe(0);
    expect(result.sql).not.toContain("ADD COLUMN DSNM");
    expect(result.stderr).toContain("no readable DSID_DSNM");
  });

  test("a name that is not an 8-character cell is refused, not stamped", () => {
    // Anything else in that field is not the chart identity the frontend puts
    // at the head of a pick, and a wrong name is worse than none.
    const { sql } = run({ ...NAMED_CELL, STUB_DSNM: "SOMETHING_ELSE.000" });

    expect(sql).not.toContain("ADD COLUMN DSNM");
  });
});

describe("BUAARE fragments of one town", () => {
  const TOWN_CELL = {
    ...THREE_RUNG_CELL,
    STUB_TABLES: "DEPARE M_COVR BUAARE",
  };

  /**
   * The three statements of the dissolve, in order, and none of the copy
   * ladder's -- which also rewrites BUAARE geometry and would otherwise be
   * swept up by anything looser.
   */
  const DISSOLVE = [
    /CREATE TABLE buaare_dissolve/,
    /DELETE FROM BUAARE WHERE/,
    /UPDATE BUAARE SET geom = \(/,
  ];
  function dissolveStatements(sql) {
    const all = statements(sql);
    return DISSOLVE.map((pattern) => {
      const statement = all.find((entry) => pattern.test(entry));
      expect(statement, `${pattern} ran`).toBeDefined();
      return statement;
    });
  }

  test("same-named areas are unioned and the extra rows dropped", () => {
    // S-57 splits a named area across every polygon its topology needs, and
    // the shared border between two fragments of ONE town was being stroked as
    // though it separated two different places.
    const { sql } = run(TOWN_CELL);

    expect(sql).toContain(
      "SELECT OBJNAM AS objnam, ST_Union(geom) AS geom\n       FROM BUAARE",
    );
    expect(sql).toMatch(/GROUP BY OBJNAM/);
    expect(sql).toMatch(/DELETE FROM BUAARE WHERE .* ROWID NOT IN/s);
    expect(sql).toMatch(/UPDATE BUAARE SET geom = \(\s*SELECT d\.geom/);
    // The working table must not survive into the export.
    expect(sql).toContain("DROP TABLE buaare_dissolve");
  });

  test("an unnamed area is left completely alone", () => {
    // "Both have no name" is not evidence that two built-up areas are the same
    // place; grouping them would union every unrelated one in the cell.
    const dissolve = dissolveStatements(run(TOWN_CELL).sql);

    expect(dissolve).toHaveLength(3);
    for (const statement of dissolve) {
      expect(statement).toContain("OBJNAM IS NOT NULL AND OBJNAM <> ''");
    }
  });

  test("the un-cast SQL convention holds here too", () => {
    // Same trap as the quilt clip: AsGPB() of an already-GPKG blob is NULL, and
    // the write-back would erase every fragment it touched.
    for (const statement of dissolveStatements(run(TOWN_CELL).sql)) {
      expect(statement).not.toContain("AsGPB");
      expect(statement).not.toContain("CastAutomagic");
    }
  });

  test("a cell with no BUAARE runs no dissolve at all", () => {
    const { sql } = run(THREE_RUNG_CELL);

    expect(sql).not.toContain("buaare_dissolve");
  });
});

describe("the M_QUAL edge generator", () => {
  test("it is handed the quality layer and both coverage inputs", () => {
    // Without the coverage inputs the layer draws a line at every cell border,
    // which is the defect it exists to remove.
    const { node } = run({
      ...THREE_RUNG_CELL,
      STUB_TABLES: "DEPARE M_COVR M_QUAL",
    });

    expect(node).toMatch(
      /generate-mqual-edges \S+_MQUAL_EDGE\.geojson --quality \S+M_QUAL\.geojson/,
    );
    expect(node).toMatch(
      /generate-mqual-edges .*--coverage \S+quilting_coverage/,
    );
    expect(node).toMatch(
      /generate-mqual-edges .*--cell-coverage \S+M_COVR\.geojson/,
    );
  });

  test("it runs BEFORE the zoom stamping, so its ranges are converted", () => {
    // It propagates _QZMIN/_QZMAX onto its outputs as properties;
    // stamp-quilt-zooms is what turns those into tippecanoe members.
    const { node } = run({
      ...THREE_RUNG_CELL,
      STUB_TABLES: "DEPARE M_COVR M_QUAL",
    });

    const lines = node.trim().split("\n");
    const edges = lines.findIndex((l) => l.includes("generate-mqual-edges"));
    const stamp = lines.findIndex((l) => l.includes("stamp-quilt-zooms"));
    expect(edges).toBeGreaterThanOrEqual(0);
    expect(stamp).toBeGreaterThan(edges);
  });

  test("a cell with no M_QUAL does not run it", () => {
    const { node } = run(THREE_RUNG_CELL);

    expect(node).not.toContain("generate-mqual-edges");
  });
});

describe("the M_QUAL letter generator", () => {
  const QUALITY_CELL = {
    ...THREE_RUNG_CELL,
    STUB_TABLES: "DEPARE M_COVR M_QUAL",
  };

  test("it is handed the quality layer", () => {
    const { node } = run(QUALITY_CELL);

    expect(node).toMatch(
      /generate-mqual-labels \S+_MQUAL_LABELS\.geojson --quality \S+M_QUAL\.geojson/,
    );
  });

  test("it is handed NO coverage inputs", () => {
    // An anchor is a point INSIDE a zone, and a zone truncated by the cell
    // border is still a zone this cell has to letter. The coverage inputs
    // suppress BORDERS, which an anchor does not have.
    const { node } = run(QUALITY_CELL);

    const line = node
      .trim()
      .split("\n")
      .find((entry) => entry.includes("generate-mqual-labels"));
    expect(line).toBeDefined();
    expect(line).not.toContain("--coverage");
    expect(line).not.toContain("--cell-coverage");
  });

  test("it runs BEFORE the zoom stamping, so its ranges are converted", () => {
    // It propagates _QZMIN/_QZMAX onto its anchors as properties, and composes
    // with the {minzoom: 0} dot-drop exemption it stamps itself.
    const { node } = run(QUALITY_CELL);

    const lines = node.trim().split("\n");
    const anchors = lines.findIndex((l) => l.includes("generate-mqual-labels"));
    const stamp = lines.findIndex((l) => l.includes("stamp-quilt-zooms"));
    expect(anchors).toBeGreaterThanOrEqual(0);
    expect(stamp).toBeGreaterThan(anchors);
  });

  test("a cell with no M_QUAL does not run it", () => {
    const { node } = run(THREE_RUNG_CELL);

    expect(node).not.toContain("generate-mqual-labels");
  });
});

describe("the restriction anchor generator", () => {
  const RESTRICTED_CELL = {
    ...THREE_RUNG_CELL,
    STUB_TABLES: "DEPARE M_COVR LNDARE RESARE CBLARE MIPARE",
  };

  test("it is handed every restriction class the cell carries, and the land", () => {
    const { node } = run(RESTRICTED_CELL);

    expect(node).toMatch(
      /generate-restriction-anchors \S+_RESTR_ANCHORS\.geojson .*--class RESARE:\S+RESARE\.geojson/,
    );
    expect(node).toMatch(
      /generate-restriction-anchors .*--class CBLARE:\S+CBLARE\.geojson/,
    );
    expect(node).toMatch(
      /generate-restriction-anchors .*--class MIPARE:\S+MIPARE\.geojson/,
    );
    // The water-side placement differences against LNDARE.
    expect(node).toMatch(
      /generate-restriction-anchors .*--land \S+LNDARE\.geojson/,
    );
  });

  test("the RESTRN01-cascade routeing classes are handed to it too", () => {
    // The class set is every LUT class whose instruction invokes the
    // CS(RESTRN01) cascade, not just the five the layer began with: the
    // routeing/precautionary polygons drew the cascade's symbols per polygon
    // per tile at the centroid, on land, exactly as RESARE did before it.
    const { node } = run({
      ...RESTRICTED_CELL,
      STUB_TABLES: "DEPARE M_COVR LNDARE FAIRWY TSSLPT TESARE PRCARE",
    });

    for (const table of ["FAIRWY", "TSSLPT", "TESARE", "PRCARE"]) {
      expect(node).toMatch(
        new RegExp(
          `generate-restriction-anchors .*--class ${table}:\\S+${table}\\.geojson`,
        ),
      );
    }
  });

  test("ACHARE is NOT handed to it", () => {
    // Anchorages are fine as drawn (user ruling): their symbols never showed
    // the per-polygon repetition on land.
    const { node } = run({
      ...RESTRICTED_CELL,
      STUB_TABLES: "DEPARE M_COVR ACHARE RESARE",
    });

    const line = node
      .trim()
      .split("\n")
      .find((entry) => entry.includes("generate-restriction-anchors"));
    expect(line).toBeDefined();
    expect(line).not.toContain("ACHARE");
  });

  test("a cell with no LNDARE still runs it, without --land", () => {
    // Advisory: the generator falls back to the plain largest-part interior
    // point, which is what the label generators emit too.
    const { node } = run({
      ...RESTRICTED_CELL,
      STUB_TABLES: "DEPARE M_COVR RESARE",
    });

    const line = node
      .trim()
      .split("\n")
      .find((entry) => entry.includes("generate-restriction-anchors"));
    expect(line).toBeDefined();
    expect(line).not.toContain("--land");
  });

  test("it runs BEFORE the zoom stamping, so its ranges are converted", () => {
    // It propagates _QZMIN/_QZMAX onto its anchors as properties, and composes
    // with the {minzoom: 0} dot-drop exemption it stamps itself.
    const { node } = run(RESTRICTED_CELL);

    const lines = node.trim().split("\n");
    const anchorLine = lines.findIndex((l) =>
      l.includes("generate-restriction-anchors"),
    );
    const stamp = lines.findIndex((l) => l.includes("stamp-quilt-zooms"));
    expect(anchorLine).toBeGreaterThanOrEqual(0);
    expect(stamp).toBeGreaterThan(anchorLine);
  });

  test("a cell with no restriction classes does not run it", () => {
    const { node } = run(THREE_RUNG_CELL);

    expect(node).not.toContain("generate-restriction-anchors");
  });
});

describe("the BUAARE edge generator", () => {
  const TOWN_CELL = {
    ...THREE_RUNG_CELL,
    STUB_TABLES: "DEPARE M_COVR BUAARE",
  };

  test("it is handed the built-up areas and both coverage inputs", () => {
    // The import-time dissolve unions the fragments of one name within THIS
    // cell; the coverage inputs are what remove the border the dissolve cannot
    // reach across, which is the half of the defect that survived it.
    const { node } = run(TOWN_CELL);

    expect(node).toMatch(
      /generate-buaare-edges \S+_BUAARE_EDGE\.geojson --built-up \S+BUAARE\.geojson/,
    );
    expect(node).toMatch(
      /generate-buaare-edges .*--coverage \S+quilting_coverage/,
    );
    expect(node).toMatch(
      /generate-buaare-edges .*--cell-coverage \S+M_COVR\.geojson/,
    );
  });

  test("it runs BEFORE the zoom stamping, so its ranges are converted", () => {
    const { node } = run(TOWN_CELL);

    const lines = node.trim().split("\n");
    const edges = lines.findIndex((l) => l.includes("generate-buaare-edges"));
    const stamp = lines.findIndex((l) => l.includes("stamp-quilt-zooms"));
    expect(edges).toBeGreaterThanOrEqual(0);
    expect(stamp).toBeGreaterThan(edges);
  });

  test("it runs AFTER the dissolve, on the geometry that reaches the tiles", () => {
    // Deriving the edges from the undissolved fragments would work -- two
    // fragments of one name agree and drop their shared segment either way --
    // but the export it reads is the dissolved one, and the two must not drift.
    const { sql, node } = run(TOWN_CELL);

    expect(sql).toContain("DROP TABLE buaare_dissolve");
    expect(node).toContain("generate-buaare-edges");
  });

  test("a cell with no BUAARE does not run it", () => {
    const { node } = run(THREE_RUNG_CELL);

    expect(node).not.toContain("generate-buaare-edges");
  });
});

describe("the area edge generator", () => {
  // RESARE and CTNARE participate; DEPARE and M_COVR are handled elsewhere
  // (their own derived layers) and must never be handed to it.
  const RULED_CELL = {
    ...THREE_RUNG_CELL,
    STUB_TABLES: "DEPARE M_COVR RESARE CTNARE",
  };

  test("it is asked for its class list, then handed every participating class", () => {
    // The participating list lives in the generator (--list-classes) so the
    // wiring loop and the derivation cannot drift apart.
    const { node } = run(RULED_CELL);

    expect(node).toMatch(/generate-area-edges --list-classes/);
    expect(node).toMatch(
      /generate-area-edges \S+_AREA_EDGE\.geojson .*--area RESARE:\S+RESARE\.geojson/,
    );
    expect(node).toMatch(
      /generate-area-edges .*--area CTNARE:\S+CTNARE\.geojson/,
    );
  });

  test("it is handed both coverage inputs, like the other edge derivations", () => {
    const { node } = run(RULED_CELL);

    expect(node).toMatch(
      /generate-area-edges .*--coverage \S+quilting_coverage/,
    );
    expect(node).toMatch(
      /generate-area-edges .*--cell-coverage \S+M_COVR\.geojson/,
    );
  });

  test("classes with their own derived edge layer are NOT handed to it", () => {
    // DEPARE belongs to _DEPARE_EDGE (seams flagged, not dropped) and M_COVR
    // is the coverage input itself, not a participant.
    const { node } = run(RULED_CELL);

    const line = node
      .trim()
      .split("\n")
      .find((entry) => entry.includes("_AREA_EDGE.geojson"));
    expect(line).toBeDefined();
    expect(line).not.toContain("--area DEPARE");
    expect(line).not.toContain("--area M_COVR");
  });

  test("it runs BEFORE the zoom stamping, so its ranges are converted", () => {
    const { node } = run(RULED_CELL);

    const lines = node.trim().split("\n");
    const edges = lines.findIndex((l) => l.includes("_AREA_EDGE.geojson"));
    const stamp = lines.findIndex((l) => l.includes("stamp-quilt-zooms"));
    expect(edges).toBeGreaterThanOrEqual(0);
    expect(stamp).toBeGreaterThan(edges);
  });

  test("a cell with no participating classes does not run it", () => {
    // The class-list query still runs -- it is how the answer is known -- but
    // no derivation is invoked over nothing.
    const { node } = run(THREE_RUNG_CELL);

    expect(node).not.toContain("_AREA_EDGE.geojson");
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
