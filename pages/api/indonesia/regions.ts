import { getIndonesiaRegionsFromSupabase, isSupabaseConfigured } from "../../../lib/supabase-admin";

export default async function handler(req, res) {
  if (!isSupabaseConfigured()) {
    return res.status(500).json({
      error: "Supabase environment variables are not configured",
    });
  }

  try {
    const regions = await getIndonesiaRegionsFromSupabase();
    res.setHeader("Cache-Control", "max-age=0, s-maxage=2592000");
    res.status(200).json(regions);
  } catch (error) {
    res.status(500).json({
      error: `Error loading Indonesia regions data: ${error}`,
    });
  }
}
