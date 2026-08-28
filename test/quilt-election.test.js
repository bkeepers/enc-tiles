/**
 * Unit runs of bin/quilt-election.mjs, the anchor election.
 *
 * Its verdict is exercised end to end by the two anchor generators' fixture
 * runs (test/generate-restriction-anchors.test.js and
 * test/generate-area-anchors.test.js, "the cross-cell election"), so what is
 * asked here directly is what an emitted anchor cannot show: the COMPONENT
 * POLYGONS the elected cell places its anchor over, and the two properties the
 * whole mechanism rests on -- that every cell of one corner reaches the SAME
 * verdict from its own viewpoint, and that a cell holding several fragments of
 * one area emits once for all of them.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { anchorElection } from "../bin/quilt-election.mjs";
import { quiltKey } from "../bin/quilt-geojson.mjs";

let work;
let written = 0;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "quilt-election-"));
  written = 0;
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

/** A rectangle, as a closed ring. */
function box(x0, y0, x1, y1) {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
  ];
}

/**
 * A rectangle's area in square degrees, longitude scaled by cos(latitude) --
 * the pipeline's one measure (bin/quilt-anchors.mjs featureArea), written out
 * here so an expected total is arithmetic the test owns rather than a second
 * call into the code under test.
 */
function boxArea([x0, y0, x1, y1]) {
  const latitude = (((y0 + y1) / 2) * Math.PI) / 180;
  return (x1 - x0) * (y1 - y0) * Math.max(Math.cos(latitude), 0.01);
}

/**
 * The semantic roster on disk, exactly as bin/extract-coverage caches it and
 * bin/s57-to-tiles exports it back out for the election: one polygon per area,
 * carrying the producing chart, its rung and the canonical CONTENT identity.
 * UNFILTERED -- this cell's own rows belong in it, and several of these tests
 * are about what happens when they are missing.
 */
function roster(entries) {
  const path = join(work, `roster-${written++}.geojson`);
  writeFileSync(
    path,
    JSON.stringify({
      type: "FeatureCollection",
      features: entries.map(
        ({ className = "DMPGRD", content = {}, dsnm, floor = 8, ring }) => ({
          type: "Feature",
          properties: {
            CLASS: className,
            CONTENT: JSON.stringify(content),
            DSNM: dsnm,
            QFLOOR: floor,
          },
          geometry: { type: "Polygon", coordinates: [ring] },
        }),
      ),
    }),
  );
  return path;
}

const SPOIL = { CATDPG: "1", INFORM: "Spoil ground" };

/**
 * The interval key of an unpartitioned cell: one interval for everything it
 * holds, whatever the generators spell it as. Built with the generators' own
 * `quiltKey` rather than written out, since the election only ever compares
 * these keys with each other.
 */
const UNPARTITIONED = quiltKey({});

/**
 * The copy ladder of one partitioned cell, in the shape a group id carries:
 * US4OR1IF's measured K=2 ladder, whose band-4 whole copy draws at z11, whose
 * ladder copy draws at z12 where the 1:22,000 cell takes over, and whose top
 * copy runs from z13 up. Disjoint zooms, so no copy can stand another down.
 */
const LADDER = [
  quiltKey({ _QZMIN: 11, _QZMAX: 11 }),
  quiltKey({ _QZMIN: 12, _QZMAX: 12 }),
  quiltKey({ _QZMIN: 13 }),
];

/** The generators' group id shape: `CLASS LNAM interval`. */
const SOLE = "DMPGRD AA 8";

/**
 * This cell's own half of one dumping ground, east of the shared border, in the
 * shape `register` takes its parts: one entry per polygon, each an array of
 * rings. Quilt-CLIPPED, like everything a generator holds.
 */
const east = [[box(1, 0, 2, 1)]];

/** This cell's UNCLIPPED row for that half, the shape the roster carries. */
const eastRow = box(1, 0, 2.1, 1);

/**
 * One cell's whole pass over the election -- register every group, then read
 * every verdict back, in the order the generators call them.
 *
 * `groups` is [key, parts, interval] triples -- the interval optional, since
 * most of these cases are one unpartitioned cell -- so a cell holding several
 * fragments of one area, or several copies of one feature, is written the way
 * they arrive: several ids, one content.
 */
function cell({
  paths,
  dsnm,
  cellFloor = 8,
  className = "DMPGRD",
  content = SPOIL,
  groups,
}) {
  const election = anchorElection({ paths, dsnm, cellFloor });
  for (const [key, parts, interval = UNPARTITIONED] of groups) {
    election.register(key, className, content, parts, interval);
  }
  const verdicts = new Map();
  for (const [key] of groups) verdicts.set(key, election.verdict(key));
  return verdicts;
}

