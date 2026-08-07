# S-57 to Vector Tiles: Attribute Encoding

The MVT (Mapbox Vector Tile) format only supports scalar property values — string,
number, and bool. There is no array type. S-57 defines many **list-type attributes**
(StringList) that hold multiple values per feature:

| Attribute | Description       | Example                   |
| --------- | ----------------- | ------------------------- |
| COLOUR    | Colour(s)         | `3,4,3` (red, green, red) |
| RESTRN    | Restriction(s)    | `7,8`                     |
| CATLIT    | Category of light | `4,13`                    |
| STATUS    | Status            | `1,2`                     |
| COLPAT    | Colour pattern    | `1`                       |
| NATSUR    | Nature of surface | `9,11`                    |

These must be serialized to strings for MVT tiles. This document describes the
encoding that the S-52 styles in this project expect, and how to produce it.

## Required Encoding

List-type attributes must be stored as **comma-separated strings** — matching the
S-52 lookup table format directly:

```
COLOUR = "3"           -- single value
COLOUR = "3,4,3"       -- multiple values (order preserved)
RESTRN = "7,8,14"      -- multiple values
```

Scalar attributes keep the type the S-57 driver gives them, which is **not**
always a string:

```
BCNSHP = 1           -- enumerated: INTEGER
CATZOC = 2           -- enumerated: INTEGER
VALDCO = 10.0        -- real:       DOUBLE
OBJNAM = "Foo Rock"  -- free text:  STRING
```

