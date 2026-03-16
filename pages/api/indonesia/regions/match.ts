import { NextApiRequest, NextApiResponse } from "next";
import { findBestIndonesiaRegionMatch } from "../../../../lib/indonesia-prayer";
import { getIndonesiaRegionsFromSupabase, isSupabaseConfigured } from "../../../../lib/supabase-admin";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({
      error: `Method ${req.method} not allowed`,
    });
  }

  if (!isSupabaseConfigured()) {
    return res.status(500).json({
      error: "Supabase environment variables are not configured",
    });
  }

  const { city, locality, regency, subAdministrativeArea, province } = req.query;

  try {
    const regions = await getIndonesiaRegionsFromSupabase();
    const result = findBestIndonesiaRegionMatch(regions, {
      city: typeof city === "string" ? city : null,
      locality: typeof locality === "string" ? locality : null,
      regency: typeof regency === "string" ? regency : null,
      subAdministrativeArea: typeof subAdministrativeArea === "string" ? subAdministrativeArea : null,
      province: typeof province === "string" ? province : null,
    });

    if (!result.match) {
      return res.status(404).json({
        error: "No confident Indonesia region match found",
        candidates: result.candidates,
      });
    }

    res.setHeader("Cache-Control", "public, s-maxage=43200");
    return res.status(200).json({
      region_id: result.match.region.id,
      location: result.match.region.location,
      province: result.match.region.province,
      timezone: result.match.region.timezone,
      score: result.match.score,
      matched_on: result.match.matched_on,
      candidates: result.candidates,
    });
  } catch (error) {
    return res.status(500).json({
      error: `${error}`,
    });
  }
}
