// The differ-only edge derivation, shared by the generators that need it.
//
// THE PROBLEM IT SOLVES, ONCE
//
//   An S-57 area class is split into as many polygons as the topology it was
//   digitised against needs, and above all by the edge of the CHART. Stroking
//   those polygons' own boundaries draws a line down every one of those splits,
//   so one survey spanning three cells comes out ruled into three boxes and one
//   town spanning two comes out cut in half.
//
//   The line the mariner is owed is the one where the thing the class states
//   actually CHANGES. That is a property of a boundary's two SIDES, not of
//   either polygon, so it has to be derived: hash every ring segment, collect
//   the owners that share it, and emit only the segments whose owners disagree.
//
//   Segments are recovered by hashing coordinate pairs rather than by a
//   geometric overlay because adjacent S-57 areas are built from the same edge
//   primitives, so a shared boundary arrives from ogr2ogr as bit-identical
//   coordinates in both polygons. See bin/generate-depare-edges for the whole
//   derivation, including why BOTH endpoints and the midpoint have to lie on a
//   coverage ring before a segment counts as being along it.
//
//   What the sides ARE, and what makes two of them disagree, is the caller's:
//   bin/generate-mqual-edges compares CATZOC numbers, bin/generate-buaare-edges
//   compares OBJNAM strings. Everything else -- the interval keying, the
//   hashing, the seam suppression, the chaining -- is the same both times and
//   lives here rather than twice.
//
// THE CHART BORDER
//
//   A segment whose owners ALL lie on ONE side -- a single owner, or several
//   overlapping areas truncated together by the same edge -- that lies along a
//   quilt cut or along this cell's own M_COVR ring is DROPPED. The area(s)
//   continue into the neighbouring chart and THIS cell cannot see what is
//   there, so emitting the segment claims a change the data does not show --
//   and a chart ruled into boxes at its cell borders is the whole defect this
//   machinery exists to remove. "All on one side" is read off the canonical
//   ring directions: owners whose interiors share a side walk the segment the
//   same way, where a genuine interface is walked in OPPOSITE directions
//   (filled side on the right of travel, both ways). The one-sided multi-owner
//   case is real and measured: nested jurisdiction areas (a state ADMARE under
//   the national one) are truncated by the same cell edge into bit-identical
//   border segments with two owners of differing content, which used to draw a
//   line down the whole interior chart border -- the US1GLBDC/US1GLBEA
//   mid-Alaska seam.
//
//   The cost is stated plainly: a real change that happens to fall exactly on a
//   cell border goes unmarked in this cell. It is marked in the NEIGHBOUR
//   wherever that cell holds both sides, and where neither does, the
//   alternative is a line at every seam whether anything changed or not.
//
//   A segment whose owners face each other across it is never suppressed,
//   wherever it lies. If this cell holds both sides of a boundary then it has
//   the evidence, and a coverage ring running along an interior boundary does
//   not take it away.
//
// THE EDGE OF ALL CHARTED DATA (the neighbour-continuation refinement)
//
//   "The area continues into the neighbouring chart" is a PRESUMPTION, and for
//   the cell's own M_COVR ring it is sometimes false: NOAA runs a cell's data
//   limit along real maritime limits, so the boundary of the thing IS the
//   boundary of the chart. Measured: US2ARCEC's coverage ring follows the
//   US/Russia treaty line through the Bering Strait, its EXEZNE (EEZ) western
//   boundary is bit-identical with it, and the unconditional drop erased the
//   EEZ line from the map entirely -- there is no neighbouring chart west of
//   that line for the area to continue into.
//
//   So when the caller supplies the OTHER charts' coverage (`neighborPaths`),
//   a one-sided segment on a chart-border ring is dropped ONLY where a
//   neighbouring chart's coverage actually lies across it -- tested by
//   stepping a small distance out of the owners' filled side and asking
//   whether any neighbour polygon contains that point. Where nothing lies
//   beyond, the truncated boundary is the true charted end of the area and its
//   presentation stands (what ECDIS and paper both draw). The refinement
//   covers BOTH ring indexes: a genuine quilt cut always has the finer chart
//   on its far side (the clip put it there), so the probe finds it in the
//   roster and the drop holds; but a finer chart's coverage can stop at the
//   SAME real limit this cell's does -- US3AK89M's west limit is the same
//   US/Russia line as US2ARCEC's for a degree of latitude -- and a segment
//   along that shared ring with void beyond is a charted end, not a cut.
//   Without `neighborPaths` the drop stays unconditional -- the legacy
//   behaviour, and the only honest one when the caller cannot say what is out
//   there.

