import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_BASE_URL = "https://api.waktusolat.app";
const DEFAULT_START_YEAR = 2023;
const DEFAULT_END_YEAR = new Date().getFullYear() + 1;
const DEFAULT_START_MONTH = 1;
const DEFAULT_END_MONTH = 12;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_DELAY_MS = 150;
const DEFAULT_OUTPUT = "json/live-waktusolat-data.json";

function printHelp() {
  console.log(`Usage: yarn sync:live-data [options]

Options:
  --base-url <url>        API base URL. Default: ${DEFAULT_BASE_URL}
  --start-year <year>     First year to fetch. Default: ${DEFAULT_START_YEAR}
  --end-year <year>       Last year to fetch. Default: ${DEFAULT_END_YEAR}
  --start-month <month>   First month to fetch. Default: ${DEFAULT_START_MONTH}
  --end-month <month>     Last month to fetch. Default: ${DEFAULT_END_MONTH}
  --concurrency <n>       Parallel requests. Default: ${DEFAULT_CONCURRENCY}
  --delay-ms <ms>         Delay after each request per worker. Default: ${DEFAULT_DELAY_MS}
  --output <path>         Output JSON path. Default: ${DEFAULT_OUTPUT}
  --timeout-ms <ms>       Per-request timeout. Default: 30000
  --help                  Show this help

Example:
  yarn sync:live-data --start-year 2023 --end-year 2027 --output json/full-dump.json
`);
}

function parseArgs(argv) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    startYear: DEFAULT_START_YEAR,
    endYear: DEFAULT_END_YEAR,
    startMonth: DEFAULT_START_MONTH,
    endMonth: DEFAULT_END_MONTH,
    concurrency: DEFAULT_CONCURRENCY,
    delayMs: DEFAULT_DELAY_MS,
    timeoutMs: 30_000,
    output: DEFAULT_OUTPUT,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help") {
      options.help = true;
      continue;
    }

    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    switch (arg) {
      case "--base-url":
        options.baseUrl = value.replace(/\/+$/, "");
        break;
      case "--start-year":
        options.startYear = parseInteger(value, arg);
        break;
      case "--end-year":
        options.endYear = parseInteger(value, arg);
        break;
      case "--concurrency":
        options.concurrency = parseInteger(value, arg);
        break;
      case "--start-month":
        options.startMonth = parseInteger(value, arg);
        break;
      case "--end-month":
        options.endMonth = parseInteger(value, arg);
        break;
      case "--delay-ms":
        options.delayMs = parseInteger(value, arg);
        break;
      case "--timeout-ms":
        options.timeoutMs = parseInteger(value, arg);
        break;
      case "--output":
        options.output = value;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }

    index += 1;
  }

  if (options.startYear > options.endYear) {
    throw new Error("--start-year must be less than or equal to --end-year");
  }

  if (options.concurrency < 1) {
    throw new Error("--concurrency must be at least 1");
  }

  if (options.startMonth < 1 || options.startMonth > 12) {
    throw new Error("--start-month must be between 1 and 12");
  }

  if (options.endMonth < 1 || options.endMonth > 12) {
    throw new Error("--end-month must be between 1 and 12");
  }

  if (options.startMonth > options.endMonth) {
    throw new Error("--start-month must be less than or equal to --end-month");
  }

  if (options.delayMs < 0) {
    throw new Error("--delay-ms must be 0 or greater");
  }

  if (options.timeoutMs < 1) {
    throw new Error("--timeout-ms must be at least 1");
  }

  return options;
}

function parseInteger(value, flagName) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`${flagName} must be an integer`);
  }
  return parsed;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchJson(url, timeoutMs) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? await response.json() : await response.text();

  return {
    ok: response.ok,
    status: response.status,
    payload,
  };
}

async function fetchWithRetries(url, timeoutMs, retries = 3) {
  let attempt = 0;
  let lastError;

  while (attempt < retries) {
    attempt += 1;

    try {
      const response = await fetchJson(url, timeoutMs);
      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`HTTP ${response.status}`);
      } else {
        return response;
      }
    } catch (error) {
      lastError = error;
    }

    if (attempt < retries) {
      await sleep(attempt * 1_000);
    }
  }

  throw lastError;
}

