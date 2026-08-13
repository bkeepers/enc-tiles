import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

// The depth of an S-57 sounding is its Z coordinate, which MVT cannot carry.
// These GDAL options split the multipoints and lift the depth into an
// attribute, so the style has something to label. A plain text-match on the
// script can't tell a live `export OGR_S57_OPTIONS=...` from a commented-out
// or un-exported one, so it's tightened to require the export keyword on an
// active line.
test("the conversion asks GDAL for sounding depths", () => {
  const script = readFileSync("bin/s57-to-tiles", "utf8");

  expect(script).toMatch(
    /^\s*export\s+OGR_S57_OPTIONS=.*SPLIT_MULTIPOINT=ON.*ADD_SOUNDG_DEPTH=ON/m,
  );
});

// The property that actually matters is that ogr2ogr's child process
// receives these options, not merely that the string appears somewhere in
// the script (an un-exported or commented-out assignment would still match
// a text search). Stub both ogrinfo (to hand back a fake DSID_INTU so the
// script reaches the conversion step) and ogr2ogr (to record the
// environment it was actually invoked with) so this stays GDAL-free and
// works without a real chart file, matching the no-gdal-bin CI constraint.
test("the conversion propagates the sounding-depth options to ogr2ogr", () => {
  const stubDir = mkdtempSync(join(tmpdir(), "enc-tiles-stub-"));
  const capture = join(stubDir, "captured-ogr-s57-options");

  const stubOgrinfo = join(stubDir, "ogrinfo");
  writeFileSync(stubOgrinfo, `#!/bin/sh\necho "  DSID_INTU (Integer) = 5"\n`, {
    mode: 0o755,
  });
  chmodSync(stubOgrinfo, 0o755);

  const stubOgr2ogr = join(stubDir, "ogr2ogr");
  writeFileSync(
    stubOgr2ogr,
    `#!/bin/sh\nprintf '%s' "$OGR_S57_OPTIONS" > "${capture}"\n`,
    { mode: 0o755 },
  );
  chmodSync(stubOgr2ogr, 0o755);

  const out = join(stubDir, "out.pmtiles");
  execFileSync("bin/s57-to-tiles", ["does-not-exist.000", out], {
    encoding: "utf8",
    stdio: "pipe",
    env: { ...process.env, PATH: `${stubDir}:${process.env.PATH}` },
  });

  const capturedOptions = readFileSync(capture, "utf8");
  expect(capturedOptions).toContain("SPLIT_MULTIPOINT=ON");
  expect(capturedOptions).toContain("ADD_SOUNDG_DEPTH=ON");
});
