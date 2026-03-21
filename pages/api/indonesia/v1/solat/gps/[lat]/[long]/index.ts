import { NextApiRequest, NextApiResponse } from "next";
import { getIndonesiaPrayerMonthFromSupabase, getIndonesiaRegionsFromSupabase, isSupabaseConfigured } from "../../../../../../../../lib/supabase-admin";
import { getMalaysiaCurrentDate } from "../../../../../../../../lib/waktu-solat";
import { findBestIndonesiaRegionMatch, monthNameFromNumber, resolveIndonesiaTimezone } from "../../../../../../../../lib/indonesia-prayer";
import { loadIndonesiaGeoJson, lookupIndonesiaZone } from "../../../../../../../../lib/indonesia-zone-lookup";
import { reverseGeocodeIndonesia } from "../../../../../../../../lib/indonesia-reverse-geocode";

// Indonesia does not observe DST — static UTC offsets in seconds.
const INDONESIA_TZ_OFFSET_SECONDS: Record<string, number> = {
  "Asia/Jakarta": 7 * 3600,
  "Asia/Pontianak": 7 * 3600,
  "Asia/Makassar": 8 * 3600,
  "Asia/Jayapura": 9 * 3600,
};

/**
 * Converts an "HH:MM" prayer time string on a specific date to a Unix timestamp.
 * Uses static UTC offsets since Indonesia has no DST.
 */
function hhmmToUnix(dateStr: string, time: string, timezone: string): number {
  const offsetSeconds = INDONESIA_TZ_OFFSET_SECONDS[timezone] ?? 7 * 3600;
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const utcMidnightSeconds = Math.floor(Date.UTC(year, month - 1, day) / 1000);
  const localSeconds = hour * 3600 + minute * 60;
  return utcMidnightSeconds + localSeconds - offsetSeconds;
}

function parseCoordinate(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  if (!isSupabaseConfigured()) {
    return res.status(500).json({ error: "Supabase environment variables are not configured" });
  }

  const latitude = parseCoordinate(req.query.lat);
  const longitude = parseCoordinate(req.query.long);

  if (latitude === null || longitude === null) {
    return res.status(400).json({ error: "Please specify valid 'lat' and 'long' path parameters" });
  }

  const now = getMalaysiaCurrentDate();
  const queryYear = req.query.year
    ? Number.parseInt(req.query.year.toString(), 10)
    : now.getFullYear();
  if (Number.isNaN(queryYear)) {
    return res.status(400).json({ error: `Invalid year: ${req.query.year}` });
  }

  const monthNumber = req.query.month
    ? Number.parseInt(req.query.month.toString(), 10)
    : now.getMonth() + 1;
  if (Number.isNaN(monthNumber) || monthNumber < 1 || monthNumber > 12) {
    return res.status(400).json({ error: `Invalid month: ${req.query.month}` });
  }

  const monthName = monthNameFromNumber(monthNumber);

  try {
    // ── Step 1: Resolve GPS coordinates to a region_id ────────────────────────
    let regionId: string | null = null;
    let location: string | null = null;
    let province: string | null = null;
    let timezone: string | null = null;

    // Primary: polygon lookup
    try {
      const geoJson = await loadIndonesiaGeoJson();
      const match = lookupIndonesiaZone(geoJson, latitude, longitude);
      if (match) {
        regionId = match.region_id;
        location = match.location;
        province = match.province;
        timezone = resolveIndonesiaTimezone(match.province);
      }
    } catch {
      // GeoJSON not yet built; fall through to Nominatim
    }

    // Fallback: Nominatim + fuzzy matching
    if (!regionId) {
      const geocode = await reverseGeocodeIndonesia(latitude, longitude);
      if (!geocode.country || geocode.country.toLowerCase() !== "indonesia") {
        return res.status(404).json({
          error: "Supplied coordinates resolve outside Indonesia",
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

      if (!result.match) {
        return res.status(404).json({
          error: `Could not resolve coordinates to an Indonesia region. Try again with a more specific location.`,
          lat: latitude,
          long: longitude,
        });
      }

      regionId = result.match.region.id;
      location = result.match.region.location;
      province = result.match.region.province;
      timezone = result.match.region.timezone;
    }

    // ── Step 2: Fetch prayer month from Supabase ──────────────────────────────
    const record = await getIndonesiaPrayerMonthFromSupabase(regionId, queryYear, monthName);
    if (!record) {
      return res.status(404).json({
        error: `No data found for region ${regionId} (${location}) for ${monthName}/${queryYear}`,
      });
    }

    const resolvedTimezone = timezone ?? record.timezone;

    // ── Step 3: Convert HH:MM prayer times to Unix timestamps ─────────────────
    // This matches the GPSMonthResponse format expected by the iOS app.
    const prayers = record.prayers.map((day: any) => ({
      day: day.day,
      fajr: hhmmToUnix(day.date, day.fajr, resolvedTimezone),
      syuruk: hhmmToUnix(day.date, day.syuruk, resolvedTimezone),
      dhuhr: hhmmToUnix(day.date, day.dhuhr, resolvedTimezone),
      asr: hhmmToUnix(day.date, day.asr, resolvedTimezone),
      maghrib: hhmmToUnix(day.date, day.maghrib, resolvedTimezone),
      isha: hhmmToUnix(day.date, day.isha, resolvedTimezone),
    }));

    res.setHeader("Cache-Control", "public, s-maxage=43200");
    return res.status(200).json({
      // "zone" here is the Indonesia region_id — matches GPSMonthResponse.zone on iOS
      zone: regionId,
      location: location ?? record.location,
      province: province ?? record.province,
      timezone: resolvedTimezone,
      year: record.year,
      month: record.month,
      month_number: record.month_number,
      last_updated: record.last_updated,
      prayers,
    });
  } catch (error) {
    return res.status(500).json({ error: `${error}` });
  }
}
