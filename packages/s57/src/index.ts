import gdal from "gdal-async";
import { join } from "node:path";

// https://github.com/mmomtchev/node-gdal-async/issues/256
gdal.config.set(
  "S57_CSV",
  join(gdal.config.get("GDAL_DATA")!, "../ogr/ogrsf_frmts/s57/data/"),
);

export function convert(src: gdal.Dataset, outputPath: string) {
  // Always use EPSG:4326/WGS84
  const srs = gdal.SpatialReference.fromEPSG(4326);

  // create destination PMTiles dataset
  const dst = gdal.open(outputPath, "w", "PMTiles");

  // iterate each layer and copy into PMTiles
  for (const layer of src.layers) {
    // create destination layer with same SRS and geometry
    const dstLayer = dst.layers.create(layer.name, srs, layer.geomType);

    // copy field definitions
    layer.fields.forEach((fld) => dstLayer.fields.add(fld));

    // iterate features one at a time
    for (const srcFeature of layer.features) {
      const dstFeature = new gdal.Feature(dstLayer);

      dstFeature.fid = srcFeature.fid;
      dstFeature.setGeometry(srcFeature.getGeometry());

      // copy all existing fields
      for (const field of layer.fields) {
        const value = srcFeature.fields.get(field.name);

        // Convert array fields to comma-separated strings
        dstFeature.fields.set(
          field.name,
          Array.isArray(value) ? value.join(",") : value,
        );
      }

      dstLayer.features.add(dstFeature);

      // release references early
      srcFeature.destroy();
      dstFeature.destroy();
    }
  }

  dst.close();
  src.close();
}
