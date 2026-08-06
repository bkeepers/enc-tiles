import { test, describe, expect } from "vitest";
import {
  attributeFilters,
  listIncludes,
  listExcludes,
} from "../src/filters.js";

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

  test("scalar attribute values match after string coercion", () => {
    const attc = [{ attl: "BCNSHP", attv: "1" }];

    expect(attributeFilters(attc)).toEqual([
      ["==", ["to-string", ["get", "BCNSHP"]], "1"],
    ]);
  });

  test("multi-value list attributes match as comma-separated strings", () => {
    const attc = [
      { attl: "COLOUR", attv: "3,4,3" },
      { attl: "BCNSHP", attv: "2" },
    ];

    expect(attributeFilters(attc)).toEqual([
      ["==", ["to-string", ["get", "COLOUR"]], "3,4,3"],
      ["==", ["to-string", ["get", "BCNSHP"]], "2"],
    ]);
  });

  test("single-value list attributes match directly", () => {
    const attc = [
      { attl: "COLOUR", attv: "3" },
      { attl: "CATREA", attv: "27" },
    ];

    expect(attributeFilters(attc)).toEqual([
      ["==", ["to-string", ["get", "COLOUR"]], "3"],
      ["==", ["to-string", ["get", "CATREA"]], "27"],
    ]);
  });
});

describe("listIncludes", () => {
  test("single value membership test", () => {
    expect(listIncludes("RESTRN", "7")).toEqual([
      "in",
      ",7,",
      ["concat", ",", ["get", "RESTRN"], ","],
    ]);
  });

  test("multiple value membership test (any of)", () => {
    expect(listIncludes("RESTRN", "7", "8", "14")).toEqual([
      "any",
      ["in", ",7,", ["concat", ",", ["get", "RESTRN"], ","]],
      ["in", ",8,", ["concat", ",", ["get", "RESTRN"], ","]],
      ["in", ",14,", ["concat", ",", ["get", "RESTRN"], ","]],
    ]);
  });
});

describe("listExcludes", () => {
  test("negates membership test", () => {
    expect(listExcludes("CATLIT", "5", "6")).toEqual([
      "!",
      [
        "any",
        ["in", ",5,", ["concat", ",", ["get", "CATLIT"], ","]],
        ["in", ",6,", ["concat", ",", ["get", "CATLIT"], ","]],
      ],
    ]);
  });
});
