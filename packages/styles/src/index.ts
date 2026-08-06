import type {
  StyleSpecification,
  VectorSourceSpecification,
} from "maplibre-gl";
import { build, type LayerConfig } from "./symbolology/index.js";
export { BoundaryType, SymbolType } from "./symbolology/index.js";
export type {
  DisplayCategory,
  LayerConfig,
  LayerFamily,
  TextGroup,
} from "./symbolology/index.js";

export interface StyleOptions extends Partial<Omit<LayerConfig, "source">> {
  source: VectorSourceSpecification;
  name?: string;
  sprite?: string;
}

// S-52 PresLib 4.0, SEABED01 (section 13.2.15) and SNDFRM04 (section 13.2.16)
const defaults: Omit<LayerConfig, "mode"> = {
  source: "enc",
  shallowContour: 2.0,
  safetyContour: 30.0,
  deepContour: 30.0,
  safetyDepth: 30.0,
};

export default function ({
  source,
  name = "S52 Style",
  mode = "DAY",
  sprite,
  ...options
}: StyleOptions): StyleSpecification {
  const config: LayerConfig = { ...defaults, mode, ...options };
  const layers = build(config);

  return {
    version: 8,
    name,
    sprite: [...(sprite ? [sprite] : []), mode.toLowerCase()].join("/"),
    glyphs: "http://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
    sources: {
      [config.source]: {
        promoteId: "LNAM",
        ...source,
      },
    },
    layers,
  };
}
