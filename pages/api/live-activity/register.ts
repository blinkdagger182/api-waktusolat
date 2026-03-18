import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { pushToken, activityId, deviceToken, prayerName, prayerTime, city } = req.body;

  if (!pushToken || !activityId) {
    return res.status(400).json({ success: false, message: 'Missing pushToken or activityId' });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && supabaseKey) {
    const response = await fetch(`${supabaseUrl}/rest/v1/live_activity_tokens`, {
      method: 'POST',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        push_token: pushToken,
        activity_id: activityId,
        device_token: deviceToken ?? null,
        prayer_name: prayerName ?? null,
        prayer_time: prayerTime ?? null,
        city: city ?? null,
        updated_at: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      console.error('Supabase error:', await response.text());
      return res.status(500).json({ success: false, message: 'Database error' });
    }
  }

  return res.status(200).json({ success: true, message: 'Live activity token registered' });
}
