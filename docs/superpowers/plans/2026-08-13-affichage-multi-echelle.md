# Affichage multi-échelle des ENC — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre visible, à tout niveau de zoom, la carte ENC de la plus grande échelle disponible, au lieu de la seule bande d'utilisation dont la plage de zoom couvre le zoom courant.

**Architecture :** Une archive PMTiles par bande d'utilisation au lieu d'une archive unique, une source MapLibre par archive avec son propre `maxzoom` — c'est ce `maxzoom` qui déclenche le surzoom natif de MapLibre et supprime les écrans vides. Les bandes sont empilées de la plus petite à la plus grande échelle, chacune précédée d'une couche masque `M_COVR CATCOV=1` peinte en NODTA qui efface les bandes inférieures à l'intérieur de sa propre emprise.

**Tech Stack :** GDAL/OGR (`ogr2ogr`, `ogrinfo`), tippecanoe (`tile-join`), GNU Make 3.81, Node 20/22/24 (ESM), TypeScript, MapLibre GL JS 5, PMTiles v3, vitest.

**Spec :** `docs/superpowers/specs/2026-08-13-affichage-multi-echelle-design.md`

## Global Constraints

- Node : `^20.19.0 || ^22.12.0 || ^24` (champ `engines` de `package.json`).
- `bin/join-bands` et `bin/lib/*.mjs` ne doivent avoir **aucune dépendance npm** : le workflow `tiles.yml` ne lance jamais `npm install`. ESM natif uniquement, imports `node:` autorisés.
- GNU Make **3.81** (macOS) : pas de cibles groupées `&:`, pas de `$(file …)`, pas de `.ONESHELL` fiable.
- `tile-join` en CI est un shim Docker montant `$PWD` sur `/data` : **tous les chemins passés à `tile-join` doivent être relatifs au répertoire courant**.
- Les tests du dépôt ne peuvent pas supposer GDAL installé : `.github/workflows/test.yml` n'installe pas `gdal-bin`.
- Le style doit rester valide au sens de `validateStyleMin` (`@maplibre/maplibre-gl-style-spec`).
- Table des bandes, identique partout :

  | bande      | `DSID_INTU` | `minzoom` | `maxzoom` |
  | ---------- | ----------- | --------- | --------- |
  | `overview` | 1           | 0         | 6         |
  | `general`  | 2           | 7         | 8         |
  | `coastal`  | 3           | 9         | 10        |
  | `approach` | 4           | 11        | 12        |
  | `harbour`  | 5           | 13        | 14        |
  | `berthing` | 6           | 15        | 16        |

- Prettier tourne en pre-commit sur tous les fichiers (`lint-staged`). Ne pas lutter contre le reformatage.
- Le dépôt est un fork : commits locaux sur la branche courante, pas de push vers `openwatersio`.

---

## Lot 1 — Robustesse du pipeline

Indépendant des trois autres lots, mergeable seul.

### Task 1: `bin/s57-to-tiles` échoue explicitement sur une bande inconnue

Aujourd'hui, si `ogrinfo` échoue ou si `DSID_INTU` sort de 1–6, le script affiche `Unknown DSID_INTU:` puis lance `ogr2ogr` avec `-dsco MINZOOM= -dsco MAXZOOM=`, ce qui produit une archive z0/z0 et **retourne 0**. Le `make` continue et l'archive dégénérée entre dans le join.

Cette tâche crée aussi le harnais de tests racine, dont les lots 1 et 2 ont besoin : les workspaces ont leur propre vitest, mais rien ne teste `bin/`.

**Files:**

- Create: `vitest.config.ts`
- Create: `test/s57-to-tiles.test.ts`
- Modify: `package.json` (script `test`)
- Modify: `bin/s57-to-tiles:81-84`

**Interfaces:**

- Consumes: rien.
- Produces: le répertoire `test/` racine et le script `npm test` qui l'exécute. Les tâches 3, 4, 5 et 14 y ajoutent des fichiers.

- [ ] **Step 1: Créer la config vitest racine**

`vitest.config.ts` :

```ts
import { defineConfig } from "vitest/config";

// Each workspace runs its own vitest suite; this config covers only the
// repo-level tests for the build scripts under bin/.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
```

- [ ] **Step 2: Écrire le test qui échoue**

`test/s57-to-tiles.test.ts` :

> **Amendement du 2026-08-13, après revue.** La première version de ce test
> n'assurait rien : elle appelait le script sur un fichier inexistant et se
> contentait d'un statut non nul, or `ogr2ogr` échoue **de lui-même** dans ce
> cas et le `echo` pré-existant imprimait déjà « DSID_INTU ». Le test restait
> vert avec le `exit 1` retiré, y compris sur un PATH sans GDAL. Le test
> ci-dessous pose un faux `ogr2ogr` en tête de `PATH` et vérifie que le script
> s'arrête **avant** de l'appeler. Preuve exigée : avec le `exit 1` retiré, le
> stub sort en 0 et le test doit ÉCHOUER.

```ts
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

// Runs bin/s57-to-tiles and captures its exit status and stderr instead of
// throwing, so tests can assert on failure paths.
function run(
  args: string[],
  options?: { env?: NodeJS.ProcessEnv },
): { status: number; stderr: string } {
  try {
    execFileSync("bin/s57-to-tiles", args, {
      encoding: "utf8",
      stdio: "pipe",
      env: options?.env,
    });
    return { status: 0, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number; stderr?: string };
    return { status: failure.status ?? 1, stderr: failure.stderr ?? "" };
  }
}

// This path exercises the same branch whether or not GDAL is installed: with no
// readable DSID layer the intended-use lookup yields an empty string either way.
// The stub ogr2ogr is what makes the test load-bearing: without the guard the
// script reaches it, the stub succeeds, and the sentinel assertion fails.
test("fails when the intended-use band cannot be determined", () => {
  const stubDir = mkdtempSync(join(tmpdir(), "enc-tiles-stub-"));
  const sentinel = join(stubDir, "ogr2ogr-was-called");
  const stubOgr2ogr = join(stubDir, "ogr2ogr");

  writeFileSync(stubOgr2ogr, `#!/bin/sh\ntouch "${sentinel}"\nexit 0\n`, {
    mode: 0o755,
  });
  chmodSync(stubOgr2ogr, 0o755);

  const out = join(stubDir, "out.pmtiles");
  const { status, stderr } = run(["does-not-exist.000", out], {
    env: { ...process.env, PATH: `${stubDir}:${process.env.PATH}` },
  });

  expect(status).not.toBe(0);
  expect(stderr).toContain("DSID_INTU");
  expect(existsSync(sentinel)).toBe(false);
});

test("rejects an output extension that is neither .mbtiles nor .pmtiles", () => {
  const out = join(mkdtempSync(join(tmpdir(), "enc-tiles-")), "out.geojson");
  const { status, stderr } = run(["does-not-exist.000", out]);

  expect(status).not.toBe(0);
  expect(stderr).toContain("mbtiles");
});
```

- [ ] **Step 3: Câbler le script `test` racine et vérifier que le test échoue**

Dans `package.json`, remplacer :

```json
"test": "npm run --workspaces --if-present test -- --run"
```

par :

```json
"test": "vitest --run && npm run --workspaces --if-present test -- --run"
```

Run: `npx vitest --run test/s57-to-tiles.test.ts`
Expected: FAIL — le premier test échoue sur `expect(status).not.toBe(0)`, le script retournant actuellement 0.

- [ ] **Step 4: Implémenter la sortie en erreur**

Dans `bin/s57-to-tiles`, remplacer le cas par défaut du `case "$INTENDED_USE"` (lignes 81-84) :

```bash
  *)
    echo "Unknown DSID_INTU: $INTENDED_USE"
    ;;
```

par :

```bash
  *)
    echo "Unable to determine DSID_INTU for $in (got: '$INTENDED_USE')" >&2
    exit 1
    ;;
```

Envoyer aussi sur stderr le message d'extension invalide, ligne 19 :

```bash
    echo "Output format must be .mbtiles or .pmtiles" >&2
