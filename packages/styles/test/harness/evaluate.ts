/**
 * Shared harness for exercising a built style the way MapLibre does.
 *
 * The unit tests around `attributeFilters` / `instructionsToStyles` check the
 * *shape* of the expressions we emit. These helpers instead run the real
 * MapLibre expression engine over synthetic features that carry the property
 * types the tiler actually writes, which is the only way to catch a filter that
 * is well-formed but can never match (or that throws and takes its whole layer
 * with it).
 */
import {
  createExpression,
  featureFilter,
  v8,
} from "@maplibre/maplibre-gl-style-spec";
import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import createStyle from "../../src/index.js";
import type { StyleOptions } from "../../src/index.js";

export type GeometryType = "Point" | "LineString" | "Polygon";

export interface Match {
  id: string;
  /** The resolved `icon-image`, if this layer draws a symbol. */
  icon?: string;
  /** True when this layer draws sounding/label text. */
  text: boolean;
  /** The raw `text-field` expression, when the layer draws text. */
  textField?: unknown;
  type: string;
  metadata: Record<string, unknown>;
  filter: unknown;
}

export function buildStyle(
  options: Partial<StyleOptions> = {},
): StyleSpecification {
  const warn = console.warn;
  // The look-up tables reference CSPs we have not implemented; the warning is
  // expected and would drown the test output.
  console.warn = () => {};
  try {
    return createStyle({
      source: { type: "vector", url: "about:blank" },
      mode: "DAY",
      ...options,
    } as StyleOptions);
  } finally {
    console.warn = warn;
  }
}

/** Layers grouped by source-layer, and compiled icon-image expressions. */
const layerIndex = new WeakMap<object, Map<string, LayerSpecification[]>>();
const iconExpressions = new WeakMap<object, { evaluate: Function }>();
const compiledFilters = new WeakMap<object, ReturnType<typeof featureFilter>>();

function layersFor(
  style: StyleSpecification,
  sourceLayer: string,
): LayerSpecification[] {
  let index = layerIndex.get(style);
  if (!index) {
    index = new Map();
    for (const layer of style.layers) {
      const key = (layer as { "source-layer"?: string })["source-layer"];
      if (!key) continue;
      const bucket = index.get(key);
      if (bucket) bucket.push(layer);
      else index.set(key, [layer]);
    }
    layerIndex.set(style, index);
  }
  return index.get(sourceLayer) ?? [];
}

function resolveIcon(
  layer: LayerSpecification,
  properties: Record<string, unknown>,
  geometry: GeometryType,
): string | undefined {
  const image = (layer.layout as Record<string, unknown> | undefined)?.[
    "icon-image"
  ];
  if (image === undefined) return undefined;
  if (typeof image === "string") return image;

  let compiledExpression = iconExpressions.get(layer);
  if (!compiledExpression) {
    const compiled = createExpression(image, v8.layout_symbol["icon-image"]);
    if (compiled.result === "error") {
      throw new Error(
        `icon-image of ${layer.id} did not compile: ${compiled.value.map(String).join(", ")}`,
      );
    }
    compiledExpression = compiled.value as unknown as { evaluate: Function };
    iconExpressions.set(layer, compiledExpression);
  }
  const value = compiledExpression.evaluate({ zoom: 14 }, {
    type: geometry,
    properties,
  } as never);
  return value === null || value === undefined ? undefined : String(value);
}

/**
 * Every visible layer of `sourceLayer` whose filter accepts the feature.
 *
 * A layer whose filter *throws* is reported as an error rather than silently
 * skipped: MapLibre drops the entire layer when a filter errors, so a throwing
 * filter is a rendering bug, not a non-match.
 */
export function matchingLayers(
  style: StyleSpecification,
  sourceLayer: string,
  properties: Record<string, unknown>,
  geometry: GeometryType = "Point",
  zoom = 14,
): Match[] {
  const matches: Match[] = [];

  for (const layer of layersFor(style, sourceLayer)) {
    if (
      (layer.layout as Record<string, unknown> | undefined)?.["visibility"] ===
      "none"
    )
      continue;

    const filter = (layer as { filter?: unknown }).filter;
    let ok: boolean;
    if (filter === undefined) {
      ok = true;
    } else {
      let compiled = compiledFilters.get(layer);
      if (!compiled) {
        compiled = featureFilter(filter as never);
        compiledFilters.set(layer, compiled);
      }
      try {
        ok = compiled.filter(
          { zoom },
          { type: geometry, properties } as never,
          undefined as never,
        );
      } catch (error) {
        throw new Error(
          `filter of ${layer.id} threw for ${JSON.stringify(properties)}: ${String(error)}`,
        );
      }
    }
    if (!ok) continue;

    const layout = layer.layout as Record<string, unknown> | undefined;
    const icon = resolveIcon(layer, properties, geometry);
    matches.push({
      id: layer.id,
      ...(icon !== undefined ? { icon } : {}),
      text: layout?.["text-field"] !== undefined,
      ...(layout?.["text-field"] !== undefined
        ? { textField: layout["text-field"] }
        : {}),
      type: layer.type,
      metadata: (layer.metadata ?? {}) as Record<string, unknown>,
      filter,
    });
  }

  return matches;
}

/** The symbol names drawn for a feature. */
export function icons(matches: Match[]): string[] {
  return matches.flatMap((m) => (m.icon ? [m.icon] : []));
}

/** Whether any matching layer draws text (a sounding, for the hazard CSPs). */
export function hasText(matches: Match[]): boolean {
  return matches.some((m) => m.text);
}

/** Recursively test whether an expression mentions a property. */
export function mentions(node: unknown, property: string): boolean {
  if (!Array.isArray(node)) return false;
  if (
    (node[0] === "get" || node[0] === "has") &&
    node.length === 2 &&
    node[1] === property
  ) {
    return true;
  }
  return node.some((child) => mentions(child, property));
}
