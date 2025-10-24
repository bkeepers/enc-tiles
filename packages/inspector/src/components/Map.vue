<script setup lang="ts">
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
import createStyle from "@enc-tiles/styles";
import { onMounted, ref } from "vue";
import Inspector from "./Inspector.vue";
import createHighlighter from "../maplibre-highlight.js";

const el = ref<HTMLElement | null>(null);
const features = ref<any[]>([]);
let highlighter: ReturnType<typeof createHighlighter>;

const tileset = import.meta.env.VITE_TILESET;
const tilesUrl =
  import.meta.env.VITE_TILES_URL ?? window.location.origin + "/tiles/";

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

onMounted(() => {
  const map = new Map({
    container: el.value!,
    hash: true, // Enable hash routing
    zoom: header.maxZoom,
    center: [header.centerLon, header.centerLat],
    style,
  });

  highlighter = createHighlighter(map);

  map.addControl(new NavigationControl({ showZoom: true, showCompass: false }));
  map.addControl(new FullscreenControl());
  map.addControl(new MaplibreInspect({ popup: new Popup({}) }));

  map.on("click", (e) => {
    features.value = map.queryRenderedFeatures([
      [e.point.x - 10, e.point.y - 10],
      [e.point.x + 10, e.point.y + 10],
    ]);
  });
});
</script>

<template>
  <div class="absolute inset-0 flex min-h-0">
    <Inspector
      class="h-full"
      :features="features"
      @select-feature="highlighter?.select"
    />
    <div ref="el" class="map flex-1 min-w-0 h-full"></div>
  </div>
</template>
