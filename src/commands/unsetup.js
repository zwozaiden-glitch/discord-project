import { SlashCommandBuilder } from 'discord.js';
import { ensureAdmin } from '../lib/permissions.js';
import { getScript } from '../lib/keySystem.js';
import { removePanel } from '../lib/panel.js';

export default {
  data: new SlashCommandBuilder()
    .setName('unsetup')
    .setDescription('Deletes the whitelist panel for a script.')
    .addStringOption((o) =>
      o.setName('script').setDescription('Script whose panel to remove').setRequired(true).setAutocomplete(true)
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    const names = Object.keys((await import('../lib/store.js')).db.panels || {});
    await interaction.respond(
      names.filter((n) => n.includes(focused)).slice(0, 25).map((name) => ({ name, value: name }))
    );
  },

  async execute(interaction) {
    if (!(await ensureAdmin(interaction))) return;
    const script = interaction.options.getString('script', true).trim();
    if (!getScript(script)) {
      return interaction.reply({ content: `❌ No such script: **${script}**.`, ephemeral: true });
    }
    const removed = await removePanel(interaction.client, script);
    await interaction.reply({
      content: removed
        ? `🗑️ Panel for **${script}** deleted.`
        : `ℹ️ No panel was stored for **${script}** (the message may have been deleted manually).`,
      ephemeral: true,
    });
  },
};
