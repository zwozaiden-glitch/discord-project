// HTTP API & Web Server for Protect-Vmax:
//
//   GET /                                -> Web landing page (index.html)
//   GET /dashboard.html                  -> Dashboard page
//   GET /styles.css, /auth.js, etc.      -> Static website assets
//   GET /auth/discord                    -> Starts Discord OAuth2 login
//   GET /callback                        -> Discord OAuth2 callback, then dashboard redirect
//   GET /api/auth/session                -> Current signed-in website user
//   POST /auth/logout                    -> Clears the website login session
//   GET /api/user/:discordId             -> Dashboard user data (apiKey, scripts, stats)
//   GET /scripts/hosted/:hash.lua        -> Raw protected Lua script for loaders
//   GET /health, /healthz                -> Health check
//   GET /api/v1/validate?key=..&hwid=..  -> JSON verdict (public, rate-limited)
//   GET /api/v1/load?script=..&key=..    -> protected Lua source (public, rate-limited)
//   GET /s/<token>.lua  /raw/<token>.lua -> one-line short loaders (same as /load)
//   GET /api/v1/status?user_id=..        -> whitelist status (token required)
//   GET /api/v1/key?key=..               -> key record        (token required)
import { createServer } from 'node:http';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
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
import { getLoaderRecord } from './loader.js';
import {
  addForward,
  getForward,
  getForwardHistory,
  getForwardLogs,
  getForwardRulesForDashboard,
  getForwardStatus,
  isDashboardManager,
  isSnowflake,
  isWebhookUrl,
  removeForward,
  ruleToApi,
  sendForwardTest,
  setForwardEnabled,
  validateDestinationChannelAccess,
} from './forward.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', '..', 'public');
const DISCORD_API = 'https://discord.com/api';
const OAUTH_STATE_COOKIE = 'pv_oauth_state';
const SESSION_COOKIE = 'pv_session';
const SESSION_MAX_AGE = 7 * 24 * 60 * 60;

function parseCookies(req) {
  const cookies = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name) cookies[name] = value;
  }
  return cookies;
}

function cookie(name, value, { maxAge = SESSION_MAX_AGE, httpOnly = true } = {}) {
  const parts = [
    `${name}=${value}`,
    'Path=/',
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
    'SameSite=Lax',
  ];
  if (httpOnly) parts.push('HttpOnly');
  if (String(CONFIG.publicUrl || '').startsWith('https://')) parts.push('Secure');
  return parts.join('; ');
}

function sessionSecret() {
  // OAuth cannot be enabled without the Discord client secret, so it is also
  // a stable signing key for the short, HttpOnly website session cookie.
  return CONFIG.discordClientSecret;
}

function sign(value) {
  return createHmac('sha256', sessionSecret()).update(value).digest('base64url');
}

function createSessionCookie(user, expiresIn) {
  const safeUser = {
    id: user.id,
    username: user.username,
    global_name: user.global_name || null,
    discriminator: user.discriminator || '0',
    avatar: user.avatar || null,
    email: user.email || null,
  };
  const maxAge = Math.min(Math.max(Number(expiresIn) || SESSION_MAX_AGE, 60), SESSION_MAX_AGE);
  const payload = Buffer.from(
    JSON.stringify({ user: safeUser, exp: Math.floor(Date.now() / 1000) + maxAge })
  ).toString('base64url');
  return { value: `${payload}.${sign(payload)}`, maxAge };
}

function readSession(req) {
  const raw = parseCookies(req)[SESSION_COOKIE] || '';
  const separator = raw.lastIndexOf('.');
  if (separator < 1 || !sessionSecret()) return null;

  const payload = raw.slice(0, separator);
  const suppliedSignature = raw.slice(separator + 1);
  const expectedSignature = sign(payload);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!session?.user?.id || !session.exp || session.exp <= Math.floor(Date.now() / 1000)) return null;
    return session;
  } catch {
    return null;
  }
}

