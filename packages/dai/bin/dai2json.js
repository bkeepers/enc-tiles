#!/usr/bin/env node

import { readFileSync, writeFileSync } from "fs";
import { parse } from "../dist/index.js";
import { join } from "path";

const infile = process.argv[2];
const outfile = process.argv[3] ?? "-";

if (!infile) {
  console.error("Usage: dia2json <infile.dai> [<outfile.json>]");
  process.exit(1);
}

const text = readFileSync(join(process.cwd(), infile), "utf8");
const preslib = parse(text);

const json = JSON.stringify(preslib, null, 2);
if (outfile === "-") {
  process.stdout.write(json);
} else {
  console.log("Writing to", outfile);
  writeFileSync(join(process.cwd(), outfile), JSON.stringify(preslib, null, 2));
}
