import { parse } from "./parser.js";
import { CS } from "./CALLSYMPROC.js";
import { AC, AP } from "./SHOWAREA.js";
import { LC, LS } from "./SHOWLINE.js";
import { SY } from "./SHOWPOINT.js";
import { TX, TE } from "./SHOWTEXT.js";
import type { LayerSpecification } from "maplibre-gl";

export * from "./parser.js"
export * from "./CALLSYMPROC.js"
export * from "./SHOWAREA.js"
export * from "./SHOWLINE.js"
export * from "./SHOWPOINT.js"
export * from "./SHOWTEXT.js"

const commands = { AC, AP, CS, LC, LS, SY, TE, TX };

export function instructionsToStyles(instruction: string | undefined): LayerSpecification[] {
  if (typeof instruction !== 'string') return [];

  return parse(instruction).flatMap(instruction => {
    const command = commands[instruction.command];

    if (!command) {
      throw new Error(`Unknown command: ${instruction.command}`);
    }

    return command(...instruction.params);
  }).filter(Boolean);
}
