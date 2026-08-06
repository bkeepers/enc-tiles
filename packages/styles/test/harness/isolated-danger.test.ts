/**
 * Quadrant harness for UDWHAZ05 (isolated dangers).
 *
 * Runs the real MapLibre filters over synthetic WRECKS / OBSTRN / UWTROC
 * features across the full matrix of
 *
 *   shoal | deep  x  safe | unsafe | drying | unjoined water
 *                 x  shallowWaterDangers on | off
 *                 x  VALSOU present | absent | join value NULL
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
