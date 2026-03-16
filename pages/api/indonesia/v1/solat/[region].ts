import { NextApiRequest, NextApiResponse } from "next";
import { getIndonesiaPrayerMonthFromSupabase, isSupabaseConfigured } from "../../../../../lib/supabase-admin";
import { getMalaysiaCurrentDate } from "../../../../../lib/waktu-solat";
import { monthNameFromNumber } from "../../../../../lib/indonesia-prayer";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { region, year, month } = req.query;

  if (!isSupabaseConfigured()) {
    return res.status(500).json({
      error: "Supabase environment variables are not configured",
    });
  }

  const now = getMalaysiaCurrentDate();
  const queryYear = year ? Number.parseInt(year.toString(), 10) : now.getFullYear();
  if (Number.isNaN(queryYear)) {
    return res.status(500).json({ error: `Invalid year: ${year?.toString()}` });
  }

  const monthNumber = month ? Number.parseInt(month.toString(), 10) : now.getMonth() + 1;
  if (Number.isNaN(monthNumber) || monthNumber < 1 || monthNumber > 12) {
    return res.status(500).json({ error: `Invalid month: ${month?.toString()}` });
  }

  const monthName = monthNameFromNumber(monthNumber);

  try {
    const record = await getIndonesiaPrayerMonthFromSupabase(region.toString(), queryYear, monthName);
    if (!record) {
      return res.status(404).json({
        error: `No data found for region: ${region.toString()} for ${monthName}/${queryYear}`,
      });
    }

    res.setHeader("Cache-Control", "public, s-maxage=43200");
    res.status(200).json({
      region_id: record.region_id,
      location: record.location,
      province: record.province,
      timezone: record.timezone,
      year: record.year,
      month: record.month,
      month_number: record.month_number,
      last_updated: record.last_updated,
      prayers: record.prayers,
    });
  } catch (error) {
    res.status(500).json({
      error: `${error}`,
    });
  }
}
