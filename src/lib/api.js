// HTTP API for Protect-Vmax:
//
//   GET /health                          -> 200 {"ok":true}
//   GET /callback                        -> Discord OAuth2 login (public, browser-facing)
//   GET /api/v1/validate?key=..&hwid=..  -> JSON verdict (public, rate-limited)
//   GET /api/v1/load?script=..&key=..    -> protected Lua source (public, rate-limited)
//   GET /api/v1/status?user_id=..        -> whitelist status (token required)
//   GET /api/v1/key?key=..               -> key record        (token required)
//
// Public endpoints only reveal validity info (they require the key + HWID that
// the script already holds). Admin endpoints need Authorization: Bearer <token>.
// /callback is public because Discord redirects the user's browser there with
// ?code=... — no API token can be attached to that redirect.
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

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Minimal browser-facing page (used by the OAuth callback, which humans hit).
function htmlPage(res, status, title, bodyHtml) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
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

const PUBLIC_PATHS = new Set(['/health', '/callback', '/api/v1/validate', '/api/v1/load']);

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
      // Loader only ships the key — HWID is bound later by the wrapped script.
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
      });
      return res.end(protectedSrc);
    }

    // ---- Discord OAuth2 login callback (public, browser-facing) ----
    // MUST stay above the token gate below: Discord redirects the user's
    // browser here with ?code=... and no API token can be attached.
    if (path === '/callback') return handleOAuthCallback(req, res, url);

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
    if (!CONFIG.discordClientSecret) {
      console.log('ℹ️ DISCORD_CLIENT_SECRET not set — the website "Login with Discord" (/callback) will not work. Add it in Railway → Variables (Developer Portal → OAuth2 → Client Secret).');
    } else {
      console.log(`🔐 Discord OAuth login ready (redirect URI: ${CONFIG.oauthRedirectUri || 'NOT SET — set PUBLIC_URL or DISCORD_OAUTH_REDIRECT_URI'})`);
    }
  });

  return server;
}
