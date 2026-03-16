import type { NextApiRequest, NextApiResponse } from "next";
import {
  getDonationPoolMonthFromSupabase,
  isSupabaseConfigured,
  recordDonationPoolEventInSupabase,
  setDonationPoolTargetInSupabase,
} from "../../../../lib/supabase-admin";
import {
  normalizeDonationPoolMonthStart,
  toDonationPoolSnapshot,
} from "../../../../lib/donation-pool";

function readAdminKey(req: NextApiRequest) {
  const headerValue = req.headers["x-donation-admin-key"];
  return Array.isArray(headerValue) ? headerValue[0] : headerValue;
}

function isAuthorized(req: NextApiRequest) {
  const expectedKey = process.env.DONATION_POOL_API_KEY;
  return Boolean(expectedKey) && readAdminKey(req) === expectedKey;
}

function toNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : NaN;
  }

  if (typeof value === "string" && value.trim() !== "") {
    return Number(value);
  }

  return NaN;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!isSupabaseConfigured()) {
    return res.status(503).json({
      error: "Supabase is not configured",
    });
  }

  if (req.method === "GET") {
    const monthStart = normalizeDonationPoolMonthStart(req.query.month);
    const record = await getDonationPoolMonthFromSupabase(monthStart);
    return res.status(200).json(toDonationPoolSnapshot(record, monthStart));
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

  const action = req.body?.action === "set_target" ? "set_target" : "record";

  try {
    if (action === "set_target") {
      const monthStart = normalizeDonationPoolMonthStart(req.body?.month);
      const targetAmount = toNumber(req.body?.targetAmount);
      const capAmount = req.body?.capAmount === undefined ? null : toNumber(req.body?.capAmount);

      if (!Number.isFinite(targetAmount) || targetAmount <= 0) {
        return res.status(400).json({
          error: "targetAmount must be a positive number",
        });
      }

      if (capAmount !== null && (!Number.isFinite(capAmount) || capAmount <= 0)) {
        return res.status(400).json({
          error: "capAmount must be a positive number",
        });
      }

      const record = await setDonationPoolTargetInSupabase({
        monthStart,
        targetAmount,
        capAmount,
      });

      return res.status(200).json(toDonationPoolSnapshot(record, monthStart));
    }

    const amount = toNumber(req.body?.amount);
    const eventId = typeof req.body?.eventId === "string" ? req.body.eventId.trim() : "";

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        error: "amount must be a positive number",
      });
    }

    if (!eventId) {
      return res.status(400).json({
        error: "eventId is required",
      });
    }

    const targetAmount = req.body?.targetAmount === undefined ? null : toNumber(req.body?.targetAmount);
    const capAmount = req.body?.capAmount === undefined ? null : toNumber(req.body?.capAmount);

    if (targetAmount !== null && (!Number.isFinite(targetAmount) || targetAmount <= 0)) {
      return res.status(400).json({
        error: "targetAmount must be a positive number",
      });
    }

    if (capAmount !== null && (!Number.isFinite(capAmount) || capAmount <= 0)) {
      return res.status(400).json({
        error: "capAmount must be a positive number",
      });
    }

    const record = await recordDonationPoolEventInSupabase({
      eventId,
      amount,
      source: typeof req.body?.source === "string" ? req.body.source : "backend",
      currency: typeof req.body?.currency === "string" ? req.body.currency : "MYR",
      purchasedAt: typeof req.body?.purchasedAt === "string" ? req.body.purchasedAt : null,
      metadata: typeof req.body?.metadata === "object" && req.body?.metadata !== null ? req.body.metadata : {},
      targetAmount,
      capAmount,
    });

    const monthStart = normalizeDonationPoolMonthStart(record?.month_start);
    return res.status(200).json(toDonationPoolSnapshot(record, monthStart));
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unexpected donation pool error",
    });
  }
}