```

- [ ] **Step 5: Vérifier que les tests passent**

Run: `npx vitest --run test/s57-to-tiles.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts test/s57-to-tiles.test.ts package.json bin/s57-to-tiles
git commit -m "Fail the tile conversion on an undeterminable usage band"
```

### Task 2: Glob explicite et suppression des tuiles périmées dans le `Makefile`

`$(wildcard $(ENC_DIR)/**/*.000)` repose sur `**`, qui n'est **pas** récursif dans `glob(3)` : il se comporte comme `*` et ne fonctionne que par coïncidence avec la structure plate de NOAA. Même problème pour `tiles/**/*.pmtiles` dans la recette de join, avec en plus le fait que le glob ramasse les archives de cartes retirées du jeu de données.

**Files:**

- Modify: `Makefile:3`, `Makefile:20-25`

**Interfaces:**

- Consumes: rien.
- Produces: `$(TILES)`, la liste explicite des archives attendues. La tâche 6 la passe à `bin/join-bands` au lieu d'un glob.

- [ ] **Step 1: Rendre le glob explicite**

`Makefile` ligne 3 :

```make
ENC := $(wildcard $(ENC_DIR)/*/*.000)
```

- [ ] **Step 2: Passer la liste explicite au join**

Recette de `${TILES_DIR}/noaa.pmtiles` : remplacer `$(TILES_DIR)/**/*.pmtiles` par `$(TILES)`.

```make
${TILES_DIR}/noaa.pmtiles: $(TILES)
	@mkdir -p $(TILES_DIR)
	# Increase file descriptor limit for tile-join, capped at the hard limit
	ulimit -n 100000 2>/dev/null || ulimit -n $$(ulimit -Hn) 2>/dev/null || true; \
	tile-join --force --no-tile-size-limit -o $@ $(TILES)
```

- [ ] **Step 3: Vérifier que make voit bien les mêmes cartes**

Run: `make -n 2>/dev/null | grep -c 's57-to-tiles'`
Expected: le même nombre qu'avant la modification. Si `data/ENC_ROOT` est présent localement, comparer à `ls -d data/ENC_ROOT/*/ | wc -l`.

Run: `make -n | tail -3`
Expected: la ligne `tile-join` liste des chemins `tiles/<CARTE>/<CARTE>.pmtiles` explicites, plus aucun `**`.

- [ ] **Step 4: Commit**

```bash
git add Makefile
git commit -m "Expand ENC and tile paths explicitly instead of relying on **"
```

---

## Lot 2 — Découpage par bande et sources multiples

C'est le lot qui fait disparaître l'écran vide.

### Task 3: Table des bandes, partagée entre les scripts de build et le paquet styles

Trois endroits ont besoin de la correspondance bande ↔ plage de zoom : `bin/s57-to-tiles` (bash), `bin/join-bands` (Node sans dépendances) et `packages/styles` (TypeScript publié sur npm). Un paquet npm ne peut pas importer depuis `bin/`, donc la table est déclarée deux fois — en `.mjs` et en `.ts` — et un test garde les deux synchronisées, y compris avec le `case` bash.

**Files:**

- Create: `bin/lib/bands.mjs`
- Create: `packages/styles/src/bands.ts`
- Create: `test/bands.test.ts`
- Modify: `packages/styles/src/index.ts` (ajout d'un ré-export)

**Interfaces:**

- Consumes: le harnais de tests racine de la tâche 1.
- Produces:
  - `bin/lib/bands.mjs` : `BANDS` (tableau de `{ name, intu, minzoom, maxzoom }`, ordonné de la plus petite à la plus grande échelle) et `bandForMinzoom(minzoom) → band | undefined`.
  - `packages/styles/src/bands.ts` : `BANDS` (même contenu, `as const`) et le type `BandName`.
  - Ré-export depuis `@enc-tiles/styles` : `BANDS`, `BandName`.

- [ ] **Step 1: Écrire le test qui échoue**

`test/bands.test.ts` :

```ts
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { BANDS as SCRIPT_BANDS, bandForMinzoom } from "../bin/lib/bands.mjs";
import { BANDS as STYLE_BANDS } from "../packages/styles/src/bands.ts";

test("the build scripts and the styles package declare the same bands", () => {
  expect(SCRIPT_BANDS).toEqual(STYLE_BANDS);
});

test("bandForMinzoom maps a tileset minzoom back to its band", () => {
  expect(bandForMinzoom(0)?.name).toBe("overview");
  expect(bandForMinzoom(13)?.name).toBe("harbour");
  expect(bandForMinzoom(1)).toBeUndefined();
});

// bin/s57-to-tiles hard-codes the zoom ranges in a shell case statement. Keep it
// honest rather than shelling out to node once per chart during the build.
test("bin/s57-to-tiles uses the same zoom range for every band", () => {
  const script = readFileSync("bin/s57-to-tiles", "utf8");

  for (const band of SCRIPT_BANDS) {
    // Extract the case clause: from "N)" label to its ";;" terminator,
    // bounded to prevent cross-case matches.
    const clausePattern = new RegExp(`^\\s*${band.intu}\\)(.*?)^\\s*;;`, "ms");
    const clauseMatch = script.match(clausePattern);
    expect(
      clauseMatch,
      `band ${band.name} (INTU ${band.intu}) case clause not found`,
    ).toBeTruthy();

    if (clauseMatch) {
      const clause = clauseMatch[1];

      // Check minzoom and maxzoom within this clause only, with flexible spacing.
      const minzoomPattern = new RegExp(`minzoom\\s*=\\s*${band.minzoom}`);
      const maxzoomPattern = new RegExp(`maxzoom\\s*=\\s*${band.maxzoom}`);

      expect(clause, `band ${band.name} (INTU ${band.intu}) minzoom`).toMatch(
        minzoomPattern,
      );
      expect(clause, `band ${band.name} (INTU ${band.intu}) maxzoom`).toMatch(
        maxzoomPattern,
      );
    }
  }
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest --run test/bands.test.ts`
Expected: FAIL — `Cannot find module '../bin/lib/bands.mjs'`.

- [ ] **Step 3: Écrire la table côté scripts de build**

`bin/lib/bands.mjs` :

```js
// ENC usage bands (S-57 DSID_INTU) and the zoom range each one is tiled at,
// ordered from the smallest scale to the largest. Kept in sync with
// packages/styles/src/bands.ts and with the case statement in bin/s57-to-tiles
// by test/bands.test.ts.
//
// No npm dependencies: .github/workflows/tiles.yml never runs `npm install`.
export const BANDS = [
  { name: "overview", intu: 1, minzoom: 0, maxzoom: 6 },
  { name: "general", intu: 2, minzoom: 7, maxzoom: 8 },
  { name: "coastal", intu: 3, minzoom: 9, maxzoom: 10 },
  { name: "approach", intu: 4, minzoom: 11, maxzoom: 12 },
  { name: "harbour", intu: 5, minzoom: 13, maxzoom: 14 },
  { name: "berthing", intu: 6, minzoom: 15, maxzoom: 16 },
];

/**
 * Resolve the band a tileset belongs to from its PMTiles header minzoom.
 * Returns undefined for a minzoom no band claims, which is how a degenerate
 * z0/z0 archive gets caught.
 */
export function bandForMinzoom(minzoom) {
  return BANDS.find((band) => band.minzoom === minzoom);
}
```

- [ ] **Step 4: Écrire la table côté paquet styles**

`packages/styles/src/bands.ts` :

```ts
/**
 * ENC usage bands (S-57 DSID_INTU) and the zoom range each one is tiled at,
 * ordered from the smallest scale to the largest — which is also the order the
 * style stacks them in. Kept in sync with bin/lib/bands.mjs by test/bands.test.ts.
 */
export const BANDS = [
  { name: "overview", intu: 1, minzoom: 0, maxzoom: 6 },
  { name: "general", intu: 2, minzoom: 7, maxzoom: 8 },
  { name: "coastal", intu: 3, minzoom: 9, maxzoom: 10 },
  { name: "approach", intu: 4, minzoom: 11, maxzoom: 12 },
  { name: "harbour", intu: 5, minzoom: 13, maxzoom: 14 },
  { name: "berthing", intu: 6, minzoom: 15, maxzoom: 16 },
] as const;

export type BandName = (typeof BANDS)[number]["name"];
```

Ajouter en tête de `packages/styles/src/index.ts` :

```ts
export * from "./bands.js";
```

- [ ] **Step 5: Vérifier que les tests passent**

Run: `npx vitest --run test/bands.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add bin/lib/bands.mjs packages/styles/src/bands.ts packages/styles/src/index.ts test/bands.test.ts
git commit -m "Declare the ENC usage bands and their zoom ranges"
```

### Task 4: Lecture de l'en-tête PMTiles

`bin/join-bands` doit classer 7239 archives par bande. Lire l'en-tête binaire (127 octets, `minzoom` à l'offset 100, `maxzoom` à 101) évite 7239 appels GDAL et détecte au passage les archives dégénérées.

**Files:**

- Create: `bin/lib/pmtiles-header.mjs`
- Create: `test/pmtiles-header.test.ts`

**Interfaces:**

- Consumes: rien.
- Produces: `readPmtilesHeader(path) → { minzoom: number, maxzoom: number }`. Lève une `Error` si la signature `PMTiles` est absente ou si le fichier fait moins de 127 octets.

- [ ] **Step 1: Écrire le test qui échoue**

`test/pmtiles-header.test.ts` :

```ts
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { readPmtilesHeader } from "../bin/lib/pmtiles-header.mjs";

// A PMTiles v3 header is 127 bytes: "PMTiles" + version, then offsets, with
// minzoom at byte 100 and maxzoom at byte 101.
function writeHeader(minzoom: number, maxzoom: number, magic = "PMTiles") {
  const header = Buffer.alloc(127);
  header.write(magic, 0, "ascii");
  header.writeUInt8(3, 7);
  header.writeUInt8(minzoom, 100);
  header.writeUInt8(maxzoom, 101);

  const path = join(mkdtempSync(join(tmpdir(), "pmtiles-")), "fixture.pmtiles");
  writeFileSync(path, header);
  return path;
}

test("reads the zoom range out of the header", () => {
  expect(readPmtilesHeader(writeHeader(13, 14))).toEqual({
    minzoom: 13,
    maxzoom: 14,
  });
});

test("rejects a file that is not a PMTiles archive", () => {
  expect(() => readPmtilesHeader(writeHeader(13, 14, "NOTPMT!"))).toThrow(
    /not a PMTiles archive/,
  );
});

test("rejects a file shorter than a header", () => {
  const path = join(mkdtempSync(join(tmpdir(), "pmtiles-")), "short.pmtiles");
  writeFileSync(path, Buffer.alloc(10));

  expect(() => readPmtilesHeader(path)).toThrow(/too short/);
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest --run test/pmtiles-header.test.ts`
Expected: FAIL — `Cannot find module '../bin/lib/pmtiles-header.mjs'`.

- [ ] **Step 3: Implémenter la lecture**

`bin/lib/pmtiles-header.mjs` :

```js
import { closeSync, openSync, readSync } from "node:fs";

const HEADER_BYTES = 127;
const MAGIC = "PMTiles";
const MINZOOM_OFFSET = 100;
const MAXZOOM_OFFSET = 101;

/**
 * Read the zoom range from a PMTiles v3 header without parsing the directories.
 * @see https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
 */
export function readPmtilesHeader(path) {
  const buffer = Buffer.alloc(HEADER_BYTES);
  const fd = openSync(path, "r");
  let read;

  try {
    read = readSync(fd, buffer, 0, HEADER_BYTES, 0);
  } finally {
    closeSync(fd);
  }

  if (read < HEADER_BYTES) {
    throw new Error(`${path}: too short to be a PMTiles archive`);
  }

  if (buffer.toString("ascii", 0, MAGIC.length) !== MAGIC) {
    throw new Error(`${path}: not a PMTiles archive`);
  }

  return {
    minzoom: buffer.readUInt8(MINZOOM_OFFSET),
    maxzoom: buffer.readUInt8(MAXZOOM_OFFSET),
  };
}
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `npx vitest --run test/pmtiles-header.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add bin/lib/pmtiles-header.mjs test/pmtiles-header.test.ts
git commit -m "Read the zoom range from a PMTiles header"
```

### Task 5: `bin/join-bands`

Remplace le `tile-join` unique par un `tile-join` par bande. La logique de regroupement est extraite dans une fonction pure pour être testable sans lancer `tile-join`.

**Files:**

- Create: `bin/join-bands`
- Create: `bin/lib/group-by-band.mjs`
- Create: `test/group-by-band.test.ts`

**Interfaces:**

- Consumes: `BANDS` et `bandForMinzoom` (tâche 3), `readPmtilesHeader` (tâche 4).
- Produces:
  - `groupByBand(paths, readHeader) → Map<bandName, string[]>` — `readHeader` est injecté pour que les tests n'aient pas besoin de vrais fichiers. Lève une `Error` listant les fichiers dont le `minzoom` ne correspond à aucune bande.
  - Exécutable `bin/join-bands --prefix <préfixe> [--dry-run] <fichier.pmtiles>…`, produisant `<préfixe>-<bande>.pmtiles` pour chaque bande non vide.

- [ ] **Step 1: Écrire le test qui échoue**

`test/group-by-band.test.ts` :

```ts
import { expect, test } from "vitest";
import { groupByBand } from "../bin/lib/group-by-band.mjs";

const headers: Record<string, { minzoom: number; maxzoom: number }> = {
  "tiles/US1EEZ1M/US1EEZ1M.pmtiles": { minzoom: 0, maxzoom: 6 },
  "tiles/US3CA70M/US3CA70M.pmtiles": { minzoom: 9, maxzoom: 10 },
  "tiles/US5CA63M/US5CA63M.pmtiles": { minzoom: 13, maxzoom: 14 },
  "tiles/US5CA65M/US5CA65M.pmtiles": { minzoom: 13, maxzoom: 14 },
  "tiles/USBROKEN/USBROKEN.pmtiles": { minzoom: 0, maxzoom: 0 },
};

const readHeader = (path: string) => headers[path]!;

test("groups archives by band, keeping band order", () => {
  const groups = groupByBand(
    [
      "tiles/US5CA63M/US5CA63M.pmtiles",
      "tiles/US1EEZ1M/US1EEZ1M.pmtiles",
      "tiles/US5CA65M/US5CA65M.pmtiles",
      "tiles/US3CA70M/US3CA70M.pmtiles",
    ],
    readHeader,
  );

  expect([...groups.keys()]).toEqual(["overview", "coastal", "harbour"]);
  expect(groups.get("harbour")).toEqual([
    "tiles/US5CA63M/US5CA63M.pmtiles",
    "tiles/US5CA65M/US5CA65M.pmtiles",
  ]);
});

// A z0/z0 archive is what bin/s57-to-tiles used to emit when the usage band was
// undeterminable. Task 1 stops producing them; this stops them being merged.
test("rejects an archive whose zoom range matches no band", () => {
  expect(() =>
    groupByBand(
      ["tiles/US1EEZ1M/US1EEZ1M.pmtiles", "tiles/USBROKEN/USBROKEN.pmtiles"],
      readHeader,
    ),
  ).toThrow(/USBROKEN/);
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest --run test/group-by-band.test.ts`
Expected: FAIL — `Cannot find module '../bin/lib/group-by-band.mjs'`.

- [ ] **Step 3: Implémenter le regroupement**

`bin/lib/group-by-band.mjs` :

```js
import { BANDS, bandForMinzoom } from "./bands.mjs";
import { readPmtilesHeader } from "./pmtiles-header.mjs";

/**
 * Group per-chart PMTiles archives by usage band, in band order.
 *
 * @param {string[]} paths
 * @param {(path: string) => { minzoom: number, maxzoom: number }} readHeader
 * @returns {Map<string, string[]>} band name -> archive paths, band order,
 *   empty bands omitted
 */
export function groupByBand(paths, readHeader = readPmtilesHeader) {
  const groups = new Map();
  const unclaimed = [];

  for (const path of paths) {
    const { minzoom, maxzoom } = readHeader(path);
    const band = bandForMinzoom(minzoom);

    if (!band || band.maxzoom !== maxzoom) {
      unclaimed.push(`${path} (z${minzoom}-${maxzoom})`);
      continue;
    }

    groups.set(band.name, [...(groups.get(band.name) ?? []), path]);
  }

  if (unclaimed.length > 0) {
    throw new Error(
      `These archives do not match any usage band and were probably produced by a failed conversion:\n  ${unclaimed.join("\n  ")}`,
    );
  }

  // Re-key in band order so the style can stack the archives smallest scale first.
  return new Map(
    BANDS.filter((band) => groups.has(band.name)).map((band) => [
      band.name,
      groups.get(band.name),
    ]),
  );
}
```

- [ ] **Step 4: Vérifier que le test passe**

Run: `npx vitest --run test/group-by-band.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Écrire l'exécutable**

`bin/join-bands` :

```js
#!/usr/bin/env node
// Merges the per-chart PMTiles archives into one archive per ENC usage band.
//
// Each band keeps its own zoom range, which is what lets MapLibre overzoom a
// band beyond its maxzoom instead of showing nothing.
//
// Usage: bin/join-bands --prefix tiles/noaa [--dry-run] tiles/*/*.pmtiles

import { spawnSync } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { groupByBand } from "./lib/group-by-band.mjs";

const { values, positionals } = parseArgs({
  options: {
    prefix: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
  allowPositionals: true,
});

if (!values.prefix) {
  console.error("Error: --prefix is required");
  process.exit(1);
}

if (positionals.length === 0) {
  console.error("Error: no input archives given");
  process.exit(1);
}

const groups = groupByBand(positionals);

for (const [band, paths] of groups) {
  const output = `${values.prefix}-${band}.pmtiles`;

  // tile-join runs in a container with the working directory bind-mounted, so
  // the list file has to live under it and be referenced relatively.
  const listPath = `${values.prefix}-${band}.inputs.txt`;
  const args = [
    "--force",
    "--no-tile-size-limit",
    "-o",
    output,
    "-r",
    listPath,
  ];

  console.log(`${band}: ${paths.length} charts -> ${output}`);

  if (values["dry-run"]) {
    console.log(`  tile-join ${args.join(" ")}`);
    continue;
  }

  writeFileSync(listPath, `${paths.join("\n")}\n`);

  try {
    const result = spawnSync("tile-join", args, { stdio: "inherit" });

    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`tile-join exited with status ${result.status}`);
    }
  } finally {
    unlinkSync(listPath);
  }
}
```

- [ ] **Step 6: Vérifier l'exécutable à vide**

```bash
chmod +x bin/join-bands
```

Run: `bin/join-bands --prefix /tmp/out --dry-run tiles/US1EEZ1M/US1EEZ1M.pmtiles`
Expected: `overview: 1 charts -> /tmp/out-overview.pmtiles` puis la ligne `tile-join --force …`. Si `tiles/` n'existe pas localement, sauter cette vérification — la tâche 6 la couvre de bout en bout.

Run: `bin/join-bands --dry-run tiles/US1EEZ1M/US1EEZ1M.pmtiles`
Expected: `Error: --prefix is required`, statut 1.

- [ ] **Step 7: Commit**

```bash
git add bin/join-bands bin/lib/group-by-band.mjs test/group-by-band.test.ts
git commit -m "Merge the per-chart archives into one archive per usage band"
```

### Task 6: Le `Makefile` produit six archives

GNU Make 3.81 ne connaît pas les cibles groupées (`&:`), donc une seule recette produit les six fichiers et un fichier témoin porte la dépendance.

**Files:**

- Modify: `Makefile:1-10`, `Makefile:20-25`

**Interfaces:**

- Consumes: `$(TILES)` (tâche 2), `bin/join-bands` (tâche 5).
- Produces: `tiles/noaa-overview.pmtiles` … `tiles/noaa-berthing.pmtiles`.

- [ ] **Step 1: Remplacer la cible de join**

> **Amendement du 2026-08-13, après revue.** Une première version faisait
> déclarer `BANDS` et `BAND_TILES` en tête de fichier. Ces deux variables ne sont
> référencées nulle part : `bin/join-bands` décide seul des bandes non vides à
> produire. Câbler `all: $(BAND_TILES)` avec `$(BAND_TILES): .bands.stamp` ne les
> rendrait pas utiles pour autant — sous Make 3.81 une règle sans recette ne
> reconstruit pas une archive supprimée à la main, et laisserait `all` se déclarer
> satisfaite en nommant un fichier absent. `all: $(TILES_DIR)/.bands.stamp` décrit
> honnêtement ce que fait le build.

Remplacer `all: ${TILES_DIR}/noaa.pmtiles` par :

```make
all: $(TILES_DIR)/.bands.stamp
```

Remplacer la cible `${TILES_DIR}/noaa.pmtiles` par :

```make
# GNU Make 3.81 has no grouped targets, so one recipe produces all six archives
# and a stamp file carries the dependency. Note: if a band archive is deleted by hand
# while the stamp survives, `make` will not regenerate it; use `make clean && make`.
$(TILES_DIR)/.bands.stamp: $(TILES)
	@mkdir -p $(TILES_DIR)
	# Increase file descriptor limit for tile-join, capped at the hard limit
	ulimit -n 100000 2>/dev/null || ulimit -n $$(ulimit -Hn) 2>/dev/null || true; \
	bin/join-bands --prefix $(TILES_DIR)/noaa $(TILES)
	@touch $@
```

- [ ] **Step 2: Vérifier le plan de build**

Run: `make -n | tail -5`
Expected: la dernière commande est `bin/join-bands --prefix tiles/noaa tiles/…/….pmtiles …`, plus aucune invocation directe de `tile-join`.

- [ ] **Step 3: Exécuter le join réel**

Prérequis : les archives par carte existent déjà dans `tiles/` (elles sont inchangées par ce lot).

Run: `make`
Expected: six lignes `<bande>: N charts -> tiles/noaa-<bande>.pmtiles`, avec N = 16, 92, 329, 2256, 4482, 64.

Run: `ls -la tiles/noaa-*.pmtiles`
Expected: six fichiers, respectivement ~0,02 / 0,04 / 0,15 / 0,58 / 0,72 / 0,01 Go.

- [ ] **Step 4: Vérifier les plages de zoom des archives produites**

```bash
node -e '
import("./bin/lib/pmtiles-header.mjs").then(({ readPmtilesHeader }) => {
  for (const band of ["overview","general","coastal","approach","harbour","berthing"]) {
    const path = `tiles/noaa-${band}.pmtiles`;
    console.log(band, readPmtilesHeader(path));
  }
});
'
```

Expected: `overview { minzoom: 0, maxzoom: 6 }`, `general { minzoom: 7, maxzoom: 8 }`, `coastal { minzoom: 9, maxzoom: 10 }`, `approach { minzoom: 11, maxzoom: 12 }`, `harbour { minzoom: 13, maxzoom: 14 }`, `berthing { minzoom: 15, maxzoom: 16 }`.

- [ ] **Step 5: Commit**

```bash
git add Makefile
git commit -m "Build one tile archive per ENC usage band"
```

### Task 7: `packages/styles` accepte plusieurs sources

`createStyle` ne connaît qu'une source, et `lookupToLayers` code `source: "enc"` en dur. Le compteur d'identifiants `i` est par ailleurs un module-global jamais réinitialisé : deux appels successifs à `createStyle` produisent aujourd'hui des identifiants différents, et six passes en produiraient six séries décalées.

**Files:**

- Modify: `packages/styles/src/index.ts`
- Modify: `packages/styles/src/symbolology/index.ts:14-22`, `:41-62`, `:107-133`
- Modify: `packages/styles/test/instructions/index.test.ts:4-10`
- Create: `packages/styles/test/multi-source.test.ts`

**Interfaces:**

- Consumes: `BANDS`, `BandName` (tâche 3).
- Produces:
  - `createStyle({ source })` — inchangé, une source nommée `enc`, aucun masque.
  - `createStyle({ sources: Partial<Record<BandName, VectorSourceSpecification>> })` — une source par bande, empilées dans l'ordre de `BANDS`.
  - `LayerConfig.sources: string[]` remplace `LayerConfig.source: string`.
  - Identifiants de couches : `<source>-<index>-<OBCL>-<ftyp>`, stables d'un appel à l'autre.
  - La tâche 11 ajoute le masque ; ici `LayerConfig.masks` n'existe pas encore.

- [ ] **Step 1: Écrire le test qui échoue**

`packages/styles/test/multi-source.test.ts` :

```ts
import { expect, test } from "vitest";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import createStyle, { BANDS } from "../src/index.js";
import type { VectorSourceSpecification } from "maplibre-gl";

const vector = (url: string): VectorSourceSpecification => ({
  type: "vector",
  url,
});

const allBands = Object.fromEntries(
  BANDS.map((band) => [
    band.name,
    vector(`pmtiles://noaa-${band.name}.pmtiles`),
  ]),
);

test("a single source keeps the current shape", () => {
  const style = createStyle({ source: vector("test.pmtiles") });

  expect(Object.keys(style.sources)).toEqual(["enc"]);
  expect(validateStyleMin(style)).toEqual([]);
});

test("band sources are declared and stacked smallest scale first", () => {
  const style = createStyle({ sources: allBands });

  expect(Object.keys(style.sources)).toEqual(BANDS.map((band) => band.name));

  const order = style.layers
    .filter((layer) => "source" in layer && layer.source)
    .map((layer) => (layer as { source: string }).source);

  expect([...new Set(order)]).toEqual(BANDS.map((band) => band.name));
  expect(validateStyleMin(style)).toEqual([]);
});

test("every layer points at the source of its band", () => {
  const style = createStyle({ sources: allBands });

  for (const layer of style.layers) {
    if (!("source" in layer) || !layer.source) continue;
    expect(layer.id.startsWith(`${layer.source}-`)).toBe(true);
  }
});

test("layer ids are unique and stable across calls", () => {
  const ids = (style: { layers: { id: string }[] }) =>
    style.layers.map((layer) => layer.id);

  const first = ids(createStyle({ sources: allBands }));
  const second = ids(createStyle({ sources: allBands }));

  expect(new Set(first).size).toBe(first.length);
  expect(first).toEqual(second);
});

test("rejects being given both source and sources", () => {
  expect(() =>
    createStyle({ source: vector("test.pmtiles"), sources: allBands }),
  ).toThrow(/exactly one/);
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `cd packages/styles && npx vitest --run test/multi-source.test.ts`
Expected: FAIL — `createStyle` n'accepte pas `sources`, et les identifiants ne sont pas stables entre deux appels.

- [ ] **Step 3: Passer la source en paramètre dans `symbolology/index.ts`**

Remplacer `source: string` par `sources: string[]` dans `LayerConfig` :

```ts
export interface LayerConfig {
  mode: Mode;
  sources: string[];
  shallowDepth: number;
  safetyDepth: number;
  deepDepth: number;
  boundaries?: BoundaryType;
  symbols?: SymbolType;
}
```

Remplacer `build` :

```ts
export function build(config: LayerConfig): LayerSpecification[] {
  const lookupGroups = groupBy(getLookups(config), (lookup) => {
    return [lookup.obcl, lookup.tnam].join("|");
  });

  const layers = config.sources.flatMap((source) => {
    // A fresh counter per source keeps ids unique across bands and stable
    // between calls to build().
    let index = 0;
    const nextIndex = () => index++;

    return Object.values(lookupGroups).flatMap((lookups) => {
      if (!lookups)
        throw new Error(
          "This should never happen but TypeScript insists it can.",
        );

      return lookups.length <= 1
        ? lookups.flatMap((lookup) => lookupToLayers(lookup, source, nextIndex))
        : lookupGroupToLayers(lookups, source, nextIndex);
    });
  });

  return [background(config), ...layers];
}
```

Propager les deux paramètres dans `lookupGroupToLayers` :

```ts
export function lookupGroupToLayers(
  lookups: LookupEntry[],
  source: string,
  nextIndex: () => number,
): LayerSpecification[] {
```

et dans son corps, remplacer `lookupToLayers(fallbackLookup!)` par `lookupToLayers(fallbackLookup!, source, nextIndex)` et `otherLookups.flatMap(lookupToLayers)` par `otherLookups.flatMap((lookup) => lookupToLayers(lookup, source, nextIndex))`.

Supprimer le `let i = 0;` de la ligne 107 et remplacer `lookupToLayers` :

```ts
export function lookupToLayers(
  lookup: LookupEntry,
  source: string,
  nextIndex: () => number,
): LayerSpecification[] {
  return instructionsToStyles(lookup.inst).map((layer) => {
    return {
      ...layer,
      metadata: {
        s52: lookup,
      },
      filter: filters.all(
        filters.scaleFilter(),
        filterGeometryType[lookup.ftyp],
        ...filters.attributeFilters(lookup.attc),
        ...("filter" in layer
          ? [layer.filter as ExpressionFilterSpecification]
          : []),
      ),
      layout: {
        ...layer.layout,
        [`${layer.type}-sort-key`]: sortKey(lookup.dpri, layer),
      },
      source,
      "source-layer": lookup.obcl,
      id: [source, nextIndex(), lookup.obcl, lookup.ftyp].join("-"),
    };
  });
}
```

- [ ] **Step 4: Accepter `sources` dans `createStyle`**

`packages/styles/src/index.ts` :

```ts
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
```

- [ ] **Step 5: Mettre à jour le test existant qui construit un `LayerConfig`**

`packages/styles/test/instructions/index.test.ts` se termine aujourd'hui par `expect(true).toBe(true)`, qui n'assure rien. Puisque cette tâche touche déjà le fichier, remplacer son contenu par :

```ts
import { expect, test } from "vitest";
import { build, LayerConfig } from "../../src/symbolology";

const config: LayerConfig = {
  sources: ["enc"],
  mode: "DAY",
  shallowDepth: 3.0, // meters (9.8 feet)
  safetyDepth: 6.0, // meters (19.6 feet)
  deepDepth: 9.0, // meters (29.5 feet)
};

test("symbology from lookups", () => {
  const layers = build(config);

  expect(layers.length).toBeGreaterThan(0);

  for (const layer of layers) {
    expect(layer.id).toBeTruthy();
    if (layer.type === "background") continue;
    expect(layer.source).toBe("enc");
    expect(layer["source-layer"]).toBeTruthy();
  }
});
```

L'import de `filter` disparaît : il n'était pas utilisé.

- [ ] **Step 6: Vérifier que toute la suite passe**

Run: `cd packages/styles && npx vitest --run`
Expected: PASS — les 5 tests de `multi-source.test.ts`, `index.test.ts` (style valide) et les suites `instructions/` existantes.

Run: `npm run build`
Expected: compilation TypeScript sans erreur (`noUnusedParameters` et `exactOptionalPropertyTypes` sont actifs).

- [ ] **Step 7: Commit**

```bash
git add packages/styles/src packages/styles/test
git commit -m "Let a style bind its layers to one source per usage band"
```

### Task 8: Le viewer charge les six archives

**Files:**

- Modify: `src/index.ts`
- Modify: `.env`

**Interfaces:**

- Consumes: `createStyle({ sources })` et `BANDS` (tâches 3 et 7), les six archives (tâche 6).
- Produces: rien pour les tâches suivantes.

- [ ] **Step 1: Remplacer le chargement mono-archive**

`src/index.ts` — remplacer tout ce qui va de `const tileset = …` jusqu'à la construction de `map` :

```ts
const prefix = import.meta.env.VITE_TILESET_PREFIX ?? "noaa";
const tilesUrl =
  import.meta.env.VITE_TILES_URL ?? window.location.origin + "/tiles/";

// add the PMTiles plugin to the maplibre-gl global.
const protocol = new Protocol({ metadata: true });
addProtocol("pmtiles", protocol.tile);

const archives: Record<string, { url: string; pmtiles: PMTiles }> = {};

for (const band of BANDS) {
  const url = new URL(`${prefix}-${band.name}.pmtiles`, tilesUrl).toString();
  const pmtiles = new PMTiles(url);
  protocol.add(pmtiles);
  archives[band.name] = { url, pmtiles };
}

// Centre on the harbour band: it carries the bulk of the coverage.
const header = await archives["harbour"]!.pmtiles.getHeader();

const style = createStyle({
  sprite: `${window.location.origin}${import.meta.env.BASE_URL}sprites`,
  sources: Object.fromEntries(
    BANDS.map((band) => [
      band.name,
      { type: "vector", url: `pmtiles://${archives[band.name]!.url}` },
    ]),
  ),
});

