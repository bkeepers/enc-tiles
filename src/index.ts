import "@maplibre/maplibre-gl-inspect/dist/maplibre-gl-inspect.css";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  addProtocol,
  Map,
  NavigationControl,
  FullscreenControl,
  Popup,
} from "maplibre-gl";
import MaplibreInspect from "@maplibre/maplibre-gl-inspect";
import { Protocol, PMTiles } from "pmtiles";
import createStyle, { BANDS } from "@enc-tiles/styles";

const prefix = import.meta.env.VITE_TILESET_PREFIX ?? "noaa";
const tilesUrl =
  import.meta.env.VITE_TILES_URL ?? window.location.origin + "/tiles/";

// add the PMTiles plugin to the maplibre-gl global.
const protocol = new Protocol({ metadata: true });
addProtocol("pmtiles", protocol.tile);

// MaplibreInspect (added below) discovers each vector source's layers by
// calling the platform's `fetch()` directly on the source's declared `url`,
// bypassing the "pmtiles" protocol MapLibre itself dispatches through. The
// Fetch API can only ever handle schemes the platform understands, so
// `fetch("pmtiles://...")` is always rejected — Chrome's console even shows
// the colon after "http" gone (`pmtiles://http//host/...`), because the URL
// parser it uses to validate/report the request treats "http" as an
// authority component and drops the trailing colon when re-serializing it
// for that error. That colon loss is a side effect of the rejection, not
// its cause: an unmangled string would fail identically, since custom
// schemes are simply outside what `fetch()` can dispatch. MapLibre's own
// tile pipeline never hits this — `protocol.tile` parses the URL with a
// plain string/regex, not `new URL()` — which is why real tiles load fine
// even while this fails. Teach `fetch` to answer `pmtiles://` requests
// itself, using that same `protocol.tile`, so any code that calls it
// directly on one of our sources' URLs gets a real response.
const nativeFetch = window.fetch.bind(window);
window.fetch = (async (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  if (!url.startsWith("pmtiles://")) return nativeFetch(input, init);
  const { data } = await protocol.tile(
    { url, type: "json" },
    new AbortController(),
  );
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;

const archives: Record<string, { url: string; pmtiles: PMTiles }> = {};

for (const band of BANDS) {
  const url = new URL(`${prefix}-${band.name}.pmtiles`, tilesUrl).toString();
  const pmtiles = new PMTiles(url);
  protocol.add(pmtiles);
  archives[band.name] = { url, pmtiles };
}

// Centre on the harbour band: it carries the bulk of the coverage.
const header = await archives["harbour"]!.pmtiles.getHeader();

const style = createStyle({
  sprite: `${window.location.origin}${import.meta.env.BASE_URL}sprites`,
  sources: Object.fromEntries(
    BANDS.map((band) => [
      band.name,
      { type: "vector", url: `pmtiles://${archives[band.name]!.url}` },
    ]),
  ),
});

const map = new Map({
  container: "map",
  hash: true, // Enable hash routing
  // Mid-approach band: the first zoom that is both wide and legible. The old
  // `header.maxZoom` opened at z16, where only the 64 berthing charts exist.
  zoom: 12,
  center: [header.centerLon, header.centerLat],
  style,
});

map.addControl(new NavigationControl({ showZoom: true, showCompass: false }));
map.addControl(new FullscreenControl());
map.addControl(new MaplibreInspect({ popup: new Popup({}) }));

// Exposed for debugging in this demo inspector: lets the browser console
// query the live map (e.g. `map.querySourceFeatures(...)`) without a
// separate build step.
(window as unknown as { map: Map }).map = map;
