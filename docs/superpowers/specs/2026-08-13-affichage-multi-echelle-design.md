# Affichage multi-échelle des ENC — design

Date : 2026-08-13
Statut : validé, prêt pour le plan d'implémentation

## 1. Problème

La très grande majorité des cartes NOAA téléchargées ne s'affiche pas dans le
viewer, alors que le pipeline de tuilage ne perd aucune carte.

Vérifications menées sur le build local du 2026-08-11 :

| Contrôle                                    | Résultat                                           |
| ------------------------------------------- | -------------------------------------------------- |
| Dossiers ENC dans `data/ENC_ROOT`           | 7239                                               |
| `.pmtiles` produits par carte               | 7239 / 7239, aucun vide, aucun corrompu            |
| Entrées effectivement passées à `tile-join` | 7239 (lues dans `generator_options`)               |
| Plages de zoom par carte                    | conformes à la bande DSID_INTU dans 7239 cas       |
| `tiles/noaa.pmtiles`                        | `minzoom` 0, `maxzoom` 16, 303 408 tuiles, 1,36 Go |

Les warnings observés pendant le build (`organizePolygons() … more than 100
parts`) sont des avertissements de performance sans effet sur les données.

## 2. Cause racine

`bin/s57-to-tiles` attribue à chaque carte une plage de zoom **fermée et
disjointe** selon sa bande d'utilisation :

```
Overview z0–6 | General z7–8 | Coastal z9–10 | Approach z11–12 | Harbour z13–14 | Berthing z15–16
```

Tout est ensuite fusionné dans une **source vectorielle unique**. MapLibre ne
demande qu'un seul niveau de zoom à la fois et ne substitue pas la tuile parente
quand une tuile est absente — le surzoom n'existe qu'au-delà du `maxzoom` de la
source, qui vaut 16 ici. **Au zoom N, seules les cartes de la bande couvrant N
sont affichées ; toutes les autres sont invisibles.**

Comme les bandes ne couvrent pas la même géographie, la surface visible
s'effondre à chaque palier. Surfaces normalisées en équivalent-tuiles z14 :

```
z8  General     11 427 840
z9  Coastal      3 574 784   -69 %
z10 Coastal      3 289 088
z11 Approach     1 365 184   -58 %
z12 Approach     1 261 328
z13 Harbour        150 480   -88 %
z14 Harbour        134 995
z15 Berthing           551   -99,6 %
```

Mesure des trous de couverture entre bandes, par recherche d'ancêtre de tuile :

- 35 % des tuiles Harbour (z14) n'ont aucun ancêtre en bande Overview (z6)
- 18 % n'ont aucun ancêtre en bande Coastal (z10)
- 10 % n'ont aucun ancêtre en bande Approach (z12)
- 73 % des tuiles z14 disparaissent au passage à z15

Aggravant : `src/index.ts` ouvre la carte à `zoom: header.maxZoom` = 16, niveau
où seules les 64 cartes Berthing existent.

## 3. Contraintes mesurées

### 3.1 Étendre `MAXZOOM` à 16 est impraticable

| Carte                 | plage actuelle  | étendue à z16                   | facteur |
| --------------------- | --------------- | ------------------------------- | ------- |
| `US509890` (Harbour)  | z13–14 → 976 KB | z13–16 → 3,5 MB                 | ×3,6    |
| `US409890` (Approach) | z11–12 → 1,6 MB | z11–16 → 15 MB                  | ×9,4    |
| `US3AK1AE` (Coastal)  | z9–10 → 496 KB  | z9–16 → n'a pas abouti en 2 min | ~×60    |

Chaque niveau de zoom supplémentaire double approximativement le volume.
Extrapolé aux 7239 cartes : 10 à 30 Go au lieu de 1,5 Go. **Écarté.**

Conséquence : le surzoom côté client est le seul mécanisme viable, et il impose
plusieurs sources.

### 3.2 Le découpage par bande est quasi gratuit

| Bande           | Cartes | Volume  |
| --------------- | ------ | ------- |
| Overview z0–6   | 16     | 0,02 Go |
| General z7–8    | 92     | 0,04 Go |
| Coastal z9–10   | 329    | 0,15 Go |
| Approach z11–12 | 2256   | 0,58 Go |
| Harbour z13–14  | 4482   | 0,72 Go |
| Berthing z15–16 | 64     | 0,01 Go |

Aucune reconversion des 7239 cartes n'est nécessaire pour le découpage : six
`tile-join` au lieu d'un.

### 3.3 Coût côté style

Le style S-52 généré fait **1162 couches / 884 KB** pour une source. Six sources
portent le style à environ **6972 couches / 5,3 MB**. Le coût par tuile est
inchangé — une tuile n'exécute que les couches liées à sa source — le surcoût
porte sur le parsing initial du style et sur six `SourceCache`.

