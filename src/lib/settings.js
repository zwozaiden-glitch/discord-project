// Runtime settings stored in data/settings.json:
//   ownerId      — the user who claimed the bot (/claimowner) or was set via OWNER_IDS
//   apiToken     — auto-generated validation API secret (or set via API_TOKEN env)
//   logChannels  — per-guild channel IDs set with /setlog
import { randomBytes } from 'node:crypto';
import { CONFIG } from './config.js';
import { db, save } from './store.js';

export function getStoredOwnerId() {
  return db.settings.ownerId || null;
}

// First person to run /claimowner becomes the owner.
export function claimOwner(userId) {
  const existing = getStoredOwnerId();
  if (existing) return { ok: false, ownerId: existing };
  db.settings.ownerId = String(userId);
  save('settings');
  return { ok: true, ownerId: String(userId) };
}

export function isBotOwner(userId) {
  if (!userId) return false;
  const id = String(userId);
  return CONFIG.ownerIds.includes(id) || db.settings.ownerId === id;
}

// Returns the token from env if set, otherwise the generated one, otherwise null.
export function getApiToken() {
  return CONFIG.apiToken || db.settings.apiToken || null;
}

// Generates and stores a token on first boot so the user always has one.
export function ensureApiToken() {
  const existing = getApiToken();
  if (existing) return { token: existing, generated: false };
  const token = randomBytes(24).toString('base64url');
  db.settings.apiToken = token;
  save('settings');
  return { token, generated: true };
}

export function getLogChannelId(guildId) {
  if (!guildId) return null;
  return db.settings.logChannels?.[String(guildId)] || null;
}

export function setLogChannel(guildId, channelId) {
  if (!guildId) return false;
  db.settings.logChannels = db.settings.logChannels || {};
  if (channelId) db.settings.logChannels[String(guildId)] = String(channelId);
  else delete db.settings.logChannels[String(guildId)];
  save('settings');
  return true;
}

// ---- Auto buyer role (assigned on redeem/whitelist) ----
// Stored as "guildId" -> roleId (applies to every script) or
// "guildId:script" -> roleId (applies to one script only).

export function getBuyerRole(guildId, script) {
  if (!guildId) return null;
  const g = String(guildId);
  return (
    db.settings.buyerRoles?.[`${g}:${script}`] ||
    db.settings.buyerRoles?.[g] ||
    null
  );
}

export function setBuyerRole(guildId, script, roleId) {
  if (!guildId) return false;
  db.settings.buyerRoles = db.settings.buyerRoles || {};
  db.settings.buyerRoles[script ? `${guildId}:${script}` : String(guildId)] = String(roleId);
  save('settings');
  return true;
}

export function clearBuyerRole(guildId, script) {
  if (!guildId) return false;
  db.settings.buyerRoles = db.settings.buyerRoles || {};
  delete db.settings.buyerRoles[script ? `${guildId}:${script}` : String(guildId)];
  save('settings');
  return true;
}
