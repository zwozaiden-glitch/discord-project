import { SlashCommandBuilder } from 'discord.js';
import { claimOwner, getStoredOwnerId } from '../lib/settings.js';

export default {
  data: new SlashCommandBuilder()
    .setName('claimowner')
    .setDescription('Claims the bot as yours — the first person to run this becomes the owner.'),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ content: 'Run this in your server, not in DMs.', ephemeral: true });
    }

    const existing = getStoredOwnerId();
    if (existing) {
      if (existing === interaction.user.id) {
        return interaction.reply({
          content: '✅ You are already the owner of this bot.',
          ephemeral: true,
        });
      }
      return interaction.reply({
        content: `ℹ️ This bot is already owned by <@${existing}>. If that's you, check the ID — otherwise you can set \`OWNER_IDS\` in the environment to override.`,
        ephemeral: true,
      });
    }

    const result = claimOwner(interaction.user.id);
    if (!result.ok) {
      return interaction.reply({
        content: '❌ Could not claim ownership. Try again in a moment.',
        ephemeral: true,
      });
    }

    console.log(`✅ Owner claimed: ${interaction.user.tag} (${interaction.user.id})`);
    await interaction.reply({
      content: `🎉 **You are now the bot owner, ${interaction.user}!**\n\nYou can use every admin command:\n\`/rolesetup\`, \`/clear\`, \`/setup\`, \`/ticketsetup\`, \`/generatekey\`, \`/bulkgen\`, \`/whitelist\`, \`/blacklist\`, \`/deletekey\`, \`/keydrop\`, \`/resethwid\`, \`/setlog\`\n\nNext: run \`/rolesetup\` to create the server roles, \`/setlog\` to choose where events are logged, or \`/ticketsetup\` to create a support panel.`,
      ephemeral: true,
    });
  },
};
