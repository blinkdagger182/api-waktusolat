import { NextApiRequest, NextApiResponse } from "next";
import { findBestIndonesiaRegionMatch } from "../../../../lib/indonesia-prayer";
import { reverseGeocodeIndonesia } from "../../../../lib/indonesia-reverse-geocode";
import { getIndonesiaRegionsFromSupabase, isSupabaseConfigured } from "../../../../lib/supabase-admin";

function parseCoordinate(value: string | string[] | undefined, fallback?: string | string[]) {
  const candidate = Array.isArray(value) ? value[0] : value ?? (Array.isArray(fallback) ? fallback[0] : fallback);
  if (!candidate) {
    return null;
  }

  const parsed = Number.parseFloat(candidate);
  return Number.isFinite(parsed) ? parsed : null;
}

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

  const latitude = parseCoordinate(req.query.lat, req.query.latitude);
  const longitude = parseCoordinate(req.query.long, req.query.lng ?? req.query.lon ?? req.query.longitude);

  if (latitude === null || longitude === null) {
    return res.status(400).json({
      error: "Please specify valid 'lat' and 'long' query parameters",
    });
  }

  try {
    const geocode = await reverseGeocodeIndonesia(latitude, longitude);
    if (geocode.country && geocode.country.toLowerCase() !== "indonesia") {
      return res.status(404).json({
        error: "Supplied coordinates resolve outside Indonesia",
        geocode,
      });
    }

    const regions = await getIndonesiaRegionsFromSupabase();
    const result = findBestIndonesiaRegionMatch(regions, {
      city: geocode.city,
      locality: geocode.locality,
      regency: geocode.regency,
      subAdministrativeArea: geocode.subAdministrativeArea,
      province: geocode.province,
    });

    res.setHeader("Cache-Control", "public, s-maxage=43200");

    if (!result.match) {
      return res.status(200).json({
        resolved: false,
        lat: latitude,
        long: longitude,
        geocode,
        candidates: result.candidates,
      });
    }

    return res.status(200).json({
      resolved: true,
      lat: latitude,
      long: longitude,
      geocode,
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