const map = new Map({
  container: "map",
  hash: true, // Enable hash routing
  // Mid-approach band: the first zoom that is both wide and legible. The old
  // `header.maxZoom` opened at z16, where only the 64 berthing charts exist.
  zoom: 12,
  center: [header.centerLon, header.centerLat],
  style,
});
```

Ajouter `BANDS` à l'import du paquet styles :

```ts
import createStyle, { BANDS } from "@enc-tiles/styles";
```

- [ ] **Step 2: Mettre à jour `.env`**

```
VITE_TILES_URL=https://pub-0b8220da652f4a95a2293d0f61351a33.r2.dev
VITE_TILESET_PREFIX=noaa
```

- [ ] **Step 3: Vérifier le rendu**

Prérequis local : les six archives doivent être servies. `/public/tiles` est ignoré par git, donc :

```bash
mkdir -p public/tiles && ln -sf ../../tiles/noaa-*.pmtiles public/tiles/
```

et `.env.local` doit contenir `VITE_TILES_URL=http://localhost:5173/tiles/`.

Lancer le serveur de dev via l'outil de preview, puis :

- ouvrir la carte sur `#13/33.9294/-118.8008` (dans la couverture de la Harbour `US5CA63M`) — la carte doit être dessinée ;
- se déplacer vers `#13/33.4000/-118.8000`, hors de toute emprise Harbour mais dans la Coastal `US3CA70M` — **avant le lot 3, la bande Coastal surzoomée doit apparaître empilée sous les autres ; l'essentiel est qu'il n'y ait plus de zone vide** ;
- monter à `#16/33.9294/-118.8008` — la carte doit rester dessinée, alors qu'elle était vide auparavant.