/** The verdict of a cell holding one group, which is most of these cases. */
function verdictOf({ parts = east, ...options }) {
  return cell({ ...options, groups: [[SOLE, parts]] }).get(SOLE);
}

describe("the component polygons a verdict hands back", () => {
  test("the joined component's polygons come back with the verdict", () => {
    // The elected cell's own share can be a corner offcut a few metres across.
    // Placing the anchor over the whole physical area is only possible if the
    // rest of the area comes back with the verdict, so it does -- every polygon
    // of the component, this cell's own unclipped row included.
    const west = box(0, 0, 1, 1);
    const verdict = verdictOf({
      paths: [
        roster([
          { content: SPOIL, dsnm: "US5OR2KC", ring: west },
          { content: SPOIL, dsnm: "US5OR2AA", ring: eastRow },
        ]),
      ],
      dsnm: "US5OR2AA",
    });

    expect(verdict.emit).toBe(true);
    expect(verdict.parts).toHaveLength(2);
    expect(verdict.parts).toContainEqual([west]);
    expect(verdict.parts).toContainEqual([eastRow]);
  });

  test("every part of a bridged component, not just the touching one", () => {
    // This cell touches only US5OR2KC, but US5OR2KC touches US4OR1AA: all three
    // parts are one area, and all of them are placement candidates for it.
    const middle = box(0, 0, 1, 1);
    const far = box(-1, 0, 0, 1);
    const verdict = verdictOf({
      paths: [
        roster([
          { content: SPOIL, dsnm: "US5OR2KC", ring: middle },
          { content: SPOIL, dsnm: "US4OR1AA", ring: far },
          { content: SPOIL, dsnm: "US5OR2AA", ring: eastRow },
        ]),
      ],
      dsnm: "US5OR2AA",
    });

    expect(verdict.parts).toHaveLength(3);
    expect(verdict.parts).toContainEqual([middle]);
    expect(verdict.parts).toContainEqual([far]);
  });

  test("a component this cell does not join contributes nothing", () => {
    // Nowhere near this cell's own area: not its component, so neither that
    // polygon nor its area joins the verdict.
    const verdict = verdictOf({
      paths: [
        roster([
          { content: SPOIL, dsnm: "US5OR2KC", ring: box(20, 0, 21, 1) },
          { content: SPOIL, dsnm: "US5OR2AA", ring: eastRow },
        ]),
      ],
      dsnm: "US5OR2AA",
    });

    expect(verdict.emit).toBe(true);
    expect(verdict.parts).toEqual([[eastRow]]);
    expect(verdict.area).toBeCloseTo(boxArea([1, 0, 2.1, 1]), 12);
  });

  test("a bucket the roster does not carry has no polygons either", () => {
    // Another class, another rung, other content: three ways to be a different
    // area, and none of them lends this one a placement candidate.
    const paths = [
      roster([
        {
          className: "PIPARE",
          content: SPOIL,
          dsnm: "US5OR2KC",
          ring: box(0, 0, 1, 1),
        },
        { content: SPOIL, dsnm: "US4OR1AA", ring: box(0, 0, 1, 1), floor: 6 },
        {
          content: { ...SPOIL, INFORM: "Disused" },
          dsnm: "US5OR2KC",
          ring: box(0, 0, 1, 1),
        },
      ]),
    ];

    const verdict = verdictOf({ paths, dsnm: "US5OR2AA" });

    expect(verdict).toEqual({ emit: true, area: 0, parts: [] });
  });

  test("an inert election hands back no polygons at all", () => {
    // No roster, no name of this cell's own, no rung to compare on: every group
    // keeps its own anchor, placed exactly where it was before this existed.
    for (const options of [
      {},
      {
        paths: [
          roster([{ content: SPOIL, dsnm: "US5OR2KC", ring: box(0, 0, 1, 1) }]),
        ],
      },
      { dsnm: "US5OR2AA", cellFloor: 8 },
    ]) {
      const election = anchorElection(options);
      election.register(SOLE, "DMPGRD", SPOIL, east, UNPARTITIONED);

      expect(election.active).toBe(false);
      expect(election.verdict(SOLE)).toEqual({
        emit: true,
        area: 0,
        parts: [],
      });
    }
  });
});