function sameValue(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

async function getAuthenticatedUser(req) {
  const sessionUser = readSession(req)?.user || null;
  if (sessionUser?.id) return sessionUser;

  const auth = req.headers.authorization || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;

  try {
    const response = await fetch(DISCORD_API + '/users/@me', {
      headers: { Authorization: `Bearer ${match[1]}` },
    });
    if (!response.ok) return null;
    const user = await response.json();
    return user?.id ? user : null;
  } catch {
    return null;
  }
}

async function requireForwarderManager(req, res) {
  const user = await getAuthenticatedUser(req);
  if (!user?.id) {
    unauthorized(res);
    return null;
  }
  if (!isDashboardManager(user.id)) {
    json(res, 403, {
      status: 'error',
      code: 'forbidden',
      message: 'Your Discord account is not allowed to manage the VMax Forwarder dashboard.',
    });
    return null;
  }
  return user;
}

function readJsonBody(req, limitBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > limitBytes) {
        reject(new Error('Request body is too large.'));
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body.'));
      }
    });
    req.on('error', reject);
  });
}

function dashboardUrl() {
  try {
    return new URL('/dashboard.html', CONFIG.publicUrl).toString();
  } catch {
    return '/dashboard.html';
  }
}

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
function htmlPage(res, status, title, bodyHtml, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
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

function oauthMissingConfig() {
  const missing = [];
  if (!CONFIG.discordClientId) missing.push('DISCORD_CLIENT_ID (or CLIENT_ID)');
  if (!CONFIG.discordClientSecret) missing.push('DISCORD_CLIENT_SECRET');
  if (!CONFIG.oauthRedirectUri) missing.push('PUBLIC_URL (or DISCORD_OAUTH_REDIRECT_URI)');
  return missing;
}

// Starts the one canonical website login flow. Keeping this on the backend
// means the client secret and Discord access token never enter browser JS.
function handleOAuthStart(res) {
  const missing = oauthMissingConfig();
  if (missing.length) {
    return htmlPage(res, 500, 'Login not configured', `
      <p class="err">Discord login is not configured on the server. Add these variables
      (Railway → your service → Variables):</p>
      <ul>${missing.map((item) => `<li><code>${escapeHtml(item)}</code></li>`).join('')}</ul>
      <p class="muted">DISCORD_CLIENT_SECRET comes from the Developer Portal → OAuth2 → Client Secret.</p>`);
  }

  const state = randomBytes(24).toString('base64url');
  const authorizeUrl = new URL('https://discord.com/oauth2/authorize');
  authorizeUrl.search = new URLSearchParams({
    client_id: CONFIG.discordClientId,
    response_type: 'code',
    redirect_uri: CONFIG.oauthRedirectUri,
    scope: 'identify email',
    state,
  }).toString();

  res.writeHead(302, {
    Location: authorizeUrl.toString(),
    'Cache-Control': 'no-store',
    'Set-Cookie': cookie(OAUTH_STATE_COOKIE, state, { maxAge: 10 * 60 }),
  });
  return res.end();
}

// Handles Discord's redirect, creates an HttpOnly signed session, and sends
// the user to the dashboard. Public + rate-limited; no API token is involved.
async function handleOAuthCallback(req, res, url) {
  const params = url.searchParams;

  if (params.get('error')) {
    return htmlPage(res, 403, 'Login cancelled', `
      <p class="err">Discord login was cancelled (<code>${escapeHtml(params.get('error'))}</code>).</p>
      <a class="btn" href="/auth/discord">Try again</a>`);
  }

  const code = params.get('code') || '';
  if (!code) {
    return htmlPage(res, 400, 'OAuth callback', `
      <p>This URL is only the Discord OAuth return endpoint, not the website homepage.</p>
      <p>Open <code>${escapeHtml(CONFIG.publicUrl)}/</code> to view the site, or start a login below.</p>
      <a class="btn" href="/auth/discord">Login with Discord</a>`);
  }

  const missing = oauthMissingConfig();
  if (missing.length) {
    return htmlPage(res, 500, 'Login not configured', `
      <p class="err">Discord login is missing:</p>
      <ul>${missing.map((item) => `<li><code>${escapeHtml(item)}</code></li>`).join('')}</ul>`);
  }

  const savedState = parseCookies(req)[OAUTH_STATE_COOKIE];
  const returnedState = params.get('state');
  if (!sameValue(savedState, returnedState)) {
    return htmlPage(res, 400, 'Login expired', `
      <p class="err">The login state is missing, expired, or invalid.</p>
      <p>Start again from the website; do not open the callback URL directly.</p>
      <a class="btn" href="/auth/discord">Try again</a>`);
  }

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
      ? 'Check <code>DISCORD_CLIENT_ID</code> / <code>DISCORD_CLIENT_SECRET</code> — they must belong to the same Discord application.'
      : err === 'invalid_grant'
        ? 'The code expired, was already used, or the Developer Portal redirect does not exactly match the deploy-log callback URL.'
        : 'Discord rejected the login code. Retry from the website.';
    return htmlPage(res, 502, 'Login failed', `
      <p class="err">Discord rejected the token exchange: <code>${escapeHtml(err)}</code></p>
      <p>${hint}</p>
      <a class="btn" href="/auth/discord">Try again</a>`);
  }

  let user = null;
  try {
    const meRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (meRes.ok) user = await meRes.json();
  } catch {
    // The error page below handles an unavailable identity.
  }

  if (!user?.id) {
    return htmlPage(res, 502, 'Login failed', `
      <p class="err">Discord authorized the login but did not return your account.</p>
      <a class="btn" href="/auth/discord">Try again</a>`);
  }

  console.log(`🔑 OAuth login: ${user.username} (${user.id})`);
  const session = createSessionCookie(user, tokenData.expires_in);
  res.writeHead(302, {
    Location: dashboardUrl(),
    'Cache-Control': 'no-store',
    'Set-Cookie': [
      cookie(SESSION_COOKIE, session.value, { maxAge: session.maxAge }),
      cookie(OAUTH_STATE_COOKIE, '', { maxAge: 0 }),
    ],
  });
  return res.end();
}

