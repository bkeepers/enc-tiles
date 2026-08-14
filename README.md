# enc-tiles

> Tools to produce vector tiles (mbtiles, pmtiles) from Electronic Navigational Charts (ENCs)

- [styles](./packages/styles/) - MapLibre styles for S-57 Nautical Charts using IHO's S-52 Presentation Library
- [s52](./packages/s52/) - The S-52 Presentation Library in JSON format
- [dai](./packages/dai/) - Parser for S-52 .dai file

# Contributing

Requires Node 20, 22, or 24 — `tileserver-gl`'s native dependencies have no prebuilt binaries for newer releases. [.nvmrc](./.nvmrc) pins the version this project is developed against.

```sh
$ git clone https://github.com/bkeepers/enc-tiles.git
$ cd enc-tiles
$ nvm install && nvm use
$ bin/setup
$ npm start
```

Open [http://localhost:5173](http://localhost:5173) in your browser to view the demo map with ENC tiles.

The tileset is published as one archive per S-57 usage band, each declaring
its own zoom range — `noaa-overview` (z0–6), `noaa-general` (7–8),
`noaa-coastal` (9–10), `noaa-approach` (11–12), `noaa-harbour` (13–14) and
`noaa-berthing` (15–16). The viewer needs all six; a band is a scale, not a
level of detail, so no one archive covers the whole zoom range on its own.

Inspect one on pmtiles.io — here
[`noaa-coastal`](https://pmtiles.io/#url=https%3A%2F%2Fpub-0b8220da652f4a95a2293d0f61351a33.r2.dev%2Fnoaa-coastal.pmtiles&map=9/40.60/-74.00&inspectFeatures=true),
at a zoom that band covers; swap the band name in the URL for the others.

## Prior Art

- https://github.com/LarsSchy/SMAC-M
- https://github.com/manimaul/njord

## License

This project is licensed under the [Apache License 2.0](./LICENSE).
