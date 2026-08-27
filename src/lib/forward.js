import { AttachmentBuilder, WebhookClient } from 'discord.js';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { CONFIG } from './config.js';
import { db, save } from './store.js';
import { isBotOwner } from './settings.js';

const WEBHOOK_RE = /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+/i;
const SNOWFLAKE_RE = /^\d{17,20}$/;
const DEFAULT_TYPES = ['all'];
const FILES_PER_MESSAGE = 10;
const HISTORY_LIMIT = CONFIG.forwarder.historyLimit;
const LOG_LIMIT = CONFIG.forwarder.logLimit;
const DEFAULT_MAX_FILE_SIZE_BYTES = CONFIG.forwarder.webhookMaxFileSizeBytes;
const FORWARDER_EMBED_COLOR = 0x5865f2;

export const SUPPORTED_FORWARD_TYPES = [
  'all',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'svg',
  'mp4',
  'mov',
  'webm',
  'pdf',
  'zip',
  'rar',
  '7z',
  'txt',
  'json',
  'csv',
  'log',
  'md',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'image/*',
  'video/*',
  'text/*',
  'application/pdf',
  'application/zip',
  'application/json',
];

const BLOCKED_EXTENSIONS = new Set([
  'apk',
  'app',
  'bat',
  'cmd',
  'com',
  'cpl',
  'dll',
  'dmg',
  'exe',
  'gadget',
  'hta',
  'inf1',
  'ins',
  'isp',
  'jar',
  'js',
  'jse',
  'lnk',
  'msc',
  'msi',
  'msp',
  'mst',
  'pif',
  'ps1',
  'reg',
  'scr',
  'sct',
  'sh',
  'sys',
  'vb',
  'vbe',
  'vbs',
  'ws',
  'wsf',
  'wsh',
]);

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'webm']);
const TEXT_EXTENSIONS = new Set(['txt', 'json', 'csv', 'log', 'md']);
const DOCUMENT_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx']);
const ARCHIVE_EXTENSIONS = new Set(['zip', 'rar', '7z']);

function ensureCollections() {
  if (!db.forwards || Array.isArray(db.forwards)) db.forwards = {};
  if (!db.forwardhistory || Array.isArray(db.forwardhistory)) db.forwardhistory = {};
  if (!Array.isArray(db.forwardlogs)) db.forwardlogs = [];
}

ensureCollections();

function persistForwardState() {
  save('forwards');
  save('forwardhistory');
  save('forwardlogs');
}

function isoNow() {
  return new Date().toISOString();
}

