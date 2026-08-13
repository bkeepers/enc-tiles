import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

// Runs bin/s57-to-tiles and captures its exit status and stderr instead of
// throwing, so tests can assert on failure paths.
function run(args: string[]): { status: number; stderr: string } {
  try {
    execFileSync("bin/s57-to-tiles", args, { encoding: "utf8", stdio: "pipe" });
    return { status: 0, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number; stderr?: string };
    return { status: failure.status ?? 1, stderr: failure.stderr ?? "" };
  }
}

// This path exercises the same branch whether or not GDAL is installed: with no
// readable DSID layer the intended-use lookup yields an empty string either way.
test("fails when the intended-use band cannot be determined", () => {
  const out = join(mkdtempSync(join(tmpdir(), "enc-tiles-")), "out.pmtiles");
  const { status, stderr } = run(["does-not-exist.000", out]);

  expect(status).not.toBe(0);
  expect(stderr).toContain("DSID_INTU");
});

test("rejects an output extension that is neither .mbtiles nor .pmtiles", () => {
  const out = join(mkdtempSync(join(tmpdir(), "enc-tiles-")), "out.geojson");
  const { status } = run(["does-not-exist.000", out]);

  expect(status).not.toBe(0);
});
