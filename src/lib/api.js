// HTTP API & Web Server for Protect-Vmax:
//
//   GET /                                -> Web landing page (index.html)
//   GET /dashboard.html                  -> Dashboard page
//   GET /styles.css, /auth.js, etc.      -> Static website assets
//   POST /token                          -> CORS token proxy for Discord OAuth PKCE
//   GET /api/user/:discordId             -> Dashboard user data (apiKey, scripts, stats)
//   GET /scripts/hosted/:hash.lua        -> Raw protected Lua script for loaders
//   GET /health, /healthz                -> Health check
//   GET /callback                        -> Server Discord OAuth2 login
//   GET /api/v1/validate?key=..&hwid=..  -> JSON verdict (public, rate-limited)
//   GET /api/v1/load?script=..&key=..    -> protected Lua source (public, rate-limited)
//   GET /api/v1/status?user_id=..        -> whitelist status (token required)
//   GET /api/v1/key?key=..               -> key record        (token required)
import { createServer } from 'node:http';
import { URL, fileURLToPath } from 'node:url';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, extname } from 'node:path';
import { CONFIG } from './config.js';
import { getApiToken, isBotOwner } from './settings.js';
import { getKeyRecord, getUserWhitelist, validateKey, isBlacklisted, listScripts } from './keySystem.js';
import { formatKey } from './keys.js';
import { recordValidation } from './analytics.js';
import { protectSource } from './protect.js';
import { db } from './store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', '..', 'public');
const DISCORD_API = 'https://discord.com/api';

/* ---------------------- deterministic hashing (mirrors dashboard.js) ---- */
function strHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) + str.charCodeAt(i);
    h |= 0;
  }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashHex(str, len) {
  const r = mulberry32(strHash(str));
  let s = '';
  while (s.length < len) s += Math.floor(r() * 16).toString(16);
  return s.slice(0, len);
}
export function deriveApiKey(user) {
  const seed = (user.id || 'demo') + '|' + (user.username || 'demo');
  return 'VMAX-' + hashHex(seed, 16).toUpperCase();
}
export function hostHash(apiKey, name) {
  return hashHex(apiKey + '::' + name, 64);
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.lua': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(payload);
}

