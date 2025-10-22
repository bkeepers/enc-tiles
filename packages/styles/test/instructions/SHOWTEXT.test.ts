import { describe, expect, test } from "vitest";
import { instructionsToStyles } from "../../src/instructions/index.js";
import { formatAttribute } from "../../src/instructions/SHOWTEXT.js";
import { SymbolLayerSpecification } from "maplibre-gl";

describe("TX", () => {
  test("TX('Hello World')", () => {
    const styles = instructionsToStyles("TX('Hello World')");
    expect(styles).toHaveLength(1);
    const style = styles[0] as SymbolLayerSpecification;
    expect(style.type).toBe("symbol");
    expect(style.layout!["text-field"]).toBe("Hello World");
    expect(style.layout?.["text-offset"]).toEqual([0, 0]);
  });

  test("TX(OBJNAM,1,2,3,'15110',0,0,CHBLK,26)", () => {
    const style = instructionsToStyles(
      `TX(OBJNAM,1,2,3,'15110',0,0,CHBLK,26)`,
    )[0] as SymbolLayerSpecification;
    expect(style.layout?.["text-field"]).toEqual(["get", "OBJNAM"]);
    expect(style.layout?.["text-anchor"]).toEqual("center");
    expect(style.layout?.["text-max-width"]).toEqual(8);
    expect(style.layout?.["text-font"]?.[0]).toMatch(/Regular/);
    expect(style.layout?.["text-size"]).toEqual(10);
    expect(style.layout?.["text-offset"]).toEqual([0, 0]);
    expect(style.paint?.["text-color"]).toEqual("#000000");
  });

  describe("text-size", () => {
    [
      ["1518", 8],
      ["15110", 10],
      ["15112", 12],
      ["15114", 14],
    ].forEach(([chars, expected]) => {
      test(`CHARS=${chars} => ${expected}`, () => {
        const style = instructionsToStyles(
          `TX('Hello',1,1,1,'${chars}')`,
        )[0] as SymbolLayerSpecification;
        expect(style.layout?.["text-size"]).toEqual(expected);
      });
    });
  });

  describe("text-anchor", () => {
    [
      [1, 1, "bottom"],
      [1, 2, "center"],
      [1, 3, "top"],
      [2, 1, "bottom-right"],
      [2, 2, "right"],
      [2, 3, "top-right"],
      [3, 1, "bottom-left"],
      [3, 2, "left"],
      [3, 3, "top-left"],
    ].forEach(([hjust, vjust, expected]) => {
      test(`HJUST=${hjust} VJUST=${vjust} => ${expected}`, () => {
        const style = instructionsToStyles(
          `TX('Hello',${hjust},${vjust})`,
        )[0] as SymbolLayerSpecification;
        expect(style.layout?.["text-anchor"]).toEqual(expected);
      });
    });
  });
});

describe("TE", () => {
  test(`TE('Nr %s','OBJNAM',3,1,2,'15110',1,0,CHBLK,29)`, () => {
    const style = instructionsToStyles(
      `TE('Nr %s','OBJNAM',3,1,2,'15110',1,0,CHBLK,29)`,
    )[0] as SymbolLayerSpecification;
    expect(style.layout?.["text-field"]).toEqual([
      "format",
      "Nr ",
      ["get", "OBJNAM"],
    ]);
  });

  test(`TE('%03.0lf deg','ORIENT',1,1,2,'15110',0,-1,CHBLK,11)`, () => {
    const style = instructionsToStyles(
      `TE('%03.0lf deg','ORIENT',1,1,2,'15110',0,-1,CHBLK,11)`,
    )[0] as SymbolLayerSpecification;
    expect(style.layout?.["text-field"]).toEqual([
      "format",
      [
        "number-format",
        ["get", "ORIENT"],
        { "min-fraction-digits": 0, "max-fraction-digits": 0 },
      ],
      " deg",
    ]);
  });
});

describe("formatToExpression", () => {
  const examples: [string, string, any][] = [
    ["%s", "OBJNAM", ["get", "OBJNAM"]],
    [
      "Hello %s World",
      "OBJNAM",
      ["format", "Hello ", ["get", "OBJNAM"], " World"],
    ],
    [
      "clr cl %4.1lf",
      "VRTCLR",
      [
        "format",
        "clr cl ",
        [
          "number-format",
          ["get", "VRTCLR"],
          { "min-fraction-digits": 1, "max-fraction-digits": 1 },
        ],
      ],
    ],
    [
      "%03.0lf deg",
      "ORIENT",
      [
        "format",
        [
          "number-format",
          ["get", "ORIENT"],
          { "min-fraction-digits": 0, "max-fraction-digits": 0 },
        ],
        " deg",
      ],
    ],
    // examples: TE('clr cl %4.1lf', 'VERCCL', ...)(multiple nearby lines ~430–480)
    // example: TE('swept to %5.1lf', 'DRVAL1', ...)(line ~194)
    // example: TE('%4.1lf kn', 'CURVEL', ...)(lines ~203–205)
  ];

  examples.forEach(([format, field, expected]) => {
    test(`'${format}', '${field}' => ${JSON.stringify(expected)}`, () => {
      const actual = formatAttribute(format, field);
      expect(actual).toEqual(expected);
    });
  });
});