Vérifier l'absence d'erreurs console et de 404 sur les six archives.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts .env
git commit -m "Load one tile archive per usage band in the viewer"
```

### Task 9: Publication des six archives

`tiles.yml` n'installe pas Node aujourd'hui ; `bin/join-bands` en a besoin.

**Files:**

- Modify: `.github/workflows/tiles.yml`

**Interfaces:**

- Consumes: `bin/join-bands` (tâche 5), les cibles du `Makefile` (tâche 6).
- Produces: rien pour les tâches suivantes.

- [ ] **Step 1: Installer Node avant le build**

Insérer, juste après l'étape `Checkout repository` :

```yaml
- name: Setup Node.js
  uses: actions/setup-node@v6
  with:
    node-version-file: .nvmrc
```

- [ ] **Step 2: Uploader les six fichiers**

Remplacer la commande de l'étape `Upload to R2` :

```yaml
run: |
  for band in overview general coastal approach harbour berthing; do
    aws s3 cp "tiles/noaa-$band.pmtiles" "s3://${R2_BUCKET}/noaa-$band.pmtiles"
  done
```

- [ ] **Step 3: Vérifier la syntaxe du workflow**

```bash
node -e '
const { readFileSync } = require("node:fs");
const yaml = readFileSync(".github/workflows/tiles.yml", "utf8");
const steps = [...yaml.matchAll(/^      - name: (.+)$/gm)].map((m) => m[1]);
console.log(steps);
'
```

Expected: `Setup Node.js` apparaît juste après `Checkout repository` et avant `Install GDAL`.

Le workflow lui-même ne peut pas être exécuté depuis le fork : `tiles.yml` y est désactivé et les secrets R2 ne s'y trouvent pas. Cette étape est une relecture, pas une exécution.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/tiles.yml
git commit -m "Publish one tile archive per usage band"
```

