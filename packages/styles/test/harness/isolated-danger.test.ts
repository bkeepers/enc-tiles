/**
 * Quadrant harness for UDWHAZ05 (isolated dangers).
 *
 * Runs the real MapLibre filters over synthetic WRECKS / OBSTRN / UWTROC
 * features across the full matrix of
 *
 *   shoal | deep  x  safe | unsafe | drying | unjoined water
 *                 x  shallowWaterDangers on | off
 *                 x  VALSOU present | absent | join value NULL
 *                 x  QUASOU trusted | flagged (2 / 7) | absent
 *
 * and asserts both the S-52 outcomes and the deliberate deviations documented
 * in CALLSYMPROC.ts.
 */
import { describe, expect, test } from "vitest";
import { SymbolType } from "../../src/symbolology/index.js";
import {
  buildStyle,
  icons,
  matchingLayers,
  mentions,
  type GeometryType,
  type Match,
} from "./evaluate.js";

const SAFETY_CONTOUR = 10;
const SAFETY_DEPTH = 10;

const options = {
  symbols: SymbolType.SIMPLIFIED,
  safetyContour: SAFETY_CONTOUR,
  safetyDepth: SAFETY_DEPTH,
  shallowContour: 2,
  deepContour: 30,
};

const withoutShallow = buildStyle(options);
const withShallow = buildStyle({ ...options, shallowWaterDangers: true });
/** `isolatedDangerMarks: false` — the whole procedure off, both families. */
const withoutMarks = buildStyle({
  ...options,
  shallowWaterDangers: true,
  isolatedDangerMarks: false,
});

const HAZARDS = ["WRECKS", "OBSTRN", "UWTROC"] as const;

/** Depth-area join columns pre-computed by bin/s57-to-tiles. */
const WATER = {
  safe: { _DEPARE_DRVAL1_MAX: 40, _DEPARE_DRVAL1_MINPOS: 40 },
  // Straddles a deep and a shoal area: MAX still qualifies as safe water.
  straddling: { _DEPARE_DRVAL1_MAX: 40, _DEPARE_DRVAL1_MINPOS: 3 },
  unsafe: { _DEPARE_DRVAL1_MAX: 5, _DEPARE_DRVAL1_MINPOS: 5 },
  drying: { _DEPARE_DRVAL1_MAX: -2 },
  unjoined: {},
  nullJoin: { _DEPARE_DRVAL1_MAX: null, _DEPARE_DRVAL1_MINPOS: null },
} as const;

/** Whether SNDFRM04 drew the hazard's sounding. */
function hasSounding(matches: Match[]): boolean {
  return matches.some((m) => m.text && mentions(m.textField, "VALSOU"));
}

function hits(
  style: ReturnType<typeof buildStyle>,
  hazard: string,
  properties: Record<string, unknown>,
  geometry: GeometryType = "Point",
): Match[] {
  return matchingLayers(style, hazard, properties, geometry);
}

describe("isolated dangers: safe water (display base)", () => {
  for (const hazard of HAZARDS) {
    test(`${hazard} shoal hazard in safe water gets ISODGR01 and no sounding`, () => {
      const feature = { VALSOU: 5, WATLEV: 3, ...WATER.safe };

      for (const style of [withoutShallow, withShallow]) {
        const matches = hits(style, hazard, feature);
        expect(icons(matches)).toContain("ISODGR01");
        expect(icons(matches)).not.toContain("DANGER01");
        expect(icons(matches)).not.toContain("DANGER02");
        expect(hasSounding(matches)).toBe(false);
      }
    });

    test(`${hazard} shoal hazard straddling a deep area is still safe-water`, () => {
      const matches = hits(withShallow, hazard, {
        VALSOU: 5,
        WATLEV: 3,
        ...WATER.straddling,
      });
      // Exactly one ISODGR01 — the safe-water and shallow-water families must
      // stay mutually exclusive even when MAX and MINPOS disagree.
      expect(icons(matches).filter((i) => i === "ISODGR01")).toHaveLength(1);
      expect(
        matches.find((m) => m.icon === "ISODGR01")!.metadata["s52:family"],
      ).toBeUndefined();
    });

    test(`${hazard} display-base isolated-danger layers ignore SCAMIN`, () => {
      const matches = hits(withoutShallow, hazard, {
        VALSOU: 5,
        WATLEV: 3,
        ...WATER.safe,
      });
      const isodgr = matches.find(
        (m) => m.icon === "ISODGR01" && !m.metadata["s52:family"],
      )!;
      expect(isodgr).toBeDefined();
      expect(mentions(isodgr.filter, "SCAMIN")).toBe(false);
      expect(mentions(isodgr.filter, "SCAMAX")).toBe(false);
    });

    test(`${hazard} above-water hazard (WATLEV 1) is not an isolated danger`, () => {
      const matches = hits(withShallow, hazard, {
        VALSOU: 5,
        WATLEV: 1,
        ...WATER.safe,
      });
      expect(icons(matches)).not.toContain("ISODGR01");
      expect(icons(matches).length).toBeGreaterThan(0);
    });
  }
});

