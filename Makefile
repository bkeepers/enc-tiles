ENC_DIR := data/ENC_ROOT
TILES_DIR := tiles
ENC := $(wildcard $(ENC_DIR)/*/*.000)
TILES := $(patsubst $(ENC_DIR)/%.000,$(TILES_DIR)/%.pmtiles,$(ENC))
BANDS := overview general coastal approach harbour berthing
BAND_TILES := $(addprefix $(TILES_DIR)/noaa-,$(addsuffix .pmtiles,$(BANDS)))

.PHONY: all clean data

all: $(TILES_DIR)/.bands.stamp

data:
	@mkdir -p data
	@echo "Downloading NOAA ENC data..."
	curl -L -o data/ALL_ENCs.zip https://charts.noaa.gov/ENCs/All_ENCs.zip
	@echo "Extracting ENC data..."
	unzip -o data/ALL_ENCs.zip -d data

$(TILES_DIR)/%.pmtiles: $(ENC_DIR)/%.000
	bin/s57-to-tiles $< $@

# GNU Make 3.81 has no grouped targets, so one recipe produces all six archives
# and a stamp file carries the dependency.
$(TILES_DIR)/.bands.stamp: $(TILES)
	@mkdir -p $(TILES_DIR)
	# Increase file descriptor limit for tile-join, capped at the hard limit
	ulimit -n 100000 2>/dev/null || ulimit -n $$(ulimit -Hn) 2>/dev/null || true; \
	bin/join-bands --prefix $(TILES_DIR)/noaa $(TILES)
	@touch $@

clean:
	rm -rf $(TILES_DIR)
