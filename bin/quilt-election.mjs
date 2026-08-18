// The CROSS-CELL ANCHOR ELECTION: which cell of a chart-split area emits its
// anchor, shared by bin/generate-restriction-anchors and bin/generate-area-anchors.
//
// THE DEFECT
//
//   Both anchor generators group by (CLASS, LNAM, interval), and LNAM is issued
//   PER CELL: one dumping ground digitised across US5OR2JC, US5OR2KC and
//   US4OR1IF is three features with three LNAMs, so the "one anchor per feature"
//   rule that removed the per-tile duplication still draws three stacks of
//   symbols on one physical area. At a four-cell corner it is worse -- a
//   measured PIPARE at the US5OR2JC/JD/KC/KD corner emitted EIGHT anchors, and
//   the ones sitting on corner offcuts a few square metres across bloom to full
//   symbol size on overzoom. Nothing inside one cell can see any of that: the
//   other parts belong to other charts.
//
//   Which is exactly what the cached semantic roster exists to say. Every cell's
//   areas are cached with their canonical CONTENT identity (bin/generate-area-edges
//   --write-evidence, stored by bin/extract-coverage), and bin/s57-to-tiles hands
//   each cell the region's roster -- the same evidence the boundary merge rule
//   reads to tell a continuing area from a real change at a cell border.
//
// THE RULE
//
//   ONE anchor per contiguous same-(CLASS, content) COMPONENT. That is the
//   identity bin/generate-area-edges already derives a boundary from (its
//   header, "THE BOUNDARY MERGE RULE": same-content fragments are one area
//   however the topology split them), and it reaches exactly as far -- WITHIN
//   one cell as much as ACROSS a seam.
//
//   The component is built over the cached roster: every polygon of that class
//   and that canonical content, in every cell of the region INCLUDING THIS ONE,
//   joined wherever they touch or overlap. The component elects the
//   lexicographically smallest DSNM in it; inside the elected cell the smallest
//   GROUP KEY among the groups standing on that component emits, and every
//   other group standing on it stands down.
//
//   Smallest DSNM rather than largest area because it has to be decidable from
//   a name alone: areas differ by a clip, names do not.
//
// SYMMETRY -- why the roster carries this cell's own rows
//
//   The election works only because no cell talks to any other: each derives
//   the same components from the same roster and reads the same winner out of
//   them. The first cut broke that by comparing DIFFERENT geometry on the two
//   sides -- this cell's parts were its QUILT-CLIPPED polygons, while the
//   roster (own rows excluded) held the neighbours' UNCLIPPED ones -- so the
//   components came out a function of who was asking.
//
//   Measured at the US5OR2JC/JD/KC/KD corner, on a PIPARE corridor of eight
//   features all carrying {"RESTRN":"2,6,24"}: US5OR2KD's big polygon reaches
//   US5OR2JC's sliver only in its UNCLIPPED form. JC therefore saw itself
//   joined to KD, found itself the smaller name and emitted for the pair --
//   while KD, testing its own CLIPPED copy, which stops at the border and never
//   reaches JC, saw no such component at all, found itself the smallest name of
//   what it could see, and emitted too. Two anchors on one point (AREA 2.835e-05
//   and 2.842e-05). Neither cell was wrong about its own inputs; the inputs
//   disagreed.
//
//   So the roster handed to the election is UNFILTERED (bin/s57-to-tiles
//   exports it a second time without the `DSNM <>` clause, as
//   area_evidence_all.geojson). Every cell buckets the same rows, derives the
//   same components and reads the same verdict out of them; this cell's clipped
//   parts are then used for ONE thing only, telling which component its own
//   groups stand on. The edge generator's --neighbor-area-evidence stays
//   neighbour-only, and for its own good reason: a chart is not evidence about
//   what lies beyond its own border. Here the question is the opposite one --
//   which of these polygons are one area -- and every cell has to answer it the
//   same way.
//
// WITHIN A CELL
//
//   Groups are per LNAM, and one cell routinely holds several LNAMs of one
//   physical area: the same corner has THREE US5OR2KD pieces of that corridor,
//   contiguous and byte-identical in content. With the cell's own rows excluded
//   from the roster nothing could ever join them, so each emitted its own
//   anchor -- four at that corner even once the cross-cell half worked.
//
//   Contiguous same-content fragments are one area however the topology split
//   them, so they stand on ONE component and the smallest group key emits for
//   all of them. The key is the generators' own group id (`CLASS LNAM
//   interval`): stable across runs, and compared only against the other keys of
//   the cell that owns them, so no other cell's naming can move it.
//
// AREA AND PLACEMENT
//
//   The surviving anchor stands for the whole component, so it is MEASURED and
//   PLACED as the whole component. `area` is the sum of the component's
//   polygons -- the roster's unclipped geometry, this cell's own row included;
//   never the local clipped offcut ADDED to the neighbours' polygons, which
//   double-counted this cell's share of the area. `parts` is all of those
//   polygons, which both generators rank alongside their own clipped parts to
//   choose the part the point goes in.
//
//   A 4 m^2 corner offcut that has just won the election for a 30 km^2 pipeline
//   area must be measured as the pipeline and drawn inside it: AREA is what the
//   style's screen-size density floor reads, and a point placed in the sliver
//   sits at the extreme edge of the physical area, at overzoom visibly outside
//   it. The roster's polygons are the cells' own unclipped geometry and may
//   overlap one another; no union is taken, since "the largest part" is exactly
//   the rule a single-cell multipolygon already gets.
//
// SAME BAND ONLY
//
//   The comparison is confined to the cell's own rung (QFLOOR): scale editions
//   legitimately differ in what they compile and how finely they draw it, and a
//   coarse chart's copy of an area is not a part of the finer chart's copy of it
//   -- they are two compilations of one thing, each anchored in its own band,
//   and the copy ladder already keeps their zoom ranges apart. QFLOOR is the
//   band key rather than INTU because it is what the roster carries and what the
//   quilt itself is keyed on (INTU is excluded from content identity for the
//   same reason: a neighbour may name its band differently and still be the
//   same water).
//
// WHAT IS DELIBERATELY NOT ELECTED
//
//   * A part alone in its component -- no same-band, same-content neighbour
//     across any border and no sibling fragment at home -- elects itself: the
//     behaviour is exactly what it was before this existed.
//   * Two disjoint components of the same content elect independently, so two
//     separate physical areas that happen to state the same thing keep one
//     anchor each.
//   * A class the roster does not carry never elects at all. The roster is built
//     over bin/generate-area-edges' AREA_EDGE_CLASSES -- the classes with a
//     stroked boundary -- so the anchor classes outside it (TSSLPT, TSSRON,
//     TSSCRS, RCTLPT, BERTHS, CHKPNT, HRBFAC, MAGVAR) keep one anchor per cell
//     copy until the roster widens.
//
// THE DEGRADED PATH
//
//   A roster carrying no row of this cell's own -- an older cache, or a cell
//   whose build precedes its own first evidence -- cannot map a group by
//   containment. `register` then falls back to the original test: the group's
//   CLIPPED parts against the component's entries, by the same adjacency. That
//   is the asymmetric comparison above and it carries the asymmetric risk with
//   it: the cross-cell half of the rule is then only as good as it was before.
//   The within-cell half reaches only as far as the NEIGHBOURS' polygons do --
//   two fragments of this cell that both meet one neighbouring component are
//   still elected between, but two that meet nothing in the roster meet nothing
//   at all. The AREA is repaired locally: the fallen-back group's own clipped
//   area is added to the component, which holds no polygon of this cell's, so
//   the anchor still measures the whole physical area rather than the
//   neighbours' share of it.
//
// Without a roster, without this cell's own DSNM, or without a rung to compare
// on -- an unpartitioned cell, a nameless chart, an older cache -- the election
// is inert and every group keeps its own anchor.

