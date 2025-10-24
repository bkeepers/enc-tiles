import {
  Map,
  type ExpressionSpecification,
  type FilterExpression,
} from "maplibre-gl";

export default function (map: Map) {
  let highlightId: string | null = null;

  return {
    select(feature: any) {
      console.log("highlight select", feature);

      try {
        map.removeLayer("highlight-area-fill");
        map.removeLayer("highlight-point-fill");
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
        id: "highlight-area-fill",
        type: "fill",
        source: feature.source,
        "source-layer": feature.sourceLayer,
        filter: ["all", filter, ["==", ["geometry-type"], "Polygon"]],
        paint: {
          "fill-color": "yellow",
          "fill-opacity": 0.3,
          "fill-outline-color": "yellow",
        },
      });

      map.addLayer({
        id: "highlight-point-fill",
        type: "circle",
        source: feature.source,
        "source-layer": feature.sourceLayer,
        filter: ["all", filter, ["==", ["geometry-type"], "Point"]],
        paint: {
          "circle-color": "yellow",
          "circle-opacity": 0.3,
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 3, 16, 15],
          "circle-stroke-color": "yellow",
          "circle-stroke-width": 1,
        },
      });
    },
  };
}
