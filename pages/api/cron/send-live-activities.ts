import type { NextApiRequest, NextApiResponse } from 'next';
import { sendAPNs } from '../../../lib/apns';
import { getMalaysiaCurrentDate } from '../../../lib/waktu-solat';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BUNDLE_ID = process.env.APPLE_BUNDLE_ID!;
const LEAD_MINUTES = 30; // start Live Activity this many minutes before prayer
const WINDOW_MINUTES = 5; // cron interval — only fire within this window

const PRAYER_NAMES: Record<string, string> = {
  fajr: 'Fajr',
  syuruk: 'Syuruk',
  dhuhr: 'Dhuhr',
  asr: 'Asr',
  maghrib: 'Maghrib',
  isha: 'Isyak',
};

async function supabase(path: string, init: RequestInit = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 204) return null;
  return res.json();
}

async function deleteStaleToken(pushToken: string) {
  await supabase(
    `live_activity_tokens?push_token=eq.${encodeURIComponent(pushToken)}`,
    { method: 'DELETE' }
  );
  console.log(`🗑 Deleted stale token: ${pushToken.slice(0, 16)}...`);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Vercel cron sends GET; protect against external calls
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).end();
  }
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const now = Date.now() / 1000; // unix seconds
  const malaysiaDate = getMalaysiaCurrentDate();
  const month = malaysiaDate.toLocaleString('en-US', { month: 'short' }).toUpperCase();
  const year = malaysiaDate.getFullYear();
  const day = malaysiaDate.getDate();

  // Get all unique zones with push-to-start tokens
  const tokenRows: { push_token: string; zone: string; city: string | null }[] =
    await supabase(
      `live_activity_tokens?select=push_token,zone,city&activity_id=eq.push-to-start&zone=not.is.null`
    ) ?? [];

  if (tokenRows.length === 0) {
    return res.status(200).json({ sent: 0, message: 'No tokens' });
  }

  // Group tokens by zone
  const byZone = new Map<string, typeof tokenRows>();
  for (const row of tokenRows) {
    const z = row.zone.toUpperCase();
    if (!byZone.has(z)) byZone.set(z, []);
    byZone.get(z)!.push(row);
  }

  let totalSent = 0;
  let totalDeleted = 0;

  for (const [zone, tokens] of Array.from(byZone)) {
    // Fetch today's prayer data for this zone
    const prayerRows: { prayers: any[] }[] =
      await supabase(
        `prayer_months?select=prayers&zone=eq.${zone}&year=eq.${year}&month=eq.${month}&limit=1`
      ) ?? [];

    if (!prayerRows?.length) continue;

    const todayPrayers = prayerRows[0].prayers.find((p: any) => p.day === day);
    if (!todayPrayers) continue;

    // Find any prayer that's within the lead window right now
    let targetPrayer: { name: string; time: number } | null = null;
    for (const [key, label] of Object.entries(PRAYER_NAMES)) {
      const prayerUnix: number = todayPrayers[key];
      if (!prayerUnix) continue;
      const minutesUntil = (prayerUnix - now) / 60;
      if (minutesUntil >= LEAD_MINUTES - WINDOW_MINUTES / 2 &&
          minutesUntil <= LEAD_MINUTES + WINDOW_MINUTES / 2) {
        targetPrayer = { name: label, time: prayerUnix };
        break;
      }
    }

    if (!targetPrayer) continue;

    console.log(`🕌 Zone ${zone}: sending "${targetPrayer.name}" Live Activity to ${tokens.length} device(s)`);

    // Get the zone's city name from zones table
    const zoneRows: { daerah: string }[] =
      await supabase(`zones?select=daerah&code=eq.${zone}&limit=1`) ?? [];
    const city = zoneRows?.[0]?.daerah ?? zone;

    // Send to each token in parallel
    await Promise.all(
      tokens.map(async (row: { push_token: string; zone: string; city: string | null }) => {
        const result = await sendAPNs({
          deviceToken: row.push_token,
          pushType: 'liveactivity',
          topic: `${BUNDLE_ID}.push-type.liveactivity`,
          sandbox: process.env.APNS_SANDBOX === 'true',
          payload: {
            aps: {
              timestamp: Math.floor(now),
              event: 'start',
              'content-state': {
                prayerName: targetPrayer!.name,
                city,
                prayerTime: targetPrayer!.time,
                startedAt: Math.floor(now),
              },
              'attributes-type': 'PrayerLiveActivityAttributes',
              attributes: { activityID: 'next-prayer' },
              alert: { title: 'Waktu Solat', body: `${targetPrayer!.name} in ${LEAD_MINUTES} minutes` },
            },
          },
        });

        if (result.statusCode === 200) {
          totalSent++;
        } else {
          const reason = (() => {
            try { return JSON.parse(result.body)?.reason ?? result.body; }
            catch { return result.body; }
          })();
          // Remove stale tokens immediately
          if (['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic'].includes(reason)) {
            await deleteStaleToken(row.push_token);
            totalDeleted++;
          } else {
            console.error(`APNs error for ${row.push_token.slice(0, 16)}: ${reason}`);
          }
        }
      })
    );
  }

  return res.status(200).json({ sent: totalSent, deleted: totalDeleted, zones: byZone.size });
}
