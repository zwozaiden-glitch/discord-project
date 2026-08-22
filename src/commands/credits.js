import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { CONFIG } from '../lib/config.js';

export default {
  data: new SlashCommandBuilder()
    .setName('credits')
    .setDescription('Who built Protect-Vmax.'),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('🛡️ Protect-Vmax')
      .setDescription(
        `**Protected by Protect-Vmax**\n\n` +
        `Made with 💜 by **${CONFIG.creditName}**\n\n` +
        `HWID-locked keys · Discord panels · script protection · keydrops · analytics`
      )
      .setColor(0x5865f2)
      .setFooter({ text: `by ${CONFIG.creditName}` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
