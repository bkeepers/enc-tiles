import theme, { Mode } from './themes/index.js';
import type { StyleSpecification, VectorSourceSpecification } from 'maplibre-gl';
import { build, LayerConfig } from './symbolology/index.js';

export interface StyleOptions {
  source: VectorSourceSpecification
  name?: string
  mode?: Mode
}

export default function ({
  source,
  name = "S52 Style",
  mode = Mode.DAY
}: StyleOptions): StyleSpecification {
  const colors = theme[mode]!;

  const config: LayerConfig = {
    colors,
    source: "enc",
    shallowDepth: 3.0, // meters (9.8 feet)
    safetyDepth: 6.0, // meters (19.6 feet)
    deepDepth: 9.0, // meters (29.5 feet)
  };

  const layers = build(config);

  return {
    version: 8,
    name,
    sprite: "day_simplified",
    glyphs: "http://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
    sources: {
      [config.source]: source
    },
    layers
  }
}
