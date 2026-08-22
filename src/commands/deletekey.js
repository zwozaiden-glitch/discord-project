import { SlashCommandBuilder } from 'discord.js';
import { ensureAdmin } from '../lib/permissions.js';
import { ensureScript, deleteUserKey, getUserWhitelist } from '../lib/keySystem.js';
import { formatKey } from '../lib/keys.js';
import { sendLog, clientEmbed } from '../lib/notify.js';

export default {
  data: new SlashCommandBuilder()
    .setName('deletekey')
    .setDescription('Deletes the whitelisted key for a Discord user or everyone with a role.')
    .addStringOption((o) =>
      o.setName('script').setDescription('Script to remove keys for').setRequired(true).setAutocomplete(true)
    )
    .addUserOption((o) => o.setName('user').setDescription('Remove this user’s key'))
    .addRoleOption((o) => o.setName('role').setDescription('Remove keys for everyone with this role')),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    await interaction.respond(
      Object.values((await import('../lib/store.js')).db.scripts || {})
        .map((s) => s.name)
        .filter((n) => n.includes(focused))
        .slice(0, 25)
        .map((name) => ({ name, value: name }))
    );
  },

  async execute(interaction) {
    if (!(await ensureAdmin(interaction))) return;

    const script = interaction.options.getString('script', true).trim();
    const user = interaction.options.getUser('user');
    const role = interaction.options.getRole('role');

    if (!user && !role) {
      return interaction.reply({
        content: '❌ Provide either a **user** or a **role**.',
        ephemeral: true,
      });
    }
    if (user && role) {
      return interaction.reply({ content: '❌ Pick only one: **user** or **role**.', ephemeral: true });
    }

    const record = await ensureScript(script);

    if (user) {
      const result = deleteUserKey(record.name, user.id);
      if (!result.removed) {
        return interaction.reply({
          content: `ℹ️ <@${user.id}> has no key for **${record.name}**.`,
          ephemeral: true,
        });
      }
      sendLog(
        interaction.client,
        clientEmbed(
          interaction.client,
          '🚫 Key deleted',
          `${interaction.user} deleted ${user}'s key for **${record.name}** (\`${formatKey(result.raw)}\`).`,
          0xed4245
        )
      );
      return interaction.reply({
        content: `✅ Deleted <@${user.id}>'s key for **${record.name}** and revoked access.`,
        ephemeral: true,
      });
    }

    // Role path: load members (uncached members would be missed otherwise).
    await interaction.deferReply({ ephemeral: true });
    let members;
    try {
      members = [...(await interaction.guild.members.fetch()).filter((m) => m.roles.cache.has(role.id))];
    } catch {
      return interaction.editReply({ content: '❌ Could not fetch guild members (missing permission?).' });
    }

    let removed = 0;
    const keys = [];
    for (const [, member] of members) {
      const result = deleteUserKey(record.name, member.id);
      if (result.removed) {
        removed += 1;
        keys.push(`${member.user.username}: ${formatKey(result.raw)}`);
      }
    }

    if (!removed) {
      return interaction.editReply({
        content: `ℹ️ Nobody with <@&${role.id}> has a key for **${record.name}** (checked ${members.length} members).`,
      });
    }

    sendLog(
      interaction.client,
      clientEmbed(
        interaction.client,
        `🚫 Bulk key deletion (${removed})`,
        `${interaction.user} removed keys for **${record.name}** from <@&${role.id}>.\n\`\`\`${keys.slice(0, 40).join('\n')}${keys.length > 40 ? `\n… ${keys.length - 40} more` : ''}\`\`\``,
        0xed4245
      )
    );

    await interaction.editReply({
      content: `✅ Removed **${removed}** key(s) for **${record.name}** from <@&${role.id}> (checked ${members.length} members).`,
    });
  },
};
