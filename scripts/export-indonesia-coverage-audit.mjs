import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const options = {
    outputDir: path.resolve(ROOT, "..", "..", "Documents", "GitHub", "waktusolat", "docs", "data"),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output-dir" && argv[index + 1]) {
      options.outputDir = path.resolve(argv[index + 1]);
      index += 1;
    }
  }

  return options;
}

function groupByProvince(regions) {
  const counts = new Map();
  for (const region of regions) {
    counts.set(region.province, (counts.get(region.province) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([province, count]) => ({ province, count }))
    .sort((left, right) => right.count - left.count || left.province.localeCompare(right.province));
}

function classifyMissingRegion(region) {
  const label = region.location.toUpperCase();
  if (
    label.startsWith("PEKAJANG ") ||
    label.startsWith("PULAU LAUT ") ||
    label.startsWith("PULAU MIDAI ") ||
    label.startsWith("PULAU SERASAN ") ||
    label.startsWith("PULAU TAMBELAN ")
  ) {
    return "special-island-zone";
  }
  return "district-gap";
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const prayerDataPath = path.join(ROOT, "json", "indonesia-prayer-data-2026.json");
  const polygonPath = path.join(ROOT, "json", "indonesia-districts.geojson");

  const prayerData = JSON.parse(await fs.readFile(prayerDataPath, "utf8"));
  const polygonData = JSON.parse(await fs.readFile(polygonPath, "utf8"));

  const regionById = new Map(prayerData.regions.map((region) => [region.id, region]));
  const coveredIds = new Set(
    polygonData.features
      .map((feature) => feature?.properties?.region_id)
      .filter(Boolean)
  );

  const missingRegions = prayerData.regions
    .filter((region) => !coveredIds.has(region.id))
    .map((region) => ({
      id: region.id,
      location: region.location,
      province: region.province,
      timezone: region.timezone,
      category: classifyMissingRegion(region),
    }))
    .sort((left, right) =>
      left.province.localeCompare(right.province) || left.location.localeCompare(right.location)
    );

  const coveredSummary = polygonData.features
    .map((feature) => {
      const regionId = feature?.properties?.region_id;
      const region = regionById.get(regionId);
      return {
        id: regionId,
        location: region?.location ?? feature?.properties?.location ?? "Unknown",
        province: region?.province ?? feature?.properties?.province ?? "Unknown",
      };
    })
    .filter((entry) => entry.id)
    .sort((left, right) =>
      left.province.localeCompare(right.province) || left.location.localeCompare(right.location)
    );

  const summary = {
    generatedAt: new Date().toISOString(),
    sourcePrayerSnapshot: "indonesia-prayer-data-2026.json",
    sourcePolygonSnapshot: "indonesia-districts.geojson",
    totalRegions: prayerData.regions.length,
    coveredRegions: coveredIds.size,
    missingRegions: missingRegions.length,
    coveragePercent: Number(((coveredIds.size / prayerData.regions.length) * 100).toFixed(2)),
    provincesWithMissing: groupByProvince(missingRegions),
  };

  await fs.mkdir(options.outputDir, { recursive: true });
  await fs.writeFile(
    path.join(options.outputDir, "indonesia-coverage-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(options.outputDir, "indonesia-missing-regions.json"),
    `${JSON.stringify(missingRegions, null, 2)}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(options.outputDir, "indonesia-covered-regions.json"),
    `${JSON.stringify(coveredSummary, null, 2)}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(options.outputDir, "indonesia-covered.geojson"),
    `${JSON.stringify(polygonData)}\n`,
    "utf8"
  );

  console.log(
    `Exported Indonesia coverage audit data to ${options.outputDir} (${coveredIds.size}/${prayerData.regions.length} covered)`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