function safeString(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function hashSha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function encryptionKey() {
  const source =
    safeString(process.env.FORWARDER_SECRET_KEY) ||
    safeString(process.env.DISCORD_TOKEN) ||
    safeString(process.env.DISCORD_CLIENT_SECRET);
  return source ? createHash('sha256').update(source).digest() : null;
}

function encryptSecret(secret) {
  if (!secret) return null;
  const key = encryptionKey();
  if (!key) return secret;

  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

function decryptSecret(secret) {
  if (!secret) return null;
  if (!String(secret).startsWith('enc:')) return String(secret);
  const key = encryptionKey();
  if (!key) throw new Error('Webhook encryption key is unavailable in this runtime.');

  const [, ivRaw, tagRaw, encryptedRaw] = String(secret).split(':');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivRaw, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, 'base64url')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

function redactWebhookUrl(value) {
  const raw = String(value || '');
  const match = raw.match(/\/api\/webhooks\/(\d+)\/([\w-]+)/i);
  if (!match) return 'webhook';
  const [, id, token] = match;
  return `webhook:${id}/${token.slice(0, 4)}…${token.slice(-4)}`;
}

function consoleLine(level, text) {
  if (level === 'error') console.error(text);
  else if (level === 'warn') console.warn(text);
  else console.log(text);
}

function pushLog(entry, { persist = true } = {}) {
  ensureCollections();
  db.forwardlogs.unshift(entry);
  if (db.forwardlogs.length > LOG_LIMIT) db.forwardlogs.length = LOG_LIMIT;
  if (persist) save('forwardlogs');
  const badge = entry.level === 'error' ? '❌' : entry.level === 'warn' ? '⚠️' : '✅';
  consoleLine(entry.level, `[forward] ${badge} ${entry.message}`);
}

function recordHistory(key, entry, { persist = true } = {}) {
  ensureCollections();
  db.forwardhistory[key] = entry;
  const keys = Object.keys(db.forwardhistory);
  if (keys.length > HISTORY_LIMIT) {
    keys
      .sort((a, b) => (Date.parse(db.forwardhistory[b]?.updatedAt || 0) || 0) - (Date.parse(db.forwardhistory[a]?.updatedAt || 0) || 0))
      .slice(HISTORY_LIMIT)
      .forEach((staleKey) => {
        delete db.forwardhistory[staleKey];
      });
  }
  if (persist) save('forwardhistory');
}

function cleanId(value) {
  return String(value || '').replace(/[<#>]/g, '').trim();
}

function safeFilename(name, fallback = 'attachment.bin') {
  return safeString(name, fallback).replace(/[\\/\u0000-\u001f]+/g, '_').slice(0, 120);
}

function extensionOf(name = '', contentType = '') {
  const filename = safeFilename(name).toLowerCase();
  const dot = filename.lastIndexOf('.');
  if (dot > -1 && dot < filename.length - 1) return filename.slice(dot + 1);
  const subtype = String(contentType || '').toLowerCase().split('/')[1] || '';
  return subtype.split(';')[0].trim();
}

function categoryOfExtension(ext = '', contentType = '') {
  const normalized = String(ext || '').toLowerCase();
  const mime = String(contentType || '').toLowerCase();
  if (IMAGE_EXTENSIONS.has(normalized) || mime.startsWith('image/')) return 'image';
  if (VIDEO_EXTENSIONS.has(normalized) || mime.startsWith('video/')) return 'video';
  if (TEXT_EXTENSIONS.has(normalized) || mime.startsWith('text/') || mime === 'application/json') return 'text';
  if (DOCUMENT_EXTENSIONS.has(normalized) || mime === 'application/pdf') return 'document';
  if (ARCHIVE_EXTENSIONS.has(normalized) || mime.includes('zip') || mime.includes('compressed')) return 'archive';
  return 'other';
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatTypesForDisplay(types = []) {
  if (!types.length || types.includes('all')) return 'all safe types';
  return types.join(', ');
}

function maxSizeBytesFromInput(value) {
  if (value == null || value === '') return DEFAULT_MAX_FILE_SIZE_BYTES;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return DEFAULT_MAX_FILE_SIZE_BYTES;
  return Math.floor(numeric);
}

function normalizeAllowedFileTypes(value) {
  const list = Array.isArray(value)
    ? value
    : String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
  if (!list.length) return [...DEFAULT_TYPES];

  const normalized = [...new Set(list.map((item) => String(item).toLowerCase().replace(/^\./, '')))];
  if (normalized.includes('*') || normalized.includes('all')) return [...DEFAULT_TYPES];
  return normalized.filter((item) => SUPPORTED_FORWARD_TYPES.includes(item) || /^[a-z0-9*+.-/]+$/i.test(item));
}

function sanitizeEmbeds(embeds = []) {
  return embeds
    .slice(0, 9)
    .map((embed) => (typeof embed?.toJSON === 'function' ? embed.toJSON() : embed?.data || embed || null))
    .filter(Boolean)
    .map((embed) => ({
      title: safeString(embed.title).slice(0, 256) || undefined,
      description: safeString(embed.description).slice(0, 4096) || undefined,
      url: safeString(embed.url) || undefined,
      color: Number.isFinite(embed.color) ? embed.color : undefined,
      timestamp: safeString(embed.timestamp) || undefined,
      footer: embed.footer?.text ? { text: safeString(embed.footer.text).slice(0, 2048) } : undefined,
      image: embed.image?.url ? { url: embed.image.url } : undefined,
      thumbnail: embed.thumbnail?.url ? { url: embed.thumbnail.url } : undefined,
      author: embed.author?.name
        ? {
            name: safeString(embed.author.name).slice(0, 256),
            url: safeString(embed.author.url) || undefined,
            icon_url: safeString(embed.author.icon_url) || undefined,
          }
        : undefined,
      fields: Array.isArray(embed.fields)
        ? embed.fields
            .slice(0, 25)
            .map((field) => ({
              name: safeString(field.name).slice(0, 256) || 'Field',
              value: safeString(field.value).slice(0, 1024) || '—',
              inline: Boolean(field.inline),
            }))
        : undefined,
    }));
}

function createRuleStats() {
  return {
    forwardedCount: 0,
    imageCount: 0,
    videoCount: 0,
    documentCount: 0,
    archiveCount: 0,
    textCount: 0,
    otherCount: 0,
    failedCount: 0,
    duplicateCount: 0,
    oversizedCount: 0,
    lastForwardedAt: null,
    lastFailedAt: null,
    lastDuplicateAt: null,
  };
}

function normalizeRule(rule) {
  const normalized = {
    ...rule,
    id: safeString(rule.id),
    guildId: safeString(rule.guildId || rule.sourceGuildId),
    sourceGuildId: safeString(rule.sourceGuildId || rule.guildId),
    sourceGuildName: safeString(rule.sourceGuildName),
    sourceChannelId: safeString(rule.sourceChannelId),
    sourceChannelName: safeString(rule.sourceChannelName),
    destinationType:
      safeString(rule.destinationType) ||
      (rule.destWebhook ? 'webhook' : rule.destUserId ? 'user' : rule.destChannelId ? 'channel' : ''),
    destChannelId: safeString(rule.destChannelId || rule.destinationChannelId),
    destinationChannelId: safeString(rule.destinationChannelId || rule.destChannelId),
    destUserId: safeString(rule.destUserId),
    destinationGuildId: safeString(rule.destinationGuildId),
    destinationGuildName: safeString(rule.destinationGuildName),
    destinationChannelName: safeString(rule.destinationChannelName),
    destWebhook: safeString(rule.destWebhook),
    createdBy: safeString(rule.createdBy),
    updatedBy: safeString(rule.updatedBy || rule.createdBy),
    createdAt: safeString(rule.createdAt) || isoNow(),
    updatedAt: safeString(rule.updatedAt) || safeString(rule.createdAt) || isoNow(),
    enabled: rule.enabled !== false,
    allowedFileTypes: normalizeAllowedFileTypes(rule.allowedFileTypes),
    maxFileSizeBytes: maxSizeBytesFromInput(rule.maxFileSizeBytes),
    forwardText: rule.forwardText !== false,
    forwardEmbeds: Boolean(rule.forwardEmbeds),
    showAuthor: rule.showAuthor !== false,
    forwarded: Number(rule.forwarded || rule.stats?.forwardedCount || 0),
    stats: {
      ...createRuleStats(),
      ...(rule.stats || {}),
      forwardedCount: Number(rule.stats?.forwardedCount || rule.forwarded || 0),
      failedCount: Number(rule.stats?.failedCount || 0),
      duplicateCount: Number(rule.stats?.duplicateCount || 0),
      oversizedCount: Number(rule.stats?.oversizedCount || 0),
    },
  };

  normalized.forwarded = normalized.stats.forwardedCount;
  normalized.destWebhookRedacted = normalized.destWebhook ? redactWebhookUrl(decryptSecretSafe(normalized.destWebhook)) : null;
  return normalized;
}

function normalizeRulesInStore() {
  ensureCollections();
  for (const [id, rule] of Object.entries(db.forwards)) {
    db.forwards[id] = normalizeRule({ ...rule, id });
  }
}

normalizeRulesInStore();

function decryptSecretSafe(secret) {
  try {
    return decryptSecret(secret);
  } catch {
    return null;
  }
}

function snapshotRule(rule) {
  const normalized = normalizeRule(rule);
  return {
    id: normalized.id,
    guildId: normalized.guildId,
    sourceGuildId: normalized.sourceGuildId,
    sourceGuildName: normalized.sourceGuildName,
    sourceChannelId: normalized.sourceChannelId,
    sourceChannelName: normalized.sourceChannelName,
    destinationType: normalized.destinationType,
    destChannelId: normalized.destChannelId || null,
    destinationChannelId: normalized.destinationChannelId || null,
    destUserId: normalized.destUserId || null,
    destinationGuildId: normalized.destinationGuildId || null,
    destinationGuildName: normalized.destinationGuildName || null,
    destinationChannelName: normalized.destinationChannelName || null,
    destWebhookRedacted: normalized.destWebhookRedacted || null,
    enabled: normalized.enabled,
    allowedFileTypes: [...normalized.allowedFileTypes],
    maxFileSizeBytes: normalized.maxFileSizeBytes,
    maxFileSizeLabel: formatBytes(normalized.maxFileSizeBytes),
    forwardText: normalized.forwardText,
    forwardEmbeds: normalized.forwardEmbeds,
    showAuthor: normalized.showAuthor,
    createdBy: normalized.createdBy,
    updatedBy: normalized.updatedBy,
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt,
    stats: { ...normalized.stats },
  };
}

function isAllowedFileType(rule, filename, contentType) {
  const allowed = normalizeAllowedFileTypes(rule.allowedFileTypes);
  const ext = extensionOf(filename, contentType);
  if (BLOCKED_EXTENSIONS.has(ext)) return false;
  if (!allowed.length || allowed.includes('all')) return true;

  const mime = String(contentType || '').toLowerCase();
  return (
    allowed.includes(ext) ||
    allowed.includes(mime) ||
    (mime.startsWith('image/') && allowed.includes('image/*')) ||
    (mime.startsWith('video/') && allowed.includes('video/*')) ||
    (mime.startsWith('text/') && allowed.includes('text/*'))
  );
}

function destinationKey({ destChannelId, destinationChannelId, destWebhook, destinationType, destUserId }) {
  if ((destinationType || '').toLowerCase() === 'webhook') {
    const raw = decryptSecretSafe(destWebhook) || String(destWebhook || '');
    return `webhook:${hashSha256(raw)}`;
  }
  if ((destinationType || '').toLowerCase() === 'user') {
    return `user:${safeString(destUserId)}`;
  }
  return `channel:${safeString(destChannelId || destinationChannelId)}`;
}

function findMatchingRule({ guildId, sourceChannelId, destinationType, destChannelId, destinationChannelId, destWebhook, destUserId }) {
  const targetKey = destinationKey({ destinationType, destChannelId, destinationChannelId, destWebhook, destUserId });
  return Object.values(db.forwards)
    .map((rule) => normalizeRule(rule))
    .find(
      (rule) =>
        rule.guildId === safeString(guildId) &&
        rule.sourceChannelId === safeString(sourceChannelId) &&
        destinationKey(rule) === targetKey,
    );
}

function nextRuleId() {
  return `fwd_${randomBytes(4).toString('hex')}`;
}

function upsertRule(rule, { persist = true } = {}) {
  const normalized = normalizeRule(rule);
  db.forwards[normalized.id] = normalized;
  if (persist) save('forwards');
  return normalized;
}

function trackRuleEvent(rule, field, whenField = null, { persist = false } = {}) {
  const normalized = normalizeRule(rule);
  normalized.stats[field] = Number(normalized.stats[field] || 0) + 1;
  if (whenField) normalized.stats[whenField] = isoNow();
  if (field === 'forwardedCount') normalized.forwarded = normalized.stats.forwardedCount;
  db.forwards[normalized.id] = normalized;
  if (persist) save('forwards');
  return normalized;
}

function createDedupeKey(ruleId, messageId, partId) {
  return `${ruleId}:${messageId}:${partId}`;
}

function historySummaryForAttachment(attachment, prepared = null) {
  return {
    attachmentId: safeString(attachment?.id),
    attachmentName: safeFilename(attachment?.name || prepared?.filename || 'attachment.bin'),
    contentType: safeString(prepared?.contentType || attachment?.contentType),
    sizeBytes: Number(prepared?.sizeBytes ?? attachment?.size ?? 0),
    sizeLabel: formatBytes(Number(prepared?.sizeBytes ?? attachment?.size ?? 0)),
    category: prepared?.category || categoryOfExtension(extensionOf(attachment?.name, attachment?.contentType), attachment?.contentType),
  };
}

function messageTextContent(message, rule, skipped = []) {
  const parts = [];
  if (rule.forwardText && safeString(message.content)) parts.push(message.content.slice(0, 1500));
  if (skipped.length) {
    const note = skipped
      .slice(0, 6)
      .map((item) => `${item.name} (${item.reason})`)
      .join(', ');
    parts.push(`⚠️ Skipped: ${note}`.slice(0, 500));
  }
  return parts.join('\n\n').slice(0, 1900);
}

function metadataEmbed(message, rule, files = [], skipped = []) {
  const authorName = message.author?.tag || message.author?.username || 'Unknown user';
  const sourceChannel = message.channel?.name ? `#${message.channel.name}` : rule.sourceChannelName || rule.sourceChannelId;
  const sourceGuild = message.guild?.name || rule.sourceGuildName || rule.sourceGuildId || 'Unknown server';
  const fileLines = files
    .slice(0, 10)
    .map((file) => `• ${file.filename} · ${file.category} · ${formatBytes(file.sizeBytes)}`)
    .join('\n');
  const skippedLines = skipped
    .slice(0, 5)
    .map((item) => `• ${item.name} · ${item.reason}`)
    .join('\n');

  return {
    color: FORWARDER_EMBED_COLOR,
    title: files.length ? `Forwarded ${files.length} attachment${files.length === 1 ? '' : 's'}` : 'Forwarded message',
    description:
      !rule.forwardText && safeString(message.content)
        ? `Original caption hidden by rule settings (${message.content.length} characters).`
        : undefined,
    author: rule.showAuthor
      ? {
          name: authorName.slice(0, 256),
          icon_url: message.author?.displayAvatarURL?.({ extension: 'png', size: 128 }) || undefined,
        }
      : undefined,
    fields: [
      { name: 'Source', value: `${sourceGuild}\n${sourceChannel}`.slice(0, 1024), inline: true },
      { name: 'Rule', value: `\`${rule.id}\``, inline: true },
      ...(files.length ? [{ name: 'Files', value: fileLines.slice(0, 1024), inline: false }] : []),
      ...(skipped.length ? [{ name: 'Skipped', value: skippedLines.slice(0, 1024), inline: false }] : []),
    ],
    footer: { text: `Message ${message.id}` },
    timestamp: new Date(message.createdTimestamp || Date.now()).toISOString(),
  };
}

function attachmentBuilders(files = []) {
  return files.map((file) => new AttachmentBuilder(file.buffer, { name: file.filename }));
}

function chunk(array, size) {
  const output = [];
  for (let index = 0; index < array.length; index += size) {
    output.push(array.slice(index, index + size));
  }
  return output;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendWebhookWithRetry(webhook, payload) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await webhook.send(payload);
    } catch (error) {
      const retryAfter = Number(error?.rawError?.retry_after || error?.data?.retry_after || 0);
      if (attempt === 0 && retryAfter > 0) {
        await sleep(Math.min(Math.ceil(retryAfter * 1000), 5000));
        continue;
      }
      throw error;
    }
  }
  return null;
}

async function sendToDestination(client, rule, payload, metaMessage = null) {
  if (rule.destinationType === 'webhook') {
    const webhookUrl = decryptSecret(rule.destWebhook);
    const webhook = new WebhookClient({ url: webhookUrl });
    await sendWebhookWithRetry(webhook, {
      ...payload,
      username: rule.showAuthor ? (messageAuthorName(metaMessage) || 'VMax Forwarder').slice(0, 80) : 'VMax Forwarder',
      avatarURL: rule.showAuthor
        ? metaMessage?.author?.displayAvatarURL?.({ extension: 'png', size: 128 }) || undefined
        : undefined,
    });
    return { ok: true };
  }

  if (rule.destinationType === 'user') {
    const user = await client.users.fetch(rule.destUserId).catch(() => null);
    if (!user) {
      return { ok: false, code: 'destination_unreachable', detail: 'Destination user could not be reached.' };
    }
    await user.send(payload);
    return { ok: true };
  }

  const dest = await client.channels.fetch(rule.destinationChannelId || rule.destChannelId).catch(() => null);
  if (!dest?.isTextBased?.() || typeof dest.send !== 'function') {
    return { ok: false, code: 'destination_unreachable', detail: 'Destination channel is missing or not text-based.' };
  }
  await dest.send(payload);
  return { ok: true };
}

function messageAuthorName(message) {
  return message?.member?.displayName || message?.author?.globalName || message?.author?.tag || message?.author?.username || 'Unknown user';
}

async function downloadAttachment(rule, attachment) {
  const filename = safeFilename(attachment.name || 'attachment.bin');
  const ext = extensionOf(filename, attachment.contentType);
  const maxBytes = Math.min(Number(rule.maxFileSizeBytes || DEFAULT_MAX_FILE_SIZE_BYTES), DEFAULT_MAX_FILE_SIZE_BYTES || Number.MAX_SAFE_INTEGER);

  if (!isAllowedFileType(rule, filename, attachment.contentType)) {
    return {
      ok: false,
      code: 'blocked_type',
      reason: 'File type is not allowed by this rule.',
      filename,
      sizeBytes: Number(attachment.size || 0),
      category: categoryOfExtension(ext, attachment.contentType),
    };
  }

  if (Number(attachment.size || 0) > maxBytes) {
    return {
      ok: false,
      code: 'oversized',
      reason: `File exceeds the ${formatBytes(maxBytes)} rule limit.`,
      filename,
      sizeBytes: Number(attachment.size || 0),
      category: categoryOfExtension(ext, attachment.contentType),
    };
  }

  let response;
  try {
    response = await fetch(attachment.url, {
      signal: AbortSignal.timeout(CONFIG.forwarder.downloadTimeoutMs),
      headers: { 'User-Agent': 'VMax-Forwarder/1.0' },
    });
  } catch (error) {
    return {
      ok: false,
      code: 'download_error',
      reason: `Attachment download failed: ${error.message}`,
      filename,
      sizeBytes: Number(attachment.size || 0),
      category: categoryOfExtension(ext, attachment.contentType),
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      code: 'download_error',
      reason: `Discord returned HTTP ${response.status} while downloading the attachment.`,
      filename,
      sizeBytes: Number(attachment.size || 0),
      category: categoryOfExtension(ext, attachment.contentType),
    };
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxBytes) {
    return {
      ok: false,
      code: 'oversized',
      reason: `Downloaded file exceeds the ${formatBytes(maxBytes)} rule limit.`,
      filename,
      sizeBytes: buffer.length,
      category: categoryOfExtension(ext, attachment.contentType),
    };
  }

  return {
    ok: true,
    filename,
    sizeBytes: buffer.length,
    buffer,
    checksum: hashSha256(buffer),
    ext,
    contentType: safeString(response.headers.get('content-type') || attachment.contentType),
    category: categoryOfExtension(ext, response.headers.get('content-type') || attachment.contentType),
  };
}

function logConfigChange(rule, action, actorId) {
  pushLog({
    id: `log_${randomBytes(6).toString('hex')}`,
    level: 'info',
    code: `rule_${action}`,
    message: `${action === 'created' ? 'Configured' : action === 'deleted' ? 'Removed' : 'Updated'} rule ${rule.id} (${rule.sourceChannelName || rule.sourceChannelId} → ${describeDest(rule)})`,
    ruleId: rule.id,
    actorId: safeString(actorId),
    guildId: rule.guildId,
    sourceChannelId: rule.sourceChannelId,
    destinationType: rule.destinationType,
    createdAt: isoNow(),
  });
}

export function isWebhookUrl(value) {
  return WEBHOOK_RE.test(String(value || '').trim());
}

export function isSnowflake(value) {
  return SNOWFLAKE_RE.test(cleanId(value));
}

export function listForwards(guildId = null, { userId = null, admin = false } = {}) {
  ensureCollections();
  let rules = Object.values(db.forwards).map((rule) => normalizeRule(rule));
  if (guildId) rules = rules.filter((rule) => rule.guildId === safeString(guildId));
  if (!admin && userId) rules = rules.filter((rule) => rule.createdBy === safeString(userId));
  return rules.sort((left, right) => (right.createdAt || '').localeCompare(left.createdAt || ''));
}

export function getForward(id) {
  ensureCollections();
  const rule = db.forwards[safeString(id)];
  return rule ? normalizeRule(rule) : null;
}

export function getForwardSnapshot(id) {
  const rule = getForward(id);
  return rule ? snapshotRule(rule) : null;
}

export function addForward(input) {
  ensureCollections();
  const destinationType = safeString(input.destinationType) || (input.destWebhook ? 'webhook' : input.destUserId ? 'user' : 'channel');
  const existing = findMatchingRule({
    guildId: input.guildId || input.sourceGuildId,
    sourceChannelId: input.sourceChannelId,
    destinationType,
    destinationChannelId: input.destinationChannelId || input.destChannelId,
    destChannelId: input.destChannelId || input.destinationChannelId,
    destWebhook: input.destWebhook,
    destUserId: input.destUserId,
  });
  if (existing) {
    const updatedExisting = upsertRule({
      ...existing,
      sourceGuildName: safeString(input.sourceGuildName || existing.sourceGuildName),
      sourceChannelName: safeString(input.sourceChannelName || existing.sourceChannelName),
      destinationGuildId: safeString(input.destinationGuildId || existing.destinationGuildId),
      destinationGuildName: safeString(input.destinationGuildName || existing.destinationGuildName),
      destinationChannelName: safeString(input.destinationChannelName || existing.destinationChannelName),
      allowedFileTypes: normalizeAllowedFileTypes(input.allowedFileTypes || existing.allowedFileTypes),
      maxFileSizeBytes: maxSizeBytesFromInput(input.maxFileSizeBytes || existing.maxFileSizeBytes),
      forwardText: input.forwardText ?? existing.forwardText,
      forwardEmbeds: input.forwardEmbeds ?? existing.forwardEmbeds,
      showAuthor: input.showAuthor ?? existing.showAuthor,
      enabled: input.enabled ?? existing.enabled,
      updatedBy: safeString(input.updatedBy || input.createdBy || existing.updatedBy),
      updatedAt: isoNow(),
    });
    logConfigChange(updatedExisting, 'updated', input.updatedBy || input.createdBy || existing.updatedBy);
    return updatedExisting;
  }

  const rule = upsertRule({
    id: nextRuleId(),
    guildId: safeString(input.guildId || input.sourceGuildId),
    sourceGuildId: safeString(input.sourceGuildId || input.guildId),
    sourceGuildName: safeString(input.sourceGuildName),
    sourceChannelId: safeString(input.sourceChannelId),
    sourceChannelName: safeString(input.sourceChannelName),
    destinationType,
    destinationChannelId: safeString(input.destinationChannelId || input.destChannelId),
    destChannelId: safeString(input.destChannelId || input.destinationChannelId),
    destUserId: safeString(input.destUserId),
    destinationGuildId: safeString(input.destinationGuildId),
    destinationGuildName: safeString(input.destinationGuildName),
    destinationChannelName: safeString(input.destinationChannelName),
    destWebhook: input.destWebhook ? encryptSecret(String(input.destWebhook).trim()) : null,
    enabled: input.enabled !== false,
    allowedFileTypes: normalizeAllowedFileTypes(input.allowedFileTypes),
    maxFileSizeBytes: maxSizeBytesFromInput(input.maxFileSizeBytes),
    forwardText: input.forwardText !== false,
    forwardEmbeds: Boolean(input.forwardEmbeds),
    showAuthor: input.showAuthor !== false,
    createdBy: safeString(input.createdBy),
    updatedBy: safeString(input.updatedBy || input.createdBy),
    createdAt: isoNow(),
    updatedAt: isoNow(),
    stats: createRuleStats(),
  });

  logConfigChange(rule, 'created', input.createdBy);
  return rule;
}

export function removeForward(id, actorId = null) {
  ensureCollections();
  const existing = getForward(id);
  if (!existing) return false;
  delete db.forwards[existing.id];
  save('forwards');
  logConfigChange(existing, 'deleted', actorId);
  return true;
}

export function setForwardEnabled(id, enabled, actorId = null) {
  const rule = getForward(id);
  if (!rule) return null;
  const updated = upsertRule({
    ...rule,
    enabled: Boolean(enabled),
    updatedBy: safeString(actorId || rule.updatedBy || rule.createdBy),
    updatedAt: isoNow(),
  });
  logConfigChange(updated, enabled ? 'enabled' : 'disabled', actorId);
  return updated;
}

export function describeDest(rule) {
  const normalized = normalizeRule(rule);
  if (normalized.destinationType === 'webhook') {
    return normalized.destWebhookRedacted || 'webhook';
  }
  if (normalized.destinationType === 'user') {
    return normalized.destUserId ? `DM:${normalized.destUserId}` : 'DM';
  }
  const channelName = normalized.destinationChannelName || normalized.destinationChannelId || normalized.destChannelId;
  const guildName = normalized.destinationGuildName ? ` (${normalized.destinationGuildName})` : '';
  return `${channelName}${guildName}`;
}

export function maskWebhookUrl(value) {
  return redactWebhookUrl(value);
}

export function getForwardLogs(limit = 100) {
  ensureCollections();
  return db.forwardlogs.slice(0, Math.max(1, Math.min(Number(limit) || 100, LOG_LIMIT))).map((entry) => ({ ...entry }));
}

export function getForwardHistory(limit = 100) {
  ensureCollections();
  return Object.values(db.forwardhistory)
    .sort((left, right) => (right.updatedAt || '').localeCompare(left.updatedAt || ''))
    .slice(0, Math.max(1, Math.min(Number(limit) || 100, HISTORY_LIMIT)))
    .map((entry) => ({ ...entry }));
}

export function getForwardStatsSummary() {
  const rules = listForwards();
  const activeRules = rules.filter((rule) => rule.enabled).length;
  const stats = rules.reduce(
    (summary, rule) => {
      summary.totalRules += 1;
      summary.activeRules = activeRules;
      summary.filesForwarded += Number(rule.stats.forwardedCount || 0);
      summary.imagesForwarded += Number(rule.stats.imageCount || 0);
      summary.videosForwarded += Number(rule.stats.videoCount || 0);
      summary.documentsForwarded += Number(rule.stats.documentCount || 0);
      summary.failedTransfers += Number(rule.stats.failedCount || 0);
      summary.duplicateCount += Number(rule.stats.duplicateCount || 0);
      summary.oversizedCount += Number(rule.stats.oversizedCount || 0);
      const candidates = [rule.stats.lastForwardedAt, rule.stats.lastFailedAt, summary.lastActivityAt].filter(Boolean).sort();
      summary.lastActivityAt = candidates[candidates.length - 1] || summary.lastActivityAt;
      return summary;
    },
    {
      totalRules: 0,
      activeRules: 0,
      filesForwarded: 0,
      imagesForwarded: 0,
      videosForwarded: 0,
      documentsForwarded: 0,
      failedTransfers: 0,
      duplicateCount: 0,
      oversizedCount: 0,
      lastActivityAt: null,
    },
  );
  return stats;
}

export function getForwardStatus(client = null) {
  const summary = getForwardStatsSummary();
  const lastError = getForwardLogs(50).find((entry) => entry.level === 'error') || null;
  return {
    ok: true,
    botConnected: Boolean(client?.user),
    botTag: client?.user?.tag || null,
    activeRules: summary.activeRules,
    totalRules: summary.totalRules,
    filesForwarded: summary.filesForwarded,
    failedTransfers: summary.failedTransfers,
    duplicatesBlocked: summary.duplicateCount,
    oversizedBlocked: summary.oversizedCount,
    lastActivityAt: summary.lastActivityAt,
    lastError,
  };
}

export function getForwardRulesForDashboard() {
  return listForwards().map((rule) => snapshotRule(rule));
}

export function isDashboardManager(userId) {
  const id = safeString(userId);
  return Boolean(id && (isBotOwner(id) || CONFIG.forwarder.dashboardManagerIds.includes(id)));
}

export async function sendForwardTest(ruleId, client, actorId = 'dashboard') {
  const rule = getForward(ruleId);
  if (!rule) throw new Error('Rule not found.');

  const content = `VMax Forwarder test message\n\nRule: ${rule.id}\nSent: ${new Date().toLocaleString('en-GB', { hour12: false })}`;
  const file = new AttachmentBuilder(Buffer.from(content, 'utf8'), { name: 'vmax-forwarder-test.txt' });

  const payload = {
    content: '🧪 VMax Forwarder test delivery',
    embeds: [
      {
        color: FORWARDER_EMBED_COLOR,
        title: 'Forwarding test successful',
        description: 'This message confirms that the destination accepted a forwarded payload from VMax Forwarder.',
        fields: [
          { name: 'Rule', value: `\`${rule.id}\``, inline: true },
          { name: 'Destination', value: describeDest(rule).slice(0, 1024), inline: true },
          { name: 'Triggered by', value: safeString(actorId).slice(0, 1024) || 'unknown', inline: false },
        ],
        timestamp: isoNow(),
      },
    ],
    files: [file],
    allowedMentions: { parse: [] },
  };

  const result = await sendToDestination(client, rule, payload, null);
  if (!result.ok) throw new Error(result.detail || result.code || 'Test send failed.');

  pushLog({
    id: `log_${randomBytes(6).toString('hex')}`,
    level: 'info',
    code: 'test_send',
    message: `Sent test payload for rule ${rule.id} → ${describeDest(rule)}`,
    ruleId: rule.id,
    actorId: safeString(actorId),
    createdAt: isoNow(),
  });
  return true;
}

function shouldProcessMessage(message, rule) {
  const attachmentCount = message.attachments?.size || 0;
  const hasText = Boolean(rule.forwardText && safeString(message.content));
  const hasEmbeds = Boolean(rule.forwardEmbeds && (message.embeds?.length || 0));
  return attachmentCount > 0 || hasText || hasEmbeds;
}

function sourceRulesForMessage(message) {
  return Object.values(db.forwards)
    .map((rule) => normalizeRule(rule))
    .filter((rule) => rule.enabled && rule.sourceChannelId === message.channelId);
}

function historyRecordBase(rule, message) {
  return {
    ruleId: rule.id,
    guildId: rule.guildId,
    sourceGuildId: rule.sourceGuildId,
    sourceGuildName: message.guild?.name || rule.sourceGuildName,
    sourceChannelId: message.channelId,
    sourceChannelName: message.channel?.name || rule.sourceChannelName,
    messageId: message.id,
    authorId: message.author?.id || null,
    authorName: messageAuthorName(message),
    destinationType: rule.destinationType,
    destination: describeDest(rule),
  };
}

async function forwardRuleMessage(rule, message) {
  const attachments = [...(message.attachments?.values?.() || [])];
  const baseHistory = historyRecordBase(rule, message);
  const prepared = [];
  const skipped = [];
  let stateChanged = false;

  for (const attachment of attachments) {
    const partId = safeString(attachment.id) || hashSha256(`${attachment.url}|${attachment.name}|${attachment.size}`);
    const dedupeKey = createDedupeKey(rule.id, message.id, partId);
    const prior = db.forwardhistory[dedupeKey];
    if (prior) {
      trackRuleEvent(rule, 'duplicateCount');
      rule = getForward(rule.id) || rule;
      skipped.push({ name: attachment.name || 'attachment', reason: 'duplicate' });
      recordHistory(
        dedupeKey,
        {
          ...prior,
          updatedAt: isoNow(),
          duplicateAttempts: Number(prior.duplicateAttempts || 0) + 1,
        },
        { persist: false },
      );
      pushLog(
        {
          id: `log_${randomBytes(6).toString('hex')}`,
          level: 'warn',
          code: 'duplicate',
          message: `Skipped duplicate ${attachment.name || 'attachment'} from ${baseHistory.sourceChannelName || baseHistory.sourceChannelId} for rule ${rule.id}`,
          ...baseHistory,
          attachmentId: attachment.id,
          attachmentName: attachment.name || 'attachment',
          createdAt: isoNow(),
        },
        { persist: false },
      );
      stateChanged = true;
      continue;
    }

    const downloaded = await downloadAttachment(rule, attachment);
    if (!downloaded.ok) {
      const statField = downloaded.code === 'oversized' ? 'oversizedCount' : 'failedCount';
      trackRuleEvent(rule, statField, downloaded.code === 'oversized' ? null : 'lastFailedAt');
      rule = getForward(rule.id) || rule;
      skipped.push({ name: downloaded.filename, reason: downloaded.code === 'oversized' ? 'too large' : downloaded.reason });
      recordHistory(
        dedupeKey,
        {
          ...baseHistory,
          ...historySummaryForAttachment(attachment, downloaded),
          status: downloaded.code === 'oversized' ? 'oversized' : 'failed',
          reason: downloaded.reason,
          updatedAt: isoNow(),
        },
        { persist: false },
      );
      pushLog(
        {
          id: `log_${randomBytes(6).toString('hex')}`,
          level: downloaded.code === 'oversized' ? 'warn' : 'error',
          code: downloaded.code,
          message:
            downloaded.code === 'oversized'
              ? `Blocked oversized ${downloaded.filename} (${formatBytes(downloaded.sizeBytes)}) for rule ${rule.id}`
              : `Failed to download ${downloaded.filename} for rule ${rule.id}: ${downloaded.reason}`,
          ...baseHistory,
          attachmentId: attachment.id,
          attachmentName: downloaded.filename,
          createdAt: isoNow(),
        },
        { persist: false },
      );
      stateChanged = true;
      continue;
    }

    prepared.push({ ...downloaded, attachmentId: attachment.id, dedupeKey, original: attachment });
  }

  const textContent = messageTextContent(message, rule, skipped);
  const metadata = metadataEmbed(message, rule, prepared, skipped);
  const originalEmbeds = rule.forwardEmbeds ? sanitizeEmbeds(message.embeds || []) : [];

  const filesByChunk = chunk(prepared, FILES_PER_MESSAGE);
  const needsPayload = filesByChunk.length > 0 || textContent || originalEmbeds.length > 0 || skipped.length > 0;
  if (!needsPayload) {
    if (stateChanged) persistForwardState();
    return;
  }

  if (!filesByChunk.length) filesByChunk.push([]);

  try {
    for (let index = 0; index < filesByChunk.length; index += 1) {
      const fileChunk = filesByChunk[index];
      const payload = {
        content:
          index === 0
            ? textContent || undefined
            : `Continued forwarded attachments (${index + 1}/${filesByChunk.length})`,
        embeds: index === 0 ? [metadata, ...originalEmbeds].slice(0, 10) : [],
        files: attachmentBuilders(fileChunk),
        allowedMentions: { parse: [] },
      };
      const result = await sendToDestination(message.client, rule, payload, message);
      if (!result.ok) throw new Error(result.detail || result.code || 'Destination send failed.');
    }

    for (const file of prepared) {
      recordHistory(
        file.dedupeKey,
        {
          ...baseHistory,
          ...historySummaryForAttachment(file.original, file),
          checksum: file.checksum,
          status: 'forwarded',
          updatedAt: isoNow(),
        },
        { persist: false },
      );
      trackRuleEvent(rule, 'forwardedCount');
      trackRuleEvent(rule, `${file.category}Count`);
      rule = getForward(rule.id) || rule;
    }

    if (!prepared.length && (textContent || originalEmbeds.length || skipped.length)) {
      const textKey = createDedupeKey(rule.id, message.id, textContent ? 'text' : 'embed');
      if (!db.forwardhistory[textKey]) {
        recordHistory(
          textKey,
          {
            ...baseHistory,
            status: 'forwarded',
            attachmentId: null,
            attachmentName: null,
            contentType: textContent ? 'text/plain' : 'discord/embed',
            sizeBytes: 0,
            sizeLabel: '0 B',
            category: textContent ? 'text' : 'other',
            updatedAt: isoNow(),
          },
          { persist: false },
        );
      }
      if (textContent) {
        trackRuleEvent(rule, 'textCount');
      } else {
        trackRuleEvent(rule, 'otherCount');
      }
      rule = getForward(rule.id) || rule;
    }

    const fileNameSummary = prepared.length ? prepared.map((item) => item.filename).slice(0, 3).join(', ') : 'message payload';
    pushLog(
      {
        id: `log_${randomBytes(6).toString('hex')}`,
        level: 'info',
        code: 'forward_success',
        message: `Forwarded ${fileNameSummary} from ${baseHistory.sourceChannelName || baseHistory.sourceChannelId} → ${describeDest(rule)}`,
        ...baseHistory,
        createdAt: isoNow(),
      },
      { persist: false },
    );
    stateChanged = true;
  } catch (error) {
    trackRuleEvent(rule, 'failedCount', 'lastFailedAt');
    rule = getForward(rule.id) || rule;
    pushLog(
      {
        id: `log_${randomBytes(6).toString('hex')}`,
        level: 'error',
        code: 'destination_error',
        message: `Forward failed for rule ${rule.id}: ${error.message}`,
        ...baseHistory,
        createdAt: isoNow(),
      },
      { persist: false },
    );
    stateChanged = true;
  }

  if (stateChanged) persistForwardState();
}

export async function handleForwardedMessage(message) {
  if (!message || message.author?.bot || message.webhookId) return;
  const rules = sourceRulesForMessage(message);
  if (!rules.length) return;

  for (const rule of rules) {
    if (!shouldProcessMessage(message, rule)) continue;
    await forwardRuleMessage(rule, message);
  }
}

export async function validateDestinationChannelAccess(client, destinationChannelId, sourceGuildId, actorUserId) {
  const id = cleanId(destinationChannelId);
  if (!isSnowflake(id)) {
    return { ok: false, code: 'invalid_channel_id', message: 'Destination channel ID is invalid.' };
  }

  const destination = await client.channels.fetch(id).catch(() => null);
  if (!destination?.isTextBased?.()) {
    return { ok: false, code: 'destination_unreachable', message: 'The bot cannot reach that destination channel.' };
  }

  const crossGuild = destination.guildId && safeString(sourceGuildId) && destination.guildId !== safeString(sourceGuildId);
  if (crossGuild && !isBotOwner(actorUserId)) {
    return {
      ok: false,
      code: 'cross_guild_restricted',
      message:
        'Direct channel forwarding across different servers is restricted to the bot owner. For external destinations, use a Discord webhook intentionally created by the destination server administrator.',
    };
  }

  return {
    ok: true,
    destination,
    crossGuild,
  };
}

export function ruleToApi(rule) {
  return snapshotRule(rule);
}

export function createRuleSummary(rule) {
  const normalized = normalizeRule(rule);
  return [
    `ID: ${normalized.id}`,
    `Source: ${normalized.sourceChannelName || normalized.sourceChannelId}`,
    `Destination: ${describeDest(normalized)}`,
    `Status: ${normalized.enabled ? 'Enabled' : 'Disabled'}`,
    `Types: ${formatTypesForDisplay(normalized.allowedFileTypes)}`,
    `Max size: ${formatBytes(normalized.maxFileSizeBytes)}`,
    `Text: ${normalized.forwardText ? 'yes' : 'no'}`,
    `Embeds: ${normalized.forwardEmbeds ? 'yes' : 'no'}`,
    `Show author: ${normalized.showAuthor ? 'yes' : 'no'}`,
  ].join(' · ');
}

export { DEFAULT_MAX_FILE_SIZE_BYTES, WEBHOOK_RE };