## 4. Architecture retenue

Six archives, une source MapLibre par bande, chacune déclarant son propre
`maxzoom`. C'est ce `maxzoom` qui déclenche le surzoom natif de MapLibre
(`OverscaledTileID`, présent dans la version installée).

| Archive                 | `minzoom` / `maxzoom` | Au-delà   |
| ----------------------- | --------------------- | --------- |
| `noaa-overview.pmtiles` | 0 / 6                 | surzoomée |
| `noaa-general.pmtiles`  | 7 / 8                 | surzoomée |
| `noaa-coastal.pmtiles`  | 9 / 10                | surzoomée |
| `noaa-approach.pmtiles` | 11 / 12               | surzoomée |
| `noaa-harbour.pmtiles`  | 13 / 14               | surzoomée |
| `noaa-berthing.pmtiles` | 15 / 16               | —         |

Le style empile les bandes de la plus petite à la plus grande échelle, en
intercalant un masque avant chaque bande sauf la première :

```
background
[Overview  : 1162 couches]
mask-general      fill M_COVR CATCOV=1, couleur NODTA, source = general
[General   : 1162 couches]
mask-coastal
[Coastal   : 1162 couches]
mask-approach
[Approach  : 1162 couches]
mask-harbour
[Harbour   : 1162 couches]
mask-berthing
[Berthing  : 1162 couches]
```

Le masque exploite la garantie S-57 « skin of the earth » : à l'intérieur de
`M_COVR CATCOV=1`, les objets du groupe 1 (`LNDARE`, `DEPARE`, `UNSARE`,
`DRGARE`, `FLODOC`, `HULKES`, `PONTON`) couvrent 100 % de la surface. Peindre la
couverture de la bande _k_ en NODTA puis dessiner ses remplissages par-dessus
efface donc complètement les bandes inférieures, sans aucune découpe géométrique
au build.

`M_COVR` est déjà présent dans les tuiles et n'est stylé par aucune couche
aujourd'hui (vérifié : 0 couche `M_COVR` dans le style généré).

### 4.1 Une cellule peut avoir plusieurs polygones de couverture

Le masque est une couche filtrée sur l'attribut (`CATCOV = 1`), pas une emprise
rectangulaire par cellule : MapLibre peint **toutes** les entités qui passent le
filtre, quel que soit leur nombre, et un anneau intérieur reste un trou. Le
design ne suppose donc nulle part un polygone unique par cellule. Scan des 7239
cellules NOAA :

| Polygones `CATCOV=1` par cellule | Cellules       |
| -------------------------------- | -------------- |
| 1                                | 7178           |
| 2                                | 51             |
| 3                                | 9              |
| 8                                | 1 (`US3TE400`) |

- **0 cellule sans `CATCOV=1`.** C'est l'invariant dont dépend le masque : une
  cellule sans polygone de couverture ne masquerait pas la bande inférieure. Un
  audit le vérifie au build (§5.7).
- **16 cellules ont des anneaux intérieurs** (jusqu'à 4 anneaux pour
  `US5CA50M`), dont 14 en bande Harbour.
- Toutes les géométries sources sont des `POLYGON`, aucun `MULTIPOLYGON`, et
  aucune valeur de `CATCOV` autre que 1 (couverture) ou 2 (pas de couverture).

Deux vérifications par échantillonnage de points confirment que le tuilage
préserve la forme réelle de la couverture — GDAL découpe les polygones troués en
morceaux mono-anneau qui contournent correctement les trous :

- `US5CA50M` (1 polygone, 3 trous) : 0 point sur 200 tirés à l'intérieur de
  chaque trou serait peint par le masque.
- `US3TE400` (8 polygones disjoints) : 0 point sur 300 tirés dans la zone
  `CATCOV=2` qui les sépare serait peint par le masque.

Le résultat corrige les deux directions :

- **En zoomant** : à z13 on voit Harbour où elle existe, Approach là où il n'y a
  pas de Harbour, Coastal là où il n'y a ni l'un ni l'autre.
- **En dézoomant** : à z9 on ne voit plus uniquement Coastal ; les zones sans
  ancêtre Coastal montrent General ou Overview au lieu du vide.

## 5. Composants

### 5.1 `bin/s57-to-tiles`

- Ajouter `OGR_S57_OPTIONS="SPLIT_MULTIPOINT=ON,ADD_SOUNDG_DEPTH=ON"`, qui
  produit un attribut `DEPTH (Real)` sur `SOUNDG` et éclate les multipoints en
  points individuels. Mesuré : +5 % de volume (976 K → 1,0 M) et 3 features →
  2681 sondes sur `US509890`.
