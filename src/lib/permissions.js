import { PermissionFlagsBits } from 'discord.js';
import { isBotOwner } from './settings.js';

export function isAdmin(interactionOrMember) {
  const member = interactionOrMember?.member || interactionOrMember;
  const userId = interactionOrMember?.user?.id || member?.id;
  if (!userId) return false;

  // Bot owner (claimed via /claimowner, or pre-set with OWNER_IDS).
  if (isBotOwner(userId)) return true;

  // Fallback: anyone with the Administrator permission in the server.
  if (member?.permissions?.has(PermissionFlagsBits.Administrator)) return true;
  return false;
}

// Sends an error reply when the user is not allowed, returns true if allowed.
export async function ensureAdmin(interaction) {
  if (isAdmin(interaction)) return true;
  await interaction.reply({
    content: '⛔ You need to be the bot owner (or have Administrator permission) to use this command.',
    ephemeral: true,
  });
  return false;
}
