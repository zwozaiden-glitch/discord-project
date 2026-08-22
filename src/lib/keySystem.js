// Core key/whitelist logic shared by commands, panels and the HTTP API.
import { CONFIG } from './config.js';
import { db, save } from './store.js';
import { generateRawKey, formatKey, normalizeKey } from './keys.js';

function now() {
  return Date.now();
}

function nowIso() {
  return new Date(now()).toISOString();
}

function assertScriptName(name) {
  if (!CONFIG.scriptNamePattern.test(String(name || '').trim())) {
    throw new Error('Script name may only contain letters, numbers, spaces, "_" and "-" (max 50 chars).');
  }
}

const DURATIONS = {
  '1d': 24 * 3600e3,
  '3d': 3 * 24 * 3600e3,
  '7d': 7 * 24 * 3600e3,
  '30d': 30 * 24 * 3600e3,
};

export function durationMs(duration) {
  if (!duration || duration === 'never') return null;
  if (DURATIONS[duration]) return DURATIONS[duration];
  throw new Error('Invalid duration. Use one of: 1d, 3d, 7d, 30d, never.');
}

// ---------------------------------------------------------------------------
// Scripts
// ---------------------------------------------------------------------------

export async function ensureScript(name) {
  assertScriptName(name);
  const script = String(name).trim();
  if (!db.scripts[script]) {
    db.scripts[script] = { name: script, createdAt: nowIso() };
    save('scripts');
  }
  return db.scripts[script];
}

export function getScript(name) {
  return db.scripts[String(name || '').trim()];
}

