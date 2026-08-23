// Smoke test for the key system — run with: DATA_DIR=<tmp> node scripts/smoke-test.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'keysys-'));
process.env.API_TOKEN = 'test-token';
process.env.KEY_PREFIX = 'LSN';
process.env.PORT = '3999';
process.env.API_PORT = '3999';

const keySystem = await import('../src/lib/keySystem.js');
const keys = await import('../src/lib/keys.js');

const { ensureScript, makeKey, generateKeys, claimKey, getUserWhitelist, isWhitelisted, validateKey, blacklistUser, isBlacklisted, resetHwidForUser, getCooldownRemaining, purgeExpired, deleteUserKey } = keySystem;

// --- scripts ---
await ensureScript('luasnapper');
await ensureScript('other script');
assert.equal(keySystem.listScripts().length, 2);

// --- key generation & formatting ---
const raw = makeKey('luasnapper', { duration: '7d' });
assert.match(raw, /^[A-Z0-9]{18}$/, 'raw key shape');
const formatted = keys.formatKey(raw);
assert.equal(formatted, `${raw.slice(0,3)}-${raw.slice(3,8)}-${raw.slice(8,13)}-${raw.slice(13)}`);
assert.equal(keys.normalizeKey(` ${formatted.toLowerCase()} `), raw);
assert.equal(keys.normalizeKey('XXXX-12345'), null, 'wrong prefix rejected');

// --- bulk gen ---
const bulk = generateKeys('luasnapper', 5, { duration: '1d' });
assert.equal(bulk.length, 5);

// --- claim ---
assert.equal(claimKey(raw, 'user-1').ok, true, 'claim first time');
assert.equal(claimKey(raw, 'user-2').ok, false, 'cannot claim others key');
assert.equal(claimKey(raw, 'user-1').ok, true, 'same user re-claim ok');
assert.equal(isWhitelisted('luasnapper', 'user-1'), true);

// --- validate / HWID binding ---
let v = validateKey({ inputKey: raw, hwid: 'HWID-A', script: 'luasnapper' });
assert.equal(v.status, 'valid');
assert.equal(v.code, 'hwid_bound');

v = validateKey({ inputKey: raw, hwid: 'HWID-A', script: 'luasnapper' });
assert.equal(v.code, 'hwid_ok');

v = validateKey({ inputKey: raw, hwid: 'HWID-B', script: 'luasnapper' });
assert.equal(v.status, 'invalid');
assert.equal(v.code, 'hwid_mismatch');

v = validateKey({ inputKey: raw, hwid: 'HWID-A', script: 'other script' });
assert.equal(v.code, 'wrong_script');

v = validateKey({ inputKey: raw, hwid: '', script: 'luasnapper' });
assert.equal(v.code, 'missing_hwid');

// --- blacklist kills validation ---
blacklistUser('luasnapper', 'user-1', { reason: 'sharing', by: 'admin' });
assert.equal(isBlacklisted('luasnapper', 'user-1'), true);
assert.equal(isWhitelisted('luasnapper', 'user-1'), false);
v = validateKey({ inputKey: raw, hwid: 'HWID-A', script: 'luasnapper' });
assert.equal(v.code, 'blacklisted');
assert.equal(v.status, 'invalid');

// --- whitelist again via makeKey(claimedBy) ---
const raw2 = makeKey('luasnapper', { claimedBy: 'user-1', duration: '30d' });
assert.equal(isWhitelisted('luasnapper', 'user-1'), true);
v = validateKey({ inputKey: raw2, hwid: 'NEW-HWID', script: 'luasnapper' });
assert.equal(v.code, 'hwid_bound');

// --- delete key revokes ---
const { removed } = deleteUserKey('luasnapper', 'user-1');
assert.equal(removed, true);
v = validateKey({ inputKey: raw2, hwid: 'NEW-HWID', script: 'luasnapper' });
assert.equal(v.code, 'voided');