### Task 10: Mesurer le coût du style multi-sources — point de bascule

Le spec identifie le volume du style (~6972 couches / 5,3 MB) comme le pari central du design. Cette tâche produit le chiffre qui décide de continuer ou de basculer sur la découpe géométrique au build.

**Files:**

- Create: `docs/superpowers/plans/2026-08-13-mesures.md`

**Interfaces:**

- Consumes: `createStyle({ sources })` (tâche 7), le viewer (tâche 8).
- Produces: la décision go / no-go pour le lot 3.

- [ ] **Step 1: Mesurer le style hors navigateur**

```bash
node -e '
import("./packages/styles/dist/index.js").then(({ default: createStyle, BANDS }) => {
  const sources = Object.fromEntries(
    BANDS.map((b) => [b.name, { type: "vector", url: `pmtiles://noaa-${b.name}.pmtiles` }]),
  );
  const start = performance.now();
  const style = createStyle({ sources });
  const built = performance.now() - start;
  const json = JSON.stringify(style);
  console.log("layers:", style.layers.length);
  console.log("size:", (json.length / 1024 / 1024).toFixed(2), "MB");
  console.log("build:", built.toFixed(0), "ms");
  const parse = performance.now();
  JSON.parse(json);
  console.log("parse:", (performance.now() - parse).toFixed(0), "ms");
});
' 2>&1 | grep -v "not implemented"
```

Attendu d'après l'estimation du spec : ~6972 couches, ~5,3 MB.

- [ ] **Step 2: Mesurer le temps jusqu'au premier rendu**

Serveur de dev lancé, carte ouverte sur `#12/33.9294/-118.8008`. Dans la console du navigateur, recharger la page puis exécuter :

