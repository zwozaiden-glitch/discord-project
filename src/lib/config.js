// Central place for environment-based configuration.

function positiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function idList(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const publicUrl = (process.env.PUBLIC_URL || '').trim();

export const CONFIG = {
  // Optional pre-claim: users who are treated as the bot owner, comma-separated.
  // Otherwise the first user to run /claimowner becomes the owner.
  ownerIds: idList(process.env.OWNER_IDS),

  // Key format: PREFIX-XXXXX-XXXXX-XXXXX (PREFIX from env, default LSN)
  keyPrefix: (process.env.KEY_PREFIX || 'LSN').toUpperCase().trim(),

  // Users can only reset their HWID once every N days (admins bypass this).
  resetCooldownDays: positiveNumber(process.env.RESET_COOLDOWN_DAYS, 7),

  // HTTP validation API
  apiToken: (process.env.API_TOKEN || '').trim(),
  apiPort: positiveNumber(process.env.API_PORT || process.env.PORT, 3000),

  // Public URL of the bot (Railway domain) — used for loadstrings / script URLs.
  // Falls back to the current production host so loaders work even if PUBLIC_URL is unset.
  publicUrl: (process.env.PUBLIC_URL || 'https://discord-project-production-a058.up.railway.app').trim().replace(/\/+$/, ''),

  // Credit shown on panels/scripts (default Zwoz).
  creditName: (process.env.CREDIT_NAME || 'Zwoz').trim(),

  // Channel where important events are logged is set per-server via /setlog
  // (stored in data/settings.json).

  // Seconds of countdown before a /keydrop reveals the keys (3-60).
  dropCountdown: Math.min(Math.max(positiveNumber(process.env.KEYDROP_COUNTDOWN, 10), 3), 60),

  // Optional footer link shown on panels/success embeds.
  supportUrl: (process.env.SUPPORT_URL || '').trim(),

  // Names of scripts may only contain these characters.
  scriptNamePattern: /^[a-z0-9 _-]{1,50}$/,
};
