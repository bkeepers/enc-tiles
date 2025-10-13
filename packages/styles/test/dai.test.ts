import { test, expect } from 'vitest';
import { readFileSync } from "fs";
import { parse } from "../src/dai.js";

const daiPath = new URL(
  '../docs/Draft_S-52_PresLib_e4.0.0_Digital_Files/Digital_PresLib_dai/PresLib_e4.0.0.dai',
  import.meta.url
)
const text = readFileSync(daiPath, 'utf8');

test('parse S52 DAI file', async () => {
  const { colours, lookups } = parse(text);

  expect(colours.length).toBe(3); // DAY, DUSK, NIGHT
  const day = colours[0];
  const nodata = day.entries[0];
  expect(nodata).toEqual({ ctok: "NODTA", chrx: 0.28, chry: 0.31, clum: 40, cuse: "grey" });
});
