/**
 * Regression harness for the LIGHTS06 flare angle and the LITDSN02 placement
 * that follows it (S-52 PresLib 4.0, section 13.2.4).
 *
 * The CSP sets a local variable FLARE_AT_45_DEG FALSE, then TRUE only when the
 * light shares its point with other 'No Sector' lights *and* its COLOUR
 * includes 1 (white), 6 (yellow) or 11 (orange). The flare is then drawn by
 * "SY(SELECT,45)" or, in every other case, "SY(SELECT,135)" — so 135° is the
 * resting orientation of a lone light, not 0°. The port used to leave a lone
 * flare upright, pointing due north instead of leaning down-right the way
 * Chart 1 P (and every ECDIS) draws it.
 *
 * The description string moves with it: CENTRE justified at [2, 0] beside the
 * 135° flare, BOTTOM justified at [2, -1] above the point when the 45° flare
 * reaches up-right through where that text would otherwise sit.
 *
 * These cases build the real style and run the real MapLibre expression engine
 * over synthetic LIGHTS features, so they catch a layout expression that is
 * well-formed but resolves to the wrong angle.
 */
import { describe, expect, test } from "vitest";
import { createExpression, v8 } from "@maplibre/maplibre-gl-style-spec";
import type { LayerSpecification } from "maplibre-gl";
import { buildStyle, matchingLayers, type Match } from "./evaluate.js";

const style = buildStyle();

/** The flare symbols LIGHTS06 selects by COLOUR. */
const FLARES = new Set(["LIGHTS11", "LIGHTS12", "LIGHTS13", "LITDEF11"]);

/** Every LIGHTS layer accepting the feature, as full layer specs. */
function lightLayers(
  properties: Record<string, unknown>,
): { match: Match; layer: LayerSpecification }[] {
  return matchingLayers(style, "LIGHTS", properties).map((match) => ({
    match,
    layer: style.layers.find((candidate) => candidate.id === match.id)!,
  }));
}

/** The single flare layer drawn for a light. */
function flareLayer(properties: Record<string, unknown>): LayerSpecification {
  const flares = lightLayers(properties).filter(
    ({ match }) => match.icon !== undefined && FLARES.has(match.icon),
  );
  expect(flares).toHaveLength(1);
  return flares[0]!.layer;
}

/** The single LITDSN02 description layer drawn for a light. */
function descriptionLayer(
  properties: Record<string, unknown>,
): LayerSpecification {
  const texts = lightLayers(properties).filter(
    ({ match }) => match.text && match.icon === undefined,
  );
  expect(texts).toHaveLength(1);
  return texts[0]!.layer;
}

/**
 * A layout property of a layer, resolved for the feature that matched it.
 *
 * Constants pass through; expressions go through the real MapLibre compiler so
 * a case that never fires shows up as the wrong value rather than passing on
 * the shape of the array alone.
 */
function layoutValue(
  layer: LayerSpecification,
  property: string,
  properties: Record<string, unknown>,
): unknown {
  const value = (layer.layout as Record<string, unknown> | undefined)?.[
    property
  ];
  if (value === undefined || !Array.isArray(value)) return value;

  const spec = (v8.layout_symbol as Record<string, unknown>)[property];
  const compiled = createExpression(value, spec as never);
  if (compiled.result === "error") {
    throw new Error(
      `${property} of ${layer.id} did not compile: ${compiled.value.map(String).join(", ")}`,
    );
  }
  return (compiled.value as unknown as { evaluate: Function }).evaluate(
    { zoom: 14 },
    { type: "Point", properties } as never,
  );
}

/** The rotation LIGHTS06 draws a light's flare at. */
function flareRotation(properties: Record<string, unknown>): unknown {
  return layoutValue(flareLayer(properties), "icon-rotate", properties);
}

describe("LIGHTS06 flare rotation: lone lights rest at 135 degrees", () => {
  test.each([
    ["red", "3"],
    ["green", "4"],
    ["white", "1"],
    ["yellow", "6"],
    ["orange", "11"],
    ["white and red", "1,3"],
  ])("a lone %s light leans 135 degrees from upright", (_label, COLOUR) => {
    // _COLOCATED is an INTEGER DEFAULT 0 column, so a lone light arrives
    // either as an explicit 0 or — if the tiler drops the zero — absent.
    expect(flareRotation({ COLOUR, _COLOCATED: 0 })).toBe(135);
    expect(flareRotation({ COLOUR })).toBe(135);
  });

  test("the whole light, not just the flare, still draws", () => {
    const drawn = lightLayers({ COLOUR: "3", LITCHR: 2, SIGPER: 4 });
    expect(drawn.map(({ match }) => match.icon)).toContain("LIGHTS11");
    expect(drawn.some(({ match }) => match.text)).toBe(true);
  });
});

