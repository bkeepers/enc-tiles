# @enc-tiles/styles

> MapLibre styles for S-57 Nautical Charts using IHO's S-52 Presentation Library

This library implements [IHO's S-52 Presentation Library specification](./docs/S-52_PresLib_e4.0.0_Part%20I_Clean_Draft.pdf) for rendering S-57 ENCs with [MapLibre](https://maplibre.org/).

## Command Line Usage

```sh
$ npx s52 --url http://example.com/my/charts.mbtiles > styles.json
```

## Design

As part of the S-52 standard, the [IHO ECDIS Presentation Library](./docs/S-52_PresLib_e4.0.0_Part%20I_Clean_Draft.pdf) (PresLib) defines a set of colors, symbols, and rules for rendering electronic navigational charts (ENCs) in the S-57 format. The goal of this library is to create ENCs that conform to the IHO standards with minimal custom or hand-coded logic. It parses the [PresLib\*.dai](../s52/data/PresLib_e4.0.0.dai) file that is included in the standard, [converts it to JSON](./data/PresLib_e4.0.0.json) for easier consumption, and then generates MapLibre styles by reading the rules and colors defined in the PresLib.

## Contributing

```sh
$ git clone https://github.com/bkeepers/s52.git && cd s52
$ npm install
$ npm test
```

Running the demo

```sh
$ demo/build
$ npm run demo
```

Visit http://localhost:8080
