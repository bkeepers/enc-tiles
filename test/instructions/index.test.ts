import { describe, expect, test } from 'vitest';
import { build, filter } from '../../src/symbolology';

test("symbology from lookups", () => {
  build();
  expect(true).toBe(true);
})

describe("filter", () => {
  test("presence of attributes", () => {
    const attc = [
      {
        "attl": "CAT_TS3",
        "attv": ""
      },
      {
        "attl": "ORIENT",
        "attv": ""
      }
    ]

    expect(filter(attc)).toEqual(["all", ["has", "CAT_TS3"], ["has", "ORIENT"]]);
  })
})
