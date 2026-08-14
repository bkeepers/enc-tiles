import type { RangeResponse, Source } from "pmtiles";

/**
 * A `Source` that always answers with the same fixed bytes, regardless of
 * the requested range -- enough to stand in for whatever a static host
 * sends back for a given URL, without a real network or file on disk.
 */
export class FixedBytesSource implements Source {
  constructor(
    private readonly key: string,
    private readonly bytes: Uint8Array,
  ) {}

  getKey(): string {
    return this.key;
  }

  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    const data = this.bytes.buffer.slice(
      this.bytes.byteOffset + offset,
      this.bytes.byteOffset + offset + length,
    );
    return { data };
  }
}

/**
 * A `Source` that fails outright, standing in for a network error or a
 * straight-up 404 (as opposed to a 200 with the wrong bytes).
 */
export class FailingSource implements Source {
  constructor(private readonly key: string) {}

  getKey(): string {
    return this.key;
  }

  async getBytes(): Promise<RangeResponse> {
    throw new Error("network error");
  }
}

/**
 * Vite's dev/preview server answers a missing static asset with its SPA
 * fallback: an HTML document, served with a 200/206 status rather than a
 * 404. Simulate that response's bytes -- what matters here is only that
 * they don't start with the PMTiles magic number.
 */
export const HTML_FALLBACK_BYTES = new TextEncoder().encode(
  "<!doctype html>\n<html><head></head><body></body></html>",
);

/**
 * A minimal-but-valid PMTiles v3 header, followed by a one-byte root
 * directory that decodes to zero entries (a leading varint of 0 means "0
 * entries", so `deserializeIndex` returns immediately without needing real
 * tile data). See https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
 */
export function validPmtilesBytes(): Uint8Array {
  const HEADER_BYTES = 127;
  const buffer = new Uint8Array(HEADER_BYTES + 1); // + empty root directory
  const view = new DataView(buffer.buffer);

  buffer.set(new TextEncoder().encode("PMTiles"), 0);
  view.setUint8(7, 3); // specVersion

  view.setUint32(8, HEADER_BYTES, true); // rootDirectoryOffset (low 32 bits)
  view.setUint32(16, 1, true); // rootDirectoryLength (low 32 bits)

  view.setUint8(97, 1); // internalCompression: None
  view.setUint8(98, 1); // tileCompression: None
  view.setUint8(99, 1); // tileType: Mvt
  view.setUint8(100, 0); // minZoom
  view.setUint8(101, 6); // maxZoom

  buffer[HEADER_BYTES] = 0x00; // root directory: varint 0 => 0 entries

  return buffer;
}