function createJobs(zones, startYear, endYear, startMonth, endMonth) {
  const jobs = [];

  for (let year = startYear; year <= endYear; year += 1) {
    for (let month = startMonth; month <= endMonth; month += 1) {
      for (const zone of zones) {
        jobs.push({
          zone: zone.jakimCode,
          year,
          month,
        });
      }
    }
  }

  return jobs;
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const zonesUrl = `${options.baseUrl}/zones`;
  console.log(`Fetching zone list from ${zonesUrl}`);
  const zonesResponse = await fetchWithRetries(zonesUrl, options.timeoutMs);

  if (!zonesResponse.ok || !Array.isArray(zonesResponse.payload)) {
    throw new Error(`Failed to fetch zones from ${zonesUrl}`);
  }

  const zones = zonesResponse.payload;
  const jobs = createJobs(
    zones,
    options.startYear,
    options.endYear,
    options.startMonth,
    options.endMonth,
  );
  const datasets = [];
  const missing = [];
  const failures = [];

  let nextIndex = 0;
  let completed = 0;

  console.log(
    `Fetching ${jobs.length} zone-month documents across ${zones.length} zones`,
  );

  async function worker(workerId) {
    while (true) {
      const job = jobs[nextIndex];
      nextIndex += 1;

      if (!job) {
        return;
      }

      const url = `${options.baseUrl}/v2/solat/${job.zone}?year=${job.year}&month=${job.month}`;

      try {
        const response = await fetchWithRetries(url, options.timeoutMs);

        if (response.ok) {
          datasets.push(response.payload);
        } else if (response.status === 404) {
          missing.push({
            zone: job.zone,
            year: job.year,
            month: job.month,
          });
        } else {
          failures.push({
            zone: job.zone,
            year: job.year,
            month: job.month,
            status: response.status,
            error: response.payload,
          });
        }
      } catch (error) {
        failures.push({
          zone: job.zone,
          year: job.year,
          month: job.month,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      completed += 1;
      if (completed % 25 === 0 || completed === jobs.length) {
        console.log(
          `[${completed}/${jobs.length}] ok=${datasets.length} missing=${missing.length} failed=${failures.length} worker=${workerId}`,
        );
      }

      if (options.delayMs > 0) {
        await sleep(options.delayMs);
      }
    }
  }

  await Promise.all(
    Array.from({ length: options.concurrency }, (_, index) => worker(index + 1)),
  );

  datasets.sort((left, right) => {
    if (left.zone !== right.zone) {
      return left.zone.localeCompare(right.zone);
    }

    if (left.year !== right.year) {
      return left.year - right.year;
    }

    return monthNameToNumber(left.month) - monthNameToNumber(right.month);
  });

  const output = {
    meta: {
      source: options.baseUrl,
      fetched_at: new Date().toISOString(),
      start_year: options.startYear,
      end_year: options.endYear,
      start_month: options.startMonth,
      end_month: options.endMonth,
      zone_count: zones.length,
      request_count: jobs.length,
      success_count: datasets.length,
      missing_count: missing.length,
      failure_count: failures.length,
    },
    zones,
    datasets,
    missing,
    failures,
  };

  const outputPath = path.resolve(options.output);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  console.log(`Wrote ${datasets.length} datasets to ${outputPath}`);
  if (missing.length > 0) {
    console.log(`Missing documents: ${missing.length}`);
  }
  if (failures.length > 0) {
    console.log(`Failed documents: ${failures.length}`);
    process.exitCode = 1;
  }
}

function monthNameToNumber(monthName) {
  const months = {
    JAN: 1,
    FEB: 2,
    MAR: 3,
    APR: 4,
    MAY: 5,
    JUN: 6,
    JUL: 7,
    AUG: 8,
    SEP: 9,
    OCT: 10,
    NOV: 11,
    DEC: 12,
  };

  return months[monthName] ?? 99;
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