export function listScripts() {
  return Object.values(db.scripts).sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

export function makeKey(script, { duration = 'never', createdBy = null, claimedBy = null, dropped = false, persist = true } = {}) {
  let raw;
  do {
    raw = generateRawKey();
  } while (db.keys[raw]); // collisions are astronomically unlikely; be safe anyway

  const expiresAt = durationMs(duration);
  db.keys[raw] = {
    raw,
    script,
    createdAt: nowIso(),
    createdBy,
    expiresAt: expiresAt ? new Date(now() + expiresAt).toISOString() : null,
    claimedBy,
    claimedAt: claimedBy ? nowIso() : null,
    hwid: null,
    hwidBoundAt: null,
    voided: false,
    dropped,
  };

  let clearedBlacklist = false;
  if (claimedBy) {
    db.whitelist[`${script}:${claimedBy}`] = {
      key: raw,
      userId: claimedBy,
      script,
      addedAt: nowIso(),
    };
    // An explicit admin grant overrides any previous blacklist.
    const blKey = `${script}:${claimedBy}`;
    if (db.blacklist[blKey]) {
      delete db.blacklist[blKey];
      clearedBlacklist = true;
    }
  }

  if (persist) {
    save('keys');
    if (claimedBy) save('whitelist');
    if (clearedBlacklist) save('blacklist');
  }
  return raw;
}

export function generateKeys(script, amount, options = {}) {
  const rawKeys = [];
  for (let i = 0; i < amount; i += 1) rawKeys.push(makeKey(script, { ...options, persist: false }));
  save('keys');
  if (options.claimedBy) save('whitelist');
  return rawKeys;
}

// Flush in-memory key/whitelist/blacklist writes after a persist:false batch.
export function persistKeyState() {
  save('keys');
  save('whitelist');
  save('blacklist');
}

export function getKeyRecord(rawOrFormatted) {
  const raw = normalizeKey(rawOrFormatted);
  if (!raw) return null;
  return db.keys[raw] || null;
}

function unclaimUnused(raw) {
  const rec = db.keys[raw];
  if (rec && !rec.claimedBy) {
    delete db.keys[raw];
    save('keys');
    return true;
  }
  return false;
}

// Claim a key for a user (used by /redeem and the panel modal).
// Pass expectedScript to reject keys that belong to a different script.
export function claimKey(input, userId, expectedScript = null) {
  const raw = normalizeKey(input);
  if (!raw) return { ok: false, reason: 'invalid' };
  const rec = db.keys[raw];
  if (!rec) return { ok: false, reason: 'not_found' };
  if (expectedScript && rec.script !== expectedScript) {
    return { ok: false, reason: 'wrong_script', script: rec.script };
  }

  if (rec.voided) return { ok: false, reason: 'voided' };
  if (rec.expiresAt && Date.parse(rec.expiresAt) < now()) return { ok: false, reason: 'expired' };
  if (rec.claimedBy && rec.claimedBy !== userId) return { ok: false, reason: 'claimed' };

  const prev = db.whitelist[`${rec.script}:${userId}`];
  if (prev && prev.key !== raw) {
    // Replacing an old key: revoke it.
    if (db.keys[prev.key]) db.keys[prev.key].voided = true;
  }

  rec.claimedBy = userId;
  rec.claimedAt = nowIso();
  db.whitelist[`${rec.script}:${userId}`] = { key: raw, userId, script: rec.script, addedAt: nowIso() };

  save('keys');
  save('whitelist');
  return { ok: true, raw, record: rec };
}

export function getUserWhitelist(userId, script = null) {
  return Object.values(db.whitelist)
    .filter((e) => e.userId === String(userId) && (!script || e.script === script))
    .sort((a, b) => a.script.localeCompare(b.script));
}

export function isWhitelisted(script, userId) {
  return Boolean(db.whitelist[`${script}:${userId}`]);
}

export function isBlacklisted(script, userId) {
  return Boolean(db.blacklist[`${script}:${userId}`]);
}

function addBlacklist(script, userId, reason, by) {
  db.blacklist[`${script}:${userId}`] = {
    userId: String(userId),
    script,
    reason: String(reason || 'No reason provided').slice(0, 500),
    by: String(by || 'unknown'),
    at: nowIso(),
  };
  save('blacklist');
}

// ---- per-user deletion (used by /deletekey, /blacklist, /resethwid) ----

export function revokeEntry(script, userId) {
  const entry = db.whitelist[`${script}:${userId}`];
  if (!entry) return { removed: false, raw: null };
  if (db.keys[entry.key]) db.keys[entry.key].voided = true;
  delete db.whitelist[`${script}:${userId}`];
  save('keys');
  save('whitelist');
  return { removed: true, raw: entry.key, record: db.keys[entry.key] };
}

export function deleteUserKey(script, userId) {
  return revokeEntry(script, String(userId));
}

export function blacklistUser(script, userId, { reason, by }) {
  const before = db.whitelist[`${script}:${userId}`];
  const revoked = revokeEntry(script, String(userId));
  addBlacklist(script, userId, reason, by);
  return { ...revoked, wasWhitelisted: Boolean(before) };
}

export function unblacklistUser(script, userId) {
  const key = `${script}:${userId}`;
  if (!db.blacklist[key]) return false;
  delete db.blacklist[key];
  save('blacklist');
  return true;
}

export function isKeyExpired(record) {
  return Boolean(record?.expiresAt && Date.parse(record.expiresAt) < now());
}

// ---- HWID ----

function currentHwid(script, userId) {
  const entry = db.whitelist[`${script}:${userId}`];
  return entry ? db.keys[entry.key]?.hwid || null : null;
}

function isExpiringSoon(record) {
  if (!record?.expiresAt) return false;
  const msLeft = Date.parse(record.expiresAt) - now();
  return msLeft > 0 && msLeft < 24 * 3600e3;
}

const HWID_PATTERN = /^[A-Za-z0-9\-_.:]{1,256}$/;

// Called by the HTTP API / panel redeem. Binds the key to the user's HWID on
// first validation. Later validations must present the same HWID.
export function validateKey({ inputKey, hwid, script, ip = null, skipHwid = false }) {
  const raw = normalizeKey(inputKey);
  if (!raw) return { status: 'invalid', code: 'invalid_key', message: 'Invalid key format.' };
  const rec = db.keys[raw];
  if (!rec) return { status: 'invalid', code: 'key_not_found', message: 'Key not found.' };
  if (script && rec.script !== script) {
    return { status: 'invalid', code: 'wrong_script', message: `This key belongs to "${rec.script}".` };
  }
  if (!rec.claimedBy) return { status: 'invalid', code: 'unclaimed', message: 'This key has not been claimed by a Discord user yet.' };

  const userId = rec.claimedBy;
  // Blacklist check comes first so scripts can show the real reason even when
  // the user's key was revoked at the same time.
  if (isBlacklisted(rec.script, userId)) {
    return {
      status: 'invalid',
      code: 'blacklisted',
      message: 'You are blacklisted from this script.',
      script: rec.script,
      discord_id: userId,
    };
  }
  if (rec.voided) return { status: 'invalid', code: 'voided', message: 'This key has been revoked.' };
  if (isKeyExpired(rec)) return { status: 'invalid', code: 'expired', message: 'This key has expired.' };

  const bindingKey = `${rec.script}:${userId}`;
  if (!db.whitelist[bindingKey] || db.whitelist[bindingKey].key !== raw) {
    return {
      status: 'invalid',
      code: 'not_whitelisted',
      message: 'This user is not whitelisted for this script.',
      script: rec.script,
      discord_id: userId,
    };
  }

  // /api/v1/load only needs a valid key — HWID is bound later by the wrapped script.
  if (skipHwid) {
    return {
      status: 'valid',
      code: rec.hwid ? 'key_ok' : 'key_unbound',
      message: 'Key is valid.',
      script: rec.script,
      discord_id: userId,
      key: formatKey(raw),
      hwid: rec.hwid,
      hwid_mismatched: false,
      expiry_renewed: false,
      expires_at: rec.expiresAt,
      server_time: nowIso(),
      ip,
    };
  }

  const suppliedHwid = String(hwid || '').trim();
  if (!HWID_PATTERN.test(suppliedHwid)) {
    return { status: 'invalid', code: 'missing_hwid', message: 'A valid HWID is required.' };
  }

  const bound = rec.hwid;
  let code = 'hwid_ok';
  let message = 'Key is valid.';
  let event = null;

  if (!bound) {
    rec.hwid = suppliedHwid;
    rec.hwidBoundAt = nowIso();
    save('keys');
    code = 'hwid_bound';
    message = 'Key is valid and bound to this device (HWID) for the first time.';
    event = 'hwid_bound';
  } else if (bound !== suppliedHwid) {
    return {
      status: 'invalid',
      code: 'hwid_mismatch',
      message: 'This key is bound to a different device (HWID).',
      script: rec.script,
      discord_id: userId,
      key: formatKey(raw),
    };
  }

  const result = {
    status: 'valid',
    code,
    message,
    script: rec.script,
    discord_id: userId,
    key: formatKey(raw),
    hwid: rec.hwid,
    hwid_mismatched: false,
    expiry_renewed: false,
    expires_at: rec.expiresAt,
    server_time: nowIso(),
    ip,
  };

  if (isExpiringSoon(rec)) {
    // Renew expiring keys on active use (so legit users don't lose access).
    rec.expiresAt = new Date(now() + 7 * 24 * 3600e3).toISOString();
    save('keys');
    result.expiry_renewed = true;
    result.expires_at = rec.expiresAt;
    event = event || 'renewed';
  }

  if (event) result.event = event;
  return result;
}

// ---- HWID reset ----

export function getCooldownRemaining(userId) {
  const until = db.cooldowns[String(userId)];
  if (!until) return 0;
  const remaining = until - now();
  return remaining > 0 ? remaining : 0;
}

export function resetHwidForUser(userId, { script = null, admin = false } = {}) {
  userId = String(userId);
  if (!admin) {
    const remaining = getCooldownRemaining(userId);
    if (remaining > 0) {
      return {
        ok: false,
        cooldownMs: remaining,
        reset: [],
      };
    }
  }

  const reset = [];
  for (const entry of Object.values(db.whitelist)) {
    if (entry.userId !== userId) continue;
    if (script && entry.script !== script) continue;
    const rec = db.keys[entry.key];
    if (rec && rec.hwid) {
      rec.hwid = null;
      rec.hwidBoundAt = null;
      reset.push({ script: entry.script, key: entry.key, raw: entry.key });
    }
  }
  save('keys');
  db.cooldowns[userId] = now() + CONFIG.resetCooldownDays * 24 * 3600e3;
  save('cooldowns');
  return { ok: true, cooldownMs: CONFIG.resetCooldownDays * 24 * 3600e3, reset };
}

// ---- Cleanup ----

// Voids expired keys and removes their whitelist entries. Called on startup.
export function purgeExpired() {
  let changedKeys = false;
  let changedWhitelist = false;
  for (const [raw, rec] of Object.entries(db.keys)) {
    if (isKeyExpired(rec)) {
      rec.voided = true;
      changedKeys = true;
    }
  }
  for (const [id, entry] of Object.entries(db.whitelist)) {
    const rec = db.keys[entry.key];
    if (!rec || rec.voided) {
      delete db.whitelist[id];
      changedWhitelist = true;
    }
  }
  if (changedKeys) save('keys');
  if (changedWhitelist) save('whitelist');
}
