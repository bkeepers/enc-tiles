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
//   A segment with only ONE owner that lies along a quilt cut or along this
//   cell's own M_COVR ring is DROPPED. The area continues into the neighbouring
//   chart and THIS cell cannot see what is there, so emitting the segment
//   claims a change the data does not show -- and a chart ruled into boxes at
//   its cell borders is the whole defect this machinery exists to remove.
//
//   The cost is stated plainly: a real change that happens to fall exactly on a
//   cell border goes unmarked in this cell. It is marked in the NEIGHBOUR
//   wherever that cell holds both sides, and where neither does, the
//   alternative is a line at every seam whether anything changed or not.
//
//   A segment with TWO owners is never suppressed, wherever it lies. If this
//   cell holds both sides of a boundary then it has the evidence, and a
//   coverage ring running along an interior boundary does not take it away.

import {
  exteriorRings,
  intervalIndex,
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

/**
 * The two coverage inputs every edge generator takes, as one seam test.
 *
 * `--coverage` is the quilt cut against a FINER chart; `--cell-coverage` is this
 * cell's own M_COVR. Both are chart borders and neither is a change in
 * anything. Passing neither gives a test that is false everywhere, which is the
 * legacy behaviour: every truncated edge is emitted.
 */
export function chartBorderTest(coveragePaths, cellCoveragePaths) {
  return seamTest([
    {
      index: coverageIndex(coveragePaths, SEAM_TOLERANCE),
      tolerance: SEAM_TOLERANCE,
    },
    {
      index: coverageIndex(
        cellCoveragePaths,
        CELL_BOUNDARY_TOLERANCE,
        (feature) => Number(feature.properties?.CATCOV) === 1,
        true,
      ),
      tolerance: CELL_BOUNDARY_TOLERANCE,
    },
  ]);
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
 *             emitted segment keeps THAT owner's ring orientation -- which is
 *             what lets a per-side edge carry its own boundary presentation
 *             facing its own interior (S-52 line marks point INTO the filled
 *             side, and MapLibre reads that off the line's direction). Without
 *             it the segment keeps its first owner's orientation, which is all
 *             a single-edge classifier ever needed.
 *   onSeam    (a, b) -> the segment is a chart border; see THE CHART BORDER
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
    for (const ring of rings(feature.geometry)) {
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1];
        const b = ring[i];
        const id = segmentKey(a, b);
        const existing = segments.get(id);
        // `dirs[i]` is the direction owner i's ring walked this segment --
        // adjacent rings walk a shared edge in OPPOSITE directions, which is
        // exactly what per-side emission needs to preserve.
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
      if (sides.length < 2) {
        // One owner: the other side is whatever is not this class here. Unless
        // that "whatever" is the next chart along, in which case this cell has
        // no evidence of a change and says nothing.
        if (onSeam(segment.a, segment.b)) {
          seamTotal++;
          continue;
        }
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
