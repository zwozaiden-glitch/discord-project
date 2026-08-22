// Smoke test for the key system — run with: DATA_DIR=<tmp> node scripts/smoke-test.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'keysys-'));
process.env.API_TOKEN = 'test-token';
process.env.KEY_PREFIX = 'LSN';

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

// --- settings: owner claim + log channel + api token ---
const { claimOwner, isBotOwner, setLogChannel, getLogChannelId, ensureApiToken } = await import('../src/lib/settings.js');

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

// --- API ---
const api = await import('../src/lib/api.js');
const server = api.startApiServer({ user: { tag: 'TestBot#1' } });

function get(path, headers = {}) {
  return fetch(`http://127.0.0.1:${process.env.API_PORT || 3000}${path}`, { headers });
}

let res = await get('/health');
assert.equal(res.status, 200);
assert.equal((await res.json()).ok, true);

res = await get('/api/v1/validate?key=BADKEY&hwid=X&script=luasnapper');
assert.equal(res.status, 401, 'api token required');

res = await get('/api/v1/validate?key=BADKEY&hwid=X&script=luasnapper', { Authorization: 'Bearer test-token' });
assert.equal(res.status, 403);
let body = await res.json();
assert.equal(body.code, 'invalid_key');

const rawApi = makeKey('luasnapper', { claimedBy: 'user-9', duration: 'never' });
res = await get(`/api/v1/validate?key=${encodeURIComponent(rawApi)}&hwid=MY-HWID&script=luasnapper`, {
  Authorization: 'Bearer test-token',
});
assert.equal(res.status, 200);
body = await res.json();
assert.equal(body.code, 'hwid_bound');
assert.equal(body.discord_id, 'user-9');

res = await get(`/api/v1/status?user_id=user-9&script=luasnapper`, {
  Authorization: 'Bearer test-token',
});
body = await res.json();
assert.equal(body.whitelisted, true);
assert.equal(body.entries.length, 1);
assert.equal(body.entries[0].hwid, 'MY-HWID');

server.close();
rmSync(process.env.DATA_DIR, { recursive: true, force: true });
console.log('✅ All smoke tests passed');
