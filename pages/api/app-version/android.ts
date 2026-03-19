import type { NextApiRequest, NextApiResponse } from "next";
import {
  buildAndroidAppVersionResponse,
  loadAndroidAppVersionConfig,
  saveAndroidAppVersionConfig,
} from "../../../lib/app-version";

type ErrorResponse = {
  error: string;
};

function readAdminKey(req: NextApiRequest) {
  const headerValue = req.headers["x-app-version-admin-key"];
  return Array.isArray(headerValue) ? headerValue[0] : headerValue;
}

function isAuthorized(req: NextApiRequest) {
  const expectedKey = process.env.APP_VERSION_API_KEY;
  return Boolean(expectedKey) && readAdminKey(req) === expectedKey;
}

function readCurrentVersion(req: NextApiRequest) {
  const queryValue = req.query.currentVersion ?? req.query.current_version;
  if (Array.isArray(queryValue)) {
    return queryValue[0] ?? null;
  }

  return typeof queryValue === "string" ? queryValue : null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ReturnType<typeof buildAndroidAppVersionResponse> | ErrorResponse>
) {
  if (req.method === "GET") {
    const config = await loadAndroidAppVersionConfig();
    return res.status(200).json(buildAndroidAppVersionResponse(config, readCurrentVersion(req)));
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

  try {
    const config = await saveAndroidAppVersionConfig(req.body ?? {});
    return res.status(200).json(buildAndroidAppVersionResponse(config, readCurrentVersion(req)));
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unexpected app version error",
    });
  }
}