// --- reset HWID + cooldown ---
const raw3 = makeKey('luasnapper', { claimedBy: 'user-3', duration: 'never' });
validateKey({ inputKey: raw3, hwid: 'H1', script: 'luasnapper' });
let r = resetHwidForUser('user-3', { admin: false });
assert.equal(r.ok, true);
assert.equal(r.reset.length, 1);
assert.ok(getCooldownRemaining('user-3') > 0, 'cooldown set');
r = resetHwidForUser('user-3', { admin: false });
assert.equal(r.ok, false, 'cooldown blocks self reset');
r = resetHwidForUser('user-3', { admin: true });
assert.equal(r.reset.length, 0, 'already unbound');
assert.equal(r.ok, true, 'admin bypasses but still binds cooldown');
resetHwidForUser('user-3', { admin: true, script: 'luasnapper' });

// --- expiry purge ---
const { db } = await import('../src/lib/store.js');
const rawExp = makeKey('luasnapper', { duration: '1d', claimedBy: 'user-4' });
db.keys[rawExp].expiresAt = new Date(Date.now() - 1000).toISOString();
purgeExpired();
assert.equal(isWhitelisted('luasnapper', 'user-4'), false, 'expired entry purged');
assert.equal(validateKey({ inputKey: rawExp, hwid: 'X', script: 'luasnapper' }).code, 'voided');

// --- settings: owner claim + log channel + api token + buyer role ---
const { claimOwner, isBotOwner, setLogChannel, getLogChannelId, ensureApiToken, setBuyerRole, clearBuyerRole, getBuyerRole } = await import('../src/lib/settings.js');

assert.equal(isBotOwner('user-1'), false, 'nobody is owner yet');
let claim = claimOwner('user-1');
assert.equal(claim.ok, true, 'first claim succeeds');
claim = claimOwner('user-2');
assert.equal(claim.ok, false, 'second claim rejected');
assert.equal(isBotOwner('user-1'), true);
assert.equal(isBotOwner('user-2'), false);

setLogChannel('guild-1', 'channel-123');
assert.equal(getLogChannelId('guild-1'), 'channel-123');
assert.equal(getLogChannelId('guild-2'), null, 'per-guild channels');
setLogChannel('guild-1', null);
assert.equal(getLogChannelId('guild-1'), null, 'clear works');

const apiTok = ensureApiToken();
assert.equal(apiTok.token, 'test-token', 'env API_TOKEN takes priority');
assert.equal(apiTok.generated, false);

// --- buyer role ---
setBuyerRole('guild-1', null, 'role-111');
assert.equal(getBuyerRole('guild-1', 'luasnapper'), 'role-111', 'global buyer role');
setBuyerRole('guild-1', 'luasnapper', 'role-222');
assert.equal(getBuyerRole('guild-1', 'luasnapper'), 'role-222', 'per-script overrides global');
assert.equal(getBuyerRole('guild-1', 'other script'), 'role-111', 'fallback to global');
clearBuyerRole('guild-1', 'luasnapper');
assert.equal(getBuyerRole('guild-1', 'luasnapper'), 'role-111', 'cleared per-script');

// --- ticket configuration + persistent open-ticket records ---
const ticketStore = await import('../src/lib/ticketStore.js');
let ticketConfig = ticketStore.setTicketConfig('guild-1', {
  categoryId: 'category-1',
  supportRoleId: 'support-1',
  logChannelId: 'ticket-log-1',
  panelChannelId: 'ticket-panel-1',
  panelMessageId: 'panel-message-1',
  title: 'Help Desk',
  description: 'Open a private support ticket.',
});
assert.equal(ticketConfig.supportRoleId, 'support-1');
assert.equal(ticketStore.getTicketConfig('guild-1').title, 'Help Desk');
assert.equal(ticketStore.takeNextTicketNumber('guild-1'), 1);
assert.equal(ticketStore.takeNextTicketNumber('guild-1'), 2);

ticketStore.createTicketRecord({
  channelId: 'ticket-channel-1',
  guildId: 'guild-1',
  userId: 'ticket-user-1',
  number: 1,
});
assert.equal(
  ticketStore.findOpenTicket('guild-1', 'ticket-user-1').channelId,
  'ticket-channel-1',
  'one open ticket can be found by user'
);
ticketStore.updateTicket('ticket-channel-1', {
  claimedBy: 'staff-1',
  addedUserIds: ['guest-1', 'guest-1'],
});
assert.equal(ticketStore.getTicket('ticket-channel-1').claimedBy, 'staff-1');
assert.deepEqual(ticketStore.getTicket('ticket-channel-1').addedUserIds, ['guest-1']);
assert.equal(ticketStore.removeTicket('ticket-channel-1'), true);
assert.equal(ticketStore.findOpenTicket('guild-1', 'ticket-user-1'), null);