describe("isolated dangers: fail-safe DEPTH_VALUE (no VALSOU)", () => {
  // The old implementation gated the whole test on ["has", "VALSOU"], which
  // exempted every unsounded hazard from UDWHAZ05.
  const cases: [string, Record<string, unknown>][] = [
    ["WRECKS", { WATLEV: 3 }], // DEPVAL02 → 0
    ["WRECKS", { WATLEV: 5 }], // DEPVAL02 → 0
    ["WRECKS", { CATWRK: 1 }], // DEPVAL02 → 20.1 (> safety contour)
    // WRECKS05 tests CATWRK before WATLEV, so this is 20.1 and not 0.
    ["WRECKS", { CATWRK: 1, WATLEV: 3 }], // DEPVAL02 → 20.1
    ["OBSTRN", { WATLEV: 3 }], // OBSTRN07 → 0.01
    ["OBSTRN", { CATOBS: 6 }], // OBSTRN07 → 0.01
    ["OBSTRN", { WATLEV: 5 }], // OBSTRN07 → 0
    ["UWTROC", { WATLEV: 3 }], // OBSTRN07 → 0.01
    ["UWTROC", {}], // OBSTRN07 → least depth unknown
  ];

  for (const [hazard, attrs] of cases) {
    const label = `${hazard} ${JSON.stringify(attrs)}`;
    test(`${label} in safe water evaluates UDWHAZ05`, () => {
      const matches = hits(withoutShallow, hazard, { ...attrs, ...WATER.safe });
      const isDanger = icons(matches).includes("ISODGR01");
      // 20.1 is deeper than the 10 m safety contour, so CATWRK 1 alone is not
      // a danger; every other stand-in depth is at or above it.
      const expected = !(hazard === "WRECKS" && attrs["CATWRK"] === 1);
      expect(isDanger).toBe(expected);
    });
  }
});

