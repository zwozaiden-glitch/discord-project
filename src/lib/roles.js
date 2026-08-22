// Auto buyer role helper — assigns the configured role after redemption.
import { getBuyerRole } from './settings.js';

export async function grantBuyerRole(client, guildId, script, userId) {
  if (!guildId || !userId) return false;
  const roleId = getBuyerRole(guildId, script);
  if (!roleId) return false;
  try {
    const guild = await client.guilds.fetch(guildId);
    const member = await guild.members.fetch(userId);
    if (member.roles.cache.has(roleId)) return true;
    await member.roles.add(roleId);
    return true;
  } catch {
    return false;
  }
}
