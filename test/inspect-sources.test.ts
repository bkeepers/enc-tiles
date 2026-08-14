import { expect, test } from "vitest";
import type { StyleSpecification } from "maplibre-gl";
import createStyle, { BANDS } from "@enc-tiles/styles";
import { inspectSources } from "../src/inspect-sources.js";

const style = (
  sources: StyleSpecification["sources"],
  layers: StyleSpecification["layers"],
): StyleSpecification => ({ version: 8, sources, layers });

const vector = { type: "vector" as const, tiles: ["pmtiles://a/{z}/{x}/{y}"] };

test("groups source-layers under the source that reads them", () => {
  expect(
    inspectSources(
      style({ coastal: vector, harbour: vector }, [
        { id: "a", type: "fill", source: "coastal", "source-layer": "DEPARE" },
        { id: "b", type: "line", source: "coastal", "source-layer": "COALNE" },
        { id: "c", type: "fill", source: "harbour", "source-layer": "M_COVR" },
      ]),
    ),
  ).toEqual({
    coastal: ["DEPARE", "COALNE"],
    harbour: ["M_COVR"],
  });
});

test("lists every source, even one no layer reads", () => {
  expect(
    inspectSources(
      style({ coastal: vector, berthing: vector }, [
        { id: "a", type: "fill", source: "coastal", "source-layer": "DEPARE" },
      ]),
    ),
  ).toEqual({ coastal: ["DEPARE"], berthing: [] });
});

test("skips layers with no source-layer, and sources not in the style", () => {
  expect(
    inspectSources(
      style({ coastal: vector }, [
        { id: "bg", type: "background" },
        { id: "a", type: "fill", source: "coastal", "source-layer": "DEPARE" },
        { id: "b", type: "fill", source: "gone", "source-layer": "DEPARE" },
      ]),
    ),
  ).toEqual({ coastal: ["DEPARE"] });
});

test("deduplicates a source-layer read by several layers", () => {
  expect(
    inspectSources(
      style({ coastal: vector }, [
        { id: "a", type: "fill", source: "coastal", "source-layer": "DEPARE" },
        { id: "b", type: "line", source: "coastal", "source-layer": "DEPARE" },
      ]),
    ),
  ).toEqual({ coastal: ["DEPARE"] });
});

// The point of the whole module: MaplibreInspect only skips its own
// TileJSON discovery when every source it would look at is already keyed
// here. A real style is the case that has to hold.
test("covers every source of the real band style", () => {
  const sources = inspectSources(
    createStyle({
      sources: Object.fromEntries(
        BANDS.map((band) => [band.name, vector]),
      ) as Record<string, typeof vector>,
    }),
  );

  expect(Object.keys(sources)).toEqual(BANDS.map((band) => band.name));
  for (const band of BANDS) {
    expect(sources[band.name]!.length, band.name).toBeGreaterThan(0);
    expect(new Set(sources[band.name]).size).toBe(sources[band.name]!.length);
  }
  expect(sources["harbour"]).toContain("M_COVR");
});
