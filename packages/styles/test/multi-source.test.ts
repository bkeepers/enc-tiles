import { expect, test } from "vitest";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import createStyle, { BANDS } from "../src/index.js";
import type { VectorSourceSpecification } from "maplibre-gl";

const vector = (url: string): VectorSourceSpecification => ({
  type: "vector",
  url,
});

const allBands = Object.fromEntries(
  BANDS.map((band) => [
    band.name,
    vector(`pmtiles://noaa-${band.name}.pmtiles`),
  ]),
);

test("a single source keeps the current shape", () => {
  const style = createStyle({ source: vector("test.pmtiles") });

  expect(Object.keys(style.sources)).toEqual(["enc"]);
  expect(validateStyleMin(style)).toEqual([]);
});

test("band sources are declared and stacked smallest scale first", () => {
  const style = createStyle({ sources: allBands });

  expect(Object.keys(style.sources)).toEqual(BANDS.map((band) => band.name));

  const order = style.layers
    .filter((layer) => "source" in layer && layer.source)
    .map((layer) => (layer as { source: string }).source);

  expect([...new Set(order)]).toEqual(BANDS.map((band) => band.name));
  expect(validateStyleMin(style)).toEqual([]);
});

test("every layer points at the source of its band", () => {
  const style = createStyle({ sources: allBands });

  for (const layer of style.layers) {
    if (!("source" in layer) || !layer.source) continue;
    expect(layer.id.startsWith(`${layer.source}-`)).toBe(true);
  }
});

test("layer ids are unique and stable across calls", () => {
  const ids = (style: { layers: { id: string }[] }) =>
    style.layers.map((layer) => layer.id);

  const first = ids(createStyle({ sources: allBands }));
  const second = ids(createStyle({ sources: allBands }));

  expect(new Set(first).size).toBe(first.length);
  expect(first).toEqual(second);
});

test("rejects being given both source and sources", () => {
  expect(() =>
    createStyle({ source: vector("test.pmtiles"), sources: allBands }),
  ).toThrow(/exactly one/);
});