describe("the four-cell corner", () => {
  /**
   * The measured defect, in miniature: a PIPARE corridor at the
   * US5OR2JC/JD/KC/KD corner -- eight S-57 features, all carrying
   * {"RESTRN":"2,6,24"}, all contiguous, JC 1, JD 3, KC 1, KD 3.
   *
   * Each cell's ROSTER row is its unclipped compilation, which overruns the
   * border it was digitised to; each cell's PARTS are the quilt-clipped subsets
   * that reach the tiles. KD's clip pulls its pieces well back from the corner,
   * so KD's clipped copies reach NO other cell's row -- which is what made both
   * sides emit when the roster excluded the asking cell: JC, comparing its
   * clipped part against KD's unclipped row, saw itself joined to KD and
   * emitted for the pair, while KD, comparing its own clipped pieces, saw no
   * component at all and emitted three more.
   */
  const CORRIDOR = { RESTRN: "2,6,24" };
  const OVERRUN = 0.05;
  const CORNER = [
    {
      dsnm: "US5OR2JC",
      key: "PIPARE 0A 8",
      piece: [-1, -0.2, 0, 0],
      clip: 0.01,
    },
    {
      dsnm: "US5OR2JD",
      key: "PIPARE 1A 8",
      piece: [-1, 0, -0.6, 0.2],
      clip: 0.01,
    },
    {
      dsnm: "US5OR2JD",
      key: "PIPARE 1B 8",
      piece: [-0.6, 0, -0.3, 0.2],
      clip: 0.01,
    },
    {
      dsnm: "US5OR2JD",
      key: "PIPARE 1C 8",
      piece: [-0.3, 0, 0, 0.2],
      clip: 0.01,
    },
    {
      dsnm: "US5OR2KC",
      key: "PIPARE 2A 8",
      piece: [0, -0.2, 1, 0],
      clip: 0.01,
    },
    {
      dsnm: "US5OR2KD",
      key: "PIPARE 3A 8",
      piece: [0, 0, 0.3, 0.2],
      clip: 0.06,
    },
    {
      dsnm: "US5OR2KD",
      key: "PIPARE 3B 8",
      piece: [0.3, 0, 0.6, 0.2],
      clip: 0.06,
    },
    {
      dsnm: "US5OR2KD",
      key: "PIPARE 3C 8",
      piece: [0.6, 0, 1, 0.2],
      clip: 0.06,
    },
  ];
  const CELLS = ["US5OR2JC", "US5OR2JD", "US5OR2KC", "US5OR2KD"];

  /** The unclipped row this cell contributed to the cache. */
  const rowRect = ({ piece: [x0, y0, x1, y1] }) => [
    x0 - OVERRUN,
    y0 - OVERRUN,
    x1 + OVERRUN,
    y1 + OVERRUN,
  ];

  /** The clipped part that reaches the tiles: a strict subset of the row. */
  const partRect = ({ piece: [x0, y0, x1, y1], clip }) => [
    x0 + clip,
    y0 + clip,
    x1 - clip,
    y1 - clip,
  ];

  const corridorRoster = (entries = CORNER) =>
    roster(
      entries.map((entry) => ({
        className: "PIPARE",
        content: CORRIDOR,
        dsnm: entry.dsnm,
        ring: box(...rowRect(entry)),
      })),
    );

  /**
   * Every cell's verdict on every group of its own, over ONE roster.
   *
   * `intervals` is the copy ladder each cell's pieces arrive as: one interval
   * is the unpartitioned corner as it was measured, and several is the same
   * corner with every piece exported once per rung.
   */
  function corner(path, intervals = [UNPARTITIONED]) {
    const all = [];
    for (const dsnm of CELLS) {
      const groups = [];
      for (const entry of CORNER.filter((piece) => piece.dsnm === dsnm)) {
        for (const interval of intervals) {
          groups.push([
            `${entry.key} ${interval}`,
            [[box(...partRect(entry))]],
            interval,
          ]);
        }
      }
      const verdicts = cell({
        paths: [path],
        dsnm,
        className: "PIPARE",
        content: CORRIDOR,
        groups,
      });
      for (const [key, , interval] of groups) {
        all.push({ dsnm, key, interval, ...verdicts.get(key) });
      }
    }
    return all;
  }

  test("exactly one of the eight groups emits, in the smallest chart", () => {
    const all = corner(corridorRoster());

    expect(all).toHaveLength(8);
    const emitted = all.filter((verdict) => verdict.emit);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].dsnm).toBe("US5OR2JC");
  });

  test("the survivor is measured and placed as the whole corridor", () => {
    const [emitted] = corner(corridorRoster()).filter(
      (verdict) => verdict.emit,
    );

    // Every piece of the corridor is a placement candidate, including the three
    // that never come near the elected cell.
    expect(emitted.parts).toHaveLength(8);
    for (const entry of CORNER) {
      expect(emitted.parts).toContainEqual([box(...rowRect(entry))]);
    }
    expect(emitted.area).toBeCloseTo(
      CORNER.reduce((total, entry) => total + boxArea(rowRect(entry)), 0),
      12,
    );
  });

  test("every cell reads the same area and the same parts out of it", () => {
    // Determinism IS the mechanism: no cell talks to any other, so a loser
    // stands down only because it computes the winner's answer exactly.
    const all = corner(corridorRoster());
    const [emitted] = all.filter((verdict) => verdict.emit);

    for (const verdict of all) {
      expect(verdict.area).toBeCloseTo(emitted.area, 12);
      expect(verdict.parts).toEqual(emitted.parts);
    }
  });

  test("partitioned, the corner keeps one emitter PER INTERVAL", () => {
    // Every piece exported once per rung of the ladder: still one anchor on
    // the corridor, but one at each range of zoom, and still in US5OR2JC. A
    // tie-break blind to the interval keeps the first copy only, and the
    // corridor loses its symbol everywhere that copy does not draw.
    const all = corner(corridorRoster(), LADDER);

    expect(all).toHaveLength(CORNER.length * LADDER.length);
    const emitted = all.filter((verdict) => verdict.emit);
    expect(emitted.map((verdict) => verdict.interval).sort()).toEqual(
      [...LADDER].sort(),
    );
    expect(emitted.map((verdict) => verdict.dsnm)).toEqual(
      LADDER.map(() => "US5OR2JC"),
    );
  });

  test("with its own rows filtered out, US5OR2KD emits too -- the defect", () => {
    // The first cut's inputs, pinned: KD comparing its CLIPPED pieces against
    // the neighbours' UNCLIPPED rows reaches none of them, so it finds itself
    // alone and emits -- three more anchors on the corridor JC has already
    // emitted for. Nothing about KD changed; only what it was allowed to see.
    const asymmetric = corridorRoster(
      CORNER.filter((entry) => entry.dsnm !== "US5OR2KD"),
    );

    const stranded = corner(asymmetric).filter(
      (verdict) => verdict.dsnm === "US5OR2KD",
    );
    expect(stranded.every((verdict) => verdict.emit)).toBe(true);

    const seen = corner(corridorRoster()).filter(
      (verdict) => verdict.dsnm === "US5OR2KD",
    );
    expect(seen.some((verdict) => verdict.emit)).toBe(false);
  });
});

