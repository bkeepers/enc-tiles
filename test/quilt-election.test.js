/**
 * Unit runs of bin/quilt-election.mjs, the cross-cell anchor election.
 *
 * Its verdict is exercised end to end by the two anchor generators' fixture
 * runs (test/generate-restriction-anchors.test.js and
 * test/generate-area-anchors.test.js, "the cross-cell election"), so what is
 * asked here directly is the half of the answer that is not readable off an
 * emitted anchor: the COMPONENT POLYGONS the elected cell places its anchor
 * over, which are the neighbours' parts of one physical area.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { anchorElection } from "../bin/quilt-election.mjs";

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
 * The OTHER cells' semantic roster on disk, exactly as bin/extract-coverage
 * caches it and bin/s57-to-tiles exports it back out: one polygon per area,
 * carrying the producing chart, its rung and the canonical CONTENT identity.
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
 * This cell's own half of one dumping ground, east of the shared border, in the
 * shape `verdict` takes its parts: one entry per polygon, each an array of
 * rings.
 */
const east = [[box(1, 0, 2, 1)]];

describe("the component polygons a verdict hands back", () => {
  test("the joined component's polygons come back with the verdict", () => {
    // The elected cell's own share can be a corner offcut a few metres across.
    // Placing the anchor over the whole physical area is only possible if the
    // rest of the area comes back with the verdict, so it does.
    const west = box(0, 0, 1, 1);
    const election = anchorElection({
      paths: [roster([{ content: SPOIL, dsnm: "US5OR2KC", ring: west }])],
      dsnm: "US5OR2AA",
      cellFloor: 8,
    });

    const verdict = election.verdict("DMPGRD", SPOIL, east);

    expect(verdict.emit).toBe(true);
    expect(verdict.parts).toEqual([[west]]);
  });

  test("every part of a bridged component, not just the touching one", () => {
    // This cell touches only US5OR2KC, but US5OR2KC touches US4OR1AA: all three
    // parts are one area, and all of the ones this cell does not own are
    // placement candidates for it.
    const middle = box(0, 0, 1, 1);
    const far = box(-1, 0, 0, 1);
    const election = anchorElection({
      paths: [
        roster([
          { content: SPOIL, dsnm: "US5OR2KC", ring: middle },
          { content: SPOIL, dsnm: "US4OR1AA", ring: far },
        ]),
      ],
      dsnm: "US5OR2AA",
      cellFloor: 8,
    });

    const verdict = election.verdict("DMPGRD", SPOIL, east);

    expect(verdict.parts).toHaveLength(2);
    expect(verdict.parts).toContainEqual([middle]);
    expect(verdict.parts).toContainEqual([far]);
  });

  test("a component this cell does not join contributes nothing", () => {
    // Nowhere near this cell's parts: not its area, so neither its polygons nor
    // its area join the verdict.
    const election = anchorElection({
      paths: [
        roster([{ content: SPOIL, dsnm: "US5OR2KC", ring: box(20, 0, 21, 1) }]),
      ],
      dsnm: "US5OR2AA",
      cellFloor: 8,
    });

    const verdict = election.verdict("DMPGRD", SPOIL, east);

    expect(verdict.emit).toBe(true);
    expect(verdict.area).toBe(0);
    expect(verdict.parts).toEqual([]);
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
    const election = anchorElection({ paths, dsnm: "US5OR2AA", cellFloor: 8 });

    const verdict = election.verdict("DMPGRD", SPOIL, east);

    expect(verdict.parts).toEqual([]);
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

      expect(election.active).toBe(false);
      expect(election.verdict("DMPGRD", SPOIL, east)).toEqual({
        emit: true,
        area: 0,
        parts: [],
      });
    }
  });
});
