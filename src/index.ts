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
import { Protocol, PMTiles, type Header } from "pmtiles";
import createStyle, { BANDS, type BandName } from "@enc-tiles/styles";
import { loadArchiveHeaders } from "./load-archive-headers.js";
import { inspectSources } from "./inspect-sources.js";
import { selectBands } from "./select-bands.js";

const prefix = import.meta.env.VITE_TILESET_PREFIX ?? "noaa";
const tilesUrl =
  import.meta.env.VITE_TILES_URL ?? window.location.origin + "/tiles/";

// add the PMTiles plugin to the maplibre-gl global.
const protocol = new Protocol();
addProtocol("pmtiles", protocol.tile);

const archives: Record<string, { url: string; pmtiles: PMTiles }> = {};

// `protocol.add` below is lazy: PMTiles only reads an archive's header the
// first time MapLibre asks it for a tile from that source. A missing or
// bogus archive can therefore go unnoticed at startup -- and worse, on a
// static host that answers a missing file with its SPA fallback (HTTP
// 200/206, `content-type: text/html`) instead of a 404, some of the requests
// that would eventually have surfaced it never resolve at all, leaving the
// map to hang rather than fail. Read every archive's header up front
// instead, so a bad archive fails fast, by name, before the map is built at
// all -- and wait for all of them to settle (see load-archive-headers.ts) so
// a bulk upload that drops more than one archive is reported all at once,
// not one redeploy at a time.
let bands: (typeof BANDS)[number][];
let headers: Record<BandName, Header>;
try {
  bands = selectBands(BANDS, import.meta.env.VITE_TILESET_BANDS);

  for (const band of bands) {
    const url = new URL(`${prefix}-${band.name}.pmtiles`, tilesUrl).toString();
    const pmtiles = new PMTiles(url);
    protocol.add(pmtiles);
    archives[band.name] = { url, pmtiles };
  }

  headers = await loadArchiveHeaders(bands, archives);
} catch (error) {
  reportFatalError(error);
  throw error;
}

// Declare each source's tile URL and zoom range outright rather than
// pointing MapLibre at a TileJSON document with `url:`. Both end up with the
// same source, since the TileJSON the pmtiles protocol synthesises is built
// from the very header fields read above -- but `url:` also has MapLibre
// hand that URL to anything that inspects the style, and `fetch()` cannot
// dispatch a `pmtiles://` scheme, so those consumers must either fail or be
// worked around. Declaring `tiles:` removes the URL they would reach for:
// MapLibre resolves the `{z}/{x}/{y}` template through `addProtocol` above,
// which parses it with a plain regex and never goes near the Fetch API.
//
// `maxzoom` is the load-bearing field, and the reason this whole branch
// exists: it is the zoom above which MapLibre overzooms a band's deepest
// tiles instead of rendering nothing.
//
// One behaviour worth knowing when debugging: with `tiles:`, MapLibre marks
// a source ready on the next animation frame (`loadTileJson` awaits one
// rather than a network response). A tab that never paints -- backgrounded,
// occluded, an automated browser with a hidden viewport -- therefore never
// finishes loading its sources, and the map looks stuck with no error. It
// resumes the moment the tab is shown.
const style = createStyle({
  sprite: `${window.location.origin}${import.meta.env.BASE_URL}sprites`,
  sources: Object.fromEntries(
    bands.map((band) => [
      band.name,
      {
        type: "vector",
        tiles: [`pmtiles://${archives[band.name]!.url}/{z}/{x}/{y}`],
        minzoom: headers[band.name].minZoom,
        maxzoom: headers[band.name].maxZoom,
      },
    ]),
  ),
});

const map = new Map({
  container: "map",
  hash: true, // Enable hash routing
  // Mid-approach band: the first zoom that is both wide and legible. The old
  // `header.maxZoom` opened at z16, where only the 64 berthing charts exist.
  zoom: 12,
  // Named, not derived. This used to be the harbour archive's header centre,
  // which is the centre of its bounding box -- and NOAA's coverage runs from
  // Guam to Puerto Rico by way of the Aleutians, so every band's bbox spans
  // very nearly the whole globe and its centre falls in the middle of the
  // Pacific: 179.325/51.4125, off Attu. A bbox centre cannot answer "where
  // are the charts" for a corpus that straddles the antimeridian, so this
  // opens on a place instead. Only used on a first visit: `hash: true` means
  // any `#zoom/lat/lon` in the URL wins, which is also how to open a
  // different tileset, e.g. the two-chart fixture of `bin/fixture-tiles`.
  center: [-74.0405, 40.6065], // The Narrows, New York
  style,
});

map.addControl(new NavigationControl({ showZoom: true, showCompass: false }));
map.addControl(new FullscreenControl());
map.addControl(
  new MaplibreInspect({
    popup: new Popup({}),
    sources: inspectSources(style),
  }),
);

// Exposed for debugging in this demo inspector: lets the browser console
// query the live map (e.g. `map.querySourceFeatures(...)`) without a
// separate build step.
(window as unknown as { map: Map }).map = map;

/**
 * Replace the page with a visible error message.
 *
 * A thrown top-level error still reaches devtools, but a blank map behind a
 * spinner-less page is easy to mistake for "still loading". This makes a
 * startup failure -- e.g. a missing tile archive -- impossible to miss in
 * the browser itself, not only in the console, which matters most in
 * production: if an upload half-fails and one or more archives go missing,
 * nobody is tailing devtools.
 *
 * `loadArchiveHeaders` throws an `AggregateError` when more than one band
 * fails, so this lists every one of its `.errors` as its own paragraph
 * rather than concatenating them into a single unreadable line -- each
 * already names its own band, URL and cause.
 */
function reportFatalError(error: unknown): void {
  console.error(error);
  const causes = error instanceof AggregateError ? error.errors : [error];
  for (const cause of causes) console.error(cause);

  const messages = causes.map((cause: unknown) =>
    cause instanceof Error ? cause.message : String(cause),
  );
  const banner = document.createElement("pre");
  banner.textContent = `Failed to load tiles\n\n${messages.join("\n\n")}`;
  banner.style.cssText =
    "position:fixed;inset:0;margin:0;padding:2rem;box-sizing:border-box;" +
    "background:#7f1d1d;color:#fff;font:14px/1.5 ui-monospace,monospace;" +
    "white-space:pre-wrap;overflow:auto;z-index:9999;";
  document.body.replaceChildren(banner);
}
