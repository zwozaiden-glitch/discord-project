import { PermissionFlagsBits } from 'discord.js';
import { CONFIG } from './config.js';

export function isAdmin(interactionOrMember) {
  const member = interactionOrMember?.member || interactionOrMember;
  const userId = interactionOrMember?.user?.id || member?.id;
  if (!userId) return false;

  if (CONFIG.ownerIds.includes(userId)) return true;
  if (member?.roles?.cache?.some((r) => CONFIG.adminRoleIds.includes(r.id))) return true;
  if (member?.permissions?.has(PermissionFlagsBits.Administrator)) return true;
  return false;
}

// Sends an error reply when the user is not allowed, returns true if allowed.
export async function ensureAdmin(interaction) {
  if (isAdmin(interaction)) return true;
  await interaction.reply({
    content: '⛔ You need to be an admin (owner, admin role, or Administrator permission) to use this command.',
    ephemeral: true,
  });
  return false;
}