describe("within one cell", () => {
  test("contiguous same-content groups elect one of their own", () => {
    // Groups are per LNAM and one cell holds several LNAMs of one area. No
    // neighbour anywhere: the two fragments are joined by THIS cell's own rows,
    // which is the half of the rule the roster could not carry before.
    const rows = [box(0, 0, 1, 1), box(1, 0, 2, 1)];
    const verdicts = cell({
      paths: [
        roster(
          rows.map((ring) => ({ content: SPOIL, dsnm: "US5OR2AA", ring })),
        ),
      ],
      dsnm: "US5OR2AA",
      // Registered out of order deliberately: the tie-break is the KEY, not the
      // order the generator happened to group them in.
      groups: [
        ["DMPGRD BB 8", [[box(1.1, 0.1, 1.9, 0.9)]]],
        ["DMPGRD AA 8", [[box(0.1, 0.1, 0.9, 0.9)]]],
      ],
    });

    expect(verdicts.get("DMPGRD AA 8").emit).toBe(true);
    expect(verdicts.get("DMPGRD BB 8").emit).toBe(false);
    // Both stand on one area, so both answer for the whole of it.
    expect(verdicts.get("DMPGRD BB 8").parts).toEqual(
      verdicts.get("DMPGRD AA 8").parts,
    );
    expect(verdicts.get("DMPGRD AA 8").area).toBeCloseTo(
      boxArea([0, 0, 1, 1]) + boxArea([1, 0, 2, 1]),
      12,
    );
  });

  test("the copy ladder's intervals do NOT stand each other down", () => {
    // The regression this rule exists for: one LNAM of a partitioned cell
    // arrives as one group per rung, ids differing only in the interval, and
    // a tie-break that kept ONE group per component kept the lowest rung
    // alone -- measured on US4OR1IF, whose band-4 anchors went 19 -> 0 at z12
    // while the polygons stayed. The copies draw at disjoint zooms, so every
    // one of them emits.
    const verdicts = cell({
      paths: [roster([{ content: SPOIL, dsnm: "US5OR2AA", ring: eastRow }])],
      dsnm: "US5OR2AA",
      groups: LADDER.map((interval) => [
        `DMPGRD AA ${interval}`,
        east,
        interval,
      ]),
    });

    expect([...verdicts.values()].map((verdict) => verdict.emit)).toEqual(
      LADDER.map(() => true),
    );
    // ...and each of them still answers for the whole area: they are one
    // feature at three ranges of zoom, not three features.
    for (const verdict of verdicts.values()) {
      expect(verdict.parts).toEqual([[eastRow]]);
    }
  });

  test("inside ONE interval the smallest key still emits for all of them", () => {
    // Both halves at once: two LNAMs of one area, each exported at two rungs.
    // The LNAMs compete, the rungs do not, so exactly one anchor survives per
    // rung and it is the smaller LNAM's.
    const rows = [box(0, 0, 1, 1), box(1, 0, 2, 1)];
    const parts = [[[box(0.1, 0.1, 0.9, 0.9)]], [[box(1.1, 0.1, 1.9, 0.9)]]];
    const verdicts = cell({
      paths: [
        roster(
          rows.map((ring) => ({ content: SPOIL, dsnm: "US5OR2AA", ring })),
        ),
      ],
      dsnm: "US5OR2AA",
      groups: LADDER.slice(0, 2).flatMap((interval) => [
        [`DMPGRD BB ${interval}`, parts[1], interval],
        [`DMPGRD AA ${interval}`, parts[0], interval],
      ]),
    });

    expect(
      [...verdicts]
        .filter(([, verdict]) => verdict.emit)
        .map(([key]) => key)
        .sort(),
    ).toEqual(
      LADDER.slice(0, 2)
        .map((interval) => `DMPGRD AA ${interval}`)
        .sort(),
    );
  });

  test("fragments of two SEPARATE areas keep an anchor each", () => {
    // The within-cell merge is contiguity, not content alone: two dumping
    // grounds that happen to state the same thing are two areas.
    const rows = [box(0, 0, 1, 1), box(10, 0, 11, 1)];
    const verdicts = cell({
      paths: [
        roster(
          rows.map((ring) => ({ content: SPOIL, dsnm: "US5OR2AA", ring })),
        ),
      ],
      dsnm: "US5OR2AA",
      groups: [
        ["DMPGRD AA 8", [[box(0.1, 0.1, 0.9, 0.9)]]],
        ["DMPGRD BB 8", [[box(10.1, 0.1, 10.9, 0.9)]]],
      ],
    });

    expect(verdicts.get("DMPGRD AA 8").emit).toBe(true);
    expect(verdicts.get("DMPGRD BB 8").emit).toBe(true);
  });
});

