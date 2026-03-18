import type { NextApiRequest, NextApiResponse } from 'next';
import { sendAPNs } from '../../../lib/apns';
import { getMalaysiaCurrentDate } from '../../../lib/waktu-solat';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BUNDLE_ID = process.env.APPLE_BUNDLE_ID!;
const LEAD_MINUTES = 5;  // start Live Activity this many minutes before prayer
const APPLE_EPOCH_OFFSET = 978307200; // Unix → Apple reference date (Jan 1, 2001)
const WINDOW_MINUTES = 5; // cron interval — only fire within this window

// Syuruk excluded — not a prayer notification
const PRAYER_NAMES: Record<string, string> = {
  fajr: 'Fajr',
  dhuhr: 'Dhuhr',
  asr: 'Asr',
  maghrib: 'Maghrib',
  isha: 'Isyak',
};

// Active hours in Malaysia time (MYT = UTC+8)
// Enable: 05:00–08:00 (Fajr window) and 12:00–21:00 (Dhuhr → Isyak window)
// Disable: 21:00–05:00 (overnight) and 08:00–12:00 (post-Syuruk gap)
function isWithinActiveHours(malaysiaDate: Date): boolean {
  const hour = malaysiaDate.getHours();
  return (hour >= 5 && hour < 8) || (hour >= 12 && hour < 21);
}

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

