import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_BASE_URL = "https://api.myquran.com/v3/sholat";
const DEFAULT_YEAR = new Date().getFullYear();
const DEFAULT_START_MONTH = 1;
const DEFAULT_END_MONTH = 12;
const DEFAULT_CONCURRENCY = 1;
const DEFAULT_DELAY_MS = 750;
const DEFAULT_OUTPUT = "json/indonesia-prayer-data.json";
const DEFAULT_MAX_RETRIES = 6;

const headers = {
  Accept: "application/json,text/plain,*/*",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Referer: "https://api.myquran.com/",
  Origin: "https://api.myquran.com",
};

const MONTH_NAMES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function printHelp() {
  console.log(`Usage: yarn sync:indonesia-data [options]

Options:
  --base-url <url>        API base URL. Default: ${DEFAULT_BASE_URL}
  --year <year>           Year to fetch. Default: ${DEFAULT_YEAR}
  --start-month <month>   First month to fetch. Default: ${DEFAULT_START_MONTH}
  --end-month <month>     Last month to fetch. Default: ${DEFAULT_END_MONTH}
  --concurrency <n>       Parallel requests. Default: ${DEFAULT_CONCURRENCY}
  --delay-ms <ms>         Delay after each request per worker. Default: ${DEFAULT_DELAY_MS}
  --max-retries <n>       Retries for throttled/failed requests. Default: ${DEFAULT_MAX_RETRIES}
  --limit <n>             Only process the first N regions. Useful for validation runs
  --progress-every <n>    Emit progress every N jobs. Default: 100
  --resume <path>         Merge and skip datasets already present in an existing output file
  --output <path>         Output JSON path. Default: ${DEFAULT_OUTPUT}
  --help                  Show this help
`);
}

function parseArgs(argv) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    year: DEFAULT_YEAR,
    startMonth: DEFAULT_START_MONTH,
    endMonth: DEFAULT_END_MONTH,
    concurrency: DEFAULT_CONCURRENCY,
    delayMs: DEFAULT_DELAY_MS,
    maxRetries: DEFAULT_MAX_RETRIES,
    limit: null,
    progressEvery: 100,
    resume: null,
    output: DEFAULT_OUTPUT,
    timeoutMs: 30_000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") {
      options.help = true;
      continue;
    }

    const value = argv[index + 1];
    switch (arg) {
      case "--base-url":
        options.baseUrl = value.replace(/\/+$/, "");
        break;
      case "--year":
        options.year = Number.parseInt(value, 10);
        break;
      case "--start-month":
        options.startMonth = Number.parseInt(value, 10);
        break;
      case "--end-month":
        options.endMonth = Number.parseInt(value, 10);
        break;
      case "--concurrency":
        options.concurrency = Number.parseInt(value, 10);
        break;
      case "--delay-ms":
        options.delayMs = Number.parseInt(value, 10);
        break;
      case "--max-retries":
        options.maxRetries = Number.parseInt(value, 10);
        break;
      case "--limit":
        options.limit = Number.parseInt(value, 10);
        break;
      case "--progress-every":
        options.progressEvery = Number.parseInt(value, 10);
        break;
      case "--resume":
        options.resume = value;
        break;
      case "--output":
        options.output = value;
        break;
      default:
        if (arg.startsWith("--")) {
          throw new Error(`Unknown argument: ${arg}`);
        }
    }
    if (arg.startsWith("--")) {
      index += 1;
    }
  }

  return options;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, timeoutMs) {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterMs = retryAfterHeader
      ? Number.parseFloat(retryAfterHeader) * 1000
      : undefined;
    const error = new Error(`HTTP ${response.status} for ${url}`);
    error.status = response.status;
    error.retryAfterMs = Number.isFinite(retryAfterMs) ? retryAfterMs : undefined;
    throw error;
  }
  return response.json();
}

async function readExistingOutput(filePath) {
  const { readFile } = await import("node:fs/promises");

  try {
    const existing = JSON.parse(await readFile(path.resolve(filePath), "utf8"));
    return {
      datasets: Array.isArray(existing.datasets) ? existing.datasets : [],
      regions: Array.isArray(existing.regions) ? existing.regions : [],
      failures: Array.isArray(existing.failures) ? existing.failures : [],
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {
        datasets: [],
        regions: [],
        failures: [],
      };
    }

    throw error;
  }
}

