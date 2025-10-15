import type { DaiFile } from "@enc-tiles/dai";
import json from "../data.json" with { type: "json" };

const data = json as DaiFile;

export const lbid = data.lbid;
export const colours = data.colours;
export const lookups = data.lookups;
export const patterns = data.patterns;
export const symbols = data.symbols;
export const linestyles = data.linestyles;
