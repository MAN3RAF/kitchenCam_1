// Research-only signing implementation; not a production transport or SDK replacement.
const { createHash, createHmac } = require('node:crypto');

const hash = (value) => createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value).digest();
const encode = (value) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (letter) => `%${letter.charCodeAt(0).toString(16).toUpperCase()}`,
  );

function presign(
  config,
  objectPath,
  { seconds = 600, method = 'PUT', headers = {}, at = new Date(), session } = {},
) {
  const url = new URL(
    `${config.STORAGE_S3_URL}/scan-raw-private/${objectPath.split('/').map(encode).join('/')}`,
  );
  const timestamp = at.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = timestamp.slice(0, 8);
  const region = config.S3_PROTOCOL_REGION;
  const scope = `${date}/${region}/s3/aws4_request`;
  // Supabase's session-token protocol uses the project ref as access ID and anon key as secret.
  const accessId = session ? 'kitchencam' : config.S3_PROTOCOL_ACCESS_KEY_ID;
  const secret = session ? config.ANON_KEY : config.S3_PROTOCOL_ACCESS_KEY_SECRET;
  const signed = { host: url.host, ...headers };
  const keys = Object.keys(signed).sort();
  const parameters = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessId}/${scope}`,
    'X-Amz-Date': timestamp,
    'X-Amz-Expires': String(seconds),
    'X-Amz-SignedHeaders': keys.join(';'),
    ...(session ? { 'X-Amz-Security-Token': session } : {}),
  };
  const query = Object.entries(parameters)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encode(key)}=${encode(value)}`)
    .join('&');
  const canonical = [
    method,
    url.pathname,
    query,
    keys.map((key) => `${key}:${signed[key].trim()}\n`).join(''),
    keys.join(';'),
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', key)
    .update(`AWS4-HMAC-SHA256\n${timestamp}\n${scope}\n${hash(canonical)}`)
    .digest('hex');
  url.search = `${query}&X-Amz-Signature=${signature}`;
  return url.toString();
}

module.exports = { presign };
