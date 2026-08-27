// Central place for environment-based configuration.

function positiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function boundedInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function idList(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Auto-detect Railway domain if PUBLIC_URL is not explicitly set
function resolvePublicUrl() {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.trim().replace(/\/+$/, '');
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`.replace(/\/+$/, '');
  if (process.env.RAILWAY_STATIC_URL) return `https://${process.env.RAILWAY_STATIC_URL}`.replace(/\/+$/, '');
  return 'https://discord-project-production-a058.up.railway.app';
}

const publicUrl = resolvePublicUrl();
const discordClientId = (process.env.DISCORD_CLIENT_ID || process.env.CLIENT_ID || '').trim();
const discordClientSecret = (process.env.DISCORD_CLIENT_SECRET || '').trim();
const oauthRedirectUri = (
  process.env.DISCORD_OAUTH_REDIRECT_URI ||
  (publicUrl ? `${publicUrl}/callback` : '')
).trim();
const websiteUrl = (process.env.WEBSITE_URL || publicUrl || '/').trim();

export const CONFIG = {
  // Optional pre-claim: users who are treated as the bot owner, comma-separated.
  // Otherwise the first user to run /claimowner becomes the owner.
  ownerIds: idList(process.env.OWNER_IDS),

  // Key format: PREFIX-XXXXX-XXXXX-XXXXX (PREFIX from env, default LSN)
  keyPrefix: (process.env.KEY_PREFIX || 'LSN').toUpperCase().trim(),

  // Users can only reset their HWID once every N days (admins bypass this).
  resetCooldownDays: positiveNumber(process.env.RESET_COOLDOWN_DAYS, 7),

  // HTTP validation API & web server port (Railway sets PORT)
  apiToken: (process.env.API_TOKEN || '').trim(),
  apiPort: positiveNumber(process.env.PORT || process.env.API_PORT, 3000),

  // Public URL of the bot (Railway domain) — used for loadstrings / script URLs.
  publicUrl,

  // Discord OAuth2 & Web site integration
  discordClientId,
  discordClientSecret,
  oauthRedirectUri,
  websiteUrl,

  // Credit shown on panels/scripts (default Zwoz).
  creditName: (process.env.CREDIT_NAME || 'Zwoz').trim(),

  // Seconds of countdown before a /keydrop reveals the keys (3-60).
  dropCountdown: Math.min(Math.max(positiveNumber(process.env.KEYDROP_COUNTDOWN, 10), 3), 60),

  // Optional footer link shown on panels/success embeds.
  supportUrl: (process.env.SUPPORT_URL || '').trim(),

  // Discord attachment forwarding system.
  forwarder: {
    webhookMaxFileSizeBytes: boundedInteger(process.env.FORWARDER_WEBHOOK_MAX_MB, 8, { min: 1, max: 100 }) * 1024 * 1024,
    downloadTimeoutMs: boundedInteger(process.env.FORWARDER_DOWNLOAD_TIMEOUT_MS, 20000, { min: 5000, max: 120000 }),
    historyLimit: boundedInteger(process.env.FORWARDER_HISTORY_LIMIT, 10000, { min: 100, max: 50000 }),
    logLimit: boundedInteger(process.env.FORWARDER_LOG_LIMIT, 2000, { min: 100, max: 10000 }),
    dashboardManagerIds: idList(process.env.FORWARDER_DASHBOARD_USER_IDS),
  },

  // Names of scripts may only contain these characters.
  scriptNamePattern: /^[a-z0-9 _-]{1,50}$/,
};
