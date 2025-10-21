import data from '../colours.json' assert { type: "json" };

export type Mode = "DAY" | "DUSK" | "NIGHT";
export type ColourName = keyof typeof data.DAY;
export type Colours = Record<Mode, Record<ColourName, string>>;

export const colours = data as Colours;
