import { getLogChannelId } from './settings.js';

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

// Sends an embed to the log channel configured for that server via /setlog.
export async function sendLog(client, embed, guildId = null) {
  const channelId = getLogChannelId(guildId);
  if (!channelId || !client?.isReady?.()) return;
  try {
    const channel = await client.channels.fetch(channelId);
    await channel?.send({ embeds: [embed] });
  } catch {
    // Logging is best-effort; never crash the bot over it.
  }
}