function unauthorized(res) {
  json(res, 401, { status: 'error', code: 'unauthorized', message: 'Missing or invalid API token.' });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Minimal browser-facing page (used by OAuth callback errors/info).
function htmlPage(res, status, title, bodyHtml) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — Protect-Vmax</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:#0a0a0a; color:#f5f5f5;
         font:16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width:540px; padding:40px 28px; text-align:center; }
  h1 { font-size:18px; letter-spacing:.12em; text-transform:uppercase; margin:0 0 18px; color:#fff; }
  h2 { font-size:22px; margin:14px 0 6px; color:#fff; }
  p { color:#a3a3a3; } p.err { color:#f87171; }
  code { background:#171717; border:1px solid #262626; border-radius:6px; padding:2px 7px; font-size:13px; }
  ul { text-align:left; display:table; margin:10px auto; color:#d4d4d4; }
  .btn { display:inline-block; margin-top:16px; padding:10px 24px; border-radius:999px;
         background:#fff; color:#0a0a0a; font-weight:600; text-decoration:none; }
  .avatar { border-radius:50%; border:2px solid #262626; }
  .muted { font-size:14px; }
</style>
</head>
<body><main><h1>Protect-Vmax</h1>${bodyHtml}</main></body>
</html>`);
}

// Serves static assets from public/ folder
function serveStaticFile(res, reqPath) {
  const safePath = reqPath === '/' ? '/index.html' : reqPath;
  const filePath = normalize(join(PUBLIC_DIR, safePath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    return false;
  }

  if (!existsSync(filePath)) {
    return false;
  }

  try {
    const stats = statSync(filePath);
    if (stats.isDirectory()) {
      const indexFile = join(filePath, 'index.html');
      if (existsSync(indexFile)) {
        return serveStaticFile(res, join(safePath, 'index.html'));
      }
      return false;
    }

    const ext = extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const content = readFileSync(filePath);

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': content.length,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

// Handles the Discord OAuth2 redirect: exchanges ?code for an access token,
// then shows who logged in. Public + rate-limited — no API token involved.
async function handleOAuthCallback(req, res, url) {
  const params = url.searchParams;

  // Discord sends ?error=access_denied when the user cancels the login prompt.
  if (params.get('error')) {
    return htmlPage(res, 403, 'Login cancelled', `
      <p class="err">Discord login was cancelled (<code>${escapeHtml(params.get('error'))}</code>).</p>
      <p>Close this tab and use the Login button on the site again if you want to retry.</p>`);
  }

  // Opened directly (no code) — show a friendly page instead of an error.
  const code = params.get('code') || '';
  if (!code) {
    const loginUrl = CONFIG.discordClientId && CONFIG.oauthRedirectUri
      ? `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(CONFIG.discordClientId)}` +
        `&response_type=code&redirect_uri=${encodeURIComponent(CONFIG.oauthRedirectUri)}&scope=identify%20guilds`
      : null;
    return htmlPage(res, 400, 'Nothing to do', `
      <p>This is the Protect-Vmax Discord login callback. It only does something when Discord
      redirects here after you press <strong>Login with Discord</strong> on the site.</p>
      ${loginUrl ? `<a class="btn" href="${loginUrl}" rel="noopener">Login with Discord</a>` : ''}`);
  }

  const missing = [];
  if (!CONFIG.discordClientId) missing.push('DISCORD_CLIENT_ID (or CLIENT_ID)');
  if (!CONFIG.discordClientSecret) missing.push('DISCORD_CLIENT_SECRET');
  if (!CONFIG.oauthRedirectUri) missing.push('PUBLIC_URL (or DISCORD_OAUTH_REDIRECT_URI)');
  if (missing.length) {
    return htmlPage(res, 500, 'Login not configured', `
      <p class="err">Discord login is not configured on the server. Add these variables
      (Railway → your service → Variables):</p>
      <ul>${missing.map((m) => `<li><code>${escapeHtml(m)}</code></li>`).join('')}</ul>
      <p class="muted">DISCORD_CLIENT_SECRET comes from the Developer Portal → OAuth2 → Client Secret.</p>`);
  }

  // Exchange the one-time code for an access token.
  let tokenRes;
  let tokenData = {};
  try {
    tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CONFIG.discordClientId,
        client_secret: CONFIG.discordClientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: CONFIG.oauthRedirectUri,
      }),
    });
    tokenData = await tokenRes.json().catch(() => ({}));
  } catch {
    return htmlPage(res, 502, 'Discord unreachable', `
      <p class="err">Could not reach Discord to finish the login. Try again in a moment.</p>`);
  }

  if (!tokenRes.ok) {
    const err = tokenData.error || `HTTP ${tokenRes.status}`;
    const hint = err === 'invalid_client'
      ? 'Check <code>DISCORD_CLIENT_ID</code> / <code>DISCORD_CLIENT_SECRET</code> — they must match the Application ID and OAuth2 Client Secret from the Developer Portal.'
      : err === 'invalid_grant'
        ? 'The code was already used or expired — retry the login. If it keeps happening, the redirect URI registered in the Developer Portal (OAuth2 → Redirects) does not exactly match the one the server sends.'
        : 'Discord rejected the login code. Retry the login from the site.';
    return htmlPage(res, 502, 'Login failed', `
      <p class="err">Discord rejected the token exchange: <code>${escapeHtml(err)}</code></p>
      <p>${hint}</p>`);
  }

  // Who just logged in? (needs the "identify" scope)
  let user = null;
  try {
    const meRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (meRes.ok) user = await meRes.json();
  } catch {
    // Non-fatal — the login itself already succeeded.
  }

  console.log(`🔑 OAuth login: ${user ? `${user.username} (${user.id})` : 'token exchange ok (identity unavailable)'}`);

  const name = user ? (user.global_name || user.username) : 'Discord user';
  const avatar = user?.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
    : null;

  return htmlPage(res, 200, 'Logged in', `
    ${avatar ? `<img class="avatar" src="${escapeHtml(avatar)}" alt="" width="80" height="80">` : ''}
    <h2>Logged in as ${escapeHtml(name)}</h2>
    ${user ? `<p class="muted">Discord ID: <code>${escapeHtml(user.id)}</code></p>` : ''}
    <p>Discord login is working. You can close this tab and return to the site.</p>
    ${CONFIG.websiteUrl ? `<a class="btn" href="${escapeHtml(CONFIG.websiteUrl)}" rel="noopener">Back to the site</a>` : ''}`);
}

// Handles user profile and script list for the dashboard: GET /api/user/:discordId
async function handleUserDashboard(req, res, discordId) {
  const auth = req.headers['authorization'] || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  let user = { id: discordId, username: 'User' };

  if (m) {
    try {
      const r = await fetch(DISCORD_API + '/users/@me', {
        headers: { Authorization: 'Bearer ' + m[1] },
      });
      if (r.ok) {
        user = await r.json();
      }
    } catch {
      // Non-fatal fallback
    }
  }

  const apiKey = deriveApiKey(user);
  const allScripts = listScripts();
  const hostBase = `${CONFIG.publicUrl || `http://localhost:${CONFIG.apiPort}`}/scripts/hosted`;

  // Compute script stats from database
  const scriptsData = allScripts.map((s) => {
    const name = s.name;
    const sourceRec = db.scriptsources?.[name];
    const keysForScript = Object.values(db.keys || {}).filter((k) => k.script === name && k.hwid);
    const execCount = (db.analytics || []).filter((a) => a.script === name).length;

    return {
      name,
      status: sourceRec?.source ? 'online' : 'paused',
      hwid: keysForScript.length,
      executions: execCount,
      created: sourceRec?.updatedAt ? sourceRec.updatedAt.slice(0, 10) : '2026-08-22',
      hostedUrl: `${hostBase}/${hostHash(apiKey, name)}.lua`,
    };
  });

  return json(res, 200, {
    apiKey,
    plan: isBotOwner(discordId) ? 'Owner' : 'Vmax',
    scripts: scriptsData,
  });
}

function findHostedSource(hashClean) {
  if (!db.scriptsources) return null;

  // 1. Direct name match
  if (db.scriptsources[hashClean]?.source) {
    return db.scriptsources[hashClean].source;
  }

  const allScripts = listScripts();

  // 2. Check known hashes for users & demo
  const candidates = new Set(['demo|demo', '1000000000000000000|DemoUser']);
  if (db.settings?.ownerId) {
    candidates.add(`${db.settings.ownerId}|Owner`);
  }
  for (const k of Object.values(db.keys || {})) {
    if (k.claimedBy) candidates.add(`${k.claimedBy}|User`);
  }

  for (const seed of candidates) {
    const [id, username] = seed.split('|');
    const apiKey = deriveApiKey({ id, username });
    for (const s of allScripts) {
      if (hostHash(apiKey, s.name) === hashClean && db.scriptsources[s.name]?.source) {
        return db.scriptsources[s.name].source;
      }
    }
  }

  // 3. Fallback to any script with source
  for (const s of allScripts) {
    if (db.scriptsources[s.name]?.source) {
      return db.scriptsources[s.name].source;
    }
  }

  for (const key of Object.keys(db.scriptsources)) {
    if (db.scriptsources[key]?.source) {
      return db.scriptsources[key].source;
    }
  }

  return null;
}

// Handles raw script delivery for hosted loader hashes: GET /scripts/hosted/:hash.lua
function handleHostedScript(res, hashClean) {
  const source = findHostedSource(hashClean);

  if (!source) {
    res.writeHead(404, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    });
    return res.end('-- script not found or no source uploaded via /apply');
  }

  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  return res.end(source);
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

const PUBLIC_API_PATHS = new Set(['/health', '/healthz', '/api/v1/info', '/callback', '/api/v1/validate', '/api/v1/load']);

export function startApiServer(client) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const path = url.pathname;
    const ip = req.socket.remoteAddress || '';

    // Handle CORS Preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      });
      return res.end();
    }

    // ---- Token Proxy for Discord OAuth PKCE (bypasses browser CORS) ----
    if (req.method === 'POST' && path === '/token') {
      let body = '';
      for await (const chunk of req) body += chunk;
      try {
        const upstream = await fetch('https://discord.com/api/oauth2/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
        });
        const text = await upstream.text();
        res.writeHead(upstream.status, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        return res.end(text);
      } catch (err) {
        return json(res, 502, { error: 'proxy_failed', detail: String(err) });
      }
    }

    if (req.method !== 'GET') return json(res, 405, { status: 'error', message: 'Method not allowed.' });

    if (PUBLIC_API_PATHS.has(path) && rateLimited(ip)) {
      return json(res, 429, { status: 'error', code: 'rate_limited', message: 'Too many requests — slow down.' });
    }

    if (path === '/health' || path === '/healthz') {
      if (path === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
        return res.end('ok');
      }
      return json(res, 200, {
        ok: true,
        bot: client?.user?.tag || 'starting',
        uptime: process.uptime(),
      });
    }

    if (path === '/api/v1/info') {
      return json(res, 200, {
        status: 'ok',
        name: 'Protect-Vmax',
        bot_online: Boolean(client?.user),
        bot_tag: client?.user?.tag || null,
        credit: CONFIG.creditName,
        public_url: CONFIG.publicUrl,
        discord_client_id: CONFIG.discordClientId || null,
        commands_count: client?.commands?.size || 16,
      });
    }

    // ---- Dashboard User Endpoint: GET /api/user/:discordId ----
    if (path.startsWith('/api/user/')) {
      const id = path.slice('/api/user/'.length).split('/')[0];
      return handleUserDashboard(req, res, id);
    }

    // ---- Hosted Script Delivery: GET /scripts/hosted/:hash.lua ----
    if (path.startsWith('/scripts/hosted/')) {
      const hash = path.slice('/scripts/hosted/'.length).replace(/\.lua$/i, '');
      return handleHostedScript(res, hash);
    }

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
      const result = validateKey({ inputKey: key, hwid, script, ip, skipHwid: true });
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
        'Access-Control-Allow-Origin': '*',
      });
      return res.end(protectedSrc);
    }

    // ---- Discord OAuth2 login callback (public, browser-facing) ----
    if (path === '/callback') return handleOAuthCallback(req, res, url);

    // ---- Admin endpoints (require API token) ----
    if (path.startsWith('/api/')) {
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
          createdAt: rec.createdAt,
        });
      }

      return json(res, 404, { status: 'error', message: 'Not found.' });
    }

    // ---- Static Web Frontend (index.html, dashboard.html, styles.css, etc.) ----
    const served = serveStaticFile(res, path);
    if (served) return;

    return json(res, 404, { status: 'error', message: 'Not found.' });
  });

  server.listen(CONFIG.apiPort, '0.0.0.0', () => {
    console.log(`✅ Protect-Vmax Web & API listening on http://0.0.0.0:${CONFIG.apiPort}`);
    if (!CONFIG.discordClientSecret) {
      console.log('ℹ️ DISCORD_CLIENT_SECRET not set — the website "Login with Discord" (/callback) will not work. Add it in Railway → Variables (Developer Portal → OAuth2 → Client Secret).');
    } else {
      console.log(`🔐 Discord OAuth login ready (redirect URI: ${CONFIG.oauthRedirectUri || 'NOT SET — set PUBLIC_URL or DISCORD_OAUTH_REDIRECT_URI'})`);
    }
  });

  return server;
}
