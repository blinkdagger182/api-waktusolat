import type { NextApiRequest, NextApiResponse } from 'next';
import { sendAPNs } from '../../../lib/apns';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { deviceToken, title = 'Waktu Solat', body = 'Test notification' } = req.body;

  if (!deviceToken) {
    return res.status(400).json({ success: false, message: 'Missing deviceToken' });
  }

  try {
    const result = await sendAPNs({
      deviceToken,
      pushType: 'alert',
      topic: process.env.APPLE_BUNDLE_ID!,
      sandbox: true,
      payload: {
        aps: {
          alert: { title, body },
          sound: 'default',
        },
      },
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
