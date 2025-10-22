import data from "../data.json" with { type: "json" };
import type { DaiFile } from "@enc-tiles/dai";

export default data as DaiFile;
export * from "./symbols.js";
export * from "./colours.js";
