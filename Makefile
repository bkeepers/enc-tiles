ENC_DIR := data/ENC_ROOT
TILES_DIR := tiles
ENC := $(wildcard $(ENC_DIR)/**/*.000)
TILES := $(patsubst $(ENC_DIR)/%.000,$(TILES_DIR)/%.pmtiles,$(ENC))
TILEJSON := $(patsubst $(ENC_DIR)/%.000,$(TILES_DIR)/%.json,$(ENC))

.PHONY: all clean data

all: $(TILES_DIR)/catalog.json ${TILES_DIR}/noaa.pmtiles

data:
	@mkdir -p data
	@echo "Downloading NOAA ENC data..."
	curl -L -o data/ALL_ENCs.zip https://charts.noaa.gov/ENCs/All_ENCs.zip
	@echo "Extracting ENC data..."
	unzip -o data/ALL_ENCs.zip -d data

$(TILES_DIR)/%.pmtiles: $(ENC_DIR)/%.000
	bin/s57-to-tiles $< $@

${TILES_DIR}/%.json: ${TILES_DIR}/%.pmtiles
	pmtiles show --tilejson $< > $@

${TILES_DIR}/noaa.pmtiles: $(TILES)
	# Increase file descriptor limit for tile-join
	ulimit -n 100000; \
	tile-join --force --no-tile-size-limit -o $@ $(TILES_DIR)/**/*.pmtiles

clean:
	rm -rf $(TILES_DIR)

${TILES_DIR}/catalog.json: $(TILEJSON)
	@rm -f $(TILES_DIR)/catalog.json
	bin/catalog $(TILES_DIR)/**/*.json > $@
