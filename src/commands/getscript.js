import { SlashCommandBuilder } from 'discord.js';
import { listScripts, getUserWhitelist, getScript } from '../lib/keySystem.js';
import { isAdmin } from '../lib/permissions.js';
import { loaderMessage } from '../lib/loader.js';
import { db } from '../lib/store.js';
import { CONFIG } from '../lib/config.js';

export default {
  data: new SlashCommandBuilder()
    .setName('getscript')
    .setDescription('Get your Protect-Vmax loadstring for a script you are whitelisted for.')
    .addStringOption((o) =>
      o.setName('script').setDescription('Script to get the loader for').setRequired(true).setAutocomplete(true)
    )
    .addUserOption((o) =>
      o.setName('user').setDescription('Admin only — get this user’s loader instead of yours')
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    await interaction.respond(
      listScripts()
        .map((s) => s.name)
        .filter((n) => n.includes(focused))
        .slice(0, 25)
        .map((name) => ({ name, value: name }))
    );
  },

  async execute(interaction) {
    const script = interaction.options.getString('script', true).trim();
    const target = interaction.options.getUser('user');

    if (target && target.id !== interaction.user.id && !isAdmin(interaction)) {
      return interaction.reply({
        content: '⛔ Only admins can fetch another user’s loader.',
        ephemeral: true,
      });
    }

    if (!getScript(script)) {
      return interaction.reply({
        content: `❌ Unknown script **${script}**. An admin can create it with \`/setup\`.`,
        ephemeral: true,
      });
    }

    const user = target || interaction.user;
    const entry = getUserWhitelist(user.id, script)[0];
    if (!entry) {
      return interaction.reply({
        content:
          user.id === interaction.user.id
            ? '📦 You need a key first — press **🎫 Redeem Key** on the panel or run `/redeem`.'
            : `📦 <@${user.id}> is not whitelisted for **${script}**.`,
        ephemeral: true,
      });
    }

    if (!db.scriptsources?.[script]?.source) {
      return interaction.reply({
        content: `📦 No script has been uploaded for **${script}** yet — an admin needs to run \`/apply\`.`,
        ephemeral: true,
      });
    }

    const who = user.id === interaction.user.id ? 'your' : `<@${user.id}>'s`;
    await interaction.reply({
      content:
        `${loaderMessage(script, entry.key)}\n` +
        `This is ${who} loader. The first run locks it to that device.\n` +
        `HWID locked by **Protect-Vmax** · made by ${CONFIG.creditName}.`,
      ephemeral: true,
    });
  },
};
