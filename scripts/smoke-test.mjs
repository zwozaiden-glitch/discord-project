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

// --- slash command loading/schema validation ---
const { Collection } = await import('discord.js');
const { loadCommandModules } = await import('../src/lib/commandSync.js');
const commandCollection = new Collection();
const commandModules = await loadCommandModules(commandCollection);
for (const command of commandModules) command.data.toJSON();
assert.equal(commandModules.length, 29, 'all slash commands load');
assert.ok(commandCollection.has('rolesetup'));
assert.ok(commandCollection.has('clear'));
assert.ok(commandCollection.has('features'));
assert.ok(commandCollection.has('ticketsetup'));
assert.ok(commandCollection.has('ticket'));
assert.ok(commandCollection.has('deobf'));
assert.ok(commandCollection.has('forward'));
assert.ok(commandCollection.has('envlog'));
const { FEATURES } = await import('../src/commands/features.js');
const { ROLE_PRESET, formatRoleName } = await import('../src/commands/rolesetup.js');
assert.equal(FEATURES.length, 28, '/features keeps the promised short feature list');
assert.equal(ROLE_PRESET.length, 13, '/rolesetup keeps the promised 13-role preset');
assert.ok(ROLE_PRESET.some((role) => role.name === 'Staff'));
assert.ok(ROLE_PRESET.some((role) => role.name === 'Member'));
assert.equal(formatRoleName('Member', '  Vmax  '), 'Member Vmax');

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
const {
  claimOwner,
  isBotOwner,
  setLogChannel,
  getLogChannelId,
  ensureApiToken,
  setBuyerRole,
  clearBuyerRole,
  getBuyerRole,
  setServerRoles,
  getServerRoles,
} = await import('../src/lib/settings.js');

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

// --- server role preset IDs ---
setServerRoles('guild-1', {
  Admin: 'role-admin',
  Support: 'role-support',
  Buyer: 'role-buyer',
  Empty: null,
});
assert.deepEqual(getServerRoles('guild-1'), {
  Admin: 'role-admin',
  Support: 'role-support',
  Buyer: 'role-buyer',
});
const roleSnapshot = getServerRoles('guild-1');
roleSnapshot.Admin = 'changed-only-in-copy';
assert.equal(getServerRoles('guild-1').Admin, 'role-admin', 'role settings return a safe copy');

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

