import { SlashCommandBuilder } from 'discord.js';
import { isAdmin } from '../lib/permissions.js';
import { getKeyRecord, getUserWhitelist } from '../lib/keySystem.js';
import { formatKey, maskHwid } from '../lib/keys.js';

function statusOf(record) {
  if (!record) return '❌ Missing';
  if (record.voided) return '❌ Revoked';
  if (record.expiresAt && Date.parse(record.expiresAt) < Date.now()) return '❌ Expired';
  return record.hwid ? '✅ Valid' : '🕐 Not bound yet';
}

export default {
  data: new SlashCommandBuilder()
    .setName('keyinfo')
    .setDescription('Shows your key status and HWID binding (admin: inspect any key).')
    .addStringOption((o) =>
      o.setName('key').setDescription('Admin: check a specific key, e.g. LSN-XXXXX-XXXXX-XXXXX')
    ),

  async execute(interaction) {
    const keyOption = interaction.options.getString('key');
    const admin = isAdmin(interaction);

    // Admin inspecting a raw key.
    if (keyOption) {
      if (!admin) {
        return interaction.reply({ content: '⛔ Only admins can inspect a key.', ephemeral: true });
      }
      const rec = getKeyRecord(keyOption);
      if (!rec) {
        return interaction.reply({ content: '❌ Key not found.', ephemeral: true });
      }
      const lines = [
        `**Script:** ${rec.script}`,
        `**Key:** \`${formatKey(rec.raw)}\``,
        `**Status:** ${statusOf(rec)}`,
        `**Owner:** ${rec.claimedBy ? `<@${rec.claimedBy}>` : '*unclaimed*'}`,
        `**HWID:** \`${maskHwid(rec.hwid)}\``,
        `**Created:** <t:${Math.floor(Date.parse(rec.createdAt) / 1000)}:R>`,
      ];
      if (rec.expiresAt) lines.push(`**Expires:** <t:${Math.floor(Date.parse(rec.expiresAt) / 1000)}:R>`);
      return interaction.reply({ content: lines.join('\n'), ephemeral: true });
    }

    // Own status.
    const entries = getUserWhitelist(interaction.user.id);
    if (!entries.length) {
      return interaction.reply({
        content: '🔑 You have no whitelisted keys yet. Ask an admin for a key, or check `/scripts`.',
        ephemeral: true,
      });
    }

    const lines = entries.map((entry) => {
      const rec = getKeyRecord(entry.key);
      return `**${entry.script}** — ${statusOf(rec)}\n\`${formatKey(entry.key)}\`\nHWID: \`${maskHwid(rec?.hwid)}\`${rec?.expiresAt ? `\nExpires: <t:${Math.floor(Date.parse(rec.expiresAt) / 1000)}:R>` : ''}`;
    });

    await interaction.reply({ content: lines.join('\n\n'), ephemeral: true });
  },
};
