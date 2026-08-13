import { Mode } from "@enc-tiles/s52";
import type {
  StyleSpecification,
  VectorSourceSpecification,
} from "maplibre-gl";
import { build, LayerConfig } from "./symbolology/index.js";
import { BANDS, type BandName } from "./bands.js";

export * from "./bands.js";

export interface StyleOptions {
  /** A single tileset holding every usage band. */
  source?: VectorSourceSpecification;
  /**
   * One tileset per usage band. Each declares its own maxzoom, which is what
   * lets MapLibre overzoom a band rather than render nothing above it.
   */
  sources?: Partial<Record<BandName, VectorSourceSpecification>>;
  name?: string;
  mode?: Mode;
  sprite?: string;
}

export default function ({
  source,
  sources,
  name = "S52 Style",
  mode = "DAY",
  sprite,
}: StyleOptions): StyleSpecification {
  if (Boolean(source) === Boolean(sources)) {
    throw new Error("Provide exactly one of `source` or `sources`");
  }

  // Band order is smallest scale first, which is also the stacking order.
  const specs: [string, VectorSourceSpecification][] = source
    ? [["enc", source]]
    : BANDS.flatMap((band) => {
        const spec = sources![band.name];
        return spec
          ? [[band.name, spec] as [string, VectorSourceSpecification]]
          : [];
      });

  const config: LayerConfig = {
    mode,
    sources: specs.map(([id]) => id),
    shallowDepth: 3.0, // meters (9.8 feet)
    safetyDepth: 6.0, // meters (19.6 feet)
    deepDepth: 9.0, // meters (29.5 feet)
  };

  return {
    version: 8,
    name,
    sprite: [...(sprite ? [sprite] : []), mode.toLowerCase()].join("/"),
    glyphs: "http://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
    sources: Object.fromEntries(
      specs.map(([id, spec]) => [id, { promoteId: "LNAM", ...spec }]),
    ),
    layers: build(config),
  };
}