const { buildLoader, mintLoaderToken, getLoaderRecord } = await import('../src/lib/loader.js');
const loader = buildLoader('Vmax', raw3);
assert.match(loader, /^loadstring\(game:HttpGet\("/, 'one-line loader');
assert.ok(loader.includes('/s/'), 'short /s/ token path');
assert.ok(loader.endsWith('))()'), 'loader invokes loadstring');
assert.ok(loader.includes('https://discord-project-production-a058.up.railway.app'), 'loader uses the public host');
assert.ok(!loader.includes('\n'), 'loader is a single line');
const minted = mintLoaderToken('Vmax', raw3);
assert.equal(getLoaderRecord(minted).script, 'Vmax');
assert.ok(loader.includes(minted), 'loader URL uses the minted token');


// --- deobfuscator detect + generic cleanup ---
const deobf = await import('../src/lib/deobfuscator.js');
const moon = deobf.detectObfuscator('-- This file was protected with MoonSec V3\nreturn 1');
assert.equal(moon.best.id, 'moonsecv3', 'detects MoonSec V3 banner');
const wrd = deobf.deobfuscate('print(string.char(72,105))\nloadstring("print(1)")()', 'wearedevs');
assert.ok(wrd.output.includes("'Hi'") || wrd.output.includes('print(1)'), 'folds string.char / unwraps loadstring');
const envSrc = deobf.envLoggerSource();
assert.ok(envSrc.includes('getsenv'), 'env logger dumps getsenv');
assert.ok(envSrc.includes('FilePath'), 'env logger documents FilePath');

const { addForward, listForwards, removeForward, isWebhookUrl, isSnowflake } = await import('../src/lib/forward.js');
assert.equal(isSnowflake('123456789012345678'), true);
assert.equal(isWebhookUrl('https://discord.com/api/webhooks/1/abc'), true);
const fwd = addForward({
  guildId: 'guild-1',
  sourceChannelId: '111',
  destUserId: 'user-1',
  createdBy: 'user-1',
});
assert.equal(listForwards('guild-1').length, 1);
assert.equal(listForwards('guild-1', { userId: 'user-1' }).length, 1);
assert.equal(removeForward(fwd.id), true);

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

// Dashboard data is private. A valid Discord bearer from the previous browser
// flow remains supported during migration to the signed HttpOnly session.
res = await get('/api/user/12345');
assert.equal(res.status, 401, 'dashboard API rejects anonymous requests');
const dashboardRealFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const urlStr = String(input instanceof URL ? input : input?.url || input);
  if (urlStr === 'https://discord.com/api/users/@me') {
    return new Response(JSON.stringify({ id: '12345', username: 'tester', global_name: 'Tester' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return dashboardRealFetch(input, init);
};
res = await get('/api/user/12345', { Authorization: 'Bearer legacy-browser-token' });
globalThis.fetch = dashboardRealFetch;
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

// The old open OAuth token proxy is gone; the backend now performs the
// exchange itself so Discord access tokens never enter browser JavaScript.
res = await fetch(`http://127.0.0.1:${process.env.API_PORT || 3000}/token`, {
  method: 'POST',
});
assert.equal(res.status, 405);

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


// short GitHub-raw style loader: GET /s/<token>.lua
const shortToken = mintLoaderToken('luasnapper', rawApi);
res = await get(`/s/${shortToken}.lua`);
assert.equal(res.status, 200, 'short /s/token.lua serves protected source');
const shortLoaded = await res.text();
assert.ok(shortLoaded.includes('PROTECT-VMAX'), 'short loader is protected');
assert.ok(shortLoaded.includes('print("hello from protected script")'));
res = await get(`/raw/${shortToken}.lua`);
assert.equal(res.status, 200, 'github-style /raw/token.lua works too');

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

// --- Discord OAuth2 flow (public — must never hit the API token gate) ---
const { CONFIG } = await import('../src/lib/config.js');
const realFetch = globalThis.fetch;
const localBase = `http://127.0.0.1:${process.env.API_PORT || 3000}`;

// 1) /callback is not a website page. Direct visits explain that clearly.
res = await get('/callback');
assert.equal(res.status, 400, 'direct /callback visit -> 400 info page');
let page = await res.text();
assert.match(page, /OAuth return endpoint/i);
assert.match(page, /not the website homepage/i);
assert.ok(!page.includes('Missing or invalid API token'), 'no token error on /callback');

// 2) Missing OAuth variables produce an actionable page.
CONFIG.discordClientId = '';
CONFIG.discordClientSecret = '';
CONFIG.oauthRedirectUri = '';
res = await get('/auth/discord');
assert.equal(res.status, 500, 'missing config reported');
page = await res.text();
assert.ok(page.includes('DISCORD_CLIENT_SECRET'), 'names the missing env var');

// 3) Configured login starts at /auth/discord with a state cookie and the exact
// callback URI shown in deploy logs.
CONFIG.discordClientId = 'client-123';
CONFIG.discordClientSecret = 'secret-456';
CONFIG.oauthRedirectUri = 'https://bot.example/callback';
res = await fetch(`${localBase}/auth/discord`, { redirect: 'manual' });
assert.equal(res.status, 302);
const authorizeLocation = new URL(res.headers.get('location'));
assert.equal(authorizeLocation.origin, 'https://discord.com');
assert.equal(authorizeLocation.searchParams.get('client_id'), 'client-123');
assert.equal(authorizeLocation.searchParams.get('redirect_uri'), 'https://bot.example/callback');
const oauthState = authorizeLocation.searchParams.get('state');
const stateCookie = (res.headers.get('set-cookie') || '').split(';')[0];
assert.ok(oauthState && stateCookie.startsWith('pv_oauth_state='));

// A callback without the matching browser state is rejected before exchange.
res = await get('/callback?code=abc&state=wrong');
assert.equal(res.status, 400, 'invalid OAuth state rejected');

let exchanged = null;
globalThis.fetch = async (input, init) => {
  const urlStr = String(input instanceof URL ? input : input?.url || input);
  if (urlStr.startsWith('https://discord.com/api/oauth2/token')) {
    exchanged = Object.fromEntries(new URLSearchParams(init.body));
    return new Response(JSON.stringify({
      access_token: 'at-1', token_type: 'Bearer', expires_in: 3600,
    }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }
  if (urlStr === 'https://discord.com/api/users/@me') {
    return new Response(JSON.stringify({
      id: '42', username: 'zwoz', global_name: 'Zwoz', avatar: null,
    }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }
  return realFetch(input, init);
};
res = await realFetch(`${localBase}/callback?code=abc&state=${encodeURIComponent(oauthState)}`, {
  headers: { Cookie: stateCookie },
  redirect: 'manual',
});
globalThis.fetch = realFetch;
assert.equal(res.status, 302, 'successful login redirects to dashboard');
assert.match(res.headers.get('location'), /dashboard\.html$/);
const callbackCookies = res.headers.get('set-cookie') || '';
const sessionMatch = callbackCookies.match(/pv_session=([^;,]+)/);
assert.ok(sessionMatch, 'callback sets signed HttpOnly session');
assert.ok(/HttpOnly/i.test(callbackCookies));
assert.equal(exchanged.client_id, 'client-123');
assert.equal(exchanged.client_secret, 'secret-456');
assert.equal(exchanged.grant_type, 'authorization_code');
assert.equal(exchanged.redirect_uri, 'https://bot.example/callback');

const sessionCookie = `pv_session=${sessionMatch[1]}`;
res = await get('/api/auth/session', { Cookie: sessionCookie });
assert.equal(res.status, 200);
let webSession = await res.json();
assert.equal(webSession.authenticated, true);
assert.equal(webSession.user.id, '42');
assert.equal(webSession.user.global_name, 'Zwoz');

res = await get('/api/user/42', { Cookie: sessionCookie });
assert.equal(res.status, 200, 'signed website session opens its dashboard');
res = await get('/api/user/999', { Cookie: sessionCookie });
assert.equal(res.status, 403, 'signed website session cannot open another dashboard');

// Logout invalidates the browser cookie.
res = await fetch(`${localBase}/auth/logout`, {
  method: 'POST',
  headers: { Cookie: sessionCookie },
});
assert.equal(res.status, 204);
assert.match(res.headers.get('set-cookie') || '', /Max-Age=0/);

// 4) Discord token failures still produce a useful callback error.
res = await fetch(`${localBase}/auth/discord`, { redirect: 'manual' });
const retryLocation = new URL(res.headers.get('location'));
const retryState = retryLocation.searchParams.get('state');
const retryCookie = (res.headers.get('set-cookie') || '').split(';')[0];
globalThis.fetch = async (input) => {
  const urlStr = String(input instanceof URL ? input : input?.url || input);
  if (urlStr.startsWith('https://discord.com/')) {
    return new Response(JSON.stringify({ error: 'invalid_grant' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
  return realFetch(input);
};
res = await realFetch(`${localBase}/callback?code=bad&state=${encodeURIComponent(retryState)}`, {
  headers: { Cookie: retryCookie },
});
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
