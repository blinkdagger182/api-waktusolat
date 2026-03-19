import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { createMocks } from "node-mocks-http";
import {
  buildAndroidAppVersionResponse,
  compareVersions,
  getUpdateAvailability,
} from "../lib/app-version";

jest.mock("../lib/app-version", () => {
  const actual = jest.requireActual("../lib/app-version");

  return {
    ...actual,
    loadAndroidAppVersionConfig: jest.fn(),
    saveAndroidAppVersionConfig: jest.fn(),
  };
});

const appVersionLib = require("../lib/app-version");
const handler = require("../pages/api/app-version/android").default;

const mockedLoadAndroidAppVersionConfig = appVersionLib.loadAndroidAppVersionConfig as jest.Mock;
const mockedSaveAndroidAppVersionConfig = appVersionLib.saveAndroidAppVersionConfig as jest.Mock;

const sampleConfig = {
  platform: "android" as const,
  latestVersion: "2.3.0",
  minimumSupportedVersion: "2.1.0",
  title: "Update available",
  subtitle: "A newer version is ready.",
  message: "Includes prayer fixes and performance improvements.",
  dismissible: true,
  ctaLabel: "Update now",
  playStoreUrl: "https://play.google.com/store/apps/details?id=app.waktu",
  releaseNotes: ["Bug fixes", "Improved prayer notifications"],
  publishedAt: "2026-03-19T00:00:00.000Z",
  effectiveFrom: null,
  supportUrl: "https://waktusolat.app/support",
  show: true,
  updatedAt: "2026-03-19T00:00:00.000Z",
};

describe("app version helpers", () => {
  test("compares dot-delimited versions numerically", () => {
    expect(compareVersions("2.10.0", "2.9.9")).toBe(1);
    expect(compareVersions("2.0", "2.0.0")).toBe(0);
    expect(compareVersions("1.9.9", "2.0.0")).toBe(-1);
  });

  test("marks versions below minimum as required", () => {
    expect(getUpdateAvailability(sampleConfig, "2.0.9")).toBe("required");
  });

  test("marks versions below latest as optional", () => {
    expect(getUpdateAvailability(sampleConfig, "2.2.9")).toBe("optional");
  });

  test("hides dismiss action for forced updates", () => {
    expect(buildAndroidAppVersionResponse(sampleConfig, "2.0.0")).toMatchObject({
      updateAvailability: "required",
      forceUpdate: true,
      dismissible: false,
      shouldDisplay: true,
    });
  });
});

describe("/api/app-version/android", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.APP_VERSION_API_KEY = "version-secret";
  });

  test("returns version payload for the current app version", async () => {
    mockedLoadAndroidAppVersionConfig.mockResolvedValue(sampleConfig);

    const { req, res } = createMocks({
      method: "GET",
      query: {
        currentVersion: "2.0.5",
      },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData()).toMatchObject({
      platform: "android",
      currentVersion: "2.0.5",
      updateAvailability: "required",
      shouldUpdate: true,
      forceUpdate: true,
      dismissible: false,
      title: "Update available",
      subtitle: "A newer version is ready.",
      ctaLabel: "Update now",
      playStoreUrl: "https://play.google.com/store/apps/details?id=app.waktu",
    });
  });

  test("rejects unauthenticated updates", async () => {
    const { req, res } = createMocks({
      method: "POST",
      body: {
        latestVersion: "2.4.0",
      },
    });

    await handler(req, res);

    expect(res._getStatusCode()).toBe(401);
    expect(mockedSaveAndroidAppVersionConfig).not.toHaveBeenCalled();
  });

  test("updates config through admin endpoint", async () => {
    mockedSaveAndroidAppVersionConfig.mockResolvedValue({
      ...sampleConfig,
      latestVersion: "2.4.0",
    });

    const { req, res } = createMocks({
      method: "POST",
      headers: {
        "x-app-version-admin-key": "version-secret",
      },
      query: {
        currentVersion: "2.3.0",
      },
      body: {
        latestVersion: "2.4.0",
        title: "Update required",
      },
    });

    await handler(req, res);

    expect(mockedSaveAndroidAppVersionConfig).toHaveBeenCalledWith({
      latestVersion: "2.4.0",
      title: "Update required",
    });
    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData()).toMatchObject({
      latestVersion: "2.4.0",
      currentVersion: "2.3.0",
      updateAvailability: "optional",
    });
  });
});