import { featureArea, pointOnSurface } from "./quilt-anchors.mjs";
import { canonicalContent } from "./quilt-content.mjs";
import { NEIGHBOR_PROBE_EPSILON, polygonsContaining } from "./quilt-edges.mjs";
import { polygons, readFeatures } from "./quilt-geojson.mjs";

/**
 * How close two parts have to come to count as one area, in degrees.
 *
 * The same step the edge derivation probes a chart border with (~10 m of
 * ground): "a charted neighbour abutting OR overlapping the border" is the
 * relation both are testing, and neither can be tighter than the quilt clip's
 * own re-derivation of the geometry. Two genuinely distinct areas that carry
 * BYTE-IDENTICAL content, sit in the same band and pass within 10 m of each
 * other would merge -- the cost is one of their two anchors, against a
 * duplicate symbol stack on every split area if the tolerance is too tight to
 * see a border at all.
 */
const ADJACENCY_TOLERANCE = NEIGHBOR_PROBE_EPSILON;

/** The verdict of a group standing on no component at all. */
const ALONE = { emit: true, area: 0, parts: [] };

/** The bucket key: only same class AND same content are ever one area. */
function bucketKey(className, content) {
  return `${className}\u0000${canonicalContent(content)}`;
}

/** A polygon with the bbox gate and the owner every test here needs. */
function entryOf(polygon, dsnm) {
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
  // `polygon`, `minX`..`maxY` and `properties` are the shape polygonsContaining
  // reads, so an entry can be handed to it as a one-polygon index.
  return { polygon, minX, minY, maxX, maxY, properties: {}, dsnm };
}

