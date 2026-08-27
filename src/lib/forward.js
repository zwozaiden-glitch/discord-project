// Cross-server file/photo forwarding.
// Source: a channel the bot can see.
// Dest: another channel ID (bot must share that server) OR a webhook URL
// so files can be sent even when the bot is not in the destination server.
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

export function listForwards(guildId = null) {
  const all = Object.values(ensure());
  if (!guildId) return all;
  return all.filter((rule) => rule.guildId === String(guildId));
}

export function getForward(id) {
  return ensure()[id] || null;
}

export function addForward({ guildId, sourceChannelId, destChannelId = null, destWebhook = null, createdBy }) {
  const id = randomBytes(4).toString('hex');
  const rule = {
    id,
    guildId: guildId ? String(guildId) : null,
    sourceChannelId: String(sourceChannelId),
    destChannelId: destChannelId ? String(destChannelId) : null,
    destWebhook: destWebhook ? String(destWebhook).trim() : null,
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

export async function handleForwardedMessage(message) {
  if (!message || message.author?.bot) return;
  if (message.webhookId) return;
  const attachments = fileAttachments(message);
  if (!attachments.length) return;

  const rules = Object.values(ensure()).filter((rule) => rule.sourceChannelId === message.channelId);
  if (!rules.length) return;

  for (const rule of rules) {
    try {
      if (rule.destWebhook) {
        const ok = await sendWebhook(rule.destWebhook, message, attachments);
        if (ok) {
          rule.forwarded = (rule.forwarded || 0) + 1;
          save('forwards');
        }
        continue;
      }
      if (rule.destChannelId) {
        const result = await sendChannel(message.client, rule.destChannelId, message, attachments);
        if (result.ok) {
          rule.forwarded = (rule.forwarded || 0) + 1;
          save('forwards');
        }
      }
    } catch (error) {
      console.warn(`[forward] rule ${rule.id} failed:`, error.message);
    }
  }
}

export { WEBHOOK_RE };