describe("LIGHTS06 flare rotation: co-located lights fan apart", () => {
  test.each([
    ["white", "1"],
    ["yellow", "6"],
    ["orange", "11"],
    // COLOUR *includes* 1, so the white half of a white-and-red light sets
    // FLARE_AT_45_DEG even though the symbol selected is the red LIGHTS11.
    ["white and red", "1,3"],
    ["white and green", "1,4"],
    ["blue and yellow", "5,6"],
  ])("a co-located %s light swings to 45 degrees", (_label, COLOUR) => {
    expect(flareRotation({ COLOUR, _COLOCATED: 1 })).toBe(45);
  });

  test.each([
    ["red", "3"],
    ["green", "4"],
    ["blue", "5"],
    ["violet", "10"],
  ])("a co-located %s light stays at 135 degrees", (_label, COLOUR) => {
    expect(flareRotation({ COLOUR, _COLOCATED: 1 })).toBe(135);
  });
});

describe("LITDSN02 placement follows FLARE_AT_45_DEG", () => {
  const description = { LITCHR: 2, SIGGRP: "(2)", SIGPER: 10, VALNMR: 15 };

  test.each([
    ["a lone white light", { COLOUR: "1", _COLOCATED: 0 }],
    ["a lone red light", { COLOUR: "3" }],
    ["a co-located red light", { COLOUR: "3", _COLOCATED: 1 }],
    ["a co-located green light", { COLOUR: "4", _COLOCATED: 1 }],
  ])("%s keeps the centred TX(...,3,2,3,...,2,0,...)", (_label, light) => {
    const properties = { ...description, ...light };
    const layer = descriptionLayer(properties);
    expect(layoutValue(layer, "text-anchor", properties)).toBe("left");
    expect(layoutValue(layer, "text-offset", properties)).toEqual([2, 0]);
  });

  test.each([
    ["a co-located white light", { COLOUR: "1", _COLOCATED: 1 }],
    ["a co-located yellow light", { COLOUR: "6", _COLOCATED: 1 }],
    ["a co-located orange light", { COLOUR: "11", _COLOCATED: 1 }],
  ])(
    "%s lifts to the bottom-justified TX(...,3,1,3,...,2,-1,...)",
    (_label, light) => {
      const properties = { ...description, ...light };
      const layer = descriptionLayer(properties);
      expect(layoutValue(layer, "text-anchor", properties)).toBe("bottom-left");
      expect(layoutValue(layer, "text-offset", properties)).toEqual([2, -1]);
    },
  );

  test("the description string itself is untouched by the move", () => {
    const properties = { ...description, COLOUR: "1", _COLOCATED: 1 };
    const layer = descriptionLayer(properties);
    // text-field resolves to a MapLibre Formatted, not a bare string.
    expect(String(layoutValue(layer, "text-field", properties))).toBe(
      "Fl(2) W 10s 15M",
    );
  });
});

describe("LIGHTS06 branches the flare angle does not reach", () => {
  test("a directional light still rotates by ORIENT +/- 180", () => {
    const properties = { CATLIT: "1", ORIENT: 45, COLOUR: "1" };
    const layer = flareLayer(properties);
    expect((layer.layout as Record<string, unknown>)["icon-rotate"]).toEqual([
      "+",
      ["get", "ORIENT"],
      180,
    ]);
    expect(layoutValue(layer, "icon-rotate", properties)).toBe(225);
  });

  test("a co-located directional light is unaffected by FLARE_AT_45_DEG", () => {
    const properties = {
      CATLIT: "16",
      ORIENT: 200,
      COLOUR: "1",
      _COLOCATED: 1,
    };
    expect(layoutValue(flareLayer(properties), "icon-rotate", properties)).toBe(
      380,
    );
  });

  test("a sector light's flare carries no rotation at all", () => {
    const properties = { SECTR1: 10, SECTR2: 100, COLOUR: "3" };
    const layer = flareLayer(properties);
    expect((layer.layout as Record<string, unknown>)["icon-rotate"]).toBe(
      undefined,
    );
  });

  test("a floodlight and a strip light are not flares", () => {
    expect(
      lightLayers({ CATLIT: "8", COLOUR: "1" }).map(({ match }) => match.icon),
    ).toContain("LIGHTS82");
    expect(
      lightLayers({ CATLIT: "9", COLOUR: "1" }).map(({ match }) => match.icon),
    ).toContain("LIGHTS81");
  });
});