describe("QUASOU: a flagged sounding is not a least depth", () => {
  // DEVIATION, documented on `soundingTrusted` in CALLSYMPROC.ts: strict S-52
  // reads VALSOU without ever consulting QUASOU. QUASOU 2 ("depth unknown")
  // and 7 ("least depth unknown, safe clearance at value shown") are the
  // source saying the least depth was never established, so a nominal VALSOU
  // deeper than the safety contour used to compute a trusted "safe" depth and
  // skip UDWHAZ05 entirely. The flagged sounding is now dropped and the
  // feature takes the arms below it, ending at the DEPTH_UNKNOWN sentinel.

  /** Deeper than the 10 m safety contour: trusted, this is no danger at all. */
  const DEEP = { VALSOU: 20, WATLEV: 3 };

  /** Codings that leave the sounding trusted. */
  const trusted: [string, Record<string, unknown>][] = [
    ["absent", {}],
    ["1 (surveyed, MVT integer)", { QUASOU: 1 }],
    ['"1" (surveyed, string)', { QUASOU: "1" }],
    ['"1,6" (a list with neither flag)', { QUASOU: "1,6" }],
    // The comma wrapping in `listIncludes` is what keeps these off: a bare
    // ",2," must not match ",12," and ",7," must not match ",27,".
    ['"12,27" (no bare 2 or 7)', { QUASOU: "12,27" }],
  ];

  /** Codings that distrust it. */
  const flagged: [string, Record<string, unknown>][] = [
    ["2 (depth unknown, MVT integer)", { QUASOU: 2 }],
    ['"2" (depth unknown, string)', { QUASOU: "2" }],
    ["7 (least depth unknown)", { QUASOU: 7 }],
    ['"1,2" (a list containing 2)', { QUASOU: "1,2" }],
    ['"6,7,9" (a list containing 7)', { QUASOU: "6,7,9" }],
  ];

  for (const hazard of HAZARDS) {
    for (const [label, quasou] of trusted) {
      test(`${hazard} deep sounding, QUASOU ${label} → ordinary symbol in safe water`, () => {
        const matches = hits(withShallow, hazard, {
          ...DEEP,
          ...quasou,
          ...WATER.safe,
        });
        expect(icons(matches)).not.toContain("ISODGR01");
        expect(hasSounding(matches)).toBe(true);
      });
    }

    for (const [label, quasou] of flagged) {
      test(`${hazard} deep sounding, QUASOU ${label} → ISODGR01 in safe water`, () => {
        const matches = hits(withShallow, hazard, {
          ...DEEP,
          ...quasou,
          ...WATER.safe,
        });
        const isodgr = matches.find((m) => m.icon === "ISODGR01");
        expect(isodgr).toBeDefined();
        // Safe surrounding water, so this is the display-base family, not
        // Continuation A.
        expect(isodgr!.metadata["s52:family"]).toBeUndefined();
        expect(hasSounding(matches)).toBe(false);
      });
    }

    // The same two codings crossed with the surrounding water.
    test(`${hazard} flagged deep sounding in UNSAFE water is a shallow-water danger`, () => {
      const feature = { ...DEEP, QUASOU: 2, ...WATER.unsafe };
      // With the option off, S-52's ordinary path stays in force.
      expect(icons(hits(withoutShallow, hazard, feature))).not.toContain(
        "ISODGR01",
      );
      const isodgr = hits(withShallow, hazard, feature).find(
        (m) => m.icon === "ISODGR01",
      );
      expect(isodgr).toBeDefined();
      expect(isodgr!.metadata["s52:family"]).toBe("shallow-water-dangers");
    });

    test(`${hazard} trusted deep sounding in UNSAFE water is marked by neither family`, () => {
      const feature = { ...DEEP, QUASOU: 1, ...WATER.unsafe };
      for (const style of [withoutShallow, withShallow]) {
        const matches = hits(style, hazard, feature);
        expect(icons(matches)).not.toContain("ISODGR01");
        expect(hasSounding(matches)).toBe(true);
      }
    });
  }

  test("a flagged sounding with no categorical attributes reaches DEPTH_UNKNOWN", () => {
    // A rock has no CATOBS/CATWRK arm and this one has no WATLEV either, so
    // the ladder runs out at the -15 sentinel: shoal at every safety contour.
    for (const quasou of [2, 7]) {
      const matches = hits(withoutShallow, "UWTROC", {
        VALSOU: 20,
        QUASOU: quasou,
        ...WATER.safe,
      });
      expect(icons(matches)).toContain("ISODGR01");
    }
  });

  test("WRECKS falls through to DEPVAL02's own stand-ins, not straight to the sentinel", () => {
    // Dropping the sounding hands the feature to the arms below it, which are
    // still the ladder's: a non-dangerous wreck (CATWRK 1) scores 20.1 m,
    // exactly as an unsounded one does, and is not a danger.
    const matches = hits(withShallow, "WRECKS", {
      VALSOU: 20,
      QUASOU: 2,
      CATWRK: 1,
      ...WATER.safe,
    });
    expect(icons(matches)).not.toContain("ISODGR01");
  });

  test("QUASOU does not reach the ordinary shoal branches", () => {
    // Only DEPTH_VALUE consults it. A shoal sounding is DANGER01 either way,
    // and the flagged one is a danger for the reason it already was.
    for (const hazard of HAZARDS) {
      for (const quasou of [{}, { QUASOU: 1 }, { QUASOU: 2 }]) {
        const matches = hits(withoutShallow, hazard, {
          VALSOU: 5,
          WATLEV: 3,
          ...quasou,
          ...WATER.unsafe,
        });
        expect(icons(matches), JSON.stringify(quasou)).toContain("DANGER01");
      }
    }
  });

  test("no filter throws for any QUASOU encoding, and marks off is still off", () => {
    // MVT cannot carry a null property, but the guard must not throw on one
    // either -- a filter that throws takes its whole layer down.
    const encodings = [
      undefined,
      1,
      2,
      7,
      "1",
      "2",
      "7",
      "1,2",
      "12",
      "",
      null,
    ];
    for (const style of [withoutShallow, withShallow, withoutMarks]) {
      for (const hazard of HAZARDS) {
        for (const quasou of encodings) {
          for (const water of Object.values(WATER)) {
            const properties = {
              VALSOU: 20,
              WATLEV: 3,
              ...water,
              ...(quasou === undefined ? {} : { QUASOU: quasou }),
            };
            const matches = hits(style, hazard, properties);
            const label = `${hazard} ${JSON.stringify(properties)}`;
            expect(matches.length, label).toBeGreaterThan(0);
            if (style === withoutMarks) {
              expect(icons(matches), label).not.toContain("ISODGR01");
            }
          }
        }
      }
    }
  });
});

