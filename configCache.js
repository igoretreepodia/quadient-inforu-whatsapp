const NodeCache = require('node-cache');
const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 }); // 5m TTL

async function getCachedEnv(varName, allowNull = false) {
  const key = varName;
  let val = cache.get(key);
  if (val === undefined) {
    val = process.env[varName];
    if (val === undefined && !allowNull) {
      return null;
    }
    cache.set(key, val);
  }
  return val;
}

async function getAuthCredentials() {
  return getCachedEnv('CREDENTIALS');
}

async function getTwilioConfig() {
  const baseUrl = await getCachedEnv('TWILIO_BASE_URL');
  const accountSid = await getCachedEnv('TWILIO_ACCOUNT_SID');
  const apiSid = await getCachedEnv('TWILIO_API_SID');
  const apiSecret = await getCachedEnv('TWILIO_API_SECRET');
  const segmentsStr = await getCachedEnv('TWILIO_SEGMENTS_PER_SECOND', true);
  const segmentsPerSecond = segmentsStr ? parseInt(segmentsStr, 10) : 0;

  if (!baseUrl || !accountSid || !apiSid || !apiSecret) {
    return null;
  }
  return { baseUrl, accountSid, apiSid, apiSecret, segmentsPerSecond };
}

module.exports = { getAuthCredentials, getTwilioConfig };