/** One polygon's area, holes and all, on the pipeline's one measure. */
function polygonArea(polygon) {
  return featureArea({ type: "Polygon", coordinates: polygon });
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

/** Whether any vertex of `from` lies within the tolerance of a ring of `to`. */
function vertexNear(from, to) {
  for (const ring of from) {
    for (const point of ring) {
      for (const other of to) {
        for (let i = 1; i < other.length; i++) {
          if (
            distanceToSegment(point, other[i - 1], other[i]) <=
            ADJACENCY_TOLERANCE
          )
            return true;
        }
      }
    }
  }
  return false;
}

/**
 * Whether two parts of one area meet: touching along a border, or overlapping
 * across it.
 *
 * Touching is the ordinary case -- neighbouring cells are digitised to a shared
 * border and their halves of an area abut along it, and so do two fragments of
 * one area inside a single cell. Overlap is the case the touch test misses:
 * cells' coverages are not a perfect tiling and the roster's polygons are the
 * cells' own UNCLIPPED geometry, so one cell's copy of an area can lie wholly
 * inside a neighbour's copy with no vertex anywhere near an edge of it.
 */
function adjacent(a, b) {
  if (a.maxX + ADJACENCY_TOLERANCE < b.minX) return false;
  if (b.maxX + ADJACENCY_TOLERANCE < a.minX) return false;
  if (a.maxY + ADJACENCY_TOLERANCE < b.minY) return false;
  if (b.maxY + ADJACENCY_TOLERANCE < a.minY) return false;
  if (vertexNear(a.polygon, b.polygon) || vertexNear(b.polygon, a.polygon))
    return true;
  return (
    a.polygon[0].some((point) => polygonsContaining([b], point).length > 0) ||
    b.polygon[0].some((point) => polygonsContaining([a], point).length > 0)
  );
}

/**
 * Connected components of one bucket's roster polygons, by adjacency.
 *
 * The roster is the whole region's, this cell's rows included, so these
 * components come out the same in every cell that derives them -- which is the
 * whole mechanism (see SYMMETRY). `own` is a convenience index over the entries
 * this cell contributed, for mapping its clipped groups onto them.
 */
function componentsOf(members, dsnm) {
  const parent = members.map((_, index) => index);
  const find = (index) => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    while (parent[index] !== root) {
      const next = parent[index];
      parent[index] = root;
      index = next;
    }
    return root;
  };
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      if (find(i) === find(j)) continue;
      if (adjacent(members[i], members[j])) parent[find(i)] = find(j);
    }
  }
  const groups = new Map();
  for (let i = 0; i < members.length; i++) {
    const root = find(i);
    const bucket = groups.get(root);
    if (bucket) bucket.push(members[i]);
    else groups.set(root, [members[i]]);
  }
  return [...groups.values()].map((entries) => ({
    entries,
    own: entries.filter((entry) => entry.dsnm === dsnm),
    owners: new Set(entries.map((entry) => entry.dsnm)),
    area: entries.reduce(
      (total, entry) => total + polygonArea(entry.polygon),
      0,
    ),
    // Filled in by `register`: this cell's group keys standing on this
    // component, and the clipped area of those that could only reach it down
    // the degraded path (see THE DEGRADED PATH).
    keys: new Set(),
    fallbackArea: 0,
  }));
}

