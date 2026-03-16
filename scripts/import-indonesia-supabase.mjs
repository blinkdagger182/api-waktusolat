import { readFile } from "node:fs/promises";
import path from "node:path";

async function readEnvFile(filePath) {
  try {
    const contents = await readFile(filePath, "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) continue;
      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  } catch (error) {
    if (error && error.code !== "ENOENT") throw error;
  }
}

async function supabaseRequest(baseUrl, serviceRoleKey, pathName, init = {}) {
  const response = await fetch(`${baseUrl}/rest/v1/${pathName}`, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Supabase request failed (${response.status}): ${await response.text()}`);
  }
}

function parseArgs(argv) {
  const options = {
    input: "json/indonesia-prayer-data.json",
    batchSize: 100,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--input") {
      options.input = argv[index + 1];
      index += 1;
    } else if (arg === "--batch-size") {
      options.batchSize = Number.parseInt(argv[index + 1], 10);
      index += 1;
    }
  }

  return options;
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function run() {
  await readEnvFile(path.resolve(".env"));
  await readEnvFile(path.resolve(".env.local"));

  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceRoleKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const options = parseArgs(process.argv.slice(2));
  const payload = JSON.parse(await readFile(path.resolve(options.input), "utf8"));

  await supabaseRequest(baseUrl, serviceRoleKey, "indonesia_regions?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(payload.regions),
  });

  const batches = chunk(
    payload.datasets.map((entry) => ({
      region_id: entry.region_id,
      year: entry.year,
      month: entry.month,
      month_number: entry.month_number,
      timezone: entry.timezone,
      location: entry.location,
      province: entry.province,
      last_updated: entry.last_updated ?? null,
      prayers: entry.prayers,
    })),
    options.batchSize,
  );

  for (let index = 0; index < batches.length; index += 1) {
    await supabaseRequest(baseUrl, serviceRoleKey, "indonesia_prayer_months?on_conflict=region_id,year,month", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(batches[index]),
    });

    if ((index + 1) % 10 === 0 || index + 1 === batches.length) {
      console.log(`Imported batch ${index + 1}/${batches.length}`);
    }
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
