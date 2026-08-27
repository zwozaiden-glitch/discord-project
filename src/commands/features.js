import { SlashCommandBuilder } from 'discord.js';

export const FEATURES = [
  'Automatic slash-command syncing',
  'Secure bot-owner claiming',
  '13-role server setup with custom names',
  'Recent-message clearing',
  'Open Ticket panel',
  'Private ticket channels',
  'Staff claim and unclaim controls',
  'Ticket member add and remove',
  'Dedicated ticket audit logs',
  'Single-key generation',
  'Bulk key generation',
  'Key redemption',
  'User and role whitelisting',
  'Blacklist and access revocation',
  'Key lookup and deletion',
  'Public key drops',
  'Expiring keys',
  'HWID device locking',
  'HWID reset cooldowns',
  'Automatic Buyer roles',
  'Lua script uploads',
  'Runtime script protection',
  'One-line short loaders (/s/token.lua)',
  'Obfuscator auto-detect + selectable deobf',
  'ENV-Logger script dumps',
  'Cross-server file/photo forwarding',
  'Usage analytics',
  'Web dashboard, API, and Discord OAuth',
];

export default {
  data: new SlashCommandBuilder()
    .setName('features')
    .setDescription('Shows a short list of all main bot features.'),

  async execute(interaction) {
    const embed = {
      title: `✨ Protect-Vmax — ${FEATURES.length} Features`,
      description: FEATURES.map((feature, index) => `**${index + 1}.** ${feature}`).join('\n'),
      color: 0x5865f2,
    };
    if (interaction.client.user) embed.footer = { text: interaction.client.user.username };

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
