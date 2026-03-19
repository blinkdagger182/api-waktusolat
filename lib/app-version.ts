import { getAndroidAppVersionConfigFromSupabase, upsertAndroidAppVersionConfigInSupabase } from "./supabase-admin";

export type UpdateAvailability = "none" | "optional" | "required";

export type AppVersionConfig = {
  platform: "android";
  latestVersion: string;
  minimumSupportedVersion: string;
  title: string;
  subtitle: string;
  message: string;
  dismissible: boolean;
  ctaLabel: string;
  playStoreUrl: string;
  releaseNotes: string[];
  publishedAt: string | null;
  effectiveFrom: string | null;
  supportUrl: string | null;
  show: boolean;
  updatedAt: string;
};

export type AppVersionResponse = {
  platform: "android";
  currentVersion: string | null;
  latestVersion: string;
  minimumSupportedVersion: string;
  updateAvailability: UpdateAvailability;
  shouldUpdate: boolean;
  shouldDisplay: boolean;
  forceUpdate: boolean;
  dismissible: boolean;
  title: string;
  subtitle: string;
  message: string;
  ctaLabel: string;
  playStoreUrl: string;
  releaseNotes: string[];
  publishedAt: string | null;
  effectiveFrom: string | null;
  supportUrl: string | null;
  updatedAt: string;
};

export const defaultAndroidAppVersionConfig: AppVersionConfig = {
  platform: "android",
  latestVersion: "1.0.0",
  minimumSupportedVersion: "1.0.0",
  title: "Update available",
  subtitle: "A newer Android version is ready.",
  message: "Update the app to get the latest fixes and improvements.",
  dismissible: true,
  ctaLabel: "Update on Play Store",
  playStoreUrl: "https://play.google.com/store",
  releaseNotes: [],
  publishedAt: null,
  effectiveFrom: null,
  supportUrl: null,
  show: false,
  updatedAt: new Date(0).toISOString(),
};

export async function loadAndroidAppVersionConfig(): Promise<AppVersionConfig> {
  const row = await getAndroidAppVersionConfigFromSupabase();
  return row ? normalizeAppVersionConfig(row) : defaultAndroidAppVersionConfig;
}

export async function saveAndroidAppVersionConfig(
  input: Partial<AppVersionConfig>
): Promise<AppVersionConfig> {
  const current = await loadAndroidAppVersionConfig();
  const next = normalizeAppVersionConfig({
    ...current,
    ...input,
    platform: "android",
    updatedAt: new Date().toISOString(),
  });

  await upsertAndroidAppVersionConfigInSupabase(next);
  return next;
}

export function buildAndroidAppVersionResponse(
  config: AppVersionConfig,
  currentVersion?: string | null
): AppVersionResponse {
  const normalizedCurrentVersion = normalizeVersionString(currentVersion);
  const updateAvailability = getUpdateAvailability(config, normalizedCurrentVersion);
  const forceUpdate = updateAvailability === "required";
  const shouldDisplay = config.show && updateAvailability !== "none";

  return {
    platform: "android",
    currentVersion: normalizedCurrentVersion,
    latestVersion: config.latestVersion,
    minimumSupportedVersion: config.minimumSupportedVersion,
    updateAvailability,
    shouldUpdate: updateAvailability !== "none",
    shouldDisplay,
    forceUpdate,
    dismissible: forceUpdate ? false : config.dismissible,
    title: config.title,
    subtitle: config.subtitle,
    message: config.message,
    ctaLabel: config.ctaLabel,
    playStoreUrl: config.playStoreUrl,
    releaseNotes: config.releaseNotes,
    publishedAt: config.publishedAt,
    effectiveFrom: config.effectiveFrom,
    supportUrl: config.supportUrl,
    updatedAt: config.updatedAt,
  };
}

export function getUpdateAvailability(
  config: Pick<AppVersionConfig, "latestVersion" | "minimumSupportedVersion">,
  currentVersion?: string | null
): UpdateAvailability {
  const normalizedCurrentVersion = normalizeVersionString(currentVersion);

  if (!normalizedCurrentVersion) {
    return "none";
  }

  if (compareVersions(normalizedCurrentVersion, config.minimumSupportedVersion) < 0) {
    return "required";
  }

  if (compareVersions(normalizedCurrentVersion, config.latestVersion) < 0) {
    return "optional";
  }

  return "none";
}

export function compareVersions(left: string, right: string) {
  const leftSegments = toComparableSegments(left);
  const rightSegments = toComparableSegments(right);
  const length = Math.max(leftSegments.length, rightSegments.length);

  for (let index = 0; index < length; index += 1) {
    const leftSegment = leftSegments[index] ?? 0;
    const rightSegment = rightSegments[index] ?? 0;

    if (leftSegment > rightSegment) {
      return 1;
    }

    if (leftSegment < rightSegment) {
      return -1;
    }
  }

  return 0;
}

export function normalizeVersionString(version?: string | null) {
  if (typeof version !== "string") {
    return null;
  }

  const trimmed = version.trim();
  return trimmed ? trimmed : null;
}

function normalizeAppVersionConfig(input: Partial<AppVersionConfig>): AppVersionConfig {
  return {
    platform: "android",
    latestVersion: normalizeRequiredString(input.latestVersion, defaultAndroidAppVersionConfig.latestVersion),
    minimumSupportedVersion: normalizeRequiredString(
      input.minimumSupportedVersion,
      defaultAndroidAppVersionConfig.minimumSupportedVersion
    ),
    title: normalizeRequiredString(input.title, defaultAndroidAppVersionConfig.title),
    subtitle: normalizeRequiredString(input.subtitle, defaultAndroidAppVersionConfig.subtitle),
    message: normalizeRequiredString(input.message, defaultAndroidAppVersionConfig.message),
    dismissible: typeof input.dismissible === "boolean" ? input.dismissible : defaultAndroidAppVersionConfig.dismissible,
    ctaLabel: normalizeRequiredString(input.ctaLabel, defaultAndroidAppVersionConfig.ctaLabel),
    playStoreUrl: normalizeRequiredString(input.playStoreUrl, defaultAndroidAppVersionConfig.playStoreUrl),
    releaseNotes: Array.isArray(input.releaseNotes)
      ? input.releaseNotes.filter((note): note is string => typeof note === "string" && note.trim().length > 0)
      : defaultAndroidAppVersionConfig.releaseNotes,
    publishedAt: normalizeOptionalString(input.publishedAt),
    effectiveFrom: normalizeOptionalString(input.effectiveFrom),
    supportUrl: normalizeOptionalString(input.supportUrl),
    show: typeof input.show === "boolean" ? input.show : defaultAndroidAppVersionConfig.show,
    updatedAt: normalizeRequiredString(input.updatedAt, new Date().toISOString()),
  };
}

function normalizeRequiredString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toComparableSegments(version: string) {
  return version
    .split(".")
    .map((segment) => {
      const match = segment.match(/\d+/);
      return match ? Number(match[0]) : 0;
    });
}
