// Placing ONE point inside an area, shared by the anchor generators.
//
// An S-57 cell splits a named feature across as many polygons as its topology
// needs -- an island group is one LNDARE per island, a survey is one M_QUAL per
// digitised patch -- and every fragment carries the same attributes. A symbol
// layer over the class draws its text once per polygon, so a chart of an
// archipelago repeats the same island name a dozen times and MapLibre's
// collision detection thins them arbitrarily.
//
// The answer both bin/generate-labels and bin/generate-mqual-labels give is the
// same: group the fragments, then emit a single anchor per group at a point
// guaranteed to be INSIDE the group's largest member. What the groups are is
// theirs; the geometry is here.

import { polygons } from "./quilt-geojson.mjs";

export function ringArea(ring) {
  let sum = 0;
  for (let i = 1; i < ring.length; i++) {
    sum += ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1];
  }
  return sum / 2;
}

/** Signed-area centroid of a ring. */
export function ringCentroid(ring) {
  let x = 0;
  let y = 0;
  let area = 0;
  for (let i = 1; i < ring.length; i++) {
    const [x0, y0] = ring[i - 1];
    const [x1, y1] = ring[i];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    x += (x0 + x1) * cross;
    y += (y0 + y1) * cross;
  }
  area /= 2;
  if (area === 0) return ring[0];
  return [x / (6 * area), y / (6 * area)];
}

function pointInRings(point, polygon) {
  let inside = false;
  for (const ring of polygon) {
    for (let i = 1; i < ring.length; i++) {
      const [x0, y0] = ring[i - 1];
      const [x1, y1] = ring[i];
      if (y0 > point[1] !== y1 > point[1]) {
        const x = x0 + ((point[1] - y0) * (x1 - x0)) / (y1 - y0);
        if (x > point[0]) inside = !inside;
      }
    }
  }
  return inside;
}

/**
 * A point guaranteed to lie inside the polygon: the centroid when it is
 * interior, otherwise the middle of the widest interior span of the horizontal
 * line through it. (The full pole-of-inaccessibility search buys very little
 * for chart-scale areas and costs a lot more code.)
 */
export function pointOnSurface(polygon) {
  const centroid = ringCentroid(polygon[0]);
  if (pointInRings(centroid, polygon)) return centroid;

  const y = centroid[1];
  const crossings = [];
  for (const ring of polygon) {
    for (let i = 1; i < ring.length; i++) {
      const [x0, y0] = ring[i - 1];
      const [x1, y1] = ring[i];
      if (y0 > y !== y1 > y) {
        crossings.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0));
      }
    }
  }
  crossings.sort((a, b) => a - b);

  let best;
  let bestWidth = -1;
  for (let i = 0; i + 1 < crossings.length; i += 2) {
    const width = crossings[i + 1] - crossings[i];
    if (width > bestWidth) {
      bestWidth = width;
      best = (crossings[i] + crossings[i + 1]) / 2;
    }
  }
  return best === undefined ? centroid : [best, y];
}

/** Area in square degrees, longitude scaled by cos(latitude). */
export function featureArea(geometry) {
  let total = 0;
  for (const polygon of polygons(geometry)) {
    const latitude = (ringCentroid(polygon[0])[1] * Math.PI) / 180;
    const scale = Math.max(Math.cos(latitude), 0.01);
    // Holes come out with the opposite winding, so the signed sum subtracts them.
    for (const ring of polygon)
      total +=
        Math.abs(ringArea(ring)) * scale * (ring === polygon[0] ? 1 : -1);
  }
  return Math.abs(total);
}

/** The anchor point of one feature, or undefined when it has no geometry. */
export function anchorOf(feature) {
  const geometry = feature.geometry;
  if (!geometry) return undefined;
  if (geometry.type === "Point") return geometry.coordinates;
  if (geometry.type === "MultiPoint") return geometry.coordinates[0];

  const shapes = polygons(geometry);
  if (shapes.length === 0) return undefined;
  // Label the biggest part of a multipolygon, not the average of the parts,
  // which for an island chain lands in open water.
  let biggest = shapes[0];
  let biggestArea = -1;
  for (const polygon of shapes) {
    const area = Math.abs(ringArea(polygon[0]));
    if (area > biggestArea) {
      biggestArea = area;
      biggest = polygon;
    }
  }
  return pointOnSurface(biggest);
}

/**
 * The `tippecanoe` member every anchor carries.
 *
 * NOT a property: tippecanoe reads it off the Feature itself. It drops a
 * fraction of POINT features at every zoom below the maxzoom (-r/--drop-rate,
 * default 2.5), and there is exactly ONE anchor per group -- drop it and the
 * area loses its label at that zoom with nothing to fall back on. --drop-rate
 * is a whole-run knob, so turning it off would also stop the SOUNDG thinning
 * that keeps small-scale tiles readable; a per-feature `minzoom` is the only
 * exemption tippecanoe scopes. See bin/s57-to-tiles step 4.
 */
export const ANCHOR_TIPPECANOE = { minzoom: 0 };
