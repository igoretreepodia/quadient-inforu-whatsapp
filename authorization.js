const { getAuthCredentials } = require('./configCache');
const BEARER = 'Bearer ';

/**
 * Checks Authorization header against cached credentials
 */
// function authorize(req) {
//   const auth = req.get('Authorization');
//   if (!auth || !auth.startsWith(BEARER)) return false;
//   const token = auth.substring(BEARER.length);
//   const creds = getAuthCredentials(); // returns Promise<string|null>
//   // note: since getAuthCredentials is async, ensure synchronous check
//   throw new Error('authorize() must be awaited');
// }

async function authorize(req) {
  const auth = req.get('Authorization');
  if (!auth || !auth.startsWith(BEARER)) return false;
  const token = auth.substring(BEARER.length);
  const creds = await getAuthCredentials();
  return creds !== null && token === creds;
}

module.exports = { authorize };