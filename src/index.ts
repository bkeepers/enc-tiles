import '@maplibre/maplibre-gl-inspect/dist/maplibre-gl-inspect.css';
import "maplibre-gl/dist/maplibre-gl.css";
import { addProtocol, Map, NavigationControl, FullscreenControl, Popup } from "maplibre-gl";
import MaplibreInspect from '@maplibre/maplibre-gl-inspect';
import { Protocol, PMTiles } from "pmtiles";
import createStyle from "@enc-tiles/styles";

const tileset = import.meta.env.VITE_TILESET;
const tilesUrl = import.meta.env.VITE_TILES_URL ?? (window.location.origin + "/tiles/");

// add the PMTiles plugin to the maplibre-gl global.
const protocol = new Protocol({ metadata: true });
addProtocol("pmtiles", protocol.tile);
const url = new URL(tileset, tilesUrl).toString();
const pmtiles = new PMTiles(url);
protocol.add(pmtiles);

// Fetch the header so we can get the center lon, lat of the map.
const header = await pmtiles.getHeader();

const style = createStyle({
  sprite: `${window.location.origin}/sprites`,
  source: {
    type: "vector",
    url: `pmtiles://${url}`,
  },
});

const map = new Map({
  container: "map",
  hash: true, // Enable hash routing
  zoom: header.maxZoom,
  center: [header.centerLon, header.centerLat],
  style,
});

map.addControl(new NavigationControl({ showZoom: true, showCompass: false }));
map.addControl(new FullscreenControl());
map.addControl(new MaplibreInspect({ popup: new Popup({}) }));
