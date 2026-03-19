import { PrayerMonthRecord } from "./waktu-solat";
import { IndonesiaPrayerMonthRecord, IndonesiaRegionRecord } from "./indonesia-prayer";
import { DonationPoolMonthlyRecord } from "./donation-pool";
import { SupportToastScheduleRecord } from "./support-toast";

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

  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text);
}

async function supabaseRpc<T>(fn: string, payload: Record<string, unknown>) {
  const rows = await supabaseRequest(`rpc/${fn}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (Array.isArray(rows)) {
    return (rows[0] ?? null) as T | null;
  }

  return (rows ?? null) as T | null;
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

export async function getIndonesiaRegionsFromSupabase(): Promise<IndonesiaRegionRecord[]> {
  const rows = await supabaseRequest("indonesia_regions?select=id,location,province,timezone&order=location.asc", {
    method: "GET",
  });

  return Array.isArray(rows) ? rows : [];
}

export async function getIndonesiaPrayerMonthFromSupabase(regionId: string, year: number, month: string): Promise<IndonesiaPrayerMonthRecord | null> {
  const search = new URLSearchParams({
    select: "region_id,year,month,month_number,timezone,location,province,last_updated,prayers",
    region_id: `eq.${regionId}`,
    year: `eq.${year}`,
    month: `eq.${month.toUpperCase()}`,
    limit: "1",
  });

  const rows = await supabaseRequest(`indonesia_prayer_months?${search.toString()}`, {
    method: "GET",
  });

  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

export async function getDonationPoolMonthFromSupabase(monthStart: string): Promise<DonationPoolMonthlyRecord | null> {
  const search = new URLSearchParams({
    select: "month_start,total_amount,target_amount,cap_amount,created_at,updated_at",
    month_start: `eq.${monthStart}`,
    limit: "1",
  });

  const rows = await supabaseRequest(`donation_pool_monthly?${search.toString()}`, {
    method: "GET",
  });

  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

export async function recordDonationPoolEventInSupabase(payload: {
  eventId: string;
  amount: number;
  source?: string;
  currency?: string;
  purchasedAt?: string | null;
  metadata?: Record<string, unknown> | null;
  targetAmount?: number | null;
  capAmount?: number | null;
}) {
  return supabaseRpc<DonationPoolMonthlyRecord>("record_donation_pool_event", {
    p_event_id: payload.eventId,
    p_amount: payload.amount,
    p_source: payload.source ?? "backend",
    p_currency: payload.currency ?? "MYR",
    p_purchased_at: payload.purchasedAt ?? null,
    p_metadata: payload.metadata ?? {},
    p_target_amount: payload.targetAmount ?? null,
    p_cap_amount: payload.capAmount ?? null,
  });
}

export async function setDonationPoolTargetInSupabase(payload: {
  monthStart?: string | null;
  targetAmount: number;
  capAmount?: number | null;
}) {
  return supabaseRpc<DonationPoolMonthlyRecord>("set_donation_pool_target", {
    p_month_start: payload.monthStart ?? null,
    p_target_amount: payload.targetAmount,
    p_cap_amount: payload.capAmount ?? null,
  });
}

export async function getSupportToastScheduleFromSupabase(): Promise<SupportToastScheduleRecord[]> {
  const rows = await supabaseRequest(
    "support_toast_schedule?select=trigger_key,is_enabled,audience,title,message,variant,min_launch_count,min_active_day_streak,minimum_hours_between_shows,show_once,priority,has_progress,auto_dismiss_seconds,created_at,updated_at&order=priority.asc",
    {
      method: "GET",
    }
  );

  return Array.isArray(rows) ? rows : [];
}

export async function upsertSupportToastScheduleInSupabase(rows: SupportToastScheduleRecord[]) {
  return upsertSupabaseRows("support_toast_schedule", rows, "trigger_key");
}

export async function getAndroidAppVersionConfigFromSupabase(): Promise<Record<string, unknown> | null> {
  const rows = await supabaseRequest(
    "android_app_version?select=*&platform=eq.android&limit=1",
    { method: "GET" }
  );
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const r = rows[0];
  return {
    platform: r.platform,
    latestVersion: r.latest_version,
    minimumSupportedVersion: r.minimum_supported_version,
    title: r.title,
    subtitle: r.subtitle,
    message: r.message,
    dismissible: r.dismissible,
    ctaLabel: r.cta_label,
    playStoreUrl: r.play_store_url,
    releaseNotes: r.release_notes,
    publishedAt: r.published_at,
    effectiveFrom: r.effective_from,
    supportUrl: r.support_url,
    show: r.show,
    updatedAt: r.updated_at,
  };
}

export async function upsertAndroidAppVersionConfigInSupabase(config: Record<string, unknown>): Promise<void> {
  await supabaseRequest("android_app_version?on_conflict=platform", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      platform: config.platform,
      latest_version: config.latestVersion,
      minimum_supported_version: config.minimumSupportedVersion,
      title: config.title,
      subtitle: config.subtitle,
      message: config.message,
      dismissible: config.dismissible,
      cta_label: config.ctaLabel,
      play_store_url: config.playStoreUrl,
      release_notes: config.releaseNotes,
      published_at: config.publishedAt,
      effective_from: config.effectiveFrom,
      support_url: config.supportUrl,
      show: config.show,
      updated_at: config.updatedAt,
    }),
  });
}