async function writeOutputFile(filePath, output) {
  const outputPath = path.resolve(filePath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
}

function resolveTimezone(province) {
  const map = {
    BALI: "Asia/Makassar",
    "NUSA TENGGARA BARAT": "Asia/Makassar",
    "NUSA TENGGARA TIMUR": "Asia/Makassar",
    "KALIMANTAN SELATAN": "Asia/Makassar",
    "KALIMANTAN TIMUR": "Asia/Makassar",
    "KALIMANTAN UTARA": "Asia/Makassar",
    "SULAWESI UTARA": "Asia/Makassar",
    "SULAWESI TENGAH": "Asia/Makassar",
    "SULAWESI SELATAN": "Asia/Makassar",
    "SULAWESI TENGGARA": "Asia/Makassar",
    GORONTALO: "Asia/Makassar",
    "SULAWESI BARAT": "Asia/Makassar",
    MALUKU: "Asia/Jayapura",
    "MALUKU UTARA": "Asia/Jayapura",
    PAPUA: "Asia/Jayapura",
    "PAPUA BARAT": "Asia/Jayapura",
    "PAPUA SELATAN": "Asia/Jayapura",
    "PAPUA TENGAH": "Asia/Jayapura",
    "PAPUA PEGUNUNGAN": "Asia/Jayapura",
    "PAPUA BARAT DAYA": "Asia/Jayapura",
    "KALIMANTAN BARAT": "Asia/Pontianak",
  };

  return map[province.toUpperCase()] ?? "Asia/Jakarta";
}

function normalizeMonthPayload(payload) {
  const jadwalEntries = Object.entries(payload.data.jadwal);
  return {
    region_id: payload.data.id,
    location: payload.data.kabko,
    province: payload.data.prov,
    timezone: resolveTimezone(payload.data.prov),
    year: Number.parseInt(jadwalEntries[0][0].slice(0, 4), 10),
    month: MONTH_NAMES[Number.parseInt(jadwalEntries[0][0].slice(5, 7), 10) - 1],
    month_number: Number.parseInt(jadwalEntries[0][0].slice(5, 7), 10),
    last_updated: null,
    prayers: jadwalEntries.map(([date, times]) => ({
      date,
      day: Number.parseInt(date.slice(-2), 10),
      imsak: times.imsak,
      fajr: times.subuh,
      syuruk: times.terbit,
      dhuha: times.dhuha,
      dhuhr: times.dzuhur,
      asr: times.ashar,
      maghrib: times.maghrib,
      isha: times.isya,
    })),
  };
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const existing = options.resume ? await readExistingOutput(options.resume) : null;

  const regionsPayload = await fetchJson(`${options.baseUrl}/kota/semua`, options.timeoutMs);
  const regions = options.limit ? regionsPayload.data.slice(0, options.limit) : regionsPayload.data;
  const existingKeys = new Set(
    (existing?.datasets ?? []).map((dataset) => `${dataset.region_id}:${dataset.year}:${dataset.month_number}`),
  );
  const jobs = [];
  for (const region of regions) {
    for (let month = options.startMonth; month <= options.endMonth; month += 1) {
      const key = `${region.id}:${options.year}:${month}`;
      if (!existingKeys.has(key)) {
        jobs.push({ region, month });
      }
    }
  }

  const datasets = [...(existing?.datasets ?? [])];
  const failures = [];
  let nextIndex = 0;
  let completed = 0;
  const regionMap = new Map();
  for (const dataset of datasets) {
    regionMap.set(dataset.region_id, {
      id: dataset.region_id,
      location: dataset.location,
      province: dataset.province,
      timezone: dataset.timezone,
    });
  }

  const output = {
    meta: {
      source: options.baseUrl,
      fetched_at: new Date().toISOString(),
      year: options.year,
      start_month: options.startMonth,
      end_month: options.endMonth,
      resumed_from: options.resume,
      region_count: regionMap.size,
      dataset_count: datasets.length,
      failure_count: failures.length,
    },
    regions: [],
    datasets: [],
    failures,
  };

  async function checkpoint() {
    output.meta.fetched_at = new Date().toISOString();
    output.meta.region_count = regionMap.size;
    output.meta.dataset_count = datasets.length;
    output.meta.failure_count = failures.length;
    output.regions = Array.from(regionMap.values()).sort((a, b) => a.location.localeCompare(b.location));
    output.datasets = [...datasets].sort((a, b) => a.location.localeCompare(b.location) || a.month_number - b.month_number);
    await writeOutputFile(options.output, output);
  }

  async function worker() {
    while (true) {
      const job = jobs[nextIndex];
      nextIndex += 1;
      if (!job) {
        return;
      }

      const monthString = String(job.month).padStart(2, "0");
      const url = `${options.baseUrl}/jadwal/${job.region.id}/${options.year}-${monthString}`;

      let attempt = 0;
      let lastError = null;
      while (attempt <= options.maxRetries) {
        try {
          const payload = await fetchJson(url, options.timeoutMs);
          const dataset = normalizeMonthPayload(payload);
          datasets.push(dataset);
          regionMap.set(dataset.region_id, {
            id: dataset.region_id,
            location: dataset.location,
            province: dataset.province,
            timezone: dataset.timezone,
          });
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          const status = error && typeof error === "object" && "status" in error ? error.status : null;
          const retryAfterMs =
            error && typeof error === "object" && "retryAfterMs" in error ? error.retryAfterMs : undefined;
          if (attempt >= options.maxRetries || (status !== 429 && status !== 503)) {
            break;
          }

          const backoffMs = retryAfterMs ?? Math.min(10_000, options.delayMs * 2 ** (attempt + 1));
          await sleep(backoffMs);
        }

        attempt += 1;
      }

      if (lastError) {
        failures.push({
          region_id: job.region.id,
          month: job.month,
          error: lastError instanceof Error ? lastError.message : String(lastError),
        });
      }

      completed += 1;
      if (completed % options.progressEvery === 0 || completed === jobs.length) {
        console.log(`[${completed}/${jobs.length}] ok=${datasets.length} failed=${failures.length}`);
        await checkpoint();
      }

      if (options.delayMs > 0) {
        await sleep(options.delayMs);
      }
    }
  }

  await checkpoint();
  await Promise.all(Array.from({ length: options.concurrency }, worker));
  await checkpoint();

  const outputPath = path.resolve(options.output);
  console.log(`Wrote ${datasets.length} datasets to ${outputPath}`);
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
