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
//   each cell every OTHER cell's rows -- the same evidence the boundary merge
//   rule reads to tell a continuing area from a real change at a cell border.
//
// THE RULE
//
//   Build the contiguous same-(CLASS, content) COMPONENT across cells: this
//   cell's own parts, plus the other cells' evidence polygons of the same class
//   and the same canonical content, joined wherever they touch or overlap. The
//   component ELECTS the lexicographically smallest DSNM in it, and only the
//   elected cell emits its anchor.
//
//   Determinism is what makes an election work with no cell talking to any
//   other: every cell is handed the same roster and the same content
//   comparison, so every cell computes the same component and reads the same
//   winner out of it -- the loser suppresses precisely because it can see who
//   won. Smallest DSNM rather than largest area because it has to be decidable
//   from a name alone: areas differ by a clip, names do not.
//
//   The elected anchor carries the COMPONENT's area, not the local offcut's.
//   AREA is what the style's screen-size density floor reads, and the one
//   surviving anchor stands for the whole feature -- a 4 m^2 corner offcut that
//   has just won the election for a 30 km^2 pipeline area must not be measured
//   as the offcut.
//
//   And it is PLACED over the component, not over the elected cell's share of
//   it. `verdict` hands the joined components' polygons back, and both
//   generators rank their own parts and those TOGETHER to choose the part the
//   point goes in -- because the elected cell is often the one holding the
//   offcut (US5OR2KC's sliver of a PIPARE that mostly lies on US5OR2KD), and an
//   anchor placed inside the sliver sits at the extreme edge of the physical
//   area, at overzoom visibly outside it. The roster's polygons are the
//   neighbours' UNCLIPPED geometry and may overlap this cell's parts; no union
//   is needed, since "the largest part" is exactly the rule a single-cell
//   multipolygon already gets.
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
//   * A part with no same-band, same-content neighbour across any border is
//     alone in its component and elects itself: the behaviour is exactly what it
//     was before this existed.
//   * Two disjoint components of the same content elect independently, so two
//     separate physical areas that happen to state the same thing keep one
//     anchor each.
//   * A class the roster does not carry never elects at all. The roster is built
//     over bin/generate-area-edges' AREA_EDGE_CLASSES -- the classes with a
//     stroked boundary -- so the anchor classes outside it (TSSLPT, TSSRON,
//     TSSCRS, RCTLPT, BERTHS, CHKPNT, HRBFAC, MAGVAR) keep one anchor per cell
//     copy until the roster widens.
//
// Without a roster, without this cell's own DSNM, or without a rung to compare
// on -- an unpartitioned cell, a nameless chart, an older cache -- the election
// is inert and every group keeps its own anchor.

import { featureArea } from "./quilt-anchors.mjs";
import { canonicalContent } from "./quilt-content.mjs";
import { NEIGHBOR_PROBE_EPSILON, polygonsContaining } from "./quilt-edges.mjs";
import { polygons, readFeatures } from "./quilt-geojson.mjs";

/**
 * How close two cells' parts have to come to count as one area, in degrees.
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
 * Whether two parts of one area meet: touching along the cell border, or
 * overlapping across it.
 *
 * Touching is the ordinary case -- neighbouring cells are digitised to a shared
 * border and their halves of an area abut along it. Overlap is the case the
 * touch test misses: cells' coverages are not a perfect tiling, the roster's
 * polygons are the cells' own UNCLIPPED geometry while this cell's parts have
 * been through the quilt clip, and a part swallowed inside a neighbour's copy
 * has no vertex anywhere near an edge of it.
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

/** Connected components of one bucket's roster polygons, by adjacency. */
function componentsOf(members) {
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
    owners: new Set(entries.map((entry) => entry.dsnm)),
    area: entries.reduce(
      (total, entry) =>
        total + featureArea({ type: "Polygon", coordinates: entry.polygon }),
      0,
    ),
  }));
}

/**
 * The election, over the other cells' semantic roster.
 *
 *   paths      the roster GeoJSON files (CLASS, CONTENT, DSNM, QFLOOR), this
 *              cell's own rows already excluded by bin/s57-to-tiles: a chart is
 *              never evidence about what lies beyond its own border
 *   dsnm       this cell's chart name, the candidate every component weighs
 *   cellFloor  this cell's rung, which is the band the comparison is confined to
 *
 * `verdict` answers for one anchor group and is the whole interface: components
 * are derived per bucket the first time one is asked for, because a region's
 * roster carries every class of every neighbouring chart and almost none of it
 * is ever consulted.
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
        if (typeof owner !== "string" || !owner || owner === dsnm) continue;
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
      components = componentsOf(buckets.get(key) ?? []);
      derived.set(key, components);
    }
    return components;
  };

  return {
    /** Whether an election is running at all; false leaves every group alone. */
    active,

    /**
     * One group's verdict: whether THIS cell emits its anchor, how much area
     * the rest of the component adds to it when it does, and the component's
     * OTHER polygons -- the placement candidates the caller ranks alongside
     * its own parts, so the surviving symbol sits over the whole physical area
     * rather than over this cell's share of it.
     *
     * `content` is the group's own `contentOf` bag (or any value the
     * canonicalizer reduces to the roster's spelling of it); `parts` are the
     * group's polygons, each an array of rings. The returned `parts` are the
     * roster entries' OWN arrays -- already in memory, read and never mutated
     * -- and are empty whenever nothing joined: no component, no election, or
     * a group whose parts meet none of the roster's.
     */
    verdict(className, content, parts) {
      if (!active) return { emit: true, area: 0, parts: [] };
      const components = componentsFor(bucketKey(className, content));
      if (components.length === 0) return { emit: true, area: 0, parts: [] };

      const own = parts
        .filter((polygon) => polygon[0] && polygon[0].length >= 4)
        .map((polygon) => entryOf(polygon, dsnm));
      let elected = dsnm;
      let area = 0;
      const joined = [];
      for (const component of components) {
        // The whole component joins as soon as ONE of its polygons meets one of
        // ours: two components this cell bridges are one area, and a cell that
        // bridges nothing sees exactly what its neighbours do.
        if (
          !component.entries.some((entry) =>
            own.some((part) => adjacent(entry, part)),
          )
        ) {
          continue;
        }
        area += component.area;
        for (const entry of component.entries) joined.push(entry.polygon);
        for (const owner of component.owners) {
          if (owner < elected) elected = owner;
        }
      }
      return { emit: elected === dsnm, area, parts: joined };
    },
  };
}
