import type { StyleSpecification } from "maplibre-gl";

/**
 * List, per source, the source-layers the style actually reads from it.
 *
 * MaplibreInspect needs this mapping to colour features by layer. Left to
 * itself it discovers it by `fetch`ing each vector source's `url` as
 * TileJSON and reading `vector_layers` -- which our sources no longer have,
 * because they declare their tile URLs directly (see `src/index.ts`). Handing
 * it the mapping up front short-circuits that discovery entirely:
 * `MaplibreInspect#onAdd` only subscribes to `tiledata`/`sourcedata` when its
 * `sources` option is empty, so passing a non-empty one also stops it
 * re-deriving the same answer on every tile that loads.
 *
 * The style is the authority here, not the archive: a source-layer present in
 * the tiles but read by no layer is one the inspector has nothing to say
 * about, and the reverse cannot happen -- `packages/styles` builds both.
 */
export function inspectSources(
  style: StyleSpecification,
): Record<string, string[]> {
  const sources = new Map<string, Set<string>>(
    Object.keys(style.sources).map((id) => [id, new Set<string>()]),
  );

  for (const layer of style.layers) {
    if (!("source" in layer) || typeof layer.source !== "string") continue;
    const sourceLayer =
      "source-layer" in layer ? layer["source-layer"] : undefined;
    if (!sourceLayer) continue;
    sources.get(layer.source)?.add(sourceLayer);
  }

  return Object.fromEntries(
    [...sources].map(([id, layers]) => [id, [...layers]]),
  );
}
