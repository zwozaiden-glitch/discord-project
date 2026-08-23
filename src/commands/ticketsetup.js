import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { ensureAdmin } from '../lib/permissions.js';
import { installTicketPanel } from '../lib/tickets.js';

const SEND_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
];

export default {
  data: new SlashCommandBuilder()
    .setName('ticketsetup')
    .setDescription('Configures the private support-ticket system and posts its open-ticket panel.')
    .addChannelOption((option) =>
      option
        .setName('category')
        .setDescription('Category where private ticket channels will be created')
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(true)
    )
    .addRoleOption((option) =>
      option
        .setName('support_role')
        .setDescription('Staff role that can view, claim, and manage tickets')
        .setRequired(true)
    )
    .addChannelOption((option) =>
      option
        .setName('log_channel')
        .setDescription('Channel for ticket open, claim, member, and close logs')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addChannelOption((option) =>
      option
        .setName('panel_channel')
        .setDescription('Where to post the Open Ticket panel (defaults to this channel)')
        .addChannelTypes(ChannelType.GuildText)
    )
    .addStringOption((option) =>
      option
        .setName('title')
        .setDescription('Optional panel title')
        .setMaxLength(80)
    )
    .addStringOption((option) =>
      option
        .setName('description')
        .setDescription('Optional instructions shown on the ticket panel')
        .setMaxLength(1000)
    ),

  async execute(interaction) {
    if (!(await ensureAdmin(interaction))) return;
    if (!interaction.guild) {
      return interaction.reply({ content: 'This command only works in a server.', ephemeral: true });
    }

    const category = interaction.options.getChannel('category', true);
    const supportRole = interaction.options.getRole('support_role', true);
    const logChannel = interaction.options.getChannel('log_channel', true);
    const panelChannel = interaction.options.getChannel('panel_channel') || interaction.channel;
    const title = interaction.options.getString('title')?.trim() || 'Support Tickets';
    const description = interaction.options.getString('description')?.trim() || null;
    const me = interaction.guild.members.me || (await interaction.guild.members.fetchMe());

    if (supportRole.id === interaction.guild.roles.everyone.id) {
      return interaction.reply({
        content: '❌ The support role cannot be `@everyone`; choose a private staff role.',
        ephemeral: true,
      });
    }

    if (panelChannel?.type !== ChannelType.GuildText) {
      return interaction.reply({
        content: '❌ Run this in a normal text channel or select a `panel_channel` option.',
        ephemeral: true,
      });
    }

    if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return interaction.reply({
        content: '❌ I need the server permission **Manage Channels** to create and close tickets.',
        ephemeral: true,
      });
    }

    const categoryPermissions = category.permissionsFor(me);
    if (
      !categoryPermissions?.has(PermissionFlagsBits.ViewChannel) ||
      !categoryPermissions?.has(PermissionFlagsBits.ManageChannels)
    ) {
      return interaction.reply({
        content: `❌ I need **View Channel** and **Manage Channels** access in ${category}.`,
        ephemeral: true,
      });
    }

    for (const [channel, purpose] of [
      [panelChannel, 'post the ticket panel'],
      [logChannel, 'write ticket logs'],
    ]) {
      if (!channel?.permissionsFor(me)?.has(SEND_PERMISSIONS)) {
        return interaction.reply({
          content: `❌ I need **View Channel**, **Send Messages**, and **Embed Links** in ${channel} to ${purpose}.`,
          ephemeral: true,
        });
      }
    }

    await interaction.deferReply({ ephemeral: true });
    try {
      const message = await installTicketPanel(interaction.client, panelChannel, {
        categoryId: category.id,
        supportRoleId: supportRole.id,
        logChannelId: logChannel.id,
        title,
        description,
      });

      await interaction.editReply(
        [
          `✅ Ticket system configured and panel posted in ${panelChannel}: ${message.url}`,
          `**Ticket category:** ${category}`,
          `**Support role:** ${supportRole}`,
          `**Ticket logs:** ${logChannel}`,
        ].join('\n')
      );
    } catch (error) {
      console.error('Ticket setup failed:', error);
      await interaction.editReply(
        '❌ I could not post or save the ticket panel. Check my channel permissions and try again.'
      );
    }
  },
};
