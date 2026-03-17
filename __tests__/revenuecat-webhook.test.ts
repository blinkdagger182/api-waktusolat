import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { createMocks } from "node-mocks-http";

jest.mock("../lib/supabase-admin", () => ({
  isSupabaseConfigured: jest.fn(),
  recordDonationPoolEventInSupabase: jest.fn(),
}));

const supabaseAdmin = require("../lib/supabase-admin");
const handler = require("../pages/api/revenuecat/webhook").default;

const mockedIsSupabaseConfigured = supabaseAdmin.isSupabaseConfigured as jest.Mock;
const mockedRecordDonationPoolEventInSupabase = supabaseAdmin.recordDonationPoolEventInSupabase as jest.Mock;

describe("/api/revenuecat/webhook", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.REVENUECAT_WEBHOOK_SECRET = "rc-secret";
    process.env.DONATION_POOL_PRODUCT_IDS = "app.riskcreatives.waktu.supporter,app.riskcreatives.waktu.sponsor";
    process.env.DONATION_POOL_DEFAULT_TARGET = "1000";
    process.env.DONATION_POOL_DEFAULT_CAP = "1000";
    mockedIsSupabaseConfigured.mockReturnValue(true);
  });

  test("records a RevenueCat purchase for an allowed pool product", async () => {
    mockedRecordDonationPoolEventInSupabase.mockResolvedValue({
      month_start: "2026-04-01",
      total_amount: 40,
      target_amount: 1000,
      cap_amount: 1000,
    });

    const { req, res } = createMocks({
      method: "POST",
      headers: {
        authorization: "Bearer rc-secret",
      },
      body: {
        event: {
          id: "evt_123",
          type: "NON_RENEWING_PURCHASE",
          product_id: "app.riskcreatives.waktu.supporter",
          price_in_purchased_currency: 40,
          currency: "MYR",
          purchased_at_ms: 1772400000000,
          app_user_id: "$RCAnonymousID:abc",
          store: "APP_STORE",
        },
      },
    });

    await handler(req, res);

    expect(mockedRecordDonationPoolEventInSupabase).toHaveBeenCalledWith({
      eventId: "evt_123",
      amount: 40,
      source: "revenuecat",
      currency: "MYR",
      purchasedAt: "2026-03-01T21:20:00.000Z",
      metadata: {
        type: "NON_RENEWING_PURCHASE",
        productId: "app.riskcreatives.waktu.supporter",
        appUserId: "$RCAnonymousID:abc",
        originalAppUserId: null,
        transactionId: null,
        originalTransactionId: null,
        store: "APP_STORE",
        countryCode: null,
        offeringId: null,
      },
      targetAmount: 1000,
      capAmount: 1000,
    });
    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData()).toEqual({
      received: true,
      recorded: true,
      monthStart: "2026-04-01",
      totalAmount: 40,
      targetAmount: 1000,
      capAmount: 1000,
    });
  });

  test("skips products outside the pool allowlist", async () => {
    const { req, res } = createMocks({
      method: "POST",
      headers: {
        authorization: "Bearer rc-secret",
      },
      body: {
        event: {
          id: "evt_456",
          type: "NON_RENEWING_PURCHASE",
          product_id: "app.riskcreatives.waktu.unrelated",
          price_in_purchased_currency: 20,
          currency: "MYR",
        },
      },
    });

    await handler(req, res);

    expect(mockedRecordDonationPoolEventInSupabase).not.toHaveBeenCalled();
    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData()).toEqual({
      received: true,
      skipped: true,
      reason: "product_not_in_pool",
      productId: "app.riskcreatives.waktu.unrelated",
    });
  });
});