- Sortir en erreur si `ogrinfo` échoue ou si `DSID_INTU` est hors 1–6.
  Aujourd'hui le script émet un `echo` puis lance `ogr2ogr` avec
  `-dsco MINZOOM= -dsco MAXZOOM=`, ce qui produit une archive z0/z0 et retourne 0. Aucune carte du build actuel n'est concernée, mais le défaut est latent.

### 5.2 `bin/join-bands` (nouveau)

Script Node. Lit les 127 octets d'en-tête de chaque `tiles/*/*.pmtiles`, groupe
les fichiers par `minzoom`, et appelle `tile-join` une fois par bande. Pas
d'appel GDAL, pas de fichier annexe. Détecte au passage les archives z0/z0
issues du défaut ci-dessus et échoue explicitement.

Remplace le `tile-join … tiles/**/*.pmtiles` du `Makefile`, dont le `**` n'est
pas récursif en `sh` et ne fonctionne que par coïncidence avec la structure plate
de NOAA.

### 5.3 `Makefile`

- Cible `all` produisant les six archives.
- Glob explicite à un niveau (`$(ENC_DIR)/*/*.000`) au lieu de `**`.
- Supprimer les `.pmtiles` périmés avant le join, pour qu'une carte retirée du
  jeu de données ne survive pas dans l'archive fusionnée.

### 5.4 `packages/styles`

- `createStyle` accepte `sources: Record<Band, VectorSourceSpecification>`. La
  forme `source:` actuelle reste supportée et produit le style mono-source
  d'aujourd'hui — c'est ce qui garde les tests existants valides et permet aux
  consommateurs externes du paquet de ne rien changer.
- `symbolology/index.ts` : `source: "enc"` codé en dur dans `lookupToLayers`
  devient un paramètre.
- `symbolology/index.ts` : le compteur d'identifiants `i` est actuellement un
  module-global qui n'est jamais réinitialisé ; il doit être scopé à l'appel de
  `build`, sinon les identifiants de couches dérivent entre les six passes et
  entre deux appels successifs de `createStyle`.
- Nouvelle fonction produisant la couche masque d'une bande : `fill`,
  `source-layer: M_COVR`, `filter: ["==", ["get", "CATCOV"], 1]`,
  `fill-color: colours[mode].NODTA`. Une seule couche par bande, quel que soit le
  nombre de polygones de couverture des cellules qu'elle contient (§4.1).

### 5.5 `src/index.ts`

- Enregistrer les six archives sur le protocole PMTiles.
- Remplacer `zoom: header.maxZoom` par `zoom: 12`, milieu de la bande Approach,
  qui est le premier niveau offrant à la fois une couverture large et un niveau
  de détail lisible.
- Centre de la carte : lire l'en-tête de l'archive Harbour et utiliser son
  `centerLon` / `centerLat`, plutôt que celui de l'archive unique.

### 5.6 CI et publication

