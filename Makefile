ENC_DIR := data/NOAA/ENC_ROOT
TILES_DIR := tiles
comma := ,

# Output name from the directory segment before ENC_ROOT
# e.g. data/ENC_ROOT → all, .../ECDIS_Chart_1/ENC_ROOT → ECDIS_Chart_1
_PARENT := $(notdir $(patsubst %/ENC_ROOT,%,$(ENC_DIR)))
OUTPUT_NAME := $(if $(filter data,$(_PARENT)),all,$(_PARENT))

# Filter charts by bounding box or place name (default: all charts)
#   make -j BBOX="-122.8,37.4,-122.0,37.9"    # west,south,east,north
#   make -j PLACE="San Francisco Bay"           # geocode via Nominatim
#   make -j ENC_DIR=path/to/ENC_ROOT            # different ENC source
ifdef BBOX
  ENC := $(shell node bin/find-charts $(ENC_DIR)/CATALOG.031 --bbox $(BBOX))
  OUTPUT_NAME := $(subst $(comma),_,$(BBOX))
else ifdef PLACE
  ENC := $(shell node bin/find-charts $(ENC_DIR)/CATALOG.031 --place "$(PLACE)")
  OUTPUT_NAME := $(subst $() ,_,$(PLACE))
else
  ENC := $(wildcard $(ENC_DIR)/**/*.000)
endif

OUTPUT := $(TILES_DIR)/$(OUTPUT_NAME).pmtiles
COVERAGE := $(TILES_DIR)/coverage.gpkg
PMTILES := $(patsubst $(ENC_DIR)/%.000,$(TILES_DIR)/%.pmtiles,$(ENC))

.PHONY: all clean data

# Pipeline: extract coverage → convert charts (parallel) → merge
all: $(OUTPUT)

# Step 1: Extract M_COVR polygons from all charts for quilting
$(COVERAGE): $(ENC)
	bin/extract-coverage $@ $^

# Step 2: Convert each S57 chart to PMTiles (parallelizable with make -j)
$(TILES_DIR)/%.pmtiles: $(ENC_DIR)/%.000 $(COVERAGE)
	bin/s57-to-tiles $< $@ --coverage $(COVERAGE)

# Step 3: Merge all individual PMTiles into one
$(OUTPUT): $(PMTILES)
	ulimit -n 65535; \
	tile-join --force \
		--no-tile-size-limit \
		--overzoom \
		--maximum-zoom="13" \
		-o $@ $^

# Download NOAA ENC data
data:
	@mkdir -p data/NOAA
	@echo "Downloading NOAA ENC data..."
	curl -L -o data/NOAA/ALL_ENCs.zip https://charts.noaa.gov/ENCs/All_ENCs.zip
	@echo "Extracting ENC data..."
	unzip -o data/NOAA/ALL_ENCs.zip -d data/NOAA

clean:
	rm -rf $(TILES_DIR)
