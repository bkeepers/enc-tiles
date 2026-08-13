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
