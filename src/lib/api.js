// HTTP API for Protect-Vmax:
//
//   GET /health                          -> 200 {"ok":true}
//   GET /api/v1/validate?key=..&hwid=..  -> JSON verdict (public, rate-limited)
//   GET /api/v1/load?script=..&key=..    -> protected Lua source (public, rate-limited)
//   GET /api/v1/status?user_id=..        -> whitelist status (token required)
//   GET /api/v1/key?key=..               -> key record        (token required)
//
// Public endpoints only reveal validity info (they require the key + HWID that
// the script already holds). Admin endpoints need Authorization: Bearer <token>.
import { createServer } from 'node:http';
import { URL } from 'node:url';
import { CONFIG } from './config.js';
import { getApiToken } from './settings.js';
import { getKeyRecord, getUserWhitelist, validateKey, isBlacklisted } from './keySystem.js';
import { formatKey } from './keys.js';
import { recordValidation } from './analytics.js';
import { protectSource } from './protect.js';
import { db } from './store.js';

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
  const token = getApiToken();
  if (!token) return true;
  const header = req.headers.authorization || '';
  if (header === `Bearer ${token}`) return true;
  return searchParams.get('token') === token;
}

// Simple per-IP rate limiter for the public endpoints (30 req / 30s).
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now > entry.reset) {
    hits.set(ip, { count: 1, reset: now + 30000 });
    return false;
  }
  entry.count += 1;
  if (entry.count > 30) {
    hits.delete(ip);
    hits.set(ip, { count: 30, reset: now + 30000 });
    return true;
  }
  return false;
}

const PUBLIC_PATHS = new Set(['/health', '/api/v1/validate', '/api/v1/load']);

export function startApiServer(client) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const path = url.pathname;
    const ip = req.socket.remoteAddress || '';

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      });
      return res.end();
    }

    if (req.method !== 'GET') return json(res, 405, { status: 'error', message: 'GET only.' });

    if (PUBLIC_PATHS.has(path) && rateLimited(ip)) {
      return json(res, 429, { status: 'error', code: 'rate_limited', message: 'Too many requests — slow down.' });
    }

    if (path === '/health') return json(res, 200, { ok: true, bot: client?.user?.tag || 'starting' });

    // ---- Public validation (used by protected scripts at runtime) ----
    if (path === '/api/v1/validate') {
      const key = url.searchParams.get('key') || '';
      const hwid = url.searchParams.get('hwid') || '';
      const script = url.searchParams.get('script') || '';
      const result = validateKey({ inputKey: key, hwid, script, ip });
      recordValidation({ script, code: result.code, key, hwid, ip });
      return json(res, result.status === 'valid' ? 200 : 403, result);
    }

    // ---- Public protected-script delivery ----
    if (path === '/api/v1/load') {
      const script = url.searchParams.get('script') || '';
      const key = url.searchParams.get('key') || '';
      const hwid = url.searchParams.get('hwid') || '';
      const result = validateKey({ inputKey: key, hwid, script, ip });
      recordValidation({ script, code: result.code, key, hwid, ip });
      if (result.status !== 'valid') return json(res, 403, result);

      const source = db.scriptsources?.[script]?.source;
      if (!source) {
        return json(res, 404, { status: 'error', code: 'no_script', message: 'No protected script uploaded yet.' });
      }

      const protectedSrc = protectSource(source, {
        script,
        key: formatKey(result.key),
        hwid: result.hwid,
        endpoint: CONFIG.publicUrl || `http://localhost:${CONFIG.apiPort}`,
      });

      res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      return res.end(protectedSrc);
    }

    // ---- Everything below needs the API token ----
    if (!authorize(req, url.searchParams)) return unauthorized(res);

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
    console.log(`✅ Protect-Vmax API listening on http://0.0.0.0:${CONFIG.apiPort} (auth: token)`);
  });

  return server;
}
