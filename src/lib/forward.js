// Cross-server file/photo forwarding.
//
// Discord will not let a bot post into a channel it cannot see. Members also
// cannot create webhooks. So dest is one of:
//   - destUserId   → DM the member who set the rule (works with no dest admin)
//   - destChannelId → a channel the bot is already in
//   - destWebhook   → optional, only if someone already has a webhook URL
import { db, save } from './store.js';
import { randomBytes } from 'node:crypto';

const WEBHOOK_RE = /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+/i;
const SNOWFLAKE_RE = /^\d{17,20}$/;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

function ensure() {
  if (!db.forwards || Array.isArray(db.forwards)) db.forwards = {};
  return db.forwards;
}

export function isWebhookUrl(value) {
  return WEBHOOK_RE.test(String(value || '').trim());
}

export function isSnowflake(value) {
  return SNOWFLAKE_RE.test(String(value || '').trim());
}

export function listForwards(guildId = null, { userId = null, admin = false } = {}) {
  let all = Object.values(ensure());
  if (guildId) all = all.filter((rule) => rule.guildId === String(guildId));
  if (!admin && userId) all = all.filter((rule) => rule.createdBy === String(userId));
  return all;
}

export function getForward(id) {
  return ensure()[id] || null;
}

export function addForward({
  guildId,
  sourceChannelId,
  destChannelId = null,
  destWebhook = null,
  destUserId = null,
  createdBy,
}) {
  const id = randomBytes(4).toString('hex');
  const rule = {
    id,
    guildId: guildId ? String(guildId) : null,
    sourceChannelId: String(sourceChannelId),
    destChannelId: destChannelId ? String(destChannelId) : null,
    destWebhook: destWebhook ? String(destWebhook).trim() : null,
    destUserId: destUserId ? String(destUserId) : null,
    createdBy: createdBy ? String(createdBy) : null,
    createdAt: new Date().toISOString(),
    forwarded: 0,
  };
  ensure()[id] = rule;
  save('forwards');
  return rule;
}

export function removeForward(id) {
  if (!ensure()[id]) return false;
  delete db.forwards[id];
  save('forwards');
  return true;
}

export function describeDest(rule) {
  if (rule.destUserId) return `DMs of <@${rule.destUserId}>`;
  if (rule.destWebhook) return 'webhook';
  if (rule.destChannelId) return `<#${rule.destChannelId}> \`${rule.destChannelId}\``;
  return 'unknown dest';
}

function captionFor(message) {
  const guildName = message.guild?.name || 'DM / unknown server';
  const channelName = message.channel?.name ? `#${message.channel.name}` : message.channelId;
  const author = message.author?.tag || message.author?.username || 'unknown';
  const extra = message.content ? `\n${message.content.slice(0, 300)}` : '';
  return `📎 **${author}** in **${guildName}** / ${channelName}${extra}`.slice(0, 1900);
}

function fileAttachments(message) {
  return [...(message.attachments?.values?.() || [])].filter((att) => att?.url);
}

async function sendWebhook(webhookUrl, message, attachments) {
  const form = new FormData();
  form.append(
    'payload_json',
    JSON.stringify({
      username: (message.author?.username || 'Protect-Vmax').slice(0, 80),
      avatar_url: message.author?.displayAvatarURL?.({ size: 128, extension: 'png' }) || undefined,
      content: captionFor(message),
      allowed_mentions: { parse: [] },
    }),
  );

  let index = 0;
  for (const att of attachments.slice(0, 10)) {
    try {
      const res = await fetch(att.url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      const name = att.name || (IMAGE_EXT.test(att.url) ? `image-${index}.png` : `file-${index}`);
      form.append(`files[${index}]`, new Blob([buf]), name);
      index += 1;
    } catch {
      // Skip a single failed download; still try the rest.
    }
  }
  if (index === 0) return false;

  const res = await fetch(webhookUrl, { method: 'POST', body: form, signal: AbortSignal.timeout(20000) });
  return res.ok;
}

async function sendChannel(client, destChannelId, message, attachments) {
  const dest = await client.channels.fetch(destChannelId).catch(() => null);
  if (!dest?.isTextBased?.() || !dest.send) return { ok: false, reason: 'dest_unreachable' };
  await dest.send({
    content: captionFor(message),
    files: attachments.slice(0, 10).map((att) => ({ attachment: att.url, name: att.name || 'file' })),
    allowedMentions: { parse: [] },
  });
  return { ok: true };
}

async function sendDm(client, userId, message, attachments) {
  const user = await client.users.fetch(userId).catch(() => null);
  if (!user) return { ok: false, reason: 'user_missing' };
  await user.send({
    content: captionFor(message),
    files: attachments.slice(0, 10).map((att) => ({ attachment: att.url, name: att.name || 'file' })),
  });
  return { ok: true };
}

export async function handleForwardedMessage(message) {
  if (!message || message.author?.bot) return;
  if (message.webhookId) return;
  const attachments = fileAttachments(message);
  if (!attachments.length) return;

  const rules = Object.values(ensure()).filter((rule) => rule.sourceChannelId === message.channelId);
  if (!rules.length) return;

  for (const rule of rules) {
    try {
      let ok = false;
      if (rule.destUserId) {
        const result = await sendDm(message.client, rule.destUserId, message, attachments);
        ok = result.ok;
      } else if (rule.destWebhook) {
        ok = await sendWebhook(rule.destWebhook, message, attachments);
      } else if (rule.destChannelId) {
        const result = await sendChannel(message.client, rule.destChannelId, message, attachments);
        ok = result.ok;
      }
      if (ok) {
        rule.forwarded = (rule.forwarded || 0) + 1;
        save('forwards');
      }
    } catch (error) {
      console.warn(`[forward] rule ${rule.id} failed:`, error.message);
    }
  }
}

export { WEBHOOK_RE };
