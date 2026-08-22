// Small HTTP API so your scripts (e.g. Luasnapper loaders) can validate keys/HWIDs
// programmatically instead of talking to Discord.
//
//   GET /health                       -> 200 {"ok":true}
//   GET /api/v1/validate?key=...&hwid=...&script=...   -> JSON (token required)
//   GET /api/v1/status?user_id=...&script=...          -> whitelist status for a user
//
// Auth: send `Authorization: Bearer <API_TOKEN>` (or ?token=). If API_TOKEN is
// not set, the API is open — only do that on a private network.
import { createServer } from 'node:http';
import { URL } from 'node:url';
import { CONFIG } from './config.js';
import { getKeyRecord, getUserWhitelist, validateKey, isWhitelisted, isBlacklisted } from './keySystem.js';
import { formatKey } from './keys.js';
import { sendLog, clientEmbed } from './notify.js';

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(payload);
}

function unauthorized(res) {
  json(res, 401, { status: 'error', code: 'unauthorized', message: 'Missing or invalid API token.' });
}

function authorize(req, searchParams) {
  if (!CONFIG.apiToken) return true;
  const header = req.headers.authorization || '';
  if (header === `Bearer ${CONFIG.apiToken}`) return true;
  return searchParams.get('token') === CONFIG.apiToken;
}

export function startApiServer(client) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const path = url.pathname;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      });
      return res.end();
    }

    if (req.method !== 'GET') return json(res, 405, { status: 'error', message: 'GET only.' });

    if (path === '/health') return json(res, 200, { ok: true, bot: client?.user?.tag || 'starting' });

    if (!authorize(req, url.searchParams)) return unauthorized(res);

    if (path === '/api/v1/validate') {
      const key = url.searchParams.get('key') || '';
      const hwid = url.searchParams.get('hwid') || '';
      const script = url.searchParams.get('script') || '';
      const result = validateKey({ inputKey: key, hwid, script, ip: req.socket.remoteAddress });
      return json(res, result.status === 'valid' ? 200 : 403, result);
    }

    if (path === '/api/v1/status') {
      const userId = url.searchParams.get('user_id') || '';
      const script = url.searchParams.get('script') || '';
      if (!userId) return json(res, 400, { status: 'error', message: 'user_id is required.' });
      const entries = getUserWhitelist(userId, script || null);
      const records = entries.map((e) => {
        const rec = getKeyRecord(e.key);
        return {
          script: e.script,
          key: formatKey(e.key),
          hwid: rec?.hwid || null,
          expires_at: rec?.expiresAt || null,
          valid: Boolean(rec && !rec.voided && !(rec.expiresAt && Date.parse(rec.expiresAt) < Date.now())),
        };
      });
      return json(res, 200, {
        status: 'ok',
        user_id: userId,
        whitelisted: Boolean(records.length),
        blacklisted: script ? isBlacklisted(script, userId) : false,
        entries: records,
      });
    }

    if (path === '/api/v1/key') {
      const rec = getKeyRecord(url.searchParams.get('key') || '');
      if (!rec) return json(res, 404, { status: 'error', code: 'not_found', message: 'Key not found.' });
      return json(res, 200, {
        status: 'ok',
        script: rec.script,
        claimed_by: rec.claimedBy,
        hwid: rec.hwid,
        expires_at: rec.expiresAt,
        voided: rec.voided,
        created_at: rec.createdAt,
      });
    }

    return json(res, 404, { status: 'error', message: 'Not found.' });
  });

  server.listen(CONFIG.apiPort, '0.0.0.0', () => {
    console.log(`✅ Validation API listening on http://0.0.0.0:${CONFIG.apiPort} (auth: ${CONFIG.apiToken ? 'token' : 'OPEN — set API_TOKEN!'})`);
  });

  if (CONFIG.apiToken) {
    console.log(`🔑 Example: curl -H "Authorization: Bearer ${'<API_TOKEN>'}" "http://localhost:${CONFIG.apiPort}/api/v1/validate?key=LSN-XXXXX-XXXXX-XXXXX&hwid=ABC123"`);
  }

  return server;
}