import {
  exteriorRings,
  intervalIndex,
  orientedRings,
  readFeatures,
  rings,
  round,
} from "./quilt-geojson.mjs";

/** How close a segment has to sit to the coverage boundary to count as a seam. */
export const SEAM_TOLERANCE = 1e-7;
/** The same for this cell's own M_COVR ring; see bin/generate-depare-edges. */
export const CELL_BOUNDARY_TOLERANCE = 1e-6;

/** Canonical, so the same edge hashes alike whichever way each ring walks it. */
export function segmentKey(a, b) {
  const [x1, y1] = [round(a[0]), round(a[1])];
  const [x2, y2] = [round(b[0]), round(b[1])];
  return x1 < x2 || (x1 === x2 && y1 <= y2)
    ? `${x1},${y1}|${x2},${y2}`
    : `${x2},${y2}|${x1},${y1}`;
}

// ---- coverage rings --------------------------------------------------------

/**
 * Index the rings of a set of coverage polygons as bbox-padded segments.
 *
 * `accept` and `exteriorOnly` are the M_COVR filters bin/generate-depare-edges
 * documents: only CATCOV = 1 ("coverage available") polygons are the cell's own
 * edge, and only their outer rings -- see `exteriorRings`.
 */
export function coverageIndex(
  paths,
  tolerance,
  accept = () => true,
  exteriorOnly = false,
) {
  const index = [];
  const walk = exteriorOnly ? exteriorRings : rings;
  for (const path of paths) {
    for (const feature of readFeatures(path)) {
      if (!accept(feature)) continue;
      for (const ring of walk(feature.geometry)) {
        for (let i = 1; i < ring.length; i++) {
          const [a, b] = [ring[i - 1], ring[i]];
          index.push({
            a,
            b,
            minX: Math.min(a[0], b[0]) - tolerance,
            maxX: Math.max(a[0], b[0]) + tolerance,
            minY: Math.min(a[1], b[1]) - tolerance,
            maxY: Math.max(a[1], b[1]) + tolerance,
          });
        }
      }
    }
  }
  return index;
}

function distanceToSegment(point, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  let t = 0;
  if (lengthSquared > 0) {
    t = ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared;
    t = Math.max(0, Math.min(1, t));
  }
  const px = a[0] + t * dx - point[0];
  const py = a[1] + t * dy - point[1];
  return Math.sqrt(px * px + py * py);
}

function near(index, point, tolerance) {
  for (const segment of index) {
    if (point[0] < segment.minX || point[0] > segment.maxX) continue;
    if (point[1] < segment.minY || point[1] > segment.maxY) continue;
    if (distanceToSegment(point, segment.a, segment.b) <= tolerance)
      return true;
  }
  return false;
}

/**
 * Along a ring of `index`: both endpoints AND the midpoint on it.
 *
 * A boundary that merely TOUCHES a coverage ring at one vertex runs into the
 * cell, not along its border, and is a real boundary that has to keep its line.
 * The midpoint is tested as well because a long chord across a bay can have
 * both ends on the ring without lying along it.
 */
export function alongRing(index, tolerance, a, mid, b) {
  if (index.length === 0) return false;
  return (
    near(index, a, tolerance) &&
    near(index, mid, tolerance) &&
    near(index, b, tolerance)
  );
}

/**
 * The seam test for a set of `{ index, tolerance }` ring indexes: true when the
 * segment lies along ANY of them.
 */
export function seamTest(indexes) {
  return (a, b) => {
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    return indexes.some(({ index, tolerance }) =>
      alongRing(index, tolerance, a, mid, b),
    );
  };
}

// ---- neighbour continuation ------------------------------------------------

/**
 * How far out of the owners' filled side the continuation probe steps, in
 * degrees. Far enough to clear the ring tolerances (1e-6) and coordinate
 * rounding (1e-9) by orders of magnitude; near enough (~10 m of ground) that a
 * neighbouring chart abutting OR overlapping the border is on the far side of
 * it. A charted neighbour narrower than this along a shared border does not
 * exist.
 */
