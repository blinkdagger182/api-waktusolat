import crypto from 'crypto';
import http2 from 'http2';

function getPrivateKey(): string {
  const raw = (process.env.APPLE_APNS_PRIVATE_KEY || '').trim();
  // Key may be stored as a single line with spaces instead of newlines
  const body = raw
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .trim()
    .replace(/\s+/g, '');
  const wrapped = body.match(/.{1,64}/g)?.join('\n') ?? body;
  return `-----BEGIN PRIVATE KEY-----\n${wrapped}\n-----END PRIVATE KEY-----`;
}

let cachedToken: { value: string; exp: number } | null = null;

function generateJWT(): string {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp > now + 300) {
    return cachedToken.value;
  }

  const header = Buffer.from(
    JSON.stringify({ alg: 'ES256', kid: process.env.APPLE_KEY_ID })
  ).toString('base64url');

  const payload = Buffer.from(
    JSON.stringify({ iss: process.env.APPLE_TEAM_ID, iat: now })
  ).toString('base64url');

  const signingInput = `${header}.${payload}`;

  const sign = crypto.createSign('SHA256');
  sign.update(signingInput);
  const signature = sign
    .sign({ key: getPrivateKey(), format: 'pem', dsaEncoding: 'ieee-p1363' })
    .toString('base64url');

  const token = `${signingInput}.${signature}`;
  cachedToken = { value: token, exp: now + 3300 }; // cache for 55 min
  return token;
}

export interface APNsPayload {
  deviceToken: string;
  payload: object;
  pushType: 'alert' | 'background' | 'liveactivity';
  topic: string;
  sandbox?: boolean;
}

export function sendAPNs({
  deviceToken,
  payload,
  pushType,
  topic,
  sandbox = true,
}: APNsPayload): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const jwt = generateJWT();
    const bodyStr = JSON.stringify(payload);
    const host = sandbox
      ? 'api.sandbox.push.apple.com'
      : 'api.push.apple.com';

    const client = http2.connect(`https://${host}`);
    client.on('error', (err) => {
      client.destroy();
      reject(err);
    });

    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${deviceToken}`,
      ':scheme': 'https',
      ':authority': host,
      'authorization': `bearer ${jwt}`,
      'apns-push-type': pushType,
      'apns-topic': topic,
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(bodyStr)),
    });

    req.write(bodyStr);
    req.end();

    let statusCode = 0;
    let responseData = '';

    req.on('response', (headers) => {
      statusCode = headers[':status'] as number;
    });
    req.on('data', (chunk) => {
      responseData += chunk;
    });
    req.on('end', () => {
      client.close();
      resolve({ statusCode, body: responseData });
    });
    req.on('error', (err) => {
      client.destroy();
      reject(err);
    });
  });
}