/**
 * The election, over the region's semantic roster.
 *
 *   paths      the roster GeoJSON files (CLASS, CONTENT, DSNM, QFLOOR),
 *              UNFILTERED: this cell's own rows are in it, and have to be, or
 *              the two sides of the comparison are different geometry and both
 *              of them can emit (see SYMMETRY)
 *   dsnm       this cell's chart name, the candidate every component weighs
 *   cellFloor  this cell's rung, which is the band the comparison is confined to
 *
 * Two passes, in this order:
 *
 *   1. `register(groupKey, className, content, parts)` for EVERY group, which
 *      maps it onto the component(s) it stands on;
 *   2. `verdict(groupKey)` for each, which answers whether this cell emits it,
 *      and with what area and placement candidates.
 *
 * Both passes are needed because the within-cell tie-break reads the OTHER
 * groups standing on the same component, so no verdict is decidable until every
 * group has been seen. Components are derived per bucket the first time one is
 * asked for, because a region's roster carries every class of every chart in it
 * and almost none of it is ever consulted.
 */
export function anchorElection({
  paths = [],
  dsnm = "",
  cellFloor = null,
} = {}) {
  const active = paths.length > 0 && !!dsnm && Number.isFinite(cellFloor);
  const buckets = new Map();

  if (active) {
    for (const path of paths) {
      for (const feature of readFeatures(path)) {
        const properties = feature.properties ?? {};
        const owner = properties.DSNM;
        // This cell's own rows are KEPT, deliberately: see SYMMETRY.
        if (typeof owner !== "string" || !owner) continue;
        if (typeof properties.CLASS !== "string") continue;
        // SAME BAND ONLY: a coarser or finer edition's copy of this area is a
        // different compilation of it, not a part of it.
        if (Number(properties.QFLOOR) !== cellFloor) continue;
        const key = bucketKey(properties.CLASS, properties.CONTENT);
        for (const polygon of polygons(feature.geometry)) {
          if (!polygon[0] || polygon[0].length < 4) continue;
          const bucket = buckets.get(key);
          if (bucket) bucket.push(entryOf(polygon, owner));
          else buckets.set(key, [entryOf(polygon, owner)]);
        }
      }
    }
  }

  /** bucket key -> its roster components, derived on first use. */
  const derived = new Map();
  const componentsFor = (key) => {
    let components = derived.get(key);
    if (!components) {
      components = componentsOf(buckets.get(key) ?? [], dsnm);
      derived.set(key, components);
    }
    return components;
  };

  /** group key -> the components it stands on, from pass 1. */
  const standing = new Map();

  return {
    /** Whether an election is running at all; false leaves every group alone. */
    active,

    /**
     * PASS 1. Map one anchor group onto its component(s), so that pass 2 can
     * answer for it -- and so that the other groups of this cell standing on
     * the same component know it is there.
     *
     * `content` is the group's own `contentOf` bag (or any value the
     * canonicalizer reduces to the roster's spelling of it); `parts` are the
     * group's QUILT-CLIPPED polygons, each an array of rings. The mapping is by
     * CONTAINMENT: a representative interior point of one clipped part, inside
     * one of the component's polygons of this cell's own -- a clipped part is a
     * subset of the row this cell contributed to the roster, so that row is the
     * one thing guaranteed to hold it whatever the clip did to its shape.
     * Adjacency of the clipped parts against the whole component is the
     * DEGRADED fallback, for a roster carrying no row of this cell's.
     */
    register(groupKey, className, content, parts) {
      if (!active || standing.has(groupKey)) return;
      const own = parts
        .filter((polygon) => polygon[0] && polygon[0].length >= 4)
        .map((polygon) => entryOf(polygon, dsnm));
      if (own.length === 0) {
        standing.set(groupKey, []);
        return;
      }
      const components = componentsFor(bucketKey(className, content));
      const inside = own.map((part) => pointOnSurface(part.polygon));
      const matched = components.filter((component) =>
        inside.some(
          (point) => polygonsContaining(component.own, point).length > 0,
        ),
      );

      if (matched.length === 0) {
        // THE DEGRADED PATH: nothing of this cell's in the roster to stand on,
        // so the clipped parts are compared against the neighbours' unclipped
        // ones -- the asymmetric test, with the asymmetric risk.
        const fallback = components.filter((component) =>
          component.entries.some((entry) =>
            own.some((part) => adjacent(entry, part)),
          ),
        );
        if (fallback.length > 0) {
          // The component holds no polygon of this cell's, so its area is the
          // neighbours' share alone and this group's own clipped parts are the
          // rest of the physical area. Added to the FIRST matched component,
          // once: `verdict` unions them, and per-component would count the same
          // offcut once for every component the group bridges.
          fallback[0].fallbackArea += own.reduce(
            (total, part) => total + polygonArea(part.polygon),
            0,
          );
        }
        for (const component of fallback) component.keys.add(groupKey);
        standing.set(groupKey, fallback);
        return;
      }

      for (const component of matched) component.keys.add(groupKey);
      standing.set(groupKey, matched);
    },

    /**
     * PASS 2. One group's verdict: whether THIS cell emits its anchor, the area
     * of the whole physical area the anchor would stand for, and the
     * component's polygons -- the placement candidates the caller ranks
     * alongside its own parts, so the surviving symbol sits over the whole area
     * rather than over this cell's share of it.
     *
     * `emit` needs both halves of the rule: the component must have elected
     * this cell (the smallest DSNM in it), and within the cell this group must
     * be the smallest group key standing on the component (the several LNAMs
     * one cell holds of one area). A group standing on nothing -- no roster, an
     * unknown class, an area of its own -- keeps its anchor, and its own area
     * and placement with it.
     *
     * The returned `parts` are the roster entries' OWN arrays -- already in
     * memory, read and never mutated. A group bridging several components is
     * standing on one area: they are unioned for all three answers.
     */
    verdict(groupKey) {
      if (!active) return ALONE;
      const components = standing.get(groupKey);
      if (!components || components.length === 0) return ALONE;

      let elected = dsnm;
      let first = groupKey;
      let area = 0;
      const joined = [];
      for (const component of components) {
        area += component.area + component.fallbackArea;
        for (const entry of component.entries) joined.push(entry.polygon);
        for (const owner of component.owners) {
          if (owner < elected) elected = owner;
        }
        for (const key of component.keys) {
          if (key < first) first = key;
        }
      }
      return {
        emit: elected === dsnm && first === groupKey,
        area,
        parts: joined,
      };
    },
  };
}
