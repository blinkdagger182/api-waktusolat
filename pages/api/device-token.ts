import type { NextApiRequest, NextApiResponse } from 'next';

type RegisterDeviceTokenRequest = {
  deviceToken: string;
  platform: 'ios' | 'android';
  appVersion?: string;
  deviceModel?: string;
};

type RegisterDeviceTokenResponse = {
  success: boolean;
  message?: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<RegisterDeviceTokenResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const { deviceToken, platform, appVersion, deviceModel } = req.body as RegisterDeviceTokenRequest;

    if (!deviceToken || !platform) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (supabaseUrl && supabaseKey) {
      const response = await fetch(`${supabaseUrl}/rest/v1/device_tokens`, {
        method: 'POST',
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates',
        },
        body: JSON.stringify({
          device_token: deviceToken,
          platform,
          app_version: appVersion,
          device_model: deviceModel,
          updated_at: new Date().toISOString()
        })
      });

      if (!response.ok) {
        console.error('Supabase error:', await response.text());
        return res.status(500).json({ success: false, message: 'Database error' });
      }
    } else {
      console.log('Device token registered (no DB):', { deviceToken, platform, appVersion, deviceModel });
    }

    return res.status(200).json({ success: true, message: 'Device token registered successfully' });
  } catch (error) {
    console.error('Error registering device token:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}