export const NEIGHBOR_PROBE_EPSILON = 1e-4;

/** The polygons of a coverage file, each ring kept, with a bbox for rejection. */
export function coveragePolygons(paths) {
  const entries = [];
  for (const path of paths) {
    for (const feature of readFeatures(path)) {
      const geometry = feature.geometry;
      if (!geometry) continue;
      const polys =
        geometry.type === "Polygon"
          ? [geometry.coordinates]
          : geometry.type === "MultiPolygon"
            ? geometry.coordinates
            : [];
      for (const polygon of polys) {
        if (!polygon[0] || polygon[0].length < 4) continue;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const [x, y] of polygon[0]) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        entries.push({
          polygon,
          minX,
          minY,
          maxX,
          maxY,
          properties: feature.properties ?? {},
        });
      }
    }
  }
  return entries;
}

/** Even-odd ray cast over one ring. */
function inRing(ring, [x, y]) {
  let inside = false;
  for (let i = 1; i < ring.length; i++) {
    const [x1, y1] = ring[i - 1];
    const [x2, y2] = ring[i];
    if (y1 > y !== y2 > y && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1)
      inside = !inside;
  }
  return inside;
}

/** Every polygon entry that contains `point` (holes use even-odd fill). */
export function polygonsContaining(entries, point) {
  const [x, y] = point;
  const matches = [];
  for (const entry of entries) {
    if (x < entry.minX || x > entry.maxX || y < entry.minY || y > entry.maxY)
      continue;
    let inside = false;
    for (const ring of entry.polygon) if (inRing(ring, point)) inside = !inside;
    if (inside) matches.push(entry);
  }
  return matches;
}

/** Whether any coverage polygon contains the point (holes even-odd). */
export function coverageContains(entries, point) {
  return polygonsContaining(entries, point).length > 0;
}

/**
 * A point `NEIGHBOR_PROBE_EPSILON` out of the filled side of a walked segment.
 *
 * The walk is the owners' canonical ring direction -- filled side on the RIGHT
 * of travel -- so "out of the fill" is the LEFT of travel, taken at the
 * segment's midpoint.
 */
export function outwardProbe([from, to]) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  const mid = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
  if (length === 0) return [wrapLongitude(mid[0]), mid[1]];
  return [
    wrapLongitude(mid[0] + (-dy / length) * NEIGHBOR_PROBE_EPSILON),
    mid[1] + (dx / length) * NEIGHBOR_PROBE_EPSILON,
  ];
}

/**
 * A probe stepped outward across the ANTIMERIDIAN lands at a longitude no
 * polygon occupies: S-57 keeps each cell's geometry in its own domain, so
 * US2ARCCB's western ring at -180 has US2ARCCA lying at +180 on the far side,
 * and an un-wrapped -180.0001 finds no serving owner -- which read as "no
 * chart continues here" and retained the EXEZNE boundary along the dateline
 * (2026-08-14). Wrapping the point back into [-180, 180] makes containment
 * find the far-side owner in the domain it actually lives in.
 */
function wrapLongitude(lon) {
  if (lon > 180) return lon - 360;
  if (lon < -180) return lon + 360;
  return lon;
}

/**
 * The coverage inputs every edge generator takes, as one seam test.
 *
 * `--coverage` is the quilt cut against a FINER chart; `--cell-coverage` is this
 * cell's own M_COVR. Both are chart borders and neither is a change in
 * anything. Passing neither gives a test that is false everywhere, which is the
 * legacy behaviour: every truncated edge is emitted.
 *
 * `neighborPaths` -- the OTHER charts' coverage, this cell's own rows harmless
 * among them -- refines the cell-ring half: a one-sided segment on the cell's
 * own ring is a seam only where some chart actually continues across it (see
 * THE EDGE OF ALL CHARTED DATA above). The quilt-cut half never consults it: a
 * quilt cut exists because a finer chart covers the far side. The test takes
 * the owners' canonical walk as its third argument so the probe knows which
 * side is out; a caller that omits it gets the unconditional legacy drop.
 */
