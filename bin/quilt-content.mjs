// The CONTENT IDENTITY of an S-57 feature: "are these two polygons the same
// thing in the water", shared by the derivations that have to answer it.
//
// One physical area is split by the topology it was digitised against and above
// all by the edge of the CHART, so the same regulated area, dumping ground or
// pipeline zone arrives as several features in several cells, each with its own
// record bookkeeping. bin/generate-area-edges asks whether the content changes
// ACROSS a boundary (it draws the line only where it does); the anchor
// generators ask whether a part in this cell continues into the next one (they
// emit one symbol for the whole of it). Both questions are the same comparison,
// and it is here so that a widening of the exclusions is a widening for both.
//
// The cached roster the cross-cell comparisons read (`--write-evidence`, stored
// per cell by bin/extract-coverage) holds exactly what `contentOf` produces, so
// nothing downstream has to reproduce these exclusions in shell or OGR SQL.

/**
 * The attributes that identify the RECORD, not the content -- excluded from
 * the identity hash AND from anything an edge or anchor emits.
 *
 * The first group is per-feature bookkeeping: LNAM is the feature identifier
 * (every fragment pair across a boundary differs in it by construction, and it
 * is issued PER CELL, so the parts of one area in three cells carry three of
 * them), the source/record dates and indicators describe the survey record, and
 * SCAMIN/SCAMAX/INTU/CSCALE are scale gating the partition owns. The second
 * group is the tile-side exclusion list bin/s57-to-tiles already passes to
 * tippecanoe (--exclude): attributes that never reach a tile cannot be content,
 * and FIDN alone would otherwise keep any two distinct features from ever
 * merging. Every _-prefixed stamp (the copy ladder's and any other of ours) is
 * excluded by prefix.
 */
export const IDENTITY_EXCLUSIONS = new Set([
  "LNAM",
  "SORIND",
  "SORDAT",
  "RECIND",
  "RECDAT",
  "SCAMIN",
  "SCAMAX",
  "INTU",
  "CSCALE",
  // Per-cell FILE REFERENCES: the value embeds the producing chart's own name
  // (US4AK2DD's ADMARE carries TXTDSC "US101DDB.TXT", its neighbour's the
  // DE-named twin), so two cells' halves of one area can never match on them.
  // They point at sidecar files that never ship with the tiles at all.
  "TXTDSC",
  "NTXTDS",
  "PICREP",
  // The tippecanoe --exclude list from bin/s57-to-tiles, step 4.
  "LNAM_REFS",
  "FFPT_RIND",
  "PRIM",
  "GRUP",
  "OBJL",
  "RVER",
  "AGEN",
  "FIDN",
  "FIDS",
  "RCID",
]);

/**
 * The content attributes of a feature: everything that survives the
 * exclusions, nulls dropped (GeoJSON exports spell "no value" both ways, and
 * an attribute a producer left null is the same content as one it left out).
 */
export function contentOf(properties) {
  const content = {};
  for (const key of Object.keys(properties ?? {}).sort()) {
    if (key.startsWith("_") || IDENTITY_EXCLUSIONS.has(key)) continue;
    const value = properties[key];
    if (value === null || value === undefined) continue;
    content[key] = value;
  }
  return content;
}

/**
 * One canonical string for a CONTENT value, whatever shape the transport gave
 * it. bin/generate-area-edges --write-evidence stores CONTENT as a JSON STRING,
 * but the GeoJSON writer that exports the cached roster back out of the
 * coverage GeoPackage (bin/s57-to-tiles step 2b) auto-detects JSON-shaped
 * strings and re-emits them as raw JSON OBJECTS (AUTODETECT_JSON_STRINGS,
 * default YES) -- and an object never string-equals a side's serialized
 * identity, which silently retained EVERY chart-border edge in the fleet (found
 * 2026-08-14, the Adak swept-area seam). The export now pins the option off,
 * and this canonicalizer makes the comparison immune to the transport either
 * way: strings that parse as objects, objects, and the `contentOf` bag itself
 * all reduce to the same sorted-key serialization.
 */
export function canonicalContent(value) {
  let content = value;
  if (typeof content === "string") {
    // The common, intended case: already the exact serialization.
    if (!content.startsWith("{")) return content;
    try {
      content = JSON.parse(content);
    } catch {
      return value;
    }
  }
  if (content === null || typeof content !== "object" || Array.isArray(content))
    return typeof value === "string" ? value : JSON.stringify(value);
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(content)
        .filter(([, v]) => v !== null && v !== undefined)
        .sort(([ka], [kb]) => (ka < kb ? -1 : ka > kb ? 1 : 0)),
    ),
  );
}