This matters because the S-52 look-up tables express _every_ condition as a
string (`ATTV = "1"`), so a filter that compares `["get", "BCNSHP"]` to `"1"`
never matches an integer 1 — MapLibre's `==` is type-strict. See
[Style Matching](#style-matching).

Each S-57 object class becomes a vector tile layer with the same name:
`LIGHTS`, `BCNLAT`, `DEPARE`, `SOUNDG`, etc.

### Attributes added to S-57 layers

Two of them are not S-57 attributes at all, and are added at step 2:

| Attribute | On       | Contents                                                                                                                                                                     |
| --------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INTU`    | every    | The cell's navigational purpose, so a style can prefer the finer chart where two overlap.                                                                                    |
| `DSNM`    | `M_COVR` | The cell's own 8-character name, from `DSID_DSNM` with its `.000`/`.001` extension stripped. On the coverage polygon ALONE — that is what a pick resolves the chart through. |

BUAARE is also **dissolved by name** at step 2: `ST_Union` grouped by `OBJNAM`,
per cell, so the shared border between two fragments of one town is not stroked
as though it separated two places. A NULL or empty `OBJNAM` is left alone —
"neither has a name" is not evidence that two areas are the same place — and
fragments of one name that do not touch come out as a MultiPolygon, which draws
exactly as they did. Borders remain between differently-named areas, which is
correct, and at CELL SEAMS, which is not: the other half of a town is in a
different chart and a different GPKG. Accepted for now.

## Derived layers

`bin/s57-to-tiles` also emits layers that are not S-57 object classes. They
carry information a MapLibre style cannot compute at render time — cross-feature
spatial relationships and geometry MapLibre cannot draw. Their names all start
with an underscore.

| Layer             | Built by                    | Contents                                                                                                                                                                               |
| ----------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_LIGHTS_SECTORS` | `bin/generate-sector-arcs`  | LineString arcs and radial legs for sector lights (LIGHTS06) — one copy per zoom, see below.                                                                                           |
| `_DEPARE_EDGE`    | `bin/generate-depare-edges` | Shared edges of the DEPARE/DRGARE partition, with `DRVAL_LO`/`DRVAL_HI` on either side, a coincident `VALDCO`, and `SEAM` where the quilt clip or the cell's own M_COVR ring cut them. |
| `_LABELS`         | `bin/generate-labels`       | One point per (`OBJNAM`, `INTU`) group of LNDARE/LNDRGN/SEAARE/BUAARE, with `CLASS` and the group's `AREA`.                                                                            |
| `_MQUAL_EDGE`     | `bin/generate-mqual-edges`  | M_QUAL boundaries where the zone of confidence CHANGES, with `CATZOC_LO`/`CATZOC_HI` on either side — see below.                                                                       |
| `_TSS_ANCHORS`    | `bin/generate-tss-anchors`  | One arrow anchor per traffic-lane leg — see below. Carries `CLASS`, `INTU`, `ORIENT`, `AREA`.                                                                                          |

### `_MQUAL_EDGE`

M_QUAL is a meta-object: it tiles the survey into zones of confidence, and its
polygons are split for reasons that have nothing to do with quality — the
topology they were digitised against, and above all the edge of the chart.
Stroking M_QUAL's own boundaries therefore rules a single CATZOC 2 survey into
one box per cell.

Segments are hashed exactly as `_DEPARE_EDGE`'s are, and one is emitted only
where its two sides DIFFER:

- Two zones of the same `CATZOC` — the interior split. Dropped.
- A zone beside no zone at all — emitted with `CATZOC_LO` = −1, which is also
  what a neighbour carrying no `CATZOC` reads as, so two unassessed zones side
  by side draw nothing between them.
- A segment lying along a quilt cut (`--coverage`) or along this cell's own
  M_COVR ring (`--cell-coverage`) — **dropped**, not flagged. The zone
  continues into the next chart at a confidence this cell cannot see, and
  asserting a change there is the defect. This is the one place `_MQUAL_EDGE`
  parts company with `_DEPARE_EDGE`, which flags its seams because the safety
  contour still has to be drawn along them.

`CATZOC_LO` is the numerically LOWER of the two, which by S-57's numbering
(1 = A1 … 6 = unassessed) is the better-surveyed side. There is no `DIFFER`
flag: every feature in the layer is a difference, so it would be constant.

### `_TSS_ANCHORS`

TSSLPT/TSSRON/DWRTPT parts are bucketed by (`CLASS`, `INTU`) and joined into
legs by union-find over pairs that both **touch** and agree on `ORIENT` to
within 2°. `ORIENT` is compared rather than bucketed because it is a REAL that
encoders quantise per part — one Santa Barbara lane carries 285/285/286/285,
and bucketing on the rounded integer split it into three uneven groups. The
group's `ORIENT` is the area-weighted circular mean of its parts', rounded to a
whole degree; `INTU` is on the key and on the output for the same reason it is
on `_LABELS` — the quilt carries several bands at once, and without it two
bands' copies of one lane draw two arrows on top of each other.

A leg gets one anchor per ~8 nm of its own axis, each at the centre of the
widest span the leg has on that line. A station that lands in a sub-tolerance
gap the grouping bridged is walked outward up to half a station spacing to find
one; a station still without a span is counted and warned about on stderr.

Groups whose **major axis** (the longer of their two extents) is under **0.5
nm** are dropped as slivers — what a quilt clip grazing a lane's corner leaves
behind, which would otherwise get an arrow the size of the one on the 30 nm
lane beside it. That is the only size rule the generator applies: `AREA` is on
the output because the _style_ decides how large a leg has to be to be worth an
arrow at a given zoom, and Plotroom's own `tss-arrows` layer filters on it.

### `_LIGHTS_SECTORS`

A sector arc is a **screen-size** figure — S-52 draws it a fixed 20 mm from the
light at every scale, because it is a legend for the bearings and not a claim
about where the light is seen. Tile geometry is geographic, so the metres only
hold at the zoom they were computed for. Computing them once, at the cell's own
band maxzoom, put a band-3 cell's legs at 19.1 km and a band-5 cell's at 2.4 km:
the same figure, eight times the size, on two charts of the same water.

Each light therefore emits **one arc and two legs per zoom**, sized for that
zoom, carrying `_z` (the zoom it is sized for) and `_zmax` (the deepest copy
there is). Each copy at or below the band maxzoom is confined to its own zoom's
tiles by a per-feature `tippecanoe` member of `{minzoom: _z, maxzoom: _z}`, so
tile weight is unchanged; only the feature count grows. The copies for the three
levels above the band maxzoom share the deepest real tile — there is no tile of
their own to go in — and ride `tile-join --overzoom` and the browser's own
overscaling up into the levels they were sized for. Because those copies arrive
together, the style **must** select on `_z`: it draws the copy whose `_z` equals
`min(floor(zoom), _zmax)`. A figure with no `_z` at all is geographic rather
than screen-size — the leg of a directional light that carries a `VALNMR`
nominal range — and is drawn at every zoom.

No copy is emitted where the figure would exceed 50 km, which is what keeps the
5900 km z0 arc out of the tiles. `SCAMIN` is not a substitute for that bound:
the style's scale filter passes any feature carrying no `SCAMIN` at all.

### Point-hazard thinning

tippecanoe's `-r/--drop-rate` thins point layers by a hash of position, which is
depth-blind: a 1.2 m rock is as likely to go as the 18 m wreck beside it.
`bin/generate-hazard-minzooms` makes the decision by depth instead, before
tiling. At each zoom the world is cut into ~64 px cells and the hazard with the
**shallowest** effective depth in each cell claims that zoom; a feature's
`tippecanoe` `minzoom` is the shallowest zoom it ever claims, and everything
else is stamped with the band maxzoom. No hazard is ever removed — the deeper
ones simply arrive later than the shoaler one beside them.

Effective depth is `VALSOU`, shallower being more dangerous, with an **absent**
`VALSOU` sorting as the shoalest thing there is: a hazard with no known least
depth is the case S-52 already treats as dangerous. Ties break on `LNAM` so the
same chart always produces the same tiles. UWTROC, WRECKS and OBSTRN compete as
one population, because a wreck and a rock 30 m apart are two symbols in the
same place on the chart.

Some object classes also gain pre-computed columns, likewise underscore-prefixed:

| Column                                        | On                     | Meaning                                                                                                                                                                                                                         |
| --------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_DEPARE_DRVAL1_MAX`, `_DEPARE_DRVAL1_MINPOS` | WRECKS, OBSTRN, UWTROC | Deepest / shoalest non-drying DRVAL1 of the depth areas the hazard touches (UDWHAZ05).                                                                                                                                          |
| `_FLOATING`                                   | TOPMAR                 | Whether the topmark sits on a buoy rather than a beacon (TOPMAR01).                                                                                                                                                             |
| `_EXTENDED_ARC`, `_COLOCATED`                 | LIGHTS                 | Co-location facts the flare and arc geometry need (LIGHTS06).                                                                                                                                                                   |
| `_TSSNOTE`                                    | PRCARE                 | The area is the manoeuvring room of a traffic separation scheme rather than a standalone caution — read out of `INFORM` or the companion `.TXT` file `TXTDSC` names. Absent when it is not, or when the note could not be read. |
| `INTU`                                        | every class            | The chart's navigational purpose, so the style can quilt.                                                                                                                                                                       |

## How to Produce This Encoding

Set `LIST_AS_STRING=ON` in `OGR_S57_OPTIONS` so the S-57 driver reads list
attributes as comma-separated strings from the start:

```sh
export OGR_S57_OPTIONS="SPLIT_MULTIPOINT=ON,ADD_SOUNDG_DEPTH=ON,LIST_AS_STRING=ON"
```

### S-57 → GeoPackage → GeoJSON → tippecanoe (recommended)

```sh
# S-57 → GeoPackage (list attrs already comma-separated from LIST_AS_STRING)
ogr2ogr -f GPKG chart.gpkg input.000

# GeoPackage → GeoJSON
ogr2ogr -f GeoJSON BOYLAT.geojson chart.gpkg BOYLAT

# GeoJSON → tiles
tippecanoe -o output.pmtiles BOYLAT.geojson
```

The full chain:

```
S-57: COLOUR = [3, 4, 3]  (StringList)
  ↓ ogr2ogr with LIST_AS_STRING=ON → GeoPackage
GPKG: COLOUR = "3,4,3"  (String)
  ↓ ogr2ogr → GeoJSON
GeoJSON: "COLOUR": "3,4,3"  (string)
  ↓ tippecanoe
MVT tile: COLOUR = "3,4,3"  (string)
```

### What does NOT work

**Without `LIST_AS_STRING=ON`**, ogr2ogr preserves native JSON arrays through
GeoJSON, and tippecanoe serializes them as compact JSON strings:

```
COLOUR = '["3","4","3"]'   -- JSON array string, not what the styles expect
```

**Direct `ogr2ogr -f PMTiles`** (S-57 straight to vector tiles) produces JSON
arrays with whitespace:

```
COLOUR = '[ "3", "4", "3" ]'   -- spaces break exact matching
```

## Style Matching

The S-52 styles use two patterns to match list-type attribute values:

### Exact Ordered Match (Lookup Tables)

The S-52 lookup table encodes every ATTV as a string, list or not: `"3,4,3"` for a
colour pattern, `"1"` for a beacon shape. Tiles use the same comma-separated form
for lists, but write **enumerated attributes as integers**, so the comparison has
to be made type-agnostic by coercing the feature value:

```
Lookup ATTC: COLOUR = "3,4,3"        BCNSHP = "1"
  ↓
Filter: ["==", ["to-string", ["get", "COLOUR"]], "3,4,3"]
        ["==", ["to-string", ["get", "BCNSHP"]], "1"]
```

Without the `to-string`, every one of the ~42 enumerated attributes silently never
matches, and the features fall through to the class's catch-all look-up entry:
lateral buoys draw the generic buoy symbol, CATMOR 7 mooring buoys draw the MORFAC
square, and the CATZOC fallback paints "quality not assessed" over assessed zones.
`packages/styles/test/harness/attribute-filters.test.ts` guards this.

Coercion is safe for the absence cases too: `["get"]` on an absent property is
null, and `to-string` of null is `""`, which never equals a non-empty ATTV.

This preserves the S-52 requirement that "the match to the object must be exact, in
order as well as content" (S-52 10.3.3.1).

### Membership Test (CSPs)

Conditional Symbology Procedures frequently test whether a list attribute contains
specific values. For example, RESARE04 asks "Does RESTRN include 7 or 8 or 14?"

The comma-separated encoding allows safe substring matching by wrapping both the
attribute value and the search term with commas to prevent false positives:

```js
// Does RESTRN include "7"?
// Wrap attribute "7,8,14" → ",7,8,14,"
// Search for ",7," → true (correct)
// On "17" → ",17," — search for ",7," → false (correct, no false positive)

["in", ",7,", ["concat", ",", ["get", "RESTRN"], ","]];
```

The `listIncludes` helper generates these expressions:

```js
// Does RESTRN include 7 or 8 or 14?
listIncludes("RESTRN", "7", "8", "14");
// → ["any",
//     ["in", ",7,", ["concat", ",", ["get", "RESTRN"], ","]],
//     ["in", ",8,", ["concat", ",", ["get", "RESTRN"], ","]],
//     ["in", ",14,", ["concat", ",", ["get", "RESTRN"], ","]]]
```

## Excluded Fields

The following S-57 internal fields are excluded from tiles as they are not useful
for rendering:

- `LNAM_REFS`, `FFPT_RIND`, `LNAM` — Internal cross-references and identifiers
- `PRIM`, `GRUP`, `OBJL` — Primitive type, group, object label (redundant with layer name)
- `RVER`, `AGEN`, `FIDN`, `FIDS` — Record version, agency, feature IDs
- `RECDAT`, `RECIND`, `SORDAT`, `SORIND` — Record/source dates and indicators
