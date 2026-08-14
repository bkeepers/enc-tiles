import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

// Runs bin/s57-to-tiles and captures its exit status and stderr instead of
// throwing, so tests can assert on failure paths.
function run(
  args: string[],
  options?: { env?: NodeJS.ProcessEnv },
): { status: number; stderr: string } {
  try {
    execFileSync("bin/s57-to-tiles", args, {
      encoding: "utf8",
      stdio: "pipe",
      env: options?.env,
    });
    return { status: 0, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number; stderr?: string };
    return { status: failure.status ?? 1, stderr: failure.stderr ?? "" };
  }
}

// This path exercises the same branch whether or not GDAL is installed: with no
// readable DSID layer the intended-use lookup yields an empty string either way.
test("fails when the intended-use band cannot be determined", () => {
  const stubDir = mkdtempSync(join(tmpdir(), "enc-tiles-stub-"));
  const sentinel = join(stubDir, "ogr2ogr-was-called");
  const stubOgr2ogr = join(stubDir, "ogr2ogr");

  // Create a stub ogr2ogr that would touch the sentinel if called
  writeFileSync(stubOgr2ogr, `#!/bin/sh\ntouch "${sentinel}"\nexit 0\n`, {
    mode: 0o755,
  });
  chmodSync(stubOgr2ogr, 0o755);

  const out = join(stubDir, "out.pmtiles");
  const { status, stderr } = run(["does-not-exist.000", out], {
    env: { ...process.env, PATH: `${stubDir}:${process.env.PATH}` },
  });

  // Must exit with non-zero
  expect(status).not.toBe(0);
  // Must mention DSID_INTU in the error
  expect(stderr).toContain("DSID_INTU");
  // Must exit BEFORE calling ogr2ogr (proof: sentinel was not created)
  expect(existsSync(sentinel)).toBe(false);
});

test("rejects an output extension that is neither .mbtiles nor .pmtiles", () => {
  const out = join(mkdtempSync(join(tmpdir(), "enc-tiles-")), "out.geojson");
  const { status, stderr } = run(["does-not-exist.000", out]);

  expect(status).not.toBe(0);
  expect(stderr).toContain("mbtiles");
});