// Reconfiguration keeps ticket numbering monotonic.
ticketConfig = ticketStore.setTicketConfig('guild-1', {
  categoryId: 'category-2',
  supportRoleId: 'support-2',
  logChannelId: 'ticket-log-2',
  panelChannelId: 'ticket-panel-2',
  panelMessageId: 'panel-message-2',
});
assert.equal(ticketConfig.nextNumber, 3);

// --- script upload + protected delivery ---
const store = await import('../src/lib/store.js');
store.db.scriptsources = store.db.scriptsources || {};
store.db.scriptsources['luasnapper'] = {
  name: 'luasnapper',
  source: 'print("hello from protected script")',
  version: 1,
  updatedAt: new Date().toISOString(),
  by: 'admin',
};
const { protectSource } = await import('../src/lib/protect.js');
const protectedSrc = protectSource('print("hi")', { script: 'luasnapper', key: 'LSN-TEST1', hwid: 'H1', endpoint: 'http://localhost:3000' });
assert.ok(protectedSrc.includes('PROTECT-VMAX'), 'preamble markers');
assert.ok(protectedSrc.includes('__V_check()'), 'runtime check included');
assert.ok(protectedSrc.includes('__V_hwid()'), 'runtime HWID detection included');
assert.ok(protectedSrc.includes('print("hi")'), 'original source kept');
assert.ok(protectedSrc.includes('Owner  : Zwoz'), 'credit in wrapped source');

const { buildLoader } = await import('../src/lib/loader.js');
const loader = buildLoader('Vmax', raw3);
assert.ok(loader.includes('-- Protect-Vmax loader — Vmax'), 'loader header');
assert.ok(loader.includes('local key = "'), 'loader key var');
assert.ok(loader.includes('/api/v1/load?script=Vmax&key=" .. key'), 'loader concatenates key');
assert.ok(loader.includes('loadstring(game:HttpGet('), 'loader uses HttpGet');
assert.ok(loader.includes('https://discord-project-production-a058.up.railway.app'), 'loader uses the public host');

// skipHwid lets /load succeed without a device id
const skipKey = makeKey('luasnapper', { claimedBy: 'user-skip', duration: 'never' });
const skip = validateKey({ inputKey: skipKey, script: 'luasnapper', skipHwid: true });
assert.equal(skip.status, 'valid', 'skipHwid accepts a valid key');
assert.ok(['key_ok', 'key_unbound'].includes(skip.code), 'skipHwid code');

// --- API ---
const api = await import('../src/lib/api.js');
const server = api.startApiServer({ user: { tag: 'TestBot#1' } });

function get(path, headers = {}) {
  return fetch(`http://127.0.0.1:${process.env.API_PORT || 3000}${path}`, { headers });
}

let res = await get('/health');
assert.equal(res.status, 200);
assert.equal((await res.json()).ok, true);

// info endpoint
res = await get('/api/v1/info');
assert.equal(res.status, 200);
let infoBody = await res.json();
assert.equal(infoBody.status, 'ok');
assert.equal(infoBody.name, 'Protect-Vmax');
assert.equal(infoBody.credit, 'Zwoz');

// static web landing page & dashboard serving
res = await get('/');
assert.equal(res.status, 200);
let indexHtml = await res.text();
assert.match(indexHtml, /Protect-Vmax/);

res = await get('/dashboard.html');
assert.equal(res.status, 200);
assert.match(await res.text(), /Dashboard/);

res = await get('/auth.js');
assert.equal(res.status, 200);
assert.match(await res.text(), /PVAuth/);

res = await get('/dashboard.js');
assert.equal(res.status, 200);

res = await get('/dashboard.css');
assert.equal(res.status, 200);

res = await get('/styles.css');
assert.equal(res.status, 200);
assert.match(await res.text(), /--bg/);

res = await get('/script.js');
assert.equal(res.status, 200);

res = await get('/favicon.svg');
assert.equal(res.status, 200);

