ENC_DIR := data/ENC_ROOT
TILES_DIR := tiles
ENC := $(wildcard $(ENC_DIR)/*/*.000)
TILES := $(patsubst $(ENC_DIR)/%.000,$(TILES_DIR)/%.pmtiles,$(ENC))

.PHONY: all clean data

all: ${TILES_DIR}/noaa.pmtiles

data:
	@mkdir -p data
	@echo "Downloading NOAA ENC data..."
	curl -L -o data/ALL_ENCs.zip https://charts.noaa.gov/ENCs/All_ENCs.zip
	@echo "Extracting ENC data..."
	unzip -o data/ALL_ENCs.zip -d data

$(TILES_DIR)/%.pmtiles: $(ENC_DIR)/%.000
	bin/s57-to-tiles $< $@

${TILES_DIR}/noaa.pmtiles: $(TILES)
	@mkdir -p $(TILES_DIR)
	# Increase file descriptor limit for tile-join, capped at the hard limit
	ulimit -n 100000 2>/dev/null || ulimit -n $$(ulimit -Hn) 2>/dev/null || true; \
	tile-join --force --no-tile-size-limit -o $@ $(TILES)

clean:
	rm -rf $(TILES_DIR)