export function chartBorderTest(
  coveragePaths,
  cellCoveragePaths,
  neighborPaths,
) {
  const quilt = {
    index: coverageIndex(coveragePaths, SEAM_TOLERANCE),
    tolerance: SEAM_TOLERANCE,
  };
  const cell = {
    index: coverageIndex(
      cellCoveragePaths,
      CELL_BOUNDARY_TOLERANCE,
      (feature) => Number(feature.properties?.CATCOV) === 1,
      true,
    ),
    tolerance: CELL_BOUNDARY_TOLERANCE,
  };
  const neighbors =
    neighborPaths && neighborPaths.length
      ? coveragePolygons(neighborPaths)
      : null;

  return (a, b, walk) => {
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (
      !alongRing(quilt.index, quilt.tolerance, a, mid, b) &&
      !alongRing(cell.index, cell.tolerance, a, mid, b)
    ) {
      return false;
    }
    // On a chart-border ring. Without the neighbour roster (or without a walk
    // to orient the probe by) the presumption of continuation stands -- the
    // unconditional legacy drop. With it, the drop holds only where some
    // chart actually lies across the segment. The refinement covers the quilt
    // ring too, and deliberately: a finer chart's coverage can STOP at the
    // same real limit this cell's does (US3AK89M's west limit is the same
    // treaty line as US2ARCEC's between 65.5 and 66.3 N), and a segment along
    // that shared ring with void beyond is the charted end of the area, not a
    // cut -- where the ring IS a cut, the finer chart is on the far side by
    // construction and the probe finds it in the roster.
    if (!neighbors || !walk) return true;
    return coverageContains(neighbors, outwardProbe(walk));
  };
}

// ---- chaining --------------------------------------------------------------

/**
 * Loose segments back into LineStrings.
 *
 * Walks forwards then backwards, taking the single continuation when the node
 * is a simple one. A junction (three or more edges) ends the chain rather than
 * picking a side arbitrarily.
 */
export function chain(entries) {
  const endpoints = new Map();
  const remaining = new Set(entries);

  const at = (point) => `${round(point[0])},${round(point[1])}`;
  for (const entry of entries) {
    for (const point of [entry.a, entry.b]) {
      const id = at(point);
      const bucket = endpoints.get(id);
      if (bucket) bucket.push(entry);
      else endpoints.set(id, [entry]);
    }
  }

  const lines = [];
  for (const start of entries) {
    if (!remaining.has(start)) continue;
    remaining.delete(start);
    const line = [start.a, start.b];

    for (const direction of [1, 0]) {
      for (;;) {
        const tip = direction ? line[line.length - 1] : line[0];
        const candidates = (endpoints.get(at(tip)) ?? []).filter((entry) =>
          remaining.has(entry),
        );
        if (candidates.length !== 1) break;
        const next = candidates[0];
        remaining.delete(next);
        const other = at(next.a) === at(tip) ? next.b : next.a;
        if (direction) line.push(other);
        else line.unshift(other);
      }
    }
    lines.push(line);
  }
  return lines;
}

// ---- the derivation --------------------------------------------------------

/**
 * The whole differ-only edge derivation.
 *
 *   features  the source areas, already exported and quilt-clipped
 *   sideOf    feature -> the value hashed onto every segment it owns
 *   absent    the side value standing in for "no source feature there"
 *   classify  the owners of one segment (always two or more) -> null when they
 *             agree, otherwise one `{ signature, properties, side? }` or an
 *             ARRAY of them for per-side emission. `signature` buckets
 *             segments for chaining, so two segments that chain together must
 *             share one; `properties` goes on the emitted feature. `side`, when
 *             present, is an index into the array classify was handed, and the
 *             emitted segment walks the CANONICAL orientation of THAT owner's
 *             ring -- filled side on the right of travel (see `orientedRings`;
 *             the SOURCE winding is arbitrary and must never be trusted) --
 *             which is what lets a per-side edge carry its own boundary
 *             presentation facing its own interior (S-52 line marks point INTO
 *             the filled side, and MapLibre reads that off the line's
 *             direction). Without it the segment walks its first owner's
 *             canonical orientation, which is all a single-edge classifier
 *             ever needed.
 *   onSeam    (a, b, walk, sides, range) -> the segment is a chart border;
 *             see THE CHART
 *             BORDER. Consulted only for ONE-SIDED segments -- a single owner,
 *             or several owners all walking the same way -- and handed the
 *             owners' shared canonical walk so a continuation probe knows
 *             which side is out. The legacy boolean result remains supported:
 *             true drops the whole segment, false keeps it. A semantic caller
 *             may instead return `{ suppressSides: number[] }`; only those
 *             owner indexes are removed before classification. This is how an
 *             area continued by identical neighbour content disappears while
 *             a different or absent neighbour keeps this cell's side.
 *
 * Returns `{ features, segmentTotal, seamTotal }`, the two totals being what
 * the generators report on stderr.
 *
 * Every interval of the copy ladder is hashed, classified and chained on its
 * OWN segments, and its edges carry its range: two copies of one area coincide
 * wherever the finer mask did not cut them, so a shared hash would read as an
 * interface between two areas that agree and delete the interval's edges
 * outright.
 */
