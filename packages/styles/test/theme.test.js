import { expect, test } from "vitest";
import theme from "../src/themes/index.js";

test("sanity check", () => {
  expect(Object.keys(theme)).toEqual(["DAY", "DUSK", "NIGHT"]);
  expect(theme.DAY.NODTA).toBe("#93AEBB");
});
