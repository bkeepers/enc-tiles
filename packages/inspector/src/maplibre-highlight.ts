import {
  Map,
  type ExpressionSpecification,
  type FilterExpression,
} from "maplibre-gl";

export default function (map: Map) {
  let highlightId: string | null = null;

  return {
    select(feature: any) {
      try {
        map.removeLayer("highlight-area");
        map.removeLayer("highlight-point");
        map.removeLayer("highlight-line");
      } catch (e) {
        // ignore
      }

      if (!feature) return;

      // FIXME: replace with id once tiles have unique IDs
      const filter: ExpressionSpecification = [
        "==",
        ["get", "LNAM"],
        feature.properties.LNAM,
      ];

      map.addLayer({
        id: "highlight-area",
        type: "fill",
        source: feature.source,
        "source-layer": feature.sourceLayer,
        filter: ["all", filter, ["==", ["geometry-type"], "Polygon"]],
        paint: {
          "fill-color": "yellow",
          "fill-opacity": 0.2,
          "fill-outline-color": "yellow",
        },
      });

      map.addLayer({
        id: "highlight-point",
        type: "circle",
        source: feature.source,
        "source-layer": feature.sourceLayer,
        filter: ["all", filter, ["==", ["geometry-type"], "Point"]],
        paint: {
          "circle-color": "yellow",
          "circle-opacity": 0.2,
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 3, 16, 15],
          "circle-stroke-color": "yellow",
          "circle-stroke-width": 1,
        },
      });

      map.addLayer({
        id: "highlight-line",
        type: "line",
        source: feature.source,
        "source-layer": feature.sourceLayer,
        filter: [
          "all",
          filter,
          ["in", ["geometry-type"], ["literal", ["LineString", "Polygon"]]],
        ],
        paint: {
          "line-color": "yellow",
          "line-opacity": 0.2,
          "line-width": 8,
        },
      });
    },
  };
}
