import { CONFIG } from './config.js';

export function clientEmbed(client, title, description, color = 0x2b2d31) {
  const embed = { title, description, color, timestamp: new Date().toISOString() };
  if (client?.user) embed.footer = { text: client.user.username };
  return embed;
}

export async function sendDM(client, userId, content, extra = {}) {
  try {
    const user = await client.users.fetch(userId);
    await user.send({ content, ...extra });
    return true;
  } catch {
    return false;
  }
}

export async function sendLog(client, embed) {
  if (!CONFIG.logChannelId || !client?.isReady?.()) return;
  try {
    const channel = await client.channels.fetch(CONFIG.logChannelId);
    await channel?.send({ embeds: [embed] });
  } catch {
    // Logging is best-effort; never crash the bot over it.
  }
}