// dashboard user API endpoint
res = await get('/api/user/12345');
assert.equal(res.status, 200);
let userBody = await res.json();
assert.ok(userBody.apiKey.startsWith('VMAX-'));
assert.ok(Array.isArray(userBody.scripts));
assert.ok(userBody.scripts.length >= 1);
assert.equal(userBody.scripts[0].name, 'luasnapper');
assert.equal(userBody.scripts[0].status, 'online');
assert.ok(userBody.scripts[0].hostedUrl.includes('/scripts/hosted/'));

// hosted script delivery: GET /scripts/hosted/:hash.lua
const hostedHash = api.hostHash(userBody.apiKey, 'luasnapper');
res = await get(`/scripts/hosted/${hostedHash}.lua`);
assert.equal(res.status, 200);
assert.equal(res.headers.get('access-control-allow-origin'), '*');
const hostedContent = await res.text();
assert.ok(hostedContent.includes('print("hello from protected script")'));

// OPTIONS /token CORS preflight
res = await fetch(`http://127.0.0.1:${process.env.API_PORT || 3000}/token`, {
  method: 'OPTIONS',
});
assert.equal(res.status, 204);
assert.equal(res.headers.get('access-control-allow-origin'), '*');

// POST /token CORS proxy for Discord OAuth PKCE
const tokenOrigFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const urlStr = String(input instanceof URL ? input : input?.url || input);
  if (urlStr.startsWith('https://discord.com/api/oauth2/token')) {
    return new Response(JSON.stringify({ access_token: 'pkce-token-test', token_type: 'Bearer' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return tokenOrigFetch(input, init);
};
res = await fetch(`http://127.0.0.1:${process.env.API_PORT || 3000}/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'client_id=123&code=abc&grant_type=authorization_code',
});
globalThis.fetch = tokenOrigFetch;
assert.equal(res.status, 200);
assert.equal(res.headers.get('access-control-allow-origin'), '*');
let tokenProxyBody = await res.json();
assert.equal(tokenProxyBody.access_token, 'pkce-token-test');

// healthz endpoint
res = await get('/healthz');
assert.equal(res.status, 200);
assert.equal(await res.text(), 'ok');

// validate is PUBLIC now (scripts call it at runtime without the API token)
res = await get('/api/v1/validate?key=BADKEY&hwid=X&script=luasnapper');
assert.equal(res.status, 403, 'validate is public, returns verdict');
let body = await res.json();
assert.equal(body.code, 'invalid_key');

// status/key still need the token
res = await get('/api/v1/status?user_id=user-9&script=luasnapper');
assert.equal(res.status, 401, 'status requires token');

const rawApi = makeKey('luasnapper', { claimedBy: 'user-9', duration: 'never' });
res = await get(`/api/v1/validate?key=${encodeURIComponent(rawApi)}&hwid=MY-HWID&script=luasnapper`);
assert.equal(res.status, 200);
body = await res.json();
assert.equal(body.code, 'hwid_bound');
assert.equal(body.discord_id, 'user-9');

// load endpoint: valid key returns protected source (HWID not required)
res = await get(`/api/v1/load?script=luasnapper&key=${encodeURIComponent(rawApi)}`);
assert.equal(res.status, 200);
const loaded = await res.text();
assert.ok(loaded.includes('PROTECT-VMAX'), 'load returns protected source');
assert.ok(loaded.includes('print("hello from protected script")'), 'load includes original source');
assert.ok(loaded.includes('Owner  : Zwoz'), 'load credits Zwoz');
assert.ok(loaded.includes('__V_hwid()'), 'load includes runtime HWID detection');

// load endpoint: still serves source even if a different hwid is passed (binding happens at validate time)
res = await get(`/api/v1/load?script=luasnapper&key=${encodeURIComponent(rawApi)}&hwid=OTHER-DEVICE`);
assert.equal(res.status, 200, 'load is key-only; HWID is checked when the script runs');

// validate still rejects a different device
res = await get(`/api/v1/validate?key=${encodeURIComponent(rawApi)}&hwid=OTHER-DEVICE&script=luasnapper`);
assert.equal(res.status, 403);
body = await res.json();
assert.equal(body.code, 'hwid_mismatch');

res = await get(`/api/v1/status?user_id=user-9&script=luasnapper`, {
  Authorization: 'Bearer test-token',
});
body = await res.json();
assert.equal(body.whitelisted, true);
assert.equal(body.entries.length, 1);
assert.equal(body.entries[0].hwid, 'MY-HWID');

// analytics recorded by the API calls above
const { analyticsStats } = await import('../src/lib/analytics.js');
let stats = analyticsStats({ script: 'luasnapper' });
assert.ok(stats.total >= 3, `analytics recorded (got ${stats.total})`);
assert.ok(stats.byCode.hwid_bound >= 1, 'bound event recorded');
assert.ok(stats.byCode.hwid_mismatch >= 1, 'mismatch event recorded');
assert.ok(stats.byDay.length === 7, '7-day buckets');
assert.ok(stats.topKeys.length >= 1, 'top keys computed');
assert.ok(stats.recent[0].hwid.includes('…') || stats.recent[0].hwid.length <= 8, 'hwid masked');

// --- Discord OAuth2 /callback (public — must never hit the API token gate) ---
const { CONFIG } = await import('../src/lib/config.js');
const realFetch = globalThis.fetch;

// 1) Opened directly (no code) -> friendly 400 page, NOT the 401 token error.
res = await get('/callback');
assert.equal(res.status, 400, 'direct /callback visit -> 400 info page');
let page = await res.text();
assert.match(page, /discord login callback/i);
assert.ok(!page.includes('Missing or invalid API token'), 'no token error on /callback');

// 2) Code present but OAuth not configured -> actionable 500 page.
CONFIG.discordClientId = '';
CONFIG.discordClientSecret = '';
CONFIG.oauthRedirectUri = '';
res = await get('/callback?code=abc');
assert.equal(res.status, 500, 'missing config reported');
page = await res.text();
assert.ok(page.includes('DISCORD_CLIENT_SECRET'), 'names the missing env var');
assert.ok(!page.includes('Missing or invalid API token'), 'no token error');

// 3) Configured -> token exchange + identity -> success page.
CONFIG.discordClientId = 'client-123';
CONFIG.discordClientSecret = 'secret-456';
CONFIG.oauthRedirectUri = 'https://bot.example/callback';
let exchanged = null;
globalThis.fetch = async (input, init) => {
  const urlStr = String(input instanceof URL ? input : input?.url || input);
  if (urlStr.startsWith('https://discord.com/api/oauth2/token')) {
    exchanged = Object.fromEntries(new URLSearchParams(init.body));
    return new Response(JSON.stringify({ access_token: 'at-1', token_type: 'Bearer' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }
  if (urlStr === 'https://discord.com/api/users/@me') {
    return new Response(JSON.stringify({ id: '42', username: 'zwoz', global_name: 'Zwoz', avatar: null }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }
  return realFetch(input, init);
};
res = await get('/callback?code=abc');
globalThis.fetch = realFetch;
assert.equal(res.status, 200, 'successful login page');
page = await res.text();
assert.match(page, /Logged in as Zwoz/);
assert.ok(page.includes('42'), 'shows the Discord ID');
assert.ok(!page.includes('secret-456'), 'never leaks the client secret');
assert.equal(exchanged.client_id, 'client-123');
assert.equal(exchanged.client_secret, 'secret-456');
assert.equal(exchanged.grant_type, 'authorization_code');
assert.equal(exchanged.redirect_uri, 'https://bot.example/callback');

// 4) Discord rejects the code -> 502 with the Discord error, still not the 401.
globalThis.fetch = async (input) => {
  const urlStr = String(input instanceof URL ? input : input?.url || input);
  if (urlStr.startsWith('https://discord.com/')) {
    return new Response(JSON.stringify({ error: 'invalid_grant' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
  return realFetch(input);
};
res = await get('/callback?code=abc');
globalThis.fetch = realFetch;
assert.equal(res.status, 502, 'rejected exchange -> 502');
page = await res.text();
assert.match(page, /invalid_grant/);

// 5) The admin token gate is still intact for everything else.
res = await get('/api/v1/status?user_id=user-1');
assert.equal(res.status, 401, 'status still requires the token');
assert.equal((await res.json()).code, 'unauthorized');

server.close();
rmSync(process.env.DATA_DIR, { recursive: true, force: true });
console.log('✅ All smoke tests passed');
