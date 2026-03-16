import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { createMocks } from "node-mocks-http";

jest.mock("../lib/supabase-admin", () => ({
  getSupportToastScheduleFromSupabase: jest.fn(),
  isSupabaseConfigured: jest.fn(),
  upsertSupportToastScheduleInSupabase: jest.fn(),
}));

const supabaseAdmin = require("../lib/supabase-admin");
const handler = require("../pages/api/support/toasts/schedule").default;

const mockedIsSupabaseConfigured = supabaseAdmin.isSupabaseConfigured as jest.Mock;
const mockedGetSupportToastScheduleFromSupabase = supabaseAdmin.getSupportToastScheduleFromSupabase as jest.Mock;
const mockedUpsertSupportToastScheduleInSupabase = supabaseAdmin.upsertSupportToastScheduleInSupabase as jest.Mock;

const baseRow = {
  trigger_key: "launch_5",
  is_enabled: true,
  audience: "production",
  title: null,
  message: "Love Waktu? Help keep it running.",
  variant: "launch",
  min_launch_count: 5,
  min_active_day_streak: null,
  minimum_hours_between_shows: null,
  show_once: true,
  priority: 10,
  has_progress: false,
  auto_dismiss_seconds: 8,
};

describe("/api/support/toasts/schedule", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.DONATION_POOL_API_KEY = "test-secret";
    mockedIsSupabaseConfigured.mockReturnValue(true);
  });

  test("returns the public schedule", async () => {
    mockedGetSupportToastScheduleFromSupabase.mockResolvedValue([baseRow]);

    const { req, res } = createMocks({
      method: "GET",
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData()).toEqual([baseRow]);
  });

  test("rejects unauthenticated writes", async () => {
    const { req, res } = createMocks({
      method: "POST",
      body: {
        items: [],
      },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(401);
  });

  test("updates an existing schedule row", async () => {
    mockedGetSupportToastScheduleFromSupabase
      .mockResolvedValueOnce([baseRow])
      .mockResolvedValueOnce([
        {
          ...baseRow,
          message: "Love Waktu? Support this month's costs.",
          is_enabled: false,
          minimum_hours_between_shows: 48,
        },
      ]);

    const { req, res } = createMocks({
      method: "POST",
      headers: {
        "x-donation-admin-key": "test-secret",
      },
      body: {
        items: [
          {
            triggerKey: "launch_5",
            message: "Love Waktu? Support this month's costs.",
            isEnabled: false,
            minimumHoursBetweenShows: 48,
          },
        ],
      },
    });

    await handler(req, res);

    expect(mockedUpsertSupportToastScheduleInSupabase).toHaveBeenCalledWith([
      {
        ...baseRow,
        message: "Love Waktu? Support this month's costs.",
        is_enabled: false,
        minimum_hours_between_shows: 48,
      },
    ]);
    expect(res._getStatusCode()).toBe(200);
  });
});