- `.github/workflows/tiles.yml` : uploader les six fichiers vers R2.
- `.env` : `VITE_TILESET` (aujourd'hui `noaa.pmtiles`) devient `VITE_TILESET_PREFIX`
  (`noaa`), le viewer composant les six noms de fichiers
  `<prefix>-<bande>.pmtiles`.

Contrainte : `tiles.yml` est désactivé sur le fork `amnesic/enc-tiles` et le
fork n'a pas les secrets R2. La modification du workflow ne peut donc pas être
validée en exécution avant la fusion en amont ; elle doit être relue à la main.

### 5.7 `bin/audit-coverage` (nouveau)

Le masque repose sur un invariant : **chaque cellule fournit au moins un polygone
`M_COVR CATCOV=1`**. Une cellule qui n'en aurait aucun ne masquerait pas la bande
inférieure sous son emprise, et le défaut serait invisible sauf à tomber
exactement dessus.

Script Node lançant `ogrinfo` en parallèle sur `data/ENC_ROOT/*/*.000`, qui
échoue en listant les cellules sans `CATCOV=1`. Environ 3 min sur les 7239
cellules avec 10 processus. Appelé une fois par `make`, avant la conversion — pas
une fois par cellule.

## 6. Risques et points de bascule

1. **Volume du style (~6972 couches / 5,3 MB).** C'est le pari central du
   design. À mesurer au lot 2 : temps de parsing du style et temps jusqu'au
   premier rendu. Si le résultat est inacceptable, repli sur la découpe
   géométrique au build (clip de chaque carte par l'union des couvertures des
   bandes de plus grande échelle), qui ramène le style à 1162 couches.

2. **Collision des symboles entre bandes masquées.** Le masque agit à la
   peinture : il recouvre visuellement les remplissages, lignes et symboles des
   bandes inférieures. Mais le placement des symboles de MapLibre est global et
   ignore ce qui est peint par-dessus. Les 728 couches `symbol` d'une bande
   masquée participent donc à la détection de collision, et comme elles sont
   déclarées avant celles de la bande visible, elles gagnent la priorité de
   placement. Conséquence possible : des étiquettes manquantes sur la carte
   effectivement visible. À mesurer au lot 3. Aucune correction simple n'existe
   à l'intérieur du design par masque — réordonner les blocs de symboles
   résoudrait le placement mais casserait le masquage visuel. Ce risque est le
   second déclencheur possible du repli sur la découpe géométrique, qui le
   supprime structurellement.

3. **Surzoom profond.** La bande Overview est étirée de z6 à z16 là où aucune
   autre carte n'existe. Les tuiles concernées sont petites (~64 KB à z6), donc
   sans coût de rendu notable, mais le résultat est grossier. Acceptable : mieux
   qu'un écran vide.

4. **Hypothèse « skin of the earth ».** Le masque suppose que les objets du
   groupe 1 couvrent intégralement l'intérieur de `M_COVR CATCOV=1`. Un ENC qui
   violerait cette garantie laisserait apparaître du NODTA. À vérifier
   visuellement au lot 3. La forme de la couverture elle-même n'est plus un
   risque : le nombre de polygones par cellule et leurs trous sont mesurés et
   traversent le tuilage intacts (§4.1).

5. **Une cellule sans `CATCOV=1`** ne masquerait pas la bande inférieure sous son
   emprise. Aucune des 7239 cellules du jeu NOAA courant n'est dans ce cas, mais
   rien ne le garantit pour une livraison future ni pour un autre producteur.
   `bin/audit-coverage` (§5.7) transforme cette hypothèse en échec de build.

6. **Reconversion complète** nécessaire pour le correctif SOUNDG : ~22 min en
   local d'après l'horodatage du build précédent (22:21 → 22:43).

## 7. Tests

- **`packages/styles`** (vitest existant) : six sources produisent cinq masques
  dans le bon ordre ; chaque couche pointe la source de sa bande ; les
  identifiants sont uniques et stables entre deux appels successifs de
  `createStyle` ; la forme mono-source produit un style identique à l'actuel.
- **`bin/join-bands`** : classement par `minzoom` ; échec explicite sur une
  archive z0/z0 ; échec explicite sur un `minzoom` hors des six valeurs
  attendues.
- **`bin/audit-coverage`** : échec listant les cellules sans `CATCOV=1`.
- **Non-régression du bug** : deux cartes qui se recouvrent, tuilées et jointes
  en deux bandes, puis vérification dans le viewer qu'à z13 la Coastal est rendue
  hors emprise Harbour et masquée à l'intérieur. C'est le test qui échoue avec le
  pipeline actuel et qui doit passer après le lot 3.

  La paire retenue couvre en même temps le cas multi-polygones : la Coastal
  `US3CA70M` contient la Harbour `US5CA63M`, qui a **3 polygones de couverture et
  des anneaux intérieurs** (Los Angeles / Long Beach). Le test vérifie donc aussi
  que la Coastal réapparaît entre les trois polygones et dans les trous, et pas
  seulement à l'extérieur de l'emprise globale.

## 8. Lots

| Lot | Contenu                                                                                                      | Note                                            |
| --- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| 1   | Robustesse du pipeline : sortie en erreur sur INTU inconnu, glob explicite, nettoyage des `.pmtiles` périmés | indépendant, mergeable seul                     |
| 2   | Découpage par bande, `bin/join-bands`, viewer multi-sources, CI et R2 — **sans masque**                      | l'écran vide disparaît ici ; mesure du risque 1 |
| 3   | Masques `M_COVR`, ordre de dessin, `bin/audit-coverage`                                                      | quilting ; mesure des risques 2 et 4            |
| 4   | `OGR_S57_OPTIONS` pour `SOUNDG` et reconversion                                                              | ajoute `DEPTH` aux tuiles                       |

## 9. Hors périmètre

`CS(SOUNDG03)` n'est pas implémentée dans `packages/styles`, si bien que le
style ne contient **aucune couche `SOUNDG`**. Ajouter `DEPTH` aux tuiles (lot 4)
est nécessaire mais pas suffisant : les sondes ne s'afficheront pas tant que la
symbologie conditionnelle n'est pas écrite. Même situation pour `LIGHTS06`,
`OBSTRN07`, `WRECKS05`, `RESARE04`, `SLCONS04`, `SYMINS02`, `TOPMAR01` et
`QUAPOS01`.

L'implémentation de ces procédures de symbologie conditionnelle fait l'objet
d'un chantier séparé. Le lot 4 se limite à rendre la donnée disponible dans les
tuiles.
