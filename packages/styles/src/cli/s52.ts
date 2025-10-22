import { parseArgs } from "node:util";
import s52style from "../index.js";
import { createWriteStream } from "node:fs";

const { values } = parseArgs({
  options: {
    url: {
      type: "string",
      short: "s",
    },
    output: {
      type: "string",
      short: "o",
      default: "-",
    },
  },
});

if (!values.url) {
  console.error("Error: --url is required");
  process.exit(1);
}

const style = s52style({
  source: {
    type: "vector",
    url: values.url,
  },
});

const output =
  values.output === "-" ? process.stdout : createWriteStream(values.output);
output.write(JSON.stringify(style, null, 2));