describe("DEPVAL02 ladder order: CATWRK 1 outranks WATLEV", () => {
  // The commonest coding of a deep, surveyed, non-dangerous wreck: "not
  // dangerous to surface navigation" (CATWRK 1), "always under water"
  // (WATLEV 3), no least-depth sounding. WRECKS05 reaches the CATWRK arm
  // first, so DEPTH_VALUE is 20.1 m -- deeper than any safety contour a user
  // can pick -- and the wreck keeps its ordinary symbol.
  //
  // With the arms the other way round the WATLEV 3 arm scored it 0 m, which
  // made every such wreck an isolated danger at EVERY safety setting, drawn
  // from the display-base, SCAMIN-immune ISODGR01 family.
  const feature = { CATWRK: 1, WATLEV: 3, ...WATER.safe };

  for (const contour of [10, 5]) {
    test(`safety contour ${contour} m: WRECKS symbol, not ISODGR01`, () => {
      const style = buildStyle({
        ...options,
        safetyContour: contour,
        safetyDepth: contour,
      });
      const matches = hits(style, "WRECKS", feature);
      expect(icons(matches)).not.toContain("ISODGR01");
      expect(
        icons(matches).some((i) => i === "WRECKS04" || i === "WRECKS05"),
      ).toBe(true);
    });
  }
});

describe("isolated dangers: shallow-water family", () => {
  for (const hazard of HAZARDS) {
    test(`${hazard} shoal hazard in unsafe water, option off → ordinary symbol + sounding`, () => {
      const matches = hits(withoutShallow, hazard, {
        VALSOU: 5,
        WATLEV: 3,
        ...WATER.unsafe,
      });
      expect(icons(matches)).not.toContain("ISODGR01");
      expect(icons(matches)).toContain("DANGER01");
      expect(hasSounding(matches)).toBe(true);
    });

    test(`${hazard} shoal hazard in unsafe water, option on → ISODGR01, no sounding`, () => {
      const matches = hits(withShallow, hazard, {
        VALSOU: 5,
        WATLEV: 3,
        ...WATER.unsafe,
      });
      const isodgr = matches.find((m) => m.icon === "ISODGR01");
      expect(isodgr).toBeDefined();
      expect(isodgr!.metadata["s52:family"]).toBe("shallow-water-dangers");
      expect(isodgr!.metadata["s52:disc"]).toBe("STANDARD");
      expect(icons(matches)).not.toContain("DANGER01");
      expect(hasSounding(matches)).toBe(false);
    });

    test(`${hazard} shoal hazard in a drying area is never a shallow-water danger`, () => {
      // Continuation A's `surroundingDepth >= 0` lower bound.
      const matches = hits(withShallow, hazard, {
        VALSOU: 5,
        WATLEV: 3,
        ...WATER.drying,
      });
      expect(icons(matches)).not.toContain("ISODGR01");
    });

    test(`${hazard} layer ids are identical with the option on and off`, () => {
      const ids = (style: ReturnType<typeof buildStyle>) =>
        style.layers
          .filter(
            (l) =>
              (l as { "source-layer"?: string })["source-layer"] === hazard,
          )
          .map((l) => l.id);
      expect(ids(withShallow)).toEqual(ids(withoutShallow));
    });
  }
});

