import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { BANDS as SCRIPT_BANDS, bandForMinzoom } from "../bin/lib/bands.mjs";
import { BANDS as STYLE_BANDS } from "../packages/styles/src/bands.ts";

test("the build scripts and the styles package declare the same bands", () => {
  expect(SCRIPT_BANDS).toEqual(STYLE_BANDS.map((band) => ({ ...band })));
});

test("bandForMinzoom maps a tileset minzoom back to its band", () => {
  expect(bandForMinzoom(0)?.name).toBe("overview");
  expect(bandForMinzoom(13)?.name).toBe("harbour");
  expect(bandForMinzoom(1)).toBeUndefined();
});

// bin/s57-to-tiles hard-codes the zoom ranges in a shell case statement. Keep it
// honest rather than shelling out to node once per chart during the build.
test("bin/s57-to-tiles uses the same zoom range for every band", () => {
  const script = readFileSync("bin/s57-to-tiles", "utf8");

  for (const band of SCRIPT_BANDS) {
    const clause = new RegExp(
      `^\\s*${band.intu}\\)[\\s\\S]*?minzoom=${band.minzoom}\\s*\\n\\s*maxzoom=${band.maxzoom}\\s*$`,
      "m",
    );
    expect(script, `band ${band.name} (INTU ${band.intu})`).toMatch(clause);
  }
});
