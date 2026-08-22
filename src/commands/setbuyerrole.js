import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { ensureAdmin } from '../lib/permissions.js';
import { getScript, listScripts } from '../lib/keySystem.js';
import { setBuyerRole, clearBuyerRole } from '../lib/settings.js';

export default {
  data: new SlashCommandBuilder()
    .setName('setbuyerrole')
    .setDescription('Auto-assigns a role when a user redeems a key. Runs/whitelist can also assign by role.')
    .addRoleOption((o) =>
      o.setName('role').setDescription('Role given automatically after redemption (leave empty to clear)')
    )
    .addStringOption((o) =>
      o.setName('script').setDescription('Only for one script (default: all scripts)').setAutocomplete(true)
    )
    .addBooleanOption((o) => o.setName('clear').setDescription('Stop auto-assigning')),

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
    if (!(await ensureAdmin(interaction))) return;
    if (!interaction.guild) {
      return interaction.reply({ content: 'This command only works in a server.', ephemeral: true });
    }

    const role = interaction.options.getRole('role');
    const script = interaction.options.getString('script');
    const clear = interaction.options.getBoolean('clear') || false;

    if (script && !getScript(script)) {
      return interaction.reply({ content: `❌ No such script: **${script}**.`, ephemeral: true });
    }

    if (clear || !role) {
      clearBuyerRole(interaction.guild.id, script);
      return interaction.reply({
        content: `🗑️ Auto role cleared${script ? ` for **${script}**` : ' (all scripts)'}.`,
        ephemeral: true,
      });
    }

    const me = interaction.guild.members.me;
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({
        content: `❌ I need the **Manage Roles** permission to assign <@&${role.id}>.`,
        ephemeral: true,
      });
    }
    if (role.managed || role.id === me.roles.highest.id) {
      return interaction.reply({
        content: `❌ I can't assign <@&${role.id}> — it's managed by an integration or higher than my top role.`,
        ephemeral: true,
      });
    }

    setBuyerRole(interaction.guild.id, script, role.id);
    await interaction.reply({
      content: `✅ Users get <@&${role.id}> automatically after redemption${script ? ` for **${script}**` : ' for every script'}.`,
      ephemeral: true,
    });
  },
};
