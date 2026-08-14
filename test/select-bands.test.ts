import { expect, test } from "vitest";
import { selectBands } from "../src/select-bands.js";

const BANDS = [
  { name: "overview" },
  { name: "general" },
  { name: "coastal" },
  { name: "approach" },
  { name: "harbour" },
  { name: "berthing" },
] as const;

const names = (bands: readonly { name: string }[]) =>
  bands.map((band) => band.name);

test("loads every band when the variable is unset", () => {
  expect(names(selectBands(BANDS, undefined))).toEqual(names(BANDS));
});

test("keeps only the bands asked for", () => {
  expect(names(selectBands(BANDS, "coastal,harbour"))).toEqual([
    "coastal",
    "harbour",
  ]);
});

// Band order is the stacking order of the style -- smallest scale first --
// so it has to come from the table, not from however the variable was typed.
test("restores the table's order", () => {
  expect(names(selectBands(BANDS, "berthing,coastal,general"))).toEqual([
    "general",
    "coastal",
    "berthing",
  ]);
});

test("tolerates spacing and a trailing comma, and repeats", () => {
  expect(names(selectBands(BANDS, " coastal , harbour, coastal,"))).toEqual([
    "coastal",
    "harbour",
  ]);
});

// A silently dropped band is exactly what this branch exists to fix, so a
// typo must not look like a deliberately smaller tileset.
test("rejects an unknown band by name", () => {
  expect(() => selectBands(BANDS, "coastal,harbor")).toThrow(/harbor/);
  expect(() => selectBands(BANDS, "coastal,harbor")).toThrow(/harbour/);
});

test("rejects an empty value rather than loading nothing", () => {
  expect(() => selectBands(BANDS, "")).toThrow(/omit it entirely/);
  expect(() => selectBands(BANDS, " , ")).toThrow(/omit it entirely/);
});
