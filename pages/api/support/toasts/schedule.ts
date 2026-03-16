import type { NextApiRequest, NextApiResponse } from "next";
import {
  getSupportToastScheduleFromSupabase,
  isSupabaseConfigured,
  upsertSupportToastScheduleInSupabase,
} from "../../../../lib/supabase-admin";
import { SupportToastScheduleRecord } from "../../../../lib/support-toast";

function readAdminKey(req: NextApiRequest) {
  const headerValue = req.headers["x-donation-admin-key"];
  return Array.isArray(headerValue) ? headerValue[0] : headerValue;
}

function isAuthorized(req: NextApiRequest) {
  const expectedKey = process.env.DONATION_POOL_API_KEY;
  return Boolean(expectedKey) && readAdminKey(req) === expectedKey;
}

function toNumberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function isAudience(value: unknown): value is SupportToastScheduleRecord["audience"] {
  return value === "debug" || value === "production" || value === "all";
}

function isVariant(value: unknown): value is SupportToastScheduleRecord["variant"] {
  return value === "generic" || value === "launch" || value === "streak" || value === "eid_pool" || value === "monthly_pool";
}

function normalizeScheduleItem(
  item: Record<string, unknown>,
  existingMap: Map<string, SupportToastScheduleRecord>
): SupportToastScheduleRecord | null {
  const triggerKey = typeof item.triggerKey === "string" ? item.triggerKey.trim() : "";

  if (!triggerKey) {
    return null;
  }

  const current = existingMap.get(triggerKey);
  const audience = isAudience(item.audience) ? item.audience : current?.audience ?? "production";
  const variant = isVariant(item.variant) ? item.variant : current?.variant ?? "generic";
  const message = typeof item.message === "string" && item.message.trim() !== "" ? item.message.trim() : current?.message ?? "";

  if (!message) {
    return null;
  }

  return {
    trigger_key: triggerKey,
    is_enabled: typeof item.isEnabled === "boolean" ? item.isEnabled : current?.is_enabled ?? true,
    audience,
    title: typeof item.title === "string" ? item.title : current?.title ?? null,
    message,
    variant,
    min_launch_count: toNumberOrNull(item.minLaunchCount ?? current?.min_launch_count),
    min_active_day_streak: toNumberOrNull(item.minActiveDayStreak ?? current?.min_active_day_streak),
    minimum_hours_between_shows: toNumberOrNull(item.minimumHoursBetweenShows ?? current?.minimum_hours_between_shows),
    show_once: typeof item.showOnce === "boolean" ? item.showOnce : current?.show_once ?? true,
    priority: toNumberOrNull(item.priority ?? current?.priority) ?? 100,
    has_progress: typeof item.hasProgress === "boolean" ? item.hasProgress : current?.has_progress ?? false,
    auto_dismiss_seconds: toNumberOrNull(item.autoDismissSeconds ?? current?.auto_dismiss_seconds) ?? 8,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!isSupabaseConfigured()) {
    return res.status(503).json({
      error: "Supabase is not configured",
    });
  }

  if (req.method === "GET") {
    const rows = await getSupportToastScheduleFromSupabase();
    return res.status(200).json(rows);
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({
      error: "Unauthorized",
    });
  }

  const items = Array.isArray(req.body?.items) ? req.body.items : [];

  if (items.length === 0) {
    return res.status(400).json({
      error: "items must be a non-empty array",
    });
  }

  try {
    const currentRows = await getSupportToastScheduleFromSupabase();
    const existingMap = new Map(currentRows.map((row) => [row.trigger_key, row]));
    const normalizedItems = items
      .map((item) => normalizeScheduleItem(item, existingMap))
      .filter(Boolean) as SupportToastScheduleRecord[];

    if (normalizedItems.length !== items.length) {
      return res.status(400).json({
        error: "Each item must include at least triggerKey and message",
      });
    }

    await upsertSupportToastScheduleInSupabase(normalizedItems);
    const updatedRows = await getSupportToastScheduleFromSupabase();

    return res.status(200).json(updatedRows);
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unexpected support toast schedule error",
    });
  }
}