describe("isolatedDangerMarks: false turns the whole procedure off", () => {
  // Not an S-52 option. The escape hatch for screenshots and presentations:
  // no magenta mark anywhere, every hazard on its ordinary branch.
  for (const hazard of HAZARDS) {
    test(`${hazard} shoal hazard in SAFE water draws its ordinary symbol, not ISODGR01`, () => {
      const feature = { VALSOU: 5, WATLEV: 3, ...WATER.safe };
      // The same feature is a display-base isolated danger with the option on.
      expect(icons(hits(withShallow, hazard, feature))).toContain("ISODGR01");

      const matches = hits(withoutMarks, hazard, feature);
      expect(icons(matches)).not.toContain("ISODGR01");
      expect(icons(matches)).toContain("DANGER01");
      expect(hasSounding(matches)).toBe(true);
    });

    test(`${hazard} shoal hazard in UNSAFE water is not marked either`, () => {
      const feature = { VALSOU: 5, WATLEV: 3, ...WATER.unsafe };
      // Continuation A would mark this one, since shallowWaterDangers is on.
      expect(icons(hits(withShallow, hazard, feature))).toContain("ISODGR01");

      const matches = hits(withoutMarks, hazard, feature);
      expect(icons(matches)).not.toContain("ISODGR01");
      expect(icons(matches)).toContain("DANGER01");
      expect(hasSounding(matches)).toBe(true);
    });

    test(`${hazard} layer ids are identical with the marks on and off`, () => {
      const ids = (style: ReturnType<typeof buildStyle>) =>
        style.layers
          .filter(
            (l) =>
              (l as { "source-layer"?: string })["source-layer"] === hazard,
          )
          .map((l) => l.id);
      expect(ids(withoutMarks)).toEqual(ids(withShallow));
    });
  }

  test("no ISODGR01 layer matches any feature of the full quadrant matrix", () => {
    const geometries: Record<string, GeometryType[]> = {
      WRECKS: ["Point", "Polygon"],
      OBSTRN: ["Point", "LineString", "Polygon"],
      UWTROC: ["Point"],
    };
    for (const hazard of HAZARDS) {
      for (const depth of [{ VALSOU: 5 }, { VALSOU: 20 }, { VALSOU: 0 }, {}]) {
        for (const water of Object.values(WATER)) {
          for (const watlev of [undefined, 1, 2, 3, 4, 5]) {
            for (const geometry of geometries[hazard]!) {
              const properties = {
                ...depth,
                ...water,
                ...(watlev === undefined ? {} : { WATLEV: watlev }),
              };
              const matches = hits(withoutMarks, hazard, properties, geometry);
              expect(
                icons(matches),
                `${hazard} ${geometry} ${JSON.stringify(properties)}`,
              ).not.toContain("ISODGR01");
              // And the feature still draws something.
              expect(matches.length).toBeGreaterThan(0);
            }
          }
        }
      }
    }
  });

  test("the option is opt-out: an undefined value keeps S-52 behaviour", () => {
    const explicit = buildStyle({ ...options, isolatedDangerMarks: true });
    const feature = { VALSOU: 5, WATLEV: 3, ...WATER.safe };
    for (const style of [withoutShallow, explicit]) {
      expect(icons(hits(style, "WRECKS", feature))).toContain("ISODGR01");
    }
    expect(JSON.stringify(explicit)).toEqual(JSON.stringify(withoutShallow));
  });
});

describe("isolated dangers: unjoined and NULL join values", () => {
  for (const hazard of HAZARDS) {
    for (const [name, water] of [
      ["unjoined", WATER.unjoined],
      ["NULL join", WATER.nullJoin],
    ] as const) {
      test(`${hazard} with a ${name} depth area still renders its ordinary symbol`, () => {
        const matches = hits(withShallow, hazard, {
          VALSOU: 5,
          WATLEV: 3,
          ...water,
        });
        // The coalesce guard: no filter throws (matchingLayers rethrows), the
        // hazard is not an isolated danger, and it is not invisible either.
        expect(icons(matches)).not.toContain("ISODGR01");
        expect(icons(matches)).toContain("DANGER01");
        expect(hasSounding(matches)).toBe(true);
      });
    }
  }
});

describe("deep hazards keep a plain symbol (deliberate deviation)", () => {
  const expected: Record<string, string> = {
    WRECKS: "WRECKS05",
    OBSTRN: "OBSTRN01",
    UWTROC: "UWTROC03",
  };

  for (const hazard of HAZARDS) {
    test(`${hazard} deeper than the safety depth draws its own symbol + sounding`, () => {
      for (const water of [WATER.safe, WATER.unsafe, WATER.unjoined]) {
        const matches = hits(withShallow, hazard, {
          VALSOU: 20,
          WATLEV: 3,
          ...water,
        });
        expect(icons(matches)).toContain(expected[hazard]);
        expect(icons(matches)).not.toContain("DANGER02");
        expect(icons(matches)).not.toContain("ISODGR01");
        expect(hasSounding(matches)).toBe(true);
      }
    });
  }

  test("DANGER02 is not referenced anywhere in the style", () => {
    const json = JSON.stringify(withShallow);
    expect(json).not.toContain("DANGER02");
  });
});

