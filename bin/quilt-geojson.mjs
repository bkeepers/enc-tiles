// The GeoJSON and copy-ladder vocabulary the derived-layer generators share.
//
// Imported, not sourced: the generators in bin/ are standalone extensionless
// node scripts (see bin/quilt-rung.sh for the bash half of the same idea), so a
// library among them carries an extension to say it is one. `.mjs` rather than
// `.js` because the repository root has no `"type": "module"` and a `.js`
// sibling would be read as CommonJS.
//
// Nothing here decides anything. It is the reading, the rounding and the ring
// walking that every generator did identically, in one place so that a fix to
// one of them is a fix to all — see bin/quilt-edges.mjs and
// bin/quilt-anchors.mjs for the two derivations built on top of it.

import { readFileSync } from "fs";

/** Coordinates round-tripped through GeoJSON text; 9 dp is ~0.1 mm. */
export const PRECISION = 9;

export const round = (value) => Number(value.toFixed(PRECISION));

/**
 * The features of a GeoJSON file, or none at all.
 *
 * A missing or empty file is not an error: a cell simply may not carry the
 * class, and every caller's answer to that is an empty layer.
 */
export function readFeatures(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  if (!text.trim()) return [];
  return JSON.parse(text).features ?? [];
}

// ---- the copy ladder -------------------------------------------------------
//
// A partitioned cell arrives as zoom-range COPIES of each source feature -- one
// per interval of the ladder, carrying _QZMIN/_QZMAX (and _QFALL on a fallback
// continuation) -- which bin/stamp-quilt-zooms turns into per-feature tippecanoe
// zoom bounds after the generators have run. See
// docs/architecture/QUILT_ZOOM_PARTITION.md.
//
// Every generator therefore has to do two things with the range: KEY on it, so
// that the copies of one interval are derived only against each other, and CARRY
// it onto whatever it emits. An input with none of those properties is one
// interval and behaves exactly as it did before the partition existed.

/** The partition properties a source copy carries. */
export const QUILT_PROPERTIES = ["_QZMIN", "_QZMAX", "_QFALL"];

/** Those of them a feature actually has, to be copied onto its outputs. */
export function quiltRange(properties) {
  const range = {};
  for (const name of QUILT_PROPERTIES) {
    const value = properties?.[name];
    if (value !== null && value !== undefined) range[name] = value;
  }
  return range;
}

/** The interval key of a range. Legacy inputs all share the empty one. */
export function quiltKey(range) {
  return QUILT_PROPERTIES.map((name) => range[name] ?? "").join(
    String.fromCharCode(0),
  );
}

/**
 * Interval key -> `{ range, ...seed() }`, in the order the intervals arrive.
 *
 * The generators differ only in what they accumulate per interval, so the
 * bookkeeping is here and the accumulator is theirs.
 */
export function intervalIndex(seed) {
  const intervals = new Map();
  return {
    intervals,
    of(properties) {
      const range = quiltRange(properties);
      const id = quiltKey(range);
      let interval = intervals.get(id);
      if (!interval) {
        interval = { range, ...seed() };
        intervals.set(id, interval);
      }
      return interval;
    },
  };
}

// ---- geometry walking ------------------------------------------------------

/** The polygons of a geometry, each as an array of rings. */
export function polygons(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

/** Every closed ring of a Polygon/MultiPolygon geometry. */
export function* rings(geometry) {
  for (const polygon of polygons(geometry)) yield* polygon;
}

/**
 * Only the OUTER ring of each polygon.
 *
 * A no-coverage gap arrives as a hole in an M_COVR polygon, and indexing the
 * hole as though it were the cell's border would silence the boundary of a real
 * unsurveyed area. See `coverageIndex` in bin/quilt-edges.mjs.
 */
export function* exteriorRings(geometry) {
  for (const polygon of polygons(geometry)) if (polygon[0]) yield polygon[0];
}

/** Shoelace on lon/lat coordinates: > 0 counter-clockwise, < 0 clockwise. */
export function signedRingArea(ring) {
  let sum = 0;
  for (let i = 1; i < ring.length; i++)
    sum += ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1];
  return sum / 2;
}

/**
 * Every ring, walked so the FILLED side lies on the RIGHT of travel: exterior
 * rings CLOCKWISE in lon/lat (signed area < 0), holes counter-clockwise. That
 * is the MVT ring convention once the lon/lat -> tile y-flip is applied, and it
 * is the one the S-52 line marks read (MapLibre puts a line symbol's image-DOWN
 * on the right of travel). GDAL leaves S-57 ring winding arbitrary -- measured
 * ~50/50 on Puget Sound, holes included -- and tippecanoe rewinds POLYGONS but
 * not LINESTRINGS, so a derived edge that trusts the source points its marks
 * out of its own area half the time.
 */
export function* orientedRings(geometry) {
  for (const polygon of polygons(geometry)) {
    for (let i = 0; i < polygon.length; i++) {
      const ring = polygon[i];
      const area = signedRingArea(ring);
      const backwards = i === 0 ? area > 0 : area < 0; // exterior CW, holes CCW
      yield backwards ? ring.slice().reverse() : ring;
    }
  }
}
