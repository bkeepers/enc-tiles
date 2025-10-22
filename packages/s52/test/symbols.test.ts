import { expect, test } from "vitest";
import { symbols } from "../src/index.js";

test("returns symbol data", () => {
  expect(symbols["BCNCAR01"]).toEqual({
    description: "cardinal beacon, north, simplified",
    height: 24,
    offset: [0, 0],
    width: 16,
  });
});
