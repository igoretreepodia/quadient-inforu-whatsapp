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

async function getInforuConfig() {
  const username = await getCachedEnv('INFORU_USERNAME');
  const token = await getCachedEnv('INFORU_TOKEN');
  const segmentsStr = await getCachedEnv('INFORU_SEGMENTS_PER_SECOND', true);
  const segmentsPerSecond = segmentsStr ? parseInt(segmentsStr, 10) : 0;

  if (!username || !token) {
    return null;
  }
  return { username, token, segmentsPerSecond };
}

module.exports = { getAuthCredentials, getInforuConfig };
