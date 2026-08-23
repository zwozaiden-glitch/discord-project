import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { isAdmin } from '../lib/permissions.js';
import { clientEmbed, sendLog } from '../lib/notify.js';

export default {
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Bulk-deletes recent messages from the current channel.')
    .addIntegerOption((option) =>
      option
        .setName('amount')
        .setDescription('Number of recent messages to delete (1-100)')
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!interaction.guild || typeof interaction.channel?.bulkDelete !== 'function') {
      return interaction.reply({
        content: '❌ This command only works in a server text channel.',
        ephemeral: true,
      });
    }

    const canManageMessages =
      isAdmin(interaction) ||
      interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages) ||
      interaction.member?.permissions?.has?.(PermissionFlagsBits.ManageMessages);
    if (!canManageMessages) {
      return interaction.reply({
        content: '⛔ You need the **Manage Messages** permission to use this command.',
        ephemeral: true,
      });
    }

    const me = interaction.guild.members.me || (await interaction.guild.members.fetchMe());
    const botPermissions = interaction.channel.permissionsFor(me);
    if (
      !botPermissions?.has(PermissionFlagsBits.ManageMessages) ||
      !botPermissions?.has(PermissionFlagsBits.ReadMessageHistory)
    ) {
      return interaction.reply({
        content: '❌ I need **Manage Messages** and **Read Message History** in this channel.',
        ephemeral: true,
      });
    }

    const amount = interaction.options.getInteger('amount', true);
    await interaction.deferReply({ ephemeral: true });

    try {
      // Discord rejects bulk deletion for messages older than 14 days. Passing
      // `true` filters those messages instead of failing the whole command.
      const deleted = await interaction.channel.bulkDelete(amount, true);
      const skipped = Math.max(0, amount - deleted.size);
      await interaction.editReply(
        `🧹 Deleted **${deleted.size}** message${deleted.size === 1 ? '' : 's'}.` +
          (skipped ? ` **${skipped}** could not be deleted (usually because they are over 14 days old).` : '')
      );

      await sendLog(
        interaction.client,
        clientEmbed(
          interaction.client,
          '🧹 Messages cleared',
          `${interaction.user} deleted **${deleted.size}** message(s) in ${interaction.channel}.`,
          0xfee75c
        ),
        interaction.guild.id
      );
    } catch (error) {
      console.error('Failed to clear messages:', error);
      await interaction.editReply(
        '❌ I could not delete those messages. Check my permissions and remember Discord cannot bulk-delete messages older than 14 days.'
      );
    }
  },
};