describe("draw order: the sounding is emitted after its icon", () => {
  // Array position IS draw order -- MapLibre paints layer n over layer n-1.
  // The UWTROC deep-hazard branch was appended to the end of the class block,
  // BELOW the SNDFRM04 entry, so every deep rock painted its own symbol over
  // the depth figure that says how deep it is. `matchingLayers` returns hits
  // in style order, so the index of the icon hit must precede the text hit.
  const style = buildStyle({
    ...options,
    safetyContour: 12,
    safetyDepth: 12,
  });

  const cases: [string, Record<string, unknown>, string][] = [
    // The case the fix is measured on: a rock deeper than the safety depth.
    ["UWTROC", { VALSOU: 20, WATLEV: 3, ...WATER.safe }, "UWTROC03"],
    ["UWTROC", { VALSOU: 20, WATLEV: 4, ...WATER.safe }, "UWTROC04"],
    // A shoal rock, whose icon branch already sat above the sounding.
    ["UWTROC", { VALSOU: 4, WATLEV: 4, ...WATER.unsafe }, "UWTROC04"],
    // OBSTRN, whose grouping the rock block now mirrors.
    ["OBSTRN", { VALSOU: 20, WATLEV: 3, ...WATER.safe }, "OBSTRN01"],
    ["OBSTRN", { VALSOU: 4, WATLEV: 3, ...WATER.unsafe }, "DANGER01"],
  ];

  for (const [hazard, feature, icon] of cases) {
    test(`${hazard} ${JSON.stringify(feature)} draws ${icon} below its sounding`, () => {
      const matches = hits(style, hazard, feature);
      const iconAt = matches.findIndex((m) => m.icon === icon);
      const soundingAt = matches.findIndex(
        (m) => m.text && mentions(m.textField, "VALSOU"),
      );
      expect(iconAt, `no ${icon} layer matched`).toBeGreaterThanOrEqual(0);
      expect(soundingAt, "no sounding layer matched").toBeGreaterThanOrEqual(0);
      expect(soundingAt).toBeGreaterThan(iconAt);
    });
  }

  test("every hazard icon of a sounded point precedes every sounding", () => {
    // Not just the one symbol: nothing that draws an icon may sit after the
    // sounding, or a second matching branch would cover it.
    for (const hazard of HAZARDS) {
      for (const valsou of [0, 4, 12, 20]) {
        for (const watlev of [undefined, 1, 2, 3, 4, 5]) {
          const feature = {
            VALSOU: valsou,
            ...(watlev === undefined ? {} : { WATLEV: watlev }),
            ...WATER.safe,
          };
          const matches = hits(style, hazard, feature);
          const lastIcon = matches.reduce(
            (last, m, index) => (m.icon ? index : last),
            -1,
          );
          const firstSounding = matches.findIndex(
            (m) => m.text && mentions(m.textField, "VALSOU"),
          );
          if (firstSounding < 0 || lastIcon < 0) continue;
          expect(
            firstSounding,
            `${hazard} ${JSON.stringify(feature)}`,
          ).toBeGreaterThan(lastIcon);
        }
      }
    }
  });
});

