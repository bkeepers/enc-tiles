# @enc-tiles/s52

The S-52 Presentation Library in JSON format

## Installation

```sh
npm install @enc-tiles/s52
# or
yarn add @enc-tiles/s52
# or
pnpm add @enc-tiles/s52
```

## Usage

The package exports the S-52 Presentation Library in two different formats:

1. A JavaScript ESM module that can be bundled into any application:

   ```js
   import s52 from "@enc-tiles/s52";
   console.dir(s52);
   ```

2. As a JSON file:

   ```js
   // If your environment supports importing JSON
   import s52 from "@enc-tiles/s52/data.json" with { type: "json" };

   // Or in Node.js, you can read the file directly
   import { readFileSync } from "node:fs";
   const s52 = JSON.parse(
     readFileSync("node_modules/@enc-tiles/s52/data.json", "utf8"),
   );
   console.dir(s52);
   ```

## License

This repository contains a download of the [S-52_PresLib_e4.0.0_Digital_Files_Draft.zip](https://legacy.iho.int/iho_pubs/draft_pubs/PresLib_e4.0.0/Digital_Files/S-52_PresLib_e4.0.0_Digital_Files_Draft.zip) from the [legacy IHO website](https://legacy.iho.int/iho_pubs/draft_pubs/S-52_e6.1.0/S-52_e6.1.0_and_PresLib_e4.0.0.htm).

These files are likely subject to copyright and/or licensing by the IHO, although there is no such restriction listed on the website or in the download.

All other files in the project are licensed under the [Apache License 2.0](../../LICENSE).
