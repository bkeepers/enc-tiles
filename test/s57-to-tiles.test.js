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
  mkdirSync,
  mkdtempSync,
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
 */
function run(env = {}) {
  const input = join(work, "in.000");
  const coverage = join(work, "cov.gpkg");
  writeFileSync(input, "");
  writeFileSync(coverage, "");

  const result = spawnSync(
    "bash",
    [SCRIPT, input, join(work, "out.pmtiles"), "--coverage", coverage],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${stubDir}:${process.env.PATH}`,
        STUB_STATE: join(work, "count-sequence"),
        ...env,
      },
    },
  );
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    tiled: (result.stdout ?? "").includes("TIPPECANOE RAN"),
  };
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