```js
const navigation = performance.getEntriesByType("navigation")[0];
map.once("load", () =>
  console.log({
    domContentLoaded: Math.round(navigation.domContentLoadedEventEnd),
    styleLoad: Math.round(performance.now()),
    layers: map.getStyle().layers.length,
    sources: Object.keys(map.getStyle().sources).length,
  }),
);
```

`styleLoad` est la mesure qui compte : le nombre de millisecondes entre la navigation et le moment où la carte est prête.

- [ ] **Step 3: Consigner les mesures et trancher**

Écrire `docs/superpowers/plans/2026-08-13-mesures.md` avec : nombre de couches, taille du style, temps de construction, temps de parsing, temps jusqu'au premier rendu, et la conclusion.

**Critère de bascule :** si `styleLoad` dépasse **3000 ms** sur la machine de développement, arrêter le lot 3 et rouvrir le design sur la découpe géométrique au build (spec §6, risque 1). Sinon, continuer.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-08-13-mesures.md
git commit -m "Record the multi-source style cost measurements"
```

---

## Lot 3 — Masques M_COVR

À n'entamer que si la tâche 10 conclut « continuer ».

### Task 11: Couche masque de couverture par bande

`M_COVR` est déjà dans les tuiles (`CATCOV` est un `Number` valant 1 ou 2) et n'est stylé par aucune couche. Une couche `fill` opaque sur `CATCOV = 1`, insérée avant les couches de chaque bande sauf la première, efface les bandes inférieures à l'intérieur de l'emprise de la bande.

**Files:**

- Modify: `packages/styles/src/symbolology/index.ts`
- Modify: `packages/styles/src/index.ts`
- Modify: `packages/styles/test/multi-source.test.ts`

**Interfaces:**

- Consumes: `LayerConfig.sources` (tâche 7).
- Produces: `LayerConfig.masks: boolean` ; les couches d'identifiant `<source>-coverage-mask`.

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à `packages/styles/test/multi-source.test.ts` :

```ts
test("masks every band but the first, right before its own layers", () => {
  const style = createStyle({ sources: allBands });
  const ids = style.layers.map((layer) => layer.id);

  expect(ids).not.toContain("overview-coverage-mask");

  for (const [position, band] of BANDS.entries()) {
    if (position === 0) continue;

    const previous = BANDS[position - 1]!.name;
    const mask = ids.indexOf(`${band.name}-coverage-mask`);
    const first = ids.findIndex((id) => id.startsWith(`${band.name}-0-`));
    const lastPrevious = ids.findLastIndex((id) =>
      id.startsWith(`${previous}-`),
    );

    expect(mask, `${band.name} mask is missing`).toBeGreaterThan(-1);
    expect(mask).toBeGreaterThan(lastPrevious);
    expect(mask).toBeLessThan(first);
  }
});

test("the mask paints the coverage polygons of its own band", () => {
  const style = createStyle({ sources: allBands });
  const mask = style.layers.find(
    (layer) => layer.id === "harbour-coverage-mask",
  );

  expect(mask).toMatchObject({
    type: "fill",
    source: "harbour",
    "source-layer": "M_COVR",
    filter: ["==", ["get", "CATCOV"], 1],
  });
});

