import { closeSync, openSync, readSync } from "node:fs";

const HEADER_BYTES = 127;
const MAGIC = "PMTiles";
const MINZOOM_OFFSET = 100;
const MAXZOOM_OFFSET = 101;

/**
 * Read the zoom range from a PMTiles v3 header without parsing the directories.
 * @see https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
 */
export function readPmtilesHeader(path) {
  const buffer = Buffer.alloc(HEADER_BYTES);
  const fd = openSync(path, "r");
  let read;

  try {
    read = readSync(fd, buffer, 0, HEADER_BYTES, 0);
  } finally {
    closeSync(fd);
  }

  if (read < HEADER_BYTES) {
    throw new Error(`${path}: too short to be a PMTiles archive`);
  }

  if (buffer.toString("ascii", 0, MAGIC.length) !== MAGIC) {
    throw new Error(`${path}: not a PMTiles archive`);
  }

  return {
    minzoom: buffer.readUInt8(MINZOOM_OFFSET),
    maxzoom: buffer.readUInt8(MAXZOOM_OFFSET),
  };
}
