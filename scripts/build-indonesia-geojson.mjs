/**
 * build-indonesia-geojson.mjs
 *
 * Downloads GADM Level 2 Indonesia GeoJSON, matches each feature (kabupaten/kota)
 * to a KEMENAG region_id, and writes a simplified GeoJSON ready for polygon-lookup.
 *
 * Usage:
 *   node scripts/build-indonesia-geojson.mjs
 *
 * Options:
 *   --gadm-input    <path>   Path to local GADM file (skips download)
 *   --supplemental  <path>   Extra FeatureCollection to merge after GADM matching
 *   --output        <path>   Output path (default: json/indonesia-districts.geojson)
 *   --min-score     <n>      Minimum match score to include feature (default: 70)
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const GADM_CACHE_PATH = path.join(ROOT, "json", "gadm41_IDN_2_raw.json");
const GADM_URL = "https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_IDN_2.json";
const DEFAULT_OUTPUT = path.join(ROOT, "json", "indonesia-districts.geojson");
const DEFAULT_SUPPLEMENTAL = path.join(ROOT, "json", "indonesia-supplemental-districts.geojson");
const DEFAULT_MIN_SCORE = 70;

// ─── CLI args ──────────────────────────────────────────────────────────────────
function parseArgs(args) {
  const result = {
    gadmInput: null,
    supplemental: DEFAULT_SUPPLEMENTAL,
    output: DEFAULT_OUTPUT,
    minScore: DEFAULT_MIN_SCORE,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--gadm-input" && args[i + 1]) result.gadmInput = args[++i];
    else if (args[i] === "--supplemental" && args[i + 1]) result.supplemental = path.resolve(args[++i]);
    else if (args[i] === "--output" && args[i + 1]) result.output = path.resolve(args[++i]);
    else if (args[i] === "--min-score" && args[i + 1]) result.minScore = parseInt(args[++i], 10);
  }
  return result;
}

// ─── Normalization (mirrors lib/indonesia-prayer.ts) ─────────────────────────
function normalizeIndonesiaPlaceName(value) {
  return value
    .normalize("NFKD")
    .replace(/[.,/()-]/g, " ")
    .replace(/\bKABUPATEN\b/g, "KAB")
    .replace(/\bKOTA ADMINISTRASI\b/g, "KOTA")
    .replace(/\bKOTA ADM\b/g, "KOTA")
    .replace(/\bKOTA\b/g, "KOTA")
    .replace(/\bKAB\b/g, "KAB")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function stripAdministrativePrefix(value) {
  return value
    .replace(/^KAB\.?\s+/g, "")
    .replace(/^KOTA\s+/g, "")
    .trim();
}

function tokenOverlapScore(a, b) {
  const aTokens = new Set(stripAdministrativePrefix(a).split(" ").filter(Boolean));
  const bTokens = new Set(stripAdministrativePrefix(b).split(" ").filter(Boolean));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap++;
  }
  return overlap / Math.max(aTokens.size, bTokens.size);
}

function matchScore(gadmFullName, gadmProvince, region) {
  const gadmNorm = normalizeIndonesiaPlaceName(gadmFullName);
  const regionNorm = normalizeIndonesiaPlaceName(region.location);
  const provNorm = normalizeIndonesiaPlaceName(gadmProvince);
  const regionProv = normalizeIndonesiaPlaceName(region.province);

  let score = 0;
  const gadmCore = stripAdministrativePrefix(gadmNorm);
  const regionCore = stripAdministrativePrefix(regionNorm);

  if (gadmNorm === regionNorm) {
    score = 100;
  } else if (gadmCore === regionCore) {
    score = 96;
  } else if (gadmNorm.includes(regionNorm) || regionNorm.includes(gadmNorm)) {
    score = 88;
  } else if (gadmCore.includes(regionCore) || regionCore.includes(gadmCore)) {
    score = 84;
  } else {
    const overlap = tokenOverlapScore(gadmNorm, regionNorm);
    if (overlap >= 0.75) score = 78;
    else if (overlap >= 0.5) score = 68;
  }

  if (score === 0) return 0;

  if (provNorm === regionProv) score += 12;
  else score -= 18;

  return score;
}

// ─── Geometry simplification (3 decimal places ≈ 110m accuracy) ──────────────
function simplifyCoord(n) {
  return Math.round(n * 1000) / 1000;
}

function simplifyGeometry(geometry) {
  if (geometry.type === "Polygon") {
    return {
      type: "Polygon",
      coordinates: geometry.coordinates.map((ring) =>
        ring.map(([lng, lat]) => [simplifyCoord(lng), simplifyCoord(lat)])
      ),
    };
  }
  if (geometry.type === "MultiPolygon") {
    return {
      type: "MultiPolygon",
      coordinates: geometry.coordinates.map((poly) =>
        poly.map((ring) =>
          ring.map(([lng, lat]) => [simplifyCoord(lng), simplifyCoord(lat)])
        )
      ),
    };
  }
  return geometry;
}

// ─── Manual overrides for GADM features that don't match via fuzzy scoring ────
// Key: "${gadmFullName}|${NAME_1}" → KEMENAG region record
const GADM_OVERRIDES = {
  "KAB KEPULAUAN SERIBU|JakartaRaya": {
    id: "cfecdb276f634854f3ef915e2e980c31",
    location: "KAB. ADMINISTRASI KEPULAUAN SERIBU",
    province: "DKI JAKARTA",
  },
  "KAB KOTA BARU|KalimantanSelatan": {
    id: "f9b902fc3289af4dd08de5d1de54f68f",
    location: "KAB. KOTABARU",
    province: "KALIMANTAN SELATAN",
  },
  "KAB SIAU TAGULANDANG BIARO|SulawesiUtara": {
    id: "2421fcb1263b9530df88f7f002e78ea5",
    location: "KAB. KEPULAUAN SIAU TAGULANDANG BIARO",
    province: "SULAWESI UTARA",
  },
  "KOTA PALANGKA RAYA|KalimantanTengah": {
    id: "82cec96096d4281b7c95cd7e74623496",
    location: "KOTA PALANGKARAYA",
    province: "KALIMANTAN TENGAH",
  },
  "KOTA TANJUNGPINANG|KepulauanRiau": {
    id: "f4b9ec30ad9f68f89b29639786cb62ef",
    location: "KOTA TANJUNG PINANG",
    province: "KEPULAUAN RIAU",
  },
  "KAB TULANGBAWANG|Lampung": {
    id: "f2217062e9a397a1dca429e7d70bc6ca",
    location: "KAB. TULANG BAWANG",
    province: "LAMPUNG",
  },
  "KAB GUNUNG KIDUL|Yogyakarta": {
    id: "be83ab3ecd0db773eb2dc1b0a17836a1",
    location: "KAB. GUNUNGKIDUL",
    province: "D.I. YOGYAKARTA",
  },
  "KAB BANYU ASIN|SumateraSelatan": {
    id: "c45147dee729311ef5b5c3003946c48f",
    location: "KAB. BANYUASIN",
    province: "SUMATERA SELATAN",
  },
  "KAB LAKE TOBA|SumateraUtara": {
    id: "642e92efb79421734881b53e1e1b18b6",
    location: "KAB. TOBA SAMOSIR",
    province: "SUMATERA UTARA",
  },
  "KAB PAKPAK BARAT|SumateraUtara": {
    id: "3416a75f4cea9109507cacd8e2f2aefc",
    location: "KAB. PAKPAK BHARAT",
    province: "SUMATERA UTARA",
  },
  "KOTA TEBINGTINGGI|SumateraUtara": {
    id: "9f61408e3afb633e50cdf1b20de6f466",
    location: "KOTA TEBING TINGGI",
    province: "SUMATERA UTARA",
  },
  "KAB POHUWATO|Gorontalo": {
    id: "f61d6947467ccd3aa5af24db320235dd",
    location: "KAB. PAHUWATO",
    province: "GORONTALO",
  },
  "KOTA PANGKALPINANG|BangkaBelitung": {
    id: "e00da03b685a0dd18fb6a08af0923de0",
    location: "KOTA PANGKAL PINANG",
    province: "KEPULAUAN BANGKA BELITUNG",
  },
  "KAB BATANG HARI|Jambi": {
    id: "812b4ba287f5ee0bc9d43bbf5bbe87fb",
    location: "KAB. BATANGHARI",
    province: "JAMBI",
  },
  "KOTA BANJAR BARU|KalimantanSelatan": {
    id: "40008b9a5380fcacce3976bf7c08af5b",
    location: "KOTA BANJARBARU",
    province: "KALIMANTAN SELATAN",
  },
  "KOTA PADANG PANJANG|SumateraBarat": {
    id: "e2c420d928d4bf8ce0ff2ec19b371514",
    location: "KOTA PADANGPANJANG",
    province: "SUMATERA BARAT",
  },
};

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv.slice(2));

  // Load KEMENAG regions from the prayer data snapshot
  const prayerDataPath = path.join(ROOT, "json", "indonesia-prayer-data-2026.json");
  const prayerData = JSON.parse(await fs.readFile(prayerDataPath, "utf-8"));
  const regions = prayerData.regions;
  console.log(`Loaded ${regions.length} KEMENAG regions`);

  // Load GADM data — from explicit path, local cache, or download
  let gadmData;
  if (opts.gadmInput) {
    console.log(`Loading GADM from ${opts.gadmInput} ...`);
    gadmData = JSON.parse(await fs.readFile(opts.gadmInput, "utf-8"));
  } else {
    try {
      gadmData = JSON.parse(await fs.readFile(GADM_CACHE_PATH, "utf-8"));
      console.log(`Loaded GADM from cache: ${gadmData.features.length} features`);
    } catch {
      console.log(`Downloading GADM Level 2 Indonesia from:\n  ${GADM_URL}`);
      console.log("(This is ~30-40 MB — may take a minute...)");
      const response = await fetch(GADM_URL);
      if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`);
      const raw = await response.text();
      gadmData = JSON.parse(raw);
      await fs.writeFile(GADM_CACHE_PATH, raw, "utf-8");
      console.log(`Downloaded and cached ${gadmData.features.length} features → ${GADM_CACHE_PATH}`);
    }
  }

  // Match each GADM feature to a KEMENAG region
  const outputFeatures = [];
  const matchedRegionIds = new Set();
  const unmatchedGADM = [];

  for (const feature of gadmData.features) {
    const { NAME_1, NAME_2, TYPE_2 } = feature.properties;

    // GADM 4.1 uses camelCase for Indonesia NAME_2 (e.g. "AcehBarat" → "Aceh Barat")
    const name2Words = NAME_2.replace(/([a-z])([A-Z])/g, "$1 $2");

    // Build full name matching KEMENAG format, e.g. "KAB. ACEH BARAT", "KOTA BANDA ACEH"
    const typePrefix =
      TYPE_2 === "Kota" || TYPE_2 === "Kota Administratif" || TYPE_2 === "City" ? "KOTA" : "KAB";
    const gadmFullName = `${typePrefix} ${name2Words.toUpperCase()}`;

    // Check manual override first
    const overrideKey = `${gadmFullName}|${NAME_1}`;
    const override = GADM_OVERRIDES[overrideKey];
    if (override) {
      outputFeatures.push({
        type: "Feature",
        geometry: simplifyGeometry(feature.geometry),
        properties: {
          region_id: override.id,
          location: override.location,
          province: override.province,
          _gadm_name: gadmFullName,
          _gadm_province: NAME_1,
          _match_score: 100,
        },
      });
      matchedRegionIds.add(override.id);
      continue;
    }

    // Find best matching KEMENAG region
    let best = null;
    let bestScore = 0;
    for (const region of regions) {
      const score = matchScore(gadmFullName, NAME_1, region);
      if (score > bestScore) {
        bestScore = score;
        best = region;
      }
    }

    if (best && bestScore >= opts.minScore) {
      outputFeatures.push({
        type: "Feature",
        geometry: simplifyGeometry(feature.geometry),
        properties: {
          region_id: best.id,
          location: best.location,
          province: best.province,
          // Debug metadata (safe to strip from production if needed)
          _gadm_name: gadmFullName,
          _gadm_province: NAME_1,
          _match_score: bestScore,
        },
      });
      matchedRegionIds.add(best.id);
    } else {
      unmatchedGADM.push({ gadmFullName, province: NAME_1, bestScore, bestMatch: best?.location });
    }
  }

  // Merge curated supplemental polygons after GADM matching.
  // This is the clean path for newer districts or special island prayer zones
  // that do not exist in the GADM level-2 source.
  try {
    const supplemental = JSON.parse(await fs.readFile(opts.supplemental, "utf-8"));
    const supplementalFeatures = Array.isArray(supplemental.features) ? supplemental.features : [];
    let merged = 0;

    for (const feature of supplementalFeatures) {
      const regionId = feature?.properties?.region_id;
      const location = feature?.properties?.location;
      const province = feature?.properties?.province;
      if (!regionId || !location || !province || !feature.geometry) {
        continue;
      }

      if (matchedRegionIds.has(regionId)) {
        continue;
      }

      outputFeatures.push({
        type: "Feature",
        geometry: simplifyGeometry(feature.geometry),
        properties: {
          region_id: regionId,
          location,
          province,
          _gadm_name: "SUPPLEMENTAL",
          _gadm_province: province,
          _match_score: 100,
        },
      });
      matchedRegionIds.add(regionId);
      merged += 1;
    }

    if (merged > 0) {
      console.log(`  Supplemental polygons merged: ${merged}`);
    }
  } catch (error) {
    if (!error || error.code !== "ENOENT") {
      throw error;
    }
  }

  // Report
  console.log(`\nResults:`);
  console.log(`  GADM features processed: ${gadmData.features.length}`);
  console.log(`  Features written: ${outputFeatures.length}`);
  console.log(`  KEMENAG regions matched: ${matchedRegionIds.size} / ${regions.length}`);

  if (unmatchedGADM.length > 0) {
    console.log(`\n  Unmatched GADM features (${unmatchedGADM.length}):`);
    unmatchedGADM.slice(0, 20).forEach(({ gadmFullName, province, bestScore, bestMatch }) => {
      console.log(`    ${gadmFullName} (${province}) score=${bestScore} → best: ${bestMatch ?? "none"}`);
    });
    if (unmatchedGADM.length > 20) console.log(`    ... and ${unmatchedGADM.length - 20} more`);
  }

  const unlinkedRegions = regions.filter((r) => !matchedRegionIds.has(r.id));
  if (unlinkedRegions.length > 0) {
    console.log(`\n  KEMENAG regions with no GADM polygon (${unlinkedRegions.length}):`);
    unlinkedRegions.slice(0, 20).forEach((r) => console.log(`    ${r.location} (${r.province})`));
    if (unlinkedRegions.length > 20) console.log(`    ... and ${unlinkedRegions.length - 20} more`);
  }

  const output = { type: "FeatureCollection", features: outputFeatures };
  await fs.writeFile(opts.output, JSON.stringify(output), "utf-8");

  const stat = await fs.stat(opts.output);
  console.log(`\nWrote ${outputFeatures.length} features → ${opts.output} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