describe("the degraded path", () => {
  test("no rows of this cell's own: the old adjacency test decides", () => {
    // An older cache, or a cell whose build precedes its own first evidence.
    // There is nothing of this cell's in the roster for its clipped part to sit
    // inside, so the part is compared against the component directly -- exactly
    // what shipped before, asymmetry and all.
    const west = box(0, 0, 1, 1);
    const verdict = verdictOf({
      paths: [roster([{ content: SPOIL, dsnm: "US5OR2KC", ring: west }])],
      dsnm: "US5OR2AA",
    });

    expect(verdict.emit).toBe(true);
    expect(verdict.parts).toEqual([[west]]);
    // ...and the AREA is repaired locally: the component holds no polygon of
    // this cell's, so the group's own clipped part is added back rather than
    // the anchor measuring the neighbour's share alone.
    expect(verdict.area).toBeCloseTo(
      boxArea([0, 0, 1, 1]) + boxArea([1, 0, 2, 1]),
      12,
    );
  });

  test("a smaller-named neighbour still wins it", () => {
    const verdict = verdictOf({
      paths: [
        roster([{ content: SPOIL, dsnm: "US5OR2AA", ring: box(0, 0, 1, 1) }]),
      ],
      dsnm: "US5OR2KC",
    });

    expect(verdict.emit).toBe(false);
  });

  test("a part touching nothing at all keeps its own anchor", () => {
    const verdict = verdictOf({
      paths: [
        roster([{ content: SPOIL, dsnm: "US5OR2AA", ring: box(20, 0, 21, 1) }]),
      ],
      dsnm: "US5OR2KC",
    });

    expect(verdict).toEqual({ emit: true, area: 0, parts: [] });
  });
});
