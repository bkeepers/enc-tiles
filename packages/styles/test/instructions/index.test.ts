import { describe, expect, test } from 'vitest';
import { build, filter } from '../../src/symbolology';
import theme from '../../src/themes/index.js';
import { LayerConfig } from '../../dist/symbolology';

const config: LayerConfig = {
  colors: theme.DAY!,
  source: "enc",
  shallowDepth: 3.0, // meters (9.8 feet)
  safetyDepth: 6.0, // meters (19.6 feet)
  deepDepth: 9.0, // meters (29.5 feet)
}

test("symbology from lookups", () => {
  build(config);
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