// Handles user profile and script list for the dashboard: GET /api/user/:discordId
async function handleUserDashboard(req, res, discordId) {
  const user = await getAuthenticatedUser(req);
  if (!user?.id) return unauthorized(res);
  if (String(user.id) !== String(discordId)) {
    return json(res, 403, { status: 'error', code: 'forbidden', message: 'That is not your dashboard.' });
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

function forwardRulePayloadToApi(rule) {
  return ruleToApi(rule);
}

function forwardOverviewPayload(client) {
  return {
    status: 'ok',
    system: getForwardStatus(client),
    rules: getForwardRulesForDashboard(),
    recentHistory: getForwardHistory(25),
    recentLogs: getForwardLogs(25),
  };
}

async function handleForwarderOverview(req, res, client) {
  const user = await requireForwarderManager(req, res);
  if (!user) return;
  return json(res, 200, {
    ...forwardOverviewPayload(client),
    user: {
      id: user.id,
      username: user.username,
      global_name: user.global_name || null,
      avatar: user.avatar || null,
    },
  });
}

async function handleForwarderRules(req, res) {
  const user = await requireForwarderManager(req, res);
  if (!user) return;
  return json(res, 200, {
    status: 'ok',
    rules: getForwardRulesForDashboard(),
    manager_id: user.id,
  });
}

async function handleForwarderLogs(req, res) {
  const user = await requireForwarderManager(req, res);
  if (!user) return;
  return json(res, 200, {
    status: 'ok',
    logs: getForwardLogs(100),
    history: getForwardHistory(100),
  });
}

async function handleForwarderCreateRule(req, res, client) {
  const user = await requireForwarderManager(req, res);
  if (!user) return;

  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    return json(res, 400, { status: 'error', code: 'invalid_body', message: error.message });
  }

  const sourceGuildId = String(body.sourceGuildId || '').trim();
  const sourceChannelId = String(body.sourceChannelId || '').replace(/[<#>]/g, '').trim();
  const sourceChannelName = String(body.sourceChannelName || sourceChannelId || '').trim();
  const sourceGuildName = String(body.sourceGuildName || sourceGuildId || '').trim();
  const destinationWebhook = String(body.destinationWebhook || '').trim();
  const destinationChannelId = String(body.destinationChannelId || '').replace(/[<#>]/g, '').trim();

  if (!sourceGuildId || !sourceChannelId || !isSnowflake(sourceChannelId)) {
    return json(res, 400, {
      status: 'error',
      code: 'invalid_source',
      message: 'sourceGuildId and sourceChannelId are required. sourceChannelId must be a Discord channel ID.',
    });
  }

  if (!destinationWebhook && !destinationChannelId) {
    return json(res, 400, {
      status: 'error',
      code: 'missing_destination',
      message: 'Provide either destinationWebhook or destinationChannelId.',
    });
  }

  if (destinationWebhook && destinationChannelId) {
    return json(res, 400, {
      status: 'error',
      code: 'ambiguous_destination',
      message: 'Choose only one destination type: webhook OR destinationChannelId.',
    });
  }

  let destinationMeta = {
    destinationType: destinationWebhook ? 'webhook' : 'channel',
    destinationChannelId: null,
    destinationGuildId: null,
    destinationGuildName: null,
    destinationChannelName: null,
    destWebhook: destinationWebhook || null,
  };

  if (destinationWebhook) {
    if (!isWebhookUrl(destinationWebhook)) {
      return json(res, 400, {
        status: 'error',
        code: 'invalid_webhook',
        message: 'destinationWebhook must be a valid Discord webhook URL.',
      });
    }
  } else {
    const checked = await validateDestinationChannelAccess(client, destinationChannelId, sourceGuildId, user.id);
    if (!checked.ok) {
      return json(res, 403, { status: 'error', code: checked.code, message: checked.message });
    }
    destinationMeta = {
      destinationType: 'channel',
      destinationChannelId: checked.destination.id,
      destinationGuildId: checked.destination.guildId || null,
      destinationGuildName: checked.destination.guild?.name || null,
      destinationChannelName: checked.destination.name || checked.destination.id,
      destWebhook: null,
    };
  }

  const rule = addForward({
    guildId: sourceGuildId,
    sourceGuildId,
    sourceGuildName,
    sourceChannelId,
    sourceChannelName,
    createdBy: user.id,
    updatedBy: user.id,
    allowedFileTypes: body.allowedFileTypes || 'all',
    maxFileSizeBytes: Number(body.maxFileSizeBytes || 8 * 1024 * 1024),
    forwardText: body.forwardText !== false,
    forwardEmbeds: Boolean(body.forwardEmbeds),
    showAuthor: body.showAuthor !== false,
    enabled: body.enabled !== false,
    ...destinationMeta,
  });

  return json(res, 201, {
    status: 'ok',
    rule: forwardRulePayloadToApi(rule),
  });
}

async function handleForwarderRuleAction(req, res, client, ruleId, action) {
  const user = await requireForwarderManager(req, res);
  if (!user) return;

  const rule = getForward(ruleId);
  if (!rule) {
    return json(res, 404, { status: 'error', code: 'not_found', message: 'Rule not found.' });
  }

  if (action === 'delete') {
    removeForward(ruleId, user.id);
    return json(res, 200, { status: 'ok', removed: true, ruleId });
  }

  if (action === 'enable' || action === 'disable') {
    const updated = setForwardEnabled(ruleId, action === 'enable', user.id);
    return json(res, 200, { status: 'ok', rule: forwardRulePayloadToApi(updated) });
  }

  if (action === 'test') {
    try {
      await sendForwardTest(ruleId, client, user.id);
      return json(res, 200, { status: 'ok', sent: true });
    } catch (error) {
      return json(res, 502, { status: 'error', code: 'test_failed', message: error.message });
    }
  }

  return json(res, 404, { status: 'error', code: 'not_found', message: 'Unknown forwarder action.' });
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

function writeProtectedSource(res, { script, key, hwid, ip }) {
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

// GitHub-raw style short loader:
//   GET /s/<token>.lua   GET /raw/<token>.lua
function handleShortLoader(req, res, url, ip) {
  const match = url.pathname.match(/^\/(?:s|raw)\/([^/]+)$/i);
  if (!match) return false;

  const token = decodeURIComponent(match[1]).replace(/\.lua$/i, '');
  const hwid = url.searchParams.get('hwid') || '';
  const rec = getLoaderRecord(token);
  if (rec?.script && rec?.key) {
    writeProtectedSource(res, { script: rec.script, key: rec.key, hwid, ip });
    return true;
  }

  const key = url.searchParams.get('key') || '';
  if (key) {
    writeProtectedSource(res, { script: token, key, hwid, ip });
    return true;
  }

  json(res, 404, {
    status: 'error',
    code: 'loader_not_found',
    message: 'Unknown short loader. Get a fresh one-liner from /getscript or Get Script.',
  });
  return true;
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

const PUBLIC_API_PATHS = new Set([
  '/health',
  '/healthz',
  '/api/v1/info',
  '/auth/discord',
  '/callback',
  '/api/auth/session',
  '/api/v1/validate',
  '/api/v1/load',
]);

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

    if (req.method === 'POST' && path === '/auth/logout') {
      res.writeHead(204, {
        'Cache-Control': 'no-store',
        'Set-Cookie': cookie(SESSION_COOKIE, '', { maxAge: 0 }),
      });
      return res.end();
    }

    if (req.method === 'POST' && path === '/api/forwarder/rules') {
      return handleForwarderCreateRule(req, res, client);
    }

    if (req.method === 'POST') {
      const actionMatch = path.match(/^\/api\/forwarder\/rules\/([^/]+)\/(enable|disable|delete|test)$/i);
      if (actionMatch) {
        return handleForwarderRuleAction(req, res, client, decodeURIComponent(actionMatch[1]), actionMatch[2].toLowerCase());
      }
    }

    if (req.method !== 'GET') return json(res, 405, { status: 'error', message: 'Method not allowed.' });

    if (PUBLIC_API_PATHS.has(path) && rateLimited(ip)) {
      return json(res, 429, { status: 'error', code: 'rate_limited', message: 'Too many requests — slow down.' });
    }

    if (path.startsWith('/s/') || path.startsWith('/raw/')) {
      if (rateLimited(ip)) {
        return json(res, 429, { status: 'error', code: 'rate_limited', message: 'Too many requests — slow down.' });
      }
      return handleShortLoader(req, res, url, ip);
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

    // ---- Website Discord OAuth and session ----
    if (path === '/auth/discord') return handleOAuthStart(res);
    if (path === '/callback') return handleOAuthCallback(req, res, url);
    if (path === '/api/auth/session') {
      const session = readSession(req);
      return json(res, 200, session
        ? { authenticated: true, user: session.user, expires_at: session.exp * 1000 }
        : { authenticated: false, user: null });
    }

    if (path === '/api/forwarder/overview') {
      return handleForwarderOverview(req, res, client);
    }

    if (path === '/api/forwarder/rules') {
      return handleForwarderRules(req, res);
    }

    if (path === '/api/forwarder/logs') {
      return handleForwarderLogs(req, res);
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
      return writeProtectedSource(res, { script, key, hwid, ip });
    }

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
    console.log(`🌐 Website home: ${CONFIG.publicUrl}/`);
    if (!CONFIG.discordClientSecret) {
      console.log('ℹ️ DISCORD_CLIENT_SECRET not set — the website "Login with Discord" will not work. Add it in Railway → Variables (Developer Portal → OAuth2 → Client Secret).');
    } else {
      console.log(`🔐 Discord OAuth callback (not the homepage): ${CONFIG.oauthRedirectUri || 'NOT SET — set PUBLIC_URL or DISCORD_OAUTH_REDIRECT_URI'}`);
    }
  });

  return server;
}