export function deriveDifferEdges({
  features,
  sideOf,
  absent,
  classify,
  onSeam,
}) {
  const index = intervalIndex(() => ({ segments: new Map() }));

  for (const feature of features) {
    const { segments } = index.of(feature.properties);
    const side = sideOf(feature);
    for (const ring of orientedRings(feature.geometry)) {
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1];
        const b = ring[i];
        const id = segmentKey(a, b);
        const existing = segments.get(id);
        // `dirs[i]` is the direction owner i's CANONICALLY wound ring walks
        // this segment -- two interiors on opposite sides walk a shared edge
        // in OPPOSITE directions, which is exactly what per-side emission
        // needs.
        if (existing) {
          existing.sides.push(side);
          existing.dirs.push([a, b]);
        } else segments.set(id, { a, b, sides: [side], dirs: [[a, b]] });
      }
    }
  }

  const out = [];
  let segmentTotal = 0;
  let seamTotal = 0;

  for (const interval of index.intervals.values()) {
    segmentTotal += interval.segments.size;

    /** Segments keyed by their attribute signature, for chaining. */
    const byAttributes = new Map();

    for (const segment of interval.segments.values()) {
      let sides = segment.sides;
      let dirs = segment.dirs;
      // Owners whose interiors share a side walk the segment the SAME way
      // (filled side on the right of travel); a genuine interface is walked in
      // opposite directions. All-same-way means every owner was truncated by
      // whatever this segment is -- one side of evidence, however many owners.
      const oneSided = dirs.every(
        (dir) =>
          round(dir[0][0]) === round(dirs[0][0][0]) &&
          round(dir[0][1]) === round(dirs[0][0][1]),
      );
      if (oneSided) {
        // The far side is whatever is not this class here. Unless that
        // "whatever" is the next chart along, in which case this cell has no
        // evidence of a change and says nothing -- for a lone truncated area
        // and equally for overlapping areas truncated together (see THE CHART
        // BORDER: the nested-jurisdiction seam).
        const seam = onSeam(
          segment.a,
          segment.b,
          dirs[0],
          sides,
          interval.range,
        );
        if (seam === true) {
          seamTotal++;
          continue;
        }
        if (seam && Array.isArray(seam.suppressSides)) {
          const suppressed = new Set(seam.suppressSides);
          sides = sides.filter((_, index) => !suppressed.has(index));
          dirs = dirs.filter((_, index) => !suppressed.has(index));
          if (sides.length === 0) {
            seamTotal++;
            continue;
          }
        }
      }
      if (sides.length < 2) {
        // The padding keeps `dirs` indexed exactly like `sides`, so an edge's
        // `side` picks the right orientation whether or not it was padded.
        sides = [absent, sides[0]];
        dirs = [null, dirs[0]];
      }

      const edges = classify(sides);
      // The whole point: only a CHANGE is a line.
      if (!edges) continue;

      for (const edge of Array.isArray(edges) ? edges : [edges]) {
        const dir = (edge.side != null && dirs[edge.side]) || [
          segment.a,
          segment.b,
        ];
        const bucket = byAttributes.get(edge.signature);
        const entry = { a: dir[0], b: dir[1], properties: edge.properties };
        if (bucket) bucket.push(entry);
        else byAttributes.set(edge.signature, [entry]);
      }
    }

    for (const entries of byAttributes.values()) {
      for (const line of chain(entries)) {
        out.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: line },
          properties: {
            ...entries[0].properties,
            // The interval these segments came from, converted to tippecanoe
            // bounds later by bin/stamp-quilt-zooms.
            ...interval.range,
          },
        });
      }
    }
  }

  return { features: out, segmentTotal, seamTotal };
}
