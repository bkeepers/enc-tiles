import gdal from "gdal-async";
import { convert } from "./index.js";

export default (args = process.argv.slice(2)) => {
  const inputPath = args[0]!;
  const outputPath = args[1] ?? inputPath.replace(/\.000$/, ".pmtiles");

  // open source S-57 dataset
  const src = gdal.open(inputPath);

  convert(src, outputPath);
  console.log(`✅ Converted ${inputPath} to ${outputPath}`);
};
