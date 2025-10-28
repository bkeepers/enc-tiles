import { test, describe, expect } from "vitest";
import { attributeFilters } from "../src/filters.js";

describe("attributeFilters", () => {
  test("presence of attributes", () => {
    const attc = [
      {
        attl: "CAT_TS3",
        attv: "",
      },
      {
        attl: "ORIENT",
        attv: "",
      },
    ];

    expect(attributeFilters(attc)).toEqual([
      ["has", "CAT_TS3"],
      ["has", "ORIENT"],
    ]);
  });

  test("exclusion of attributes", () => {
    const attc = [
      {
        attl: "DRVAL1",
        attv: "?",
      },
      {
        attl: "DRVAL2",
        attv: "?",
      },
    ];

    expect(attributeFilters(attc)).toEqual([
      ["!", ["has", "DRVAL1"]],
      ["!", ["has", "DRVAL2"]],
    ]);
  });
});
