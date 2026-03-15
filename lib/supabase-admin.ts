import { PrayerMonthRecord } from "./waktu-solat";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function isSupabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

async function supabaseRequest(path: string, init: RequestInit = {}) {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase environment variables are not configured");
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY!,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY!}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase request failed (${response.status}): ${body}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

export async function getPrayerMonthFromSupabase(zone: string, year: number, month: string): Promise<PrayerMonthRecord | null> {
  const search = new URLSearchParams({
    select: "zone,year,month,last_updated,prayers",
    zone: `eq.${zone.toUpperCase()}`,
    year: `eq.${year}`,
    month: `eq.${month.toUpperCase()}`,
    limit: "1",
  });

  const rows = await supabaseRequest(`prayer_months?${search.toString()}`, {
    method: "GET",
  });

  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

export async function upsertSupabaseRows(table: string, rows: unknown[], onConflict: string) {
  if (rows.length === 0) {
    return [];
  }

  const search = new URLSearchParams({
    on_conflict: onConflict,
  });

  return supabaseRequest(`${table}?${search.toString()}`, {
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
}
