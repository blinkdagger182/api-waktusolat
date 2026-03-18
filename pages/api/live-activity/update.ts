import type { NextApiRequest, NextApiResponse } from 'next';
import { sendAPNs } from '../../../lib/apns';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const {
    pushToken,       // Live Activity push token (for update/end) OR device token (for start)
    prayerName,
    city,
    prayerTime,      // ISO string or unix seconds
    startedAt,       // ISO string or unix seconds
    event = 'update', // 'start' | 'update' | 'end'
  } = req.body;

  if (!pushToken) {
    return res.status(400).json({ success: false, message: 'Missing pushToken' });
  }

  const toUnix = (val: string | number): number =>
    typeof val === 'number' ? val : Math.floor(new Date(val).getTime() / 1000);

  const now = Math.floor(Date.now() / 1000);
  const bundleId = process.env.APPLE_BUNDLE_ID!;

  const contentState = {
    prayerName,
    city,
    prayerTime: prayerTime != null ? toUnix(prayerTime) : now,
    startedAt: startedAt != null ? toUnix(startedAt) : now,
  };

  // 'start' uses the regular APNs device token and requires attributes-type + attributes
  const apsPayload = event === 'start'
    ? {
        timestamp: now,
        event: 'start',
        'content-state': contentState,
        'attributes-type': 'PrayerLiveActivityAttributes',
        attributes: { activityID: 'next-prayer' },
        alert: { title: 'Waktu Solat', body: `${prayerName} is coming up` },
      }
    : {
        timestamp: now,
        event,
        'content-state': contentState,
      };

  try {
    const result = await sendAPNs({
      deviceToken: pushToken,
      pushType: 'liveactivity',
      topic: `${bundleId}.push-type.liveactivity`,
      sandbox: process.env.APNS_SANDBOX === 'true',
      payload: { aps: apsPayload },
    });

    if (result.statusCode === 200) {
      return res.status(200).json({ success: true });
    }
    return res.status(502).json({
      success: false,
      apnsStatus: result.statusCode,
      apnsBody: result.body,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({ success: false, message });
  }
}
