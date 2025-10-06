# S-52 Presentation Library for MapLibre

> MapLibre styles from S-57 Nautical Charts

This library implements [IHO's S-52 Presentation Library specification](./docs/S-52_PresLib_e4.0.0_Part%20I_Clean_Draft.pdf) for rendering S-57 ENCs with [MapLibre](https://maplibre.org/).

## Command Line Usage

```sh
$ npx s52 --url http://example.com/my/charts.mbtiles > styles.json
```

## Design

As part of the S-52 standard, the [IHO ECDIS Presentation Library](./docs/S-52_PresLib_e4.0.0_Part%20I_Clean_Draft.pdf) (PresLib) is a set of colors, symbols, and rules for rendering S-57 .

The goal of this library is to create electronic navigational charts (ENCs) that conform to the IHO standards with minimal custom or hand-coded logic. It parses the [PresLib*.dai](docs/Draft_S-52_PresLib_e4.0.0_Digital_Files/Digital_PresLib_dai/PresLib_e4.0.0.dai) file that is included in the standard, [converts it to JSON](./data/PresLib_e4.0.0.json) for easier consumption, and then generates MapLibre styles by reading the rules and colors defined in the PresLib.