/** Fetches all rows from a Supabase table, paginating past the 1,000-row default limit. */
async function supabaseAll<T>(path: string): Promise<T[]> {
  const PAGE_SIZE = 1000;
  const results: T[] = [];
  let offset = 0;
  const sep = path.includes('?') ? '&' : '?';
  while (true) {
    const page: T[] = await supabase(`${path}${sep}limit=${PAGE_SIZE}&offset=${offset}`) ?? [];
    results.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return results;
}

const BATCH_SIZE = 100; // max concurrent APNs connections per batch

async function runInBatches<T>(items: T[], fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    await Promise.all(items.slice(i, i + BATCH_SIZE).map(fn));
  }
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

  if (!isWithinActiveHours(malaysiaDate)) {
    return res.status(200).json({ skipped: true, reason: 'outside active hours' });
  }
  const month = malaysiaDate.toLocaleString('en-US', { month: 'short' }).toUpperCase();
  const year = malaysiaDate.getFullYear();
  const day = malaysiaDate.getDate();

  // Fetch push-to-start tokens (for starting activities)
  const startTokenRows: { push_token: string; zone: string; city: string | null; lead_minutes: number }[] =
    await supabaseAll(
      `live_activity_tokens?select=push_token,zone,city,lead_minutes&activity_id=eq.push-to-start&zone=not.is.null`
    );

  // Fetch active activity tokens (for ending activities)
  const endTokenRows: { push_token: string; zone: string }[] =
    await supabaseAll(
      `live_activity_tokens?select=push_token,zone&activity_id=eq.next-prayer&zone=not.is.null`
    );

  if (startTokenRows.length === 0 && endTokenRows.length === 0) {
    return res.status(200).json({ sent: 0, message: 'No tokens' });
  }

  // Group tokens by zone
  const byZone = new Map<string, typeof startTokenRows>();
  for (const row of startTokenRows) {
    const z = row.zone.toUpperCase();
    if (!byZone.has(z)) byZone.set(z, []);
    byZone.get(z)!.push(row);
  }

  const endByZone = new Map<string, typeof endTokenRows>();
  for (const row of endTokenRows) {
    const z = row.zone.toUpperCase();
    if (!endByZone.has(z)) endByZone.set(z, []);
    endByZone.get(z)!.push(row);
  }

  // All zones that need processing
  const allZones = new Set([...Array.from(byZone.keys()), ...Array.from(endByZone.keys())]);

  let totalSent = 0;
  let totalEnded = 0;
  let totalDeleted = 0;

  for (const zone of Array.from(allZones)) {
    // Fetch today's prayer data for this zone
    const prayerRows: { prayers: any[] }[] =
      await supabase(
        `prayer_months?select=prayers&zone=eq.${zone}&year=eq.${year}&month=eq.${month}&limit=1`
      ) ?? [];

    if (!prayerRows?.length) continue;

    const todayPrayers = prayerRows[0].prayers.find((p: any) => p.day === day);
    if (!todayPrayers) continue;

    // === START: fire for each token based on its own lead_minutes ===
    const startTokens = byZone.get(zone) ?? [];
    if (startTokens.length > 0) {
      // Fetch city name once per zone
      const zoneRows: { daerah: string }[] =
        await supabase(`zones?select=daerah&code=eq.${zone}&limit=1`) ?? [];
      const city = zoneRows?.[0]?.daerah ?? zone;

      await runInBatches(
        startTokens,
        async (row: { push_token: string; zone: string; city: string | null; lead_minutes: number }) => {
          const tokenLead = row.lead_minutes ?? LEAD_MINUTES;

          // Find the prayer within this token's personal window
          let targetPrayer: { name: string; time: number } | null = null;
          for (const [key, label] of Object.entries(PRAYER_NAMES)) {
            const prayerUnix: number = todayPrayers[key];
            if (!prayerUnix) continue;
            const minutesUntil = (prayerUnix - now) / 60;
            if (minutesUntil >= tokenLead - WINDOW_MINUTES / 2 &&
                minutesUntil <= tokenLead + WINDOW_MINUTES / 2) {
              targetPrayer = { name: label, time: prayerUnix };
              break;
            }
          }

          if (!targetPrayer) return;

          console.log(`🕌 Zone ${zone}: starting "${targetPrayer.name}" (${tokenLead}min lead) for ${row.push_token.slice(0, 16)}...`);

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
                  prayerName: targetPrayer.name,
                  city,
                  prayerTime: targetPrayer.time - APPLE_EPOCH_OFFSET,
                  startedAt: Math.floor(now) - APPLE_EPOCH_OFFSET,
                },
                'attributes-type': 'PrayerLiveActivityAttributes',
                attributes: { activityID: 'next-prayer' },
                alert: { title: 'Waktu Solat', body: `${targetPrayer.name} in ${tokenLead} min` },
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
            if (['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic'].includes(reason)) {
              await deleteStaleToken(row.push_token);
              totalDeleted++;
            } else {
              console.error(`APNs start error for ${row.push_token.slice(0, 16)}: ${reason}`);
            }
          }
        }
      );
    }

    // === END: prayer time just passed (within window) ===
    const endTokens = endByZone.get(zone) ?? [];
    if (endTokens.length > 0) {
      let endedPrayer: { name: string; time: number } | null = null;
      for (const [key, label] of Object.entries(PRAYER_NAMES)) {
        const prayerUnix: number = todayPrayers[key];
        if (!prayerUnix) continue;
        const minutesPast = (now - prayerUnix) / 60;
        if (minutesPast >= 0 && minutesPast <= WINDOW_MINUTES) {
          endedPrayer = { name: label, time: prayerUnix };
          break;
        }
      }

      if (endedPrayer) {
        console.log(`⏱ Zone ${zone}: ending "${endedPrayer.name}" Live Activity for ${endTokens.length} device(s)`);

        await runInBatches(
          endTokens,
          async (row: { push_token: string; zone: string }) => {
            const result = await sendAPNs({
              deviceToken: row.push_token,
              pushType: 'liveactivity',
              topic: `${BUNDLE_ID}.push-type.liveactivity`,
              sandbox: process.env.APNS_SANDBOX === 'true',
              payload: {
                aps: {
                  timestamp: Math.floor(now),
                  event: 'end',
                  'content-state': {
                    prayerName: endedPrayer!.name,
                    city: zone,
                    prayerTime: endedPrayer!.time - APPLE_EPOCH_OFFSET,
                    startedAt: endedPrayer!.time - LEAD_MINUTES * 60 - APPLE_EPOCH_OFFSET,
                  },
                  'dismissal-date': endedPrayer!.time + 5 * 60, // dismiss 5 min after prayer
                },
              },
            });

            if (result.statusCode === 200) {
              totalEnded++;
            } else {
              const reason = (() => {
                try { return JSON.parse(result.body)?.reason ?? result.body; }
                catch { return result.body; }
              })();
              if (['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic'].includes(reason)) {
                await deleteStaleToken(row.push_token);
                totalDeleted++;
              } else {
                console.error(`APNs end error for ${row.push_token.slice(0, 16)}: ${reason}`);
              }
            }
          }
        );
      }
    }
  }

  return res.status(200).json({ sent: totalSent, ended: totalEnded, deleted: totalDeleted, zones: allZones.size });
}
