# @enc-tiles/dai

Parses S-52 .dai presentation library files as described in [S-52 PresLib e4.0.0 Part I, Ch.11](https://legacy.iho.int/iho_pubs/draft_pubs/PresLib_e4.0.0/Part_I/S-52_PresLib_e4.0.0_Part%20I_Clean_Draft.pdf).

## Usage

### CLI

```sh
npx @enc-tiles/dai dai2json input.dai output.json
```

### Library

```js
import { parse } from "@enc-tiles/dai";

const text = readFileSync("path/to/PresLib.dai", "utf8");
const json = parse(text);
```
