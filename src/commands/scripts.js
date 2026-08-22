import { SlashCommandBuilder } from 'discord.js';
import { listScripts, isWhitelisted, getUserWhitelist } from '../lib/keySystem.js';
import { maskKey } from '../lib/keys.js';

export default {
  data: new SlashCommandBuilder()
    .setName('scripts')
    .setDescription('Shows all scripts and whether you are whitelisted for them.'),

  async execute(interaction) {
    const scripts = listScripts();
    if (!scripts.length) {
      return interaction.reply({
        content: 'ℹ️ No scripts exist yet — an admin can create one with `/setup`.',
        ephemeral: true,
      });
    }

    const lines = scripts.map((s) => {
      if (!isWhitelisted(s.name, interaction.user.id)) {
        return `**${s.name}** — ❌ not whitelisted`;
      }
      const entry = getUserWhitelist(interaction.user.id, s.name)[0];
      return `**${s.name}** — ✅ whitelisted — \`${maskKey(entry.key)}\``;
    });

    await interaction.reply({ content: `📜 **Scripts**\n\n${lines.join('\n')}`, ephemeral: true });
  },
};
