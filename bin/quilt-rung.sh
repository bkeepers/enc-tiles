#!/usr/bin/env bash
# The quilt rung function, sourced by bin/extract-coverage and bin/s57-to-tiles.
# Not executable: it defines functions and nothing else.
#
# Both scripts must land on the SAME floor for the same chart. extract-coverage
# stamps QFLOOR on a chart's coverage rows; s57-to-tiles derives that chart's own
# floor again when it tiles it, and compares the two through the coverage table.
# A disagreement of one zoom leaves a gap or an overlap in the copy ladder, so
# the derivation lives in one place rather than twice.
#
# See docs/architecture/QUILT_ZOOM_PARTITION.md ("the rung function"):
#
#   nativeZ(S, lat) = log2(559_082_264 * cos(lat_mid) / S)   WebMercator, 96 dpi
#   rungFloor       = clamp(round(nativeZ) - 2, 0, 12)

# WebMercator scale denominator at zoom 0, 96 dpi.
QUILT_SCALE_DENOMINATOR_Z0=559082264

# Maps the ECDIS-native ladder onto Plotroom's web ladder. 2, not the 3 this was
# (nor the historical 4): one zoom later again, from a live comparison of the
# scale Plotroom estimates for the viewport against the actual compilation scale
# of the chart drawn in it (2026-08-15). Every band was arriving one zoom early
# -- clutter at the handover, and an estimated scale one step off the chart's
# own.
# At Puget latitude the S-101 standard scales land at 10M->3, 3.5M->5, 1.5M->6,
# 700k->7, 350k->8, 180k->9, 90k->10, 45k->11, 22k->12, 12k->13; 1:4k and 1:2k
# land above 13 and clamp to the cap.
QUILT_RUNG_OFFSET=2

# The web ladder the rung is clamped into.
#
# The top is the PUBLISHED ARCHIVE's maxzoom, not the deepest zoom any band
# tiles to. The archive a browser mounts is the national join, and that join is
# capped at the MINIMUM band maxzoom across its member regions -- 13 under this
# ladder, because the harbour band (INTU 5, floors 12 and 13) now tiles z13
# natively in every region (see publication_maxzoom in bin/s57-to-tiles).
# Every tile above the cap is deleted from the published archive.
#
# 13, not 12, since the offset went 3 -> 2 (2026-08-15): the ladder shifted one
# zoom deeper, and the cap moved with it in the same change. Held at 12 the
# 1:22k and 1:12k bands would both floor at 12 -- two compilation scales sharing
# one zoom, which is the one thing the rung function exists to prevent. The cap
# moves with publication_maxzoom, exactly as it did when the join's minimum was
# 11.
#
# A floor of 14 still names a zoom the archive does not hold: berthing-scale
# content (cscale <= ~8000 at Puget latitude, and the band-6 fallback cscale
# 4000 among it, raw rung 14) would be stamped past the cap, its tiles die in the
# join, and the style -- which gates on the stamped floor -- would draw it at
# NO zoom at all. Clamping at the cap makes the deepest rung one the reader can
# actually ask for. If the join's minimum ever moves again, this moves with
# publication_maxzoom.
QUILT_FLOOR_MIN=0
QUILT_FLOOR_MAX=13

# The compilation scale a chart falls back to when its DSID carries no
# DSPM_CSCL: the COARSER rung of its INTU band's standard pair. A legacy chart
# is then floored no lower than the band it has always been floored to, so an
# invocation predating the compilation-scale key keeps working.
quilt_band_cscale() {
  case "$1" in
    1) echo 10000000 ;;
    2) echo 1500000 ;;
    3) echo 350000 ;;
    4) echo 90000 ;;
    5) echo 22000 ;;
    6) echo 4000 ;;
    *) return 1 ;;
  esac
}

# DSPM_CSCL out of an `ogrinfo -q <chart> DSID` dump, which is the same read
# DSID_INTU comes from. Empty when the field is absent or is not a positive
# integer -- GDAL prints `(null)` for an unset one, and a 0 would divide.
quilt_dsid_cscale() {
  printf '%s\n' "$1" | grep DSPM_CSCL | awk '{print $NF}' |
    grep -xE '[1-9][0-9]*' || true
}

# Midpoint latitude of a chart's own M_COVR bbox. The rung is computed at CELL
# latitude: the same compilation scale is 0.7-1.3 zooms different in Zone II/III
# Alaska than at Puget latitude, and the cosine absorbs it.
#
# Empty when the extent cannot be read, which is the caller's signal that the
# chart cannot be placed on the ladder at all.
quilt_mid_lat() {
  # No -q here: GDAL 3.13's ogrinfo suppresses the whole -so summary under -q
  # (only "Layer name:" survives), so a quiet read never prints the Extent
  # line at all — every chart then skips as "could not read the extent"
  # (2026-08-07, first real-GDAL run; the test stub now mirrors this). The
  # sed tolerates the CRS-annotated form ("Extent (EPSG:4326): ...") too.
  ogrinfo -so "$1" M_COVR 2>/dev/null |
    sed -n 's/^Extent[^:]*: //p' | tr -d '(),' |
    awk 'NF >= 5 { printf "%.6f", ($2 + $5) / 2; exit }'
}

# rungFloor for a compilation scale at a latitude. Fails rather than printing a
# floor when the scale is not usable, because a wrong floor is silently wrong
# geometry in every tile.
quilt_rung_floor() {
  awk -v scale="$1" -v lat="$2" \
    -v z0="$QUILT_SCALE_DENOMINATOR_Z0" -v offset="$QUILT_RUNG_OFFSET" \
    -v lo="$QUILT_FLOOR_MIN" -v hi="$QUILT_FLOOR_MAX" '
    BEGIN {
      if (scale + 0 <= 0) exit 1
      pi = atan2(0, -1)
      cosine = cos(lat * pi / 180)
      if (cosine <= 0) exit 1
      native = log(z0 * cosine / scale) / log(2)
      # Away from zero, so a rung exactly between two zooms does not depend on
      # the sign of the exponent.
      rung = int(native + (native >= 0 ? 0.5 : -0.5)) - offset
      if (rung < lo) rung = lo
      if (rung > hi) rung = hi
      printf "%d", rung
    }'
}
