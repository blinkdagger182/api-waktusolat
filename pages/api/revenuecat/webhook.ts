import type { NextApiRequest, NextApiResponse } from "next";
import { isSupabaseConfigured, recordDonationPoolEventInSupabase } from "../../../lib/supabase-admin";

const POSITIVE_EVENT_TYPES = new Set(["INITIAL_PURCHASE", "NON_RENEWING_PURCHASE", "RENEWAL"]);

type RevenueCatEventPayload = Record<string, unknown>;

function readString(value: unknown) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function readNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function readAuthorizationSecret(req: NextApiRequest) {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }

  const customHeader = req.headers["x-revenuecat-webhook-secret"];
  return Array.isArray(customHeader) ? customHeader[0] : customHeader;
}

function isAuthorized(req: NextApiRequest) {
  const expectedSecret = process.env.REVENUECAT_WEBHOOK_SECRET;
  if (!expectedSecret) {
    return true;
  }

  return readAuthorizationSecret(req) === expectedSecret;
}

function normalizedEventPayload(body: unknown): RevenueCatEventPayload {
  if (body && typeof body === "object" && "event" in (body as Record<string, unknown>)) {
    const nested = (body as Record<string, unknown>).event;
    if (nested && typeof nested === "object") {
      return nested as RevenueCatEventPayload;
    }
  }

  return (body && typeof body === "object") ? (body as RevenueCatEventPayload) : {};
}

function configuredProductIds() {
  const raw = process.env.DONATION_POOL_PRODUCT_IDS ?? "";
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

function readPurchasedAt(event: RevenueCatEventPayload) {
  const purchasedAtMs = readNumber(event.purchased_at_ms);
  if (purchasedAtMs !== null) {
    return new Date(purchasedAtMs).toISOString();
  }

  return readString(event.purchased_at);
}

function fallbackEventId(event: RevenueCatEventPayload, type: string, productId: string, purchasedAt: string | null) {
  const transactionId = readString(event.transaction_id) ?? readString(event.original_transaction_id) ?? "unknown-transaction";
  return [type || "UNKNOWN", productId || "unknown-product", transactionId, purchasedAt ?? "unknown-time"].join(":");
}

function defaultTargetAmount() {
  const parsed = readNumber(process.env.DONATION_POOL_DEFAULT_TARGET);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function defaultCapAmount() {
  const parsed = readNumber(process.env.DONATION_POOL_DEFAULT_CAP);
  return parsed !== null && parsed > 0 ? parsed : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  if (!isSupabaseConfigured()) {
    return res.status(503).json({
      error: "Supabase is not configured",
    });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({
      error: "Unauthorized",
    });
  }

  const event = normalizedEventPayload(req.body);
  const eventType = (readString(event.type) ?? "").toUpperCase();
  const productId = readString(event.product_id) ?? readString(event.productId) ?? "";
  const productAllowlist = configuredProductIds();

  if (!productId) {
    return res.status(200).json({ received: true, skipped: true, reason: "missing_product_id" });
  }

  if (productAllowlist.size > 0 && !productAllowlist.has(productId.toLowerCase())) {
    return res.status(200).json({ received: true, skipped: true, reason: "product_not_in_pool", productId });
  }

  if (eventType && !POSITIVE_EVENT_TYPES.has(eventType)) {
    return res.status(200).json({ received: true, skipped: true, reason: "unsupported_event_type", eventType, productId });
  }

  const amount = readNumber(event.price_in_purchased_currency) ?? readNumber(event.price) ?? readNumber(event.amount);
  if (amount === null || amount <= 0) {
    return res.status(200).json({ received: true, skipped: true, reason: "missing_amount", eventType, productId });
  }

  const purchasedAt = readPurchasedAt(event);
  const eventId =
    readString(event.id) ??
    readString(event.event_id) ??
    fallbackEventId(event, eventType, productId, purchasedAt);

  const currency = readString(event.currency) ?? readString(event.currency_code) ?? "MYR";

  try {
    const record = await recordDonationPoolEventInSupabase({
      eventId,
      amount,
      source: "revenuecat",
      currency,
      purchasedAt,
      metadata: {
        type: eventType,
        productId,
        appUserId: readString(event.app_user_id),
        originalAppUserId: readString(event.original_app_user_id),
        transactionId: readString(event.transaction_id),
        originalTransactionId: readString(event.original_transaction_id),
        store: readString(event.store),
        countryCode: readString(event.country_code),
        offeringId: readString(event.offering_id),
      },
      targetAmount: defaultTargetAmount(),
      capAmount: defaultCapAmount(),
    });

    return res.status(200).json({
      received: true,
      recorded: true,
      monthStart: record?.month_start ?? null,
      totalAmount: record?.total_amount ?? null,
      targetAmount: record?.target_amount ?? null,
      capAmount: record?.cap_amount ?? null,
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unexpected RevenueCat webhook error",
    });
  }
}