describe("unsounded obstructions: OBSTRN01, not the danger oval", () => {
  // 2,389 of Puget Sound's 2,455 snag/stump points carry no VALSOU. They were
  // drawing DANGER01 -- the big filled oval, which asserts a hazard whose
  // least depth is KNOWN and is at or above the safety depth. The S-101
  // OBSTRN07 lua the fork ships (packages/s52/data/.../Rules/OBSTRN07.lua)
  // defaults that arm to OBSTRN01, the small circle Coastal Explorer draws.
  const cases: [Record<string, unknown>, string][] = [
    [{}, "OBSTRN01"], // a snag/stump with nothing but its position
    [{ CATOBS: 5 }, "OBSTRN01"], // CATOBS 5 = wellhead; any non-6 category
    [{ CATOBS: 6 }, "OBSTRN01"], // foul area
    [{ WATLEV: 1 }, "OBSTRN11"], // dry
    [{ WATLEV: 2 }, "OBSTRN11"], // partly submerged
    [{ WATLEV: 3 }, "OBSTRN01"], // always under water
    [{ WATLEV: 4 }, "OBSTRN03"], // covers and uncovers
    [{ WATLEV: 5 }, "OBSTRN03"], // awash
  ];

  for (const [attrs, expected] of cases) {
    test(`OBSTRN ${JSON.stringify(attrs)} → ${expected}`, () => {
      const matches = hits(withoutShallow, "OBSTRN", {
        ...attrs,
        ...WATER.unjoined,
      });
      expect(icons(matches)).toEqual([expected]);
    });
  }

  test("no unsounded obstruction draws DANGER01 or a rock symbol", () => {
    for (const catobs of [undefined, 1, 5, 6, 10]) {
      for (const watlev of [undefined, 1, 2, 3, 4, 5]) {
        for (const water of Object.values(WATER)) {
          const properties = {
            ...(catobs === undefined ? {} : { CATOBS: catobs }),
            ...(watlev === undefined ? {} : { WATLEV: watlev }),
            ...water,
          };
          const drawn = icons(hits(withShallow, "OBSTRN", properties));
          const label = JSON.stringify(properties);
          expect(drawn, label).not.toContain("DANGER01");
          expect(drawn, label).not.toContain("UWTROC03");
          expect(drawn, label).not.toContain("UWTROC04");
        }
      }
    }
  });

  test("rocks keep their own symbols", () => {
    // The OBSTRN change must not reach UWTROC: a rock with no VALSOU is still
    // UWTROC03/UWTROC04, which is what S-52 and the lua both say.
    expect(
      icons(hits(withoutShallow, "UWTROC", { WATLEV: 3, ...WATER.unjoined })),
    ).toEqual(["UWTROC03"]);
    expect(
      icons(hits(withoutShallow, "UWTROC", { WATLEV: 4, ...WATER.unjoined })),
    ).toEqual(["UWTROC04"]);
  });
});

describe("drying heights on awash rocks (deliberate deviation)", () => {
  test("WATLEV 4 rock keeps UWTROC04 and its sounding", () => {
    const matches = hits(withoutShallow, "UWTROC", {
      VALSOU: 0.5,
      WATLEV: 4,
      ...WATER.unsafe,
    });
    expect(icons(matches)).toContain("UWTROC04");
    expect(hasSounding(matches)).toBe(true);
  });

  test("WATLEV 5 rock keeps the S-52 sounding suppression", () => {
    const matches = hits(withoutShallow, "UWTROC", {
      VALSOU: 0,
      WATLEV: 5,
      ...WATER.unsafe,
    });
    expect(icons(matches)).toContain("UWTROC04");
    expect(hasSounding(matches)).toBe(false);
  });
});

describe("no filter throws across the full quadrant matrix", () => {
  // MVT cannot carry a null-valued property -- an absent sounding is an absent
  // key -- so those are the only two encodings the tiler can produce. (The
  // depth-area join columns are swept with an explicit null anyway, because
  // that is the shape the measured blackout came in.)
  const depths: Record<string, unknown>[] = [
    { VALSOU: 5 },
    { VALSOU: 20 },
    { VALSOU: 0 },
    {},
  ];
  const watlevs = [undefined, 1, 2, 3, 4, 5];
  // The geometries each class actually has look-up entries for.
  const geometries: Record<string, GeometryType[]> = {
    WRECKS: ["Point", "Polygon"],
    OBSTRN: ["Point", "LineString", "Polygon"],
    UWTROC: ["Point"],
  };

  test("every combination evaluates and draws something", () => {
    for (const style of [withoutShallow, withShallow]) {
      for (const hazard of HAZARDS) {
        for (const depth of depths) {
          for (const water of Object.values(WATER)) {
            for (const watlev of watlevs) {
              for (const geometry of geometries[hazard]!) {
                const properties = {
                  ...depth,
                  ...water,
                  ...(watlev === undefined ? {} : { WATLEV: watlev }),
                };
                const matches = hits(style, hazard, properties, geometry);
                expect(
                  matches.length,
                  `${hazard} ${geometry} ${JSON.stringify(properties)}`,
                ).toBeGreaterThan(0);
              }
            }
          }
        }
      }
    }
  });
});
