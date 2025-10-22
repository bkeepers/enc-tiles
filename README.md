# enc-tiles

> Tools to produce vector tiles (mbtiles, pmtiles) from Electronic Navigational Charts (ENCs)

* [styles](./packages/styles/) - MapLibre styles for S-57 Nautical Charts using IHO's S-52 Presentation Library
* [s52](./packages/s52/) - The S-52 Presentation Library in JSON format
* [dai](./packages/dai/) - Parser for S-52 .dai file


# Contributing

```sh
$ git clone https://github.com/bkeepers/enc-tiles.git
$ cd enc-tiles
$ bin/setup
$ npm start
```

Open [http://localhost:5173](http://localhost:5173) in your browser to view the demo map with ENC tiles.

[Inspect tiles using pmtiles.io](https://pmtiles.io/#url=https%3A%2F%2Fpub-0b8220da652f4a95a2293d0f61351a33.r2.dev%2Fnoaa.pmtiles&map=3.05/39.23/-73.65&inspectFeatures=true).
