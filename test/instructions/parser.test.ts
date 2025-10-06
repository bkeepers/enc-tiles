import { describe, test, expect } from 'vitest';
import { parse, Reference } from '../../src/instructions/index.js';

describe('S52 Symbology Command Parser', () => {
  const examples = {
    "SY(ACHARE51)": [
      {
        command: "SY",
        params: [new Reference("ACHARE51")]
      }
    ],
    "SY(TSSLPT51,ORIENT)": [
      {
        command: "SY",
        params: [new Reference("TSSLPT51"), new Reference("ORIENT")]
      }
    ],
    "TX(OBJNAM,1,2,3,'15110',0,0,CHBLK,26)": [
      {
        command: "TX",
        params: [new Reference("OBJNAM"), 1, 2, 3, "15110", 0, 0, new Reference("CHBLK"), 26]
      }
    ]
  }

  for (const example of Object.keys(examples)) {
    test(example, () => {
      const result = parse(example);
      expect(result).toEqual(examples[example]);
    });
  }

  test("Reference equality", () => {
    expect(new Reference("ACHARE51")).toEqual(new Reference("ACHARE51"));
  })
});
