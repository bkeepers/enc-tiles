export type Param = string | number | Reference;
export type Instruction = {
  command: string;
  params: Param[];
};

export class Reference {
  name: string;

  constructor(name: string) {
    this.name = name;
  }

  toString() {
    return this.name;
  }

  toJSON() {
    return this.name;
  }
}

// TODO: replace with real parser?
export function parse(input: string): Instruction[] {
  return input
    .split(";")
    .filter((i) => i.trim() !== "")
    .map((instruction) => {
      const match = instruction.trim().match(/^([A-Z]{2})\((.*?)\)?$/);
      if (!match || !match[1] || !match[2]) {
        throw new Error(
          `Invalid command format: ${JSON.stringify(instruction)}`,
        );
      }
      const [, cmd, params] = match;
      const paramList = params
        ?.split(",")
        .map((p) => p.trim())
        .map((param) => {
          return parseParam(param);
        });

      return {
        command: cmd,
        params: paramList,
      };
    });
}

function parseParam(value: string): Param {
  // String literal
  if (/^'.*'$/.test(value)) {
    return value.slice(1, -1);
  }

  // Numeric literal
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return parseFloat(value);
  }

  return new Reference(value);
}