test("a single source emits no mask", () => {
  const style = createStyle({ source: vector("test.pmtiles") });

  expect(
    style.layers.some((layer) => layer.id.endsWith("-coverage-mask")),
  ).toBe(false);
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `cd packages/styles && npx vitest --run test/multi-source.test.ts`
Expected: FAIL — `harbour mask is missing`.

- [ ] **Step 3: Implémenter le masque**

Dans `packages/styles/src/symbolology/index.ts`, ajouter `masks` à `LayerConfig` :

```ts
export interface LayerConfig {
  mode: Mode;
  sources: string[];
  /**
   * Paint each band's M_COVR coverage before its own layers, so a larger-scale
   * band erases the smaller-scale bands stacked beneath it.
   */
  masks: boolean;
  shallowDepth: number;
  safetyDepth: number;
  deepDepth: number;
  boundaries?: BoundaryType;
  symbols?: SymbolType;
}
```

Ajouter le constructeur de masque, à côté de `background` :

```ts
/**
 * S-57 guarantees that group 1 objects (LNDARE, DEPARE, UNSARE, DRGARE,
 * FLODOC, HULKES, PONTON) cover the whole interior of an M_COVR CATCOV=1
 * polygon, so painting that polygon and then drawing the band's own fills over
 * it hides everything stacked underneath.
 *
 * One layer covers the whole band: the filter selects features, so a cell that
 * declares several coverage polygons (61 of the 7239 NOAA cells do, up to 8)
 * gets each of them painted, and an interior ring stays a hole the band below
 * shows through.
 */
function coverageMask(
  source: string,
  { mode }: LayerConfig,
): FillLayerSpecification {
  return {
    id: `${source}-coverage-mask`,
    type: "fill",
    source,
    "source-layer": "M_COVR",
    filter: ["==", ["get", "CATCOV"], 1],
    paint: {
      "fill-color": colours[mode].NODTA,
    },
  };
}
```

Ajouter `FillLayerSpecification` à l'import de types `maplibre-gl` en tête de fichier.

Dans `build`, préfixer chaque bande de son masque :

```ts
const layers = config.sources.flatMap((source, position) => {
  // A fresh counter per source keeps ids unique across bands and stable
  // between calls to build().
  let index = 0;
  const nextIndex = () => index++;

  const symbology = Object.values(lookupGroups).flatMap((lookups) => {
    if (!lookups)
      throw new Error(
        "This should never happen but TypeScript insists it can.",
      );

    return lookups.length <= 1
      ? lookups.flatMap((lookup) => lookupToLayers(lookup, source, nextIndex))
      : lookupGroupToLayers(lookups, source, nextIndex);
  });

  // The first band needs no mask: the background layer already covers it.
  return config.masks && position > 0
    ? [coverageMask(source, config), ...symbology]
    : symbology;
});
```

Dans `packages/styles/src/index.ts`, renseigner le champ dans `config` :

```ts
const config: LayerConfig = {
  mode,
  sources: specs.map(([id]) => id),
  masks: !source,
  shallowDepth: 3.0, // meters (9.8 feet)
  safetyDepth: 6.0, // meters (19.6 feet)
  deepDepth: 9.0, // meters (29.5 feet)
};
```

Ajouter `masks: false,` au `LayerConfig` de `packages/styles/test/instructions/index.test.ts`.

- [ ] **Step 4: Vérifier que la suite passe**

Run: `cd packages/styles && npx vitest --run`
Expected: PASS, y compris `index.test.ts` qui revalide le style avec `validateStyleMin`.

Run: `npm run build`
Expected: compilation sans erreur.

- [ ] **Step 5: Commit**

```bash
git add packages/styles/src packages/styles/test
git commit -m "Mask smaller-scale bands with each band's own coverage"
```

### Task 12: `bin/audit-coverage` — garantir l'invariant dont dépend le masque

Le masque ne fonctionne que si **chaque cellule fournit au moins un polygone `M_COVR CATCOV=1`**. Une cellule qui n'en aurait aucun ne masquerait pas la bande inférieure sous son emprise, et le défaut serait invisible sauf à tomber exactement dessus. Sur le jeu NOAA du 2026-08-11, les 7239 cellules respectent l'invariant ; rien ne le garantit pour une livraison future.

**Files:**

- Create: `bin/audit-coverage`
- Modify: `Makefile`

**Interfaces:**

- Consumes: `data/ENC_ROOT/*/*.000`.
- Produces: un échec de build listant les cellules sans `CATCOV=1`.

- [ ] **Step 1: Écrire le script**

`bin/audit-coverage` :

```js
#!/usr/bin/env node
// The band masks paint M_COVR CATCOV=1, so a cell with no coverage polygon
// would silently fail to hide the smaller-scale band beneath it. Fail the build
// instead of shipping an invisible hole.
//
// Usage: bin/audit-coverage [enc-root]

import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = process.argv[2] ?? "data/ENC_ROOT";

const cells = readdirSync(root)
  .map((name) => ({ name, path: join(root, name, `${name}.000`) }))
  .filter((cell) => existsSync(cell.path));

if (cells.length === 0) {
  console.error(`No ENC cells found under ${root}`);
  process.exit(1);
}

async function coveragePolygons({ path }) {
  const { stdout } = await run(
    "ogrinfo",
    ["-q", "-sql", "SELECT CATCOV FROM M_COVR WHERE CATCOV = 1", path],
    { maxBuffer: 256 * 1024 * 1024 },
  );
  return (stdout.match(/^OGRFeature/gm) ?? []).length;
}

const workers = Math.max(1, availableParallelism() - 2);
const queue = [...cells];
const uncovered = [];

await Promise.all(
  Array.from({ length: workers }, async () => {
    for (let cell = queue.pop(); cell; cell = queue.pop()) {
      if ((await coveragePolygons(cell)) === 0) uncovered.push(cell.name);
    }
  }),
);

if (uncovered.length > 0) {
  console.error(
    `${uncovered.length} of ${cells.length} cells have no M_COVR CATCOV=1 polygon, so the band mask would not cover them:\n  ${uncovered.sort().join("\n  ")}`,
  );
  process.exit(1);
}

console.log(`${cells.length} cells all declare their coverage`);
```

```bash
chmod +x bin/audit-coverage
```

- [ ] **Step 2: Vérifier sur un sous-ensemble connu**

```bash
mkdir -p /tmp/audit-ok/US3TE400 /tmp/audit-ok/US5CA63M
cp data/ENC_ROOT/US3TE400/US3TE400.000 /tmp/audit-ok/US3TE400/
cp data/ENC_ROOT/US5CA63M/US5CA63M.000 /tmp/audit-ok/US5CA63M/
bin/audit-coverage /tmp/audit-ok
```

Expected: `2 cells all declare their coverage`, statut 0. Ces deux cellules ont respectivement 8 et 3 polygones de couverture : l'audit compte les entités, pas les cellules à un polygone.

- [ ] **Step 3: Vérifier le chemin d'échec**

```bash
mkdir -p /tmp/audit-ko/US5NOCOV
printf '' > /tmp/audit-ko/US5NOCOV/US5NOCOV.000
bin/audit-coverage /tmp/audit-ko
```

Expected: statut non nul, et un message nommant `US5NOCOV`. Le fichier vide n'est pas un ENC lisible : `ogrinfo` échoue, `run` rejette, et le rejet non capturé fait sortir Node en erreur. Une cellule illisible ne doit jamais être comptée comme « 0 polygone » en silence, ni comme « couverte ».

- [ ] **Step 4: Lancer l'audit complet**

Run: `time bin/audit-coverage`
Expected: `7239 cells all declare their coverage`, en environ 3 minutes.

- [ ] **Step 5: Brancher l'audit sur le build**

Dans le `Makefile`, ajouter une cible et la placer en dépendance de la conversion :

```make
.PHONY: all clean data audit

audit:
	bin/audit-coverage $(ENC_DIR)
```

et faire dépendre la cible de join de l'audit :

```make
$(TILES_DIR)/.bands.stamp: audit $(TILES)
```

Run: `make -n | head -3`
Expected: `bin/audit-coverage data/ENC_ROOT` apparaît avant les conversions.

- [ ] **Step 6: Commit**

```bash
git add bin/audit-coverage Makefile
git commit -m "Fail the build when a cell declares no coverage polygon"
```

### Task 13: Non-régression bout en bout, y compris couverture multi-polygones

C'est le test qui échoue avec le pipeline d'origine et qui doit passer une fois le lot 3 en place.

La paire de cartes est choisie pour couvrir **en même temps** le cas simple et le cas multi-polygones : la Coastal `US3CA70M` contient la Harbour `US5CA63M` (Los Angeles / Long Beach, emprise -118,824 / 33,759 → -118,371 / 34,071), qui a **3 polygones de couverture disjoints, dont un avec un anneau intérieur**. Le masque doit donc laisser réapparaître la Coastal entre les trois polygones et dans le trou, pas seulement à l'extérieur de l'emprise globale.

**Files:**

- Create: `bin/fixture-tiles`

**Interfaces:**

- Consumes: `bin/s57-to-tiles` (tâche 1), `bin/join-bands` (tâche 5).
- Produces: `public/tiles/fixture-coastal.pmtiles` et `public/tiles/fixture-harbour.pmtiles` pour la vérification manuelle.

- [ ] **Step 1: Écrire le script de fixture**

`bin/fixture-tiles` :

```bash
#!/usr/bin/env bash
# Builds a two-chart tileset for verifying band stacking by hand.
#
# US3CA70M (coastal) contains US5CA63M (harbour), and US5CA63M declares three
# disjoint coverage polygons, one of them with an interior ring — so this pair
# also exercises the multi-polygon and hole cases of the M_COVR mask.
#
# Usage: bin/fixture-tiles [output-dir]

set -e

out="${1:-public/tiles}"
charts=(US3CA70M US5CA63M)

mkdir -p "$out"

for chart in "${charts[@]}"; do
  bin/s57-to-tiles "data/ENC_ROOT/$chart/$chart.000" "$out/charts/$chart.pmtiles"
done

bin/join-bands --prefix "$out/fixture" "$out"/charts/*.pmtiles
```

```bash
chmod +x bin/fixture-tiles
```

- [ ] **Step 2: Générer les fixtures**

Run: `bin/fixture-tiles`
Expected: `coastal: 1 charts -> public/tiles/fixture-coastal.pmtiles` et `harbour: 1 charts -> public/tiles/fixture-harbour.pmtiles`.

- [ ] **Step 3: Vérifier que les trois polygones de couverture arrivent dans les tuiles**

```bash
ogrinfo -q -sql "SELECT CATCOV FROM M_COVR WHERE CATCOV = 1" \
  public/tiles/fixture-harbour.pmtiles | grep -c '^OGRFeature'
```

Expected: un nombre nettement supérieur à 3 — les polygones sont découpés par tuile. Ce qui compte est que le compte soit non nul aux deux niveaux de zoom de la bande ; si `M_COVR` disparaissait à z13 ou z14, le masque disparaîtrait avec.

- [ ] **Step 4: Vérifier le quilting dans le viewer**

Pointer temporairement le viewer sur les fixtures en ajoutant à `.env.local` :

```
VITE_TILES_URL=http://localhost:5173/tiles/
VITE_TILESET_PREFIX=fixture
```

Lancer le serveur de dev via l'outil de preview et vérifier, aux positions suivantes — toutes calculées à partir des géométries réelles :

| Position                | Attendu                                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `#14/33.9294/-118.8008` | dans la couverture Harbour : la Harbour est dessinée, aucun trait ni symbole de la Coastal ne transparaît                                                           |
| `#14/33.8557/-118.8005` | **hors couverture Harbour mais dans la Coastal** : la Coastal réapparaît. C'est le cœur du cas multi-polygones — si la Coastal reste masquée ici, le masque déborde |
| `#15/33.8405/-118.3970` | polygone Harbour 1 : Harbour dessinée                                                                                                                               |
| `#15/33.9787/-118.4709` | polygone Harbour 2 : Harbour dessinée                                                                                                                               |
| `#15/33.9935/-118.7230` | polygone Harbour 3 (celui à anneau intérieur) : Harbour dessinée                                                                                                    |
| `#13/33.4000/-118.8000` | dans la Coastal, loin de la Harbour : Coastal surzoomée. **C'est le cas qui rendait un écran vide avant le chantier.**                                              |

Prendre une capture d'écran des trois premiers cas.

Une fois la vérification faite, retirer `VITE_TILESET_PREFIX=fixture` de `.env.local` pour que le viewer repointe sur les archives complètes. `.env.local` est ignoré par git, il n'y a rien à committer.

- [ ] **Step 5: Vérifier l'hypothèse « skin of the earth » (spec §6, risque 4)**

À `#14/33.9294/-118.8008`, chercher des aplats de la couleur NODTA à l'intérieur de la couverture Harbour. Leur présence signifierait qu'un objet du groupe 1 manque et que le masque laisse un trou. Consigner le résultat dans `docs/superpowers/plans/2026-08-13-mesures.md`.

- [ ] **Step 6: Commit**

```bash
git add bin/fixture-tiles docs/superpowers/plans/2026-08-13-mesures.md
git commit -m "Add a two-chart fixture covering multi-polygon coverage"
```

### Task 14: Mesurer la collision de symboles entre bandes masquées — point de bascule

Le masque agit à la peinture, mais le placement des symboles dans MapLibre est global : les couches `symbol` d'une bande masquée participent quand même à la détection de collision et, déclarées avant celles de la bande visible, elles gagnent la priorité de placement (spec §6, risque 2).

**Files:**

- Modify: `docs/superpowers/plans/2026-08-13-mesures.md`

**Interfaces:**

- Consumes: les fixtures de la tâche 13.
- Produces: la décision de conserver le design par masque ou de rouvrir sur la découpe géométrique.

- [ ] **Step 1: Compter les étiquettes rendues avec et sans la bande inférieure**

Serveur de dev lancé sur les fixtures, carte à `#14/33.9294/-118.8008`. Dans la console du navigateur :

```js
const labelled = () =>
  map.queryRenderedFeatures().filter((f) => f.layer.type === "symbol").length;

const withCoastal = labelled();

// Hide every coastal layer, which removes them from symbol placement entirely.
map
  .getStyle()
  .layers.filter((l) => l.id.startsWith("coastal-"))
  .forEach((l) => map.setLayoutProperty(l.id, "visibility", "none"));

map.once("idle", () =>
  console.log({ withCoastal, withoutCoastal: labelled() }),
);
```

- [ ] **Step 2: Consigner et trancher**

Ajouter les deux nombres à `docs/superpowers/plans/2026-08-13-mesures.md`, avec une capture d'écran avant / après.

**Critère de bascule :** si masquer la bande Coastal fait apparaître plus de **10 %** de symboles supplémentaires sur la bande Harbour, le placement est effectivement volé par la bande invisible. Ouvrir alors un chantier de suivi sur la découpe géométrique au build, qui supprime le problème à la racine. En dessous de ce seuil, conserver le design par masque.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-08-13-mesures.md
git commit -m "Record the cross-band symbol collision measurements"
```

---

## Lot 4 — Profondeurs des sondes

Indépendant des lots 2 et 3. Nécessite une reconversion complète des 7239 cartes (~22 min en local).

### Task 15: Exposer `DEPTH` sur la couche `SOUNDG`

`ogr2ogr` émet aujourd'hui `Warning 1: Attempt to write Z geometries to layer SOUNDG that does not support them. Z component will be discarded`. Pour les sondes S-57, la profondeur **est** la coordonnée Z : elle est donc perdue. `OGR_S57_OPTIONS="SPLIT_MULTIPOINT=ON,ADD_SOUNDG_DEPTH=ON"` éclate les multipoints en points et ajoute un attribut `DEPTH (Real)`. Mesuré sur `US509890` : 976 K → 1,0 M (+5 %) et 3 features → 2681 sondes.

**Files:**

- Modify: `bin/s57-to-tiles`
- Create: `test/soundg.test.ts`

**Interfaces:**

- Consumes: `bin/s57-to-tiles` (tâche 1).
- Produces: l'attribut `DEPTH` sur `SOUNDG` dans les tuiles.

- [ ] **Step 1: Écrire le test qui échoue**

`test/soundg.test.ts` :

```ts
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

// The depth of an S-57 sounding is its Z coordinate, which MVT cannot carry.
// These GDAL options split the multipoints and lift the depth into an
// attribute, so the style has something to label.
test("the conversion asks GDAL for sounding depths", () => {
  const script = readFileSync("bin/s57-to-tiles", "utf8");

  expect(script).toMatch(/OGR_S57_OPTIONS=/);
  expect(script).toMatch(/SPLIT_MULTIPOINT=ON/);
  expect(script).toMatch(/ADD_SOUNDG_DEPTH=ON/);
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npx vitest --run test/soundg.test.ts`
Expected: FAIL — `OGR_S57_OPTIONS` absent du script.

- [ ] **Step 3: Passer les options à GDAL**

Dans `bin/s57-to-tiles`, juste après `set -e` :

```bash
# The depth of an S-57 sounding is carried in the Z coordinate, which MVT drops.
# SPLIT_MULTIPOINT turns each SOUNDG multipoint into individual points and
# ADD_SOUNDG_DEPTH lifts the depth into a DEPTH attribute the style can read.
export OGR_S57_OPTIONS="SPLIT_MULTIPOINT=ON,ADD_SOUNDG_DEPTH=ON"
```

- [ ] **Step 4: Vérifier que le test passe**

Run: `npx vitest --run test/soundg.test.ts`
Expected: PASS.

- [ ] **Step 5: Vérifier sur une vraie carte**

```bash
bin/s57-to-tiles data/ENC_ROOT/US509890/US509890.000 /tmp/soundg.pmtiles
ogrinfo -q -so /tmp/soundg.pmtiles SOUNDG | grep -i depth
```

Expected: le champ `DEPTH` figure dans le schéma de la couche `SOUNDG`.

- [ ] **Step 6: Reconvertir et rejoindre**

Run: `rm -rf tiles && make -j$(sysctl -n hw.ncpu)`
Expected: la conversion complète aboutit ; taille totale de `tiles/` en hausse d'environ 5 %.

- [ ] **Step 7: Commit**

```bash
git add bin/s57-to-tiles test/soundg.test.ts
git commit -m "Carry sounding depths into the tiles"
```

---

## Hors périmètre

`CS(SOUNDG03)` n'est pas implémentée : le style ne contient **aucune couche `SOUNDG`**, donc la tâche 15 rend la donnée disponible sans la rendre visible. Même situation pour `CS(LIGHTS06)`, `CS(OBSTRN07)`, `CS(WRECKS05)`, `CS(RESARE04)`, `CS(SLCONS04)`, `CS(SYMINS02)`, `CS(TOPMAR01)` et `CS(QUAPOS01)`. Ces procédures de symbologie conditionnelle font l'objet d'un chantier séparé.
