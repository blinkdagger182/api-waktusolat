import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { createMocks } from "node-mocks-http";
import {
  getCurrentDonationPoolMonthStart,
  normalizeDonationPoolMonthStart,
  toDonationPoolSnapshot,
} from "../lib/donation-pool";

jest.mock("../lib/supabase-admin", () => ({
  getDonationPoolMonthFromSupabase: jest.fn(),
  isSupabaseConfigured: jest.fn(),
  recordDonationPoolEventInSupabase: jest.fn(),
  setDonationPoolTargetInSupabase: jest.fn(),
}));

const supabaseAdmin = require("../lib/supabase-admin");
const handler = require("../pages/api/donations/pool/current").default;

const mockedIsSupabaseConfigured = supabaseAdmin.isSupabaseConfigured as jest.Mock;
const mockedGetDonationPoolMonthFromSupabase = supabaseAdmin.getDonationPoolMonthFromSupabase as jest.Mock;
const mockedRecordDonationPoolEventInSupabase = supabaseAdmin.recordDonationPoolEventInSupabase as jest.Mock;
const mockedSetDonationPoolTargetInSupabase = supabaseAdmin.setDonationPoolTargetInSupabase as jest.Mock;

describe("donation pool helpers", () => {
  test("normalize month input to first day of month", () => {
    expect(normalizeDonationPoolMonthStart("2026-03")).toBe("2026-03-01");
    expect(normalizeDonationPoolMonthStart("2026-03-24")).toBe("2026-03-01");
  });

  test("builds a default snapshot when no row exists", () => {
    expect(toDonationPoolSnapshot(null, "2026-03-01")).toEqual({
      month: "2026-03",
      monthStart: "2026-03-01",
      totalAmount: 0,
      targetAmount: 150,
      capAmount: 1000,
      progress: 0,
    });
  });

  test("uses Malaysia month boundaries for fallback", () => {
    expect(getCurrentDonationPoolMonthStart(new Date("2026-03-16T12:00:00.000Z"))).toBe("2026-03-01");
  });
});

describe("/api/donations/pool/current", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.DONATION_POOL_API_KEY = "test-secret";
    mockedIsSupabaseConfigured.mockReturnValue(true);
  });

  test("returns current month pool with defaults when empty", async () => {
    mockedGetDonationPoolMonthFromSupabase.mockResolvedValue(null);

    const { req, res } = createMocks({
      method: "GET",
      query: {
        month: "2026-03",
      },
    });

    await handler(req, res);

    expect(mockedGetDonationPoolMonthFromSupabase).toHaveBeenCalledWith("2026-03-01");
    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData()).toEqual({
      month: "2026-03",
      monthStart: "2026-03-01",
      totalAmount: 0,
      targetAmount: 150,
      capAmount: 1000,
      progress: 0,
    });
  });

  test("rejects unauthenticated updates", async () => {
    const { req, res } = createMocks({
      method: "POST",
      body: {
        eventId: "rc_123",
        amount: 10,
      },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(401);
  });

  test("records a donation event through the backend route", async () => {
    mockedRecordDonationPoolEventInSupabase.mockResolvedValue({
      month_start: "2026-03-01",
      total_amount: 40,
      target_amount: 150,
      cap_amount: 1000,
    });

    const { req, res } = createMocks({
      method: "POST",
      headers: {
        "x-donation-admin-key": "test-secret",
      },
      body: {
        eventId: "rc_123",
        amount: 40,
        source: "revenuecat",
        metadata: {
          productId: "eid_pool_small",
        },
      },
    });

    await handler(req, res);

    expect(mockedRecordDonationPoolEventInSupabase).toHaveBeenCalledWith({
      eventId: "rc_123",
      amount: 40,
      source: "revenuecat",
      currency: "MYR",
      purchasedAt: null,
      metadata: {
        productId: "eid_pool_small",
      },
      targetAmount: null,
      capAmount: null,
    });
    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData()).toEqual({
      month: "2026-03",
      monthStart: "2026-03-01",
      totalAmount: 40,
      targetAmount: 150,
      capAmount: 1000,
      progress: 0.2667,
    });
  });

  test("updates the target for the month", async () => {
    mockedSetDonationPoolTargetInSupabase.mockResolvedValue({
      month_start: "2026-03-01",
      total_amount: 40,
      target_amount: 150,
      cap_amount: 1000,
    });

    const { req, res } = createMocks({
      method: "POST",
      headers: {
        "x-donation-admin-key": "test-secret",
      },
      body: {
        action: "set_target",
        month: "2026-03",
        targetAmount: 150,
        capAmount: 1000,
      },
    });

    await handler(req, res);

    expect(mockedSetDonationPoolTargetInSupabase).toHaveBeenCalledWith({
      monthStart: "2026-03-01",
      targetAmount: 150,
      capAmount: 1000,
    });
    expect(res._getStatusCode()).toBe(200);
  });
});
