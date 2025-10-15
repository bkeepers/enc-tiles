import { expect, test } from "vitest";
import { colours } from "../src/index.js";

test("sanity check", () => {
  expect(Object.keys(colours)).toEqual(["DAY", "DUSK", "NIGHT"]);
  expect(colours.DAY.NODTA).toBe("#93AEBB");
});
