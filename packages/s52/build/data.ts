import { parse } from "@enc-tiles/dai";
import { readFileSync, writeFileSync } from "fs";

/** Always rebuild data.json from presentation library */
export default {
  name: "build-data",
  buildStart() {
    console.log("Building data.json from data/PresLib_e4.0.0.dai");
    const text = readFileSync("data/PresLib_e4.0.0.dai", "utf8");
    const data = parse(text);
    const json = JSON.stringify(data, null, 2);
    writeFileSync("data.json", json);
  },
};
