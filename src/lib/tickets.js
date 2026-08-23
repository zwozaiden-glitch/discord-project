// Discord ticket panels and staff workflow.
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
} from 'discord.js';
import { isAdmin } from './permissions.js';
import {
  createTicketRecord,
  findOpenTicket,
  getTicket,
  getTicketConfig,
  removeTicket,
  setTicketConfig,
  takeNextTicketNumber,
  updateTicket,
} from './ticketStore.js';

const OPENING = new Set();
const CLOSING = new Set();

const MEMBER_ACCESS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.EmbedLinks,
];

function button(customId, label, style, emoji) {
  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(style)
    .setEmoji(emoji);
}

function ticketPanelPayload(client, values) {
  const embed = {
    title: `🎫 ${values.title || 'Support Tickets'}`,
    description:
      values.description ||
      'Need help? Press **Open Ticket** below and the support team will assist you in a private channel.',
    color: 0x5865f2,
    fields: [
      {
        name: 'Private support',
        value: 'Only you and the support team can see your ticket.',
        inline: true,
      },
      {
        name: 'One at a time',
        value: 'Each member can have one open ticket.',
        inline: true,
      },
    ],
    timestamp: new Date().toISOString(),
  };
  if (client?.user) embed.footer = { text: client.user.username };

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        button('ticket:open', 'Open Ticket', ButtonStyle.Primary, '🎫')
      ),
    ],
  };
}

function ticketChannelPayload(client, config, record) {
  const claimed = record.claimedBy ? `<@${record.claimedBy}>` : 'Waiting for staff';
  const embed = {
    title: `🎫 Ticket #${String(record.number).padStart(4, '0')}`,
    description:
      `Welcome <@${record.userId}>. Describe what you need help with and a member of ` +
      `<@&${config.supportRoleId}> will respond.`,
    color: record.claimedBy ? 0x57f287 : 0xfee75c,
    fields: [
      { name: 'Opened by', value: `<@${record.userId}>`, inline: true },
      { name: 'Status', value: claimed, inline: true },
    ],
    timestamp: record.createdAt,
  };
  if (client?.user) embed.footer = { text: client.user.username };

  const controls = new ActionRowBuilder().addComponents(
    button('ticket:claim', 'Claim', ButtonStyle.Success, '🙋').setDisabled(Boolean(record.claimedBy)),
    button('ticket:unclaim', 'Unclaim', ButtonStyle.Secondary, '↩️').setDisabled(!record.claimedBy),
    button('ticket:close', 'Close', ButtonStyle.Danger, '🔒')
  );

  return { embeds: [embed], components: [controls] };
}

function closeConfirmationRow() {
  return new ActionRowBuilder().addComponents(
    button('ticket:confirm-close', 'Yes, close it', ButtonStyle.Danger, '🔒'),
    button('ticket:cancel-close', 'Cancel', ButtonStyle.Secondary, '✖️')
  );
}

async function replyEphemeral(interaction, content) {
  const payload = typeof content === 'string' ? { content, ephemeral: true } : { ...content, ephemeral: true };
  if (interaction.deferred) {
    const { ephemeral: _ephemeral, ...editPayload } = payload;
    return interaction.editReply(editPayload);
  }
  if (interaction.replied) return interaction.followUp(payload);
  return interaction.reply(payload);
}

function memberHasRole(member, roleId) {
  if (!member || !roleId) return false;
  if (member.roles?.cache?.has) return member.roles.cache.has(roleId);
  if (Array.isArray(member.roles)) return member.roles.includes(roleId);
  return false;
}

export function isTicketStaff(interaction, config = getTicketConfig(interaction.guildId)) {
  if (!config) return false;
  return isAdmin(interaction) || memberHasRole(interaction.member, config.supportRoleId);
}

function activeTicketContext(interaction) {
  const record = getTicket(interaction.channelId);
  const config = record ? getTicketConfig(record.guildId) : null;
  return { record, config };
}

async function sendTicketLog(client, guildId, title, description, color = 0x2b2d31) {
  const config = getTicketConfig(guildId);
  if (!config?.logChannelId || !client?.isReady?.()) return false;

  try {
    const channel = await client.channels.fetch(config.logChannelId);
    if (!channel?.isTextBased?.()) return false;
    const embed = { title, description, color, timestamp: new Date().toISOString() };
    if (client.user) embed.footer = { text: client.user.username };
    await channel.send({ embeds: [embed] });
    return true;
  } catch {
    return false;
  }
}

async function updateTicketHeader(interaction, config, record) {
  if (!record.messageId) return;
  try {
    const message = await interaction.channel.messages.fetch(record.messageId);
    await message.edit(ticketChannelPayload(interaction.client, config, record));
  } catch {
    // The workflow still works if someone deleted the original control message.
  }
}

function cleanChannelName(username, number) {
  const slug = String(username || 'member')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'member';
  return `ticket-${slug}-${String(number).padStart(4, '0')}`.slice(0, 100);
}

export async function installTicketPanel(client, panelChannel, values) {
  const previous = getTicketConfig(panelChannel.guild.id);
  const oldPanel = previous
    ? { channelId: previous.panelChannelId, messageId: previous.panelMessageId }
    : null;

  const message = await panelChannel.send(ticketPanelPayload(client, values));
  setTicketConfig(panelChannel.guild.id, {
    ...values,
    panelChannelId: panelChannel.id,
    panelMessageId: message.id,
  });

  if (oldPanel?.channelId && oldPanel?.messageId && oldPanel.messageId !== message.id) {
    try {
      const oldChannel = await client.channels.fetch(oldPanel.channelId);
      const oldMessage = await oldChannel?.messages?.fetch?.(oldPanel.messageId);
      await oldMessage?.delete?.();
    } catch {
      // A missing/locked old panel should not break the new setup.
    }
  }

  return message;
}

async function openTicket(interaction) {
  if (!interaction.guild) {
    await replyEphemeral(interaction, '❌ Tickets can only be opened inside a server.');
    return;
  }

  const config = getTicketConfig(interaction.guild.id);
  if (!config) {
    await replyEphemeral(interaction, '❌ Tickets are not configured. Ask an admin to run `/ticketsetup`.');
    return;
  }

  const lockKey = `${interaction.guild.id}:${interaction.user.id}`;
  if (OPENING.has(lockKey)) {
    await replyEphemeral(interaction, '⏳ Your ticket is already being created.');
    return;
  }

  OPENING.add(lockKey);
  await interaction.deferReply({ ephemeral: true });
  let createdChannel = null;

  try {
    const existing = findOpenTicket(interaction.guild.id, interaction.user.id);
    if (existing) {
      const existingChannel =
        interaction.guild.channels.cache.get(existing.channelId) ||
        (await interaction.guild.channels.fetch(existing.channelId).catch(() => null));
      if (existingChannel) {
        await interaction.editReply(`ℹ️ You already have an open ticket: ${existingChannel}`);
        return;
      }
      // Clean up a stale record left behind if its Discord channel was deleted manually.
      removeTicket(existing.channelId);
    }

    const category =
      interaction.guild.channels.cache.get(config.categoryId) ||
      (await interaction.guild.channels.fetch(config.categoryId).catch(() => null));
    const supportRole =
      interaction.guild.roles.cache.get(config.supportRoleId) ||
      (await interaction.guild.roles.fetch(config.supportRoleId).catch(() => null));

    if (!category || category.type !== ChannelType.GuildCategory || !supportRole) {
      await interaction.editReply(
        '❌ The ticket category or support role was deleted. Ask an admin to run `/ticketsetup` again.'
      );
      return;
    }

    const number = takeNextTicketNumber(interaction.guild.id);
    const botMember = interaction.guild.members.me || (await interaction.guild.members.fetchMe());
    createdChannel = await interaction.guild.channels.create({
      name: cleanChannelName(interaction.user.username, number),
      type: ChannelType.GuildText,
      parent: category.id,
      topic: `Support ticket #${number} opened by ${interaction.user.tag} (${interaction.user.id})`,
      reason: `Ticket opened by ${interaction.user.tag}`,
      permissionOverwrites: [
        {
          id: interaction.guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: interaction.user.id,
          allow: MEMBER_ACCESS,
        },
        {
          id: supportRole.id,
          allow: MEMBER_ACCESS,
        },
        {
          id: botMember.id,
          allow: [...MEMBER_ACCESS, PermissionFlagsBits.ManageChannels],
        },
      ],
    });

    let record = createTicketRecord({
      channelId: createdChannel.id,
      guildId: interaction.guild.id,
      userId: interaction.user.id,
      number,
    });

    const message = await createdChannel.send({
      content: `<@${interaction.user.id}> <@&${supportRole.id}>`,
      ...ticketChannelPayload(interaction.client, config, record),
      allowedMentions: { users: [interaction.user.id], roles: [supportRole.id] },
    });
    record = updateTicket(createdChannel.id, { messageId: message.id });

    await interaction.editReply(`✅ Your private ticket is ready: ${createdChannel}`);
    await sendTicketLog(
      interaction.client,
      interaction.guild.id,
      '🎫 Ticket opened',
      `${interaction.user} opened ${createdChannel} (ticket #${String(number).padStart(4, '0')}).`,
      0x5865f2
    );
  } catch (error) {
    console.error('Failed to create ticket:', error);
    if (createdChannel) {
      removeTicket(createdChannel.id);
      await createdChannel.delete('Cleaning up a failed ticket creation').catch(() => {});
    }
    await interaction.editReply(
      '❌ I could not create your ticket. Make sure I have **Manage Channels**, **View Channel**, **Send Messages**, and **Embed Links** permissions.'
    );
  } finally {
    OPENING.delete(lockKey);
  }
}

export async function claimTicket(interaction) {
  const { record, config } = activeTicketContext(interaction);
  if (!record || !config) {
    await replyEphemeral(interaction, '❌ This is not an active ticket channel.');
    return;
  }
  if (!isTicketStaff(interaction, config)) {
    await replyEphemeral(interaction, '⛔ Only the configured support role or an administrator can claim tickets.');
    return;
  }
  if (record.claimedBy) {
    await replyEphemeral(
      interaction,
      record.claimedBy === interaction.user.id
        ? 'ℹ️ You already claimed this ticket.'
        : `ℹ️ This ticket is already claimed by <@${record.claimedBy}>.`
    );
    return;
  }

  const updated = updateTicket(record.channelId, { claimedBy: interaction.user.id });
  if (interaction.isButton()) {
    await interaction.update(ticketChannelPayload(interaction.client, config, updated));
  } else {
    await interaction.deferReply({ ephemeral: true });
    await updateTicketHeader(interaction, config, updated);
    await interaction.editReply('✅ You claimed this ticket.');
  }

  await interaction.channel.send(`🙋 ${interaction.user} claimed this ticket.`).catch(() => {});
  await sendTicketLog(
    interaction.client,
    record.guildId,
    '🙋 Ticket claimed',
    `${interaction.user} claimed ${interaction.channel}.`,
    0x57f287
  );
}

export async function unclaimTicket(interaction) {
  const { record, config } = activeTicketContext(interaction);
  if (!record || !config) {
    await replyEphemeral(interaction, '❌ This is not an active ticket channel.');
    return;
  }
  if (!isTicketStaff(interaction, config)) {
    await replyEphemeral(interaction, '⛔ Only ticket staff can unclaim tickets.');
    return;
  }
  if (!record.claimedBy) {
    await replyEphemeral(interaction, 'ℹ️ This ticket is not currently claimed.');
    return;
  }
  if (record.claimedBy !== interaction.user.id && !isAdmin(interaction)) {
    await replyEphemeral(interaction, `⛔ This ticket is claimed by <@${record.claimedBy}>.`);
    return;
  }

  const previousClaimant = record.claimedBy;
  const updated = updateTicket(record.channelId, { claimedBy: null });
  if (interaction.isButton()) {
    await interaction.update(ticketChannelPayload(interaction.client, config, updated));
  } else {
    await interaction.deferReply({ ephemeral: true });
    await updateTicketHeader(interaction, config, updated);
    await interaction.editReply('✅ The ticket is unclaimed and available to other staff.');
  }

  await interaction.channel.send(`↩️ ${interaction.user} unclaimed this ticket.`).catch(() => {});
  await sendTicketLog(
    interaction.client,
    record.guildId,
    '↩️ Ticket unclaimed',
    `${interaction.user} unclaimed ${interaction.channel} (previous claimant: <@${previousClaimant}>).`,
    0xfee75c
  );
}

function canCloseTicket(interaction, config, record) {
  return record.userId === interaction.user.id || isTicketStaff(interaction, config);
}

async function askToCloseTicket(interaction) {
  const { record, config } = activeTicketContext(interaction);
  if (!record || !config) {
    await replyEphemeral(interaction, '❌ This is not an active ticket channel.');
    return;
  }
  if (!canCloseTicket(interaction, config, record)) {
    await replyEphemeral(interaction, '⛔ Only the ticket opener or ticket staff can close this ticket.');
    return;
  }

  await interaction.reply({
    content: '⚠️ Close this ticket? The channel will be permanently deleted.',
    components: [closeConfirmationRow()],
    ephemeral: true,
  });
}

export async function closeTicket(interaction, reason = null) {
  const { record, config } = activeTicketContext(interaction);
  if (!record || !config) {
    await replyEphemeral(interaction, '❌ This is not an active ticket channel.');
    return;
  }
  if (!canCloseTicket(interaction, config, record)) {
    await replyEphemeral(interaction, '⛔ Only the ticket opener or ticket staff can close this ticket.');
    return;
  }
  if (CLOSING.has(record.channelId)) {
    await replyEphemeral(interaction, '⏳ This ticket is already closing.');
    return;
  }

  CLOSING.add(record.channelId);
  const closeReason = reason?.trim() || 'No reason provided';

  if (interaction.isButton()) {
    await interaction.update({ content: '🔒 Closing ticket…', components: [] });
  } else {
    await interaction.reply({ content: '🔒 Closing ticket…', ephemeral: true });
  }

  try {
    await sendTicketLog(
      interaction.client,
      record.guildId,
      '🔒 Ticket closed',
      [
        `**Ticket:** #${String(record.number).padStart(4, '0')} (${interaction.channel.name})`,
        `**Opened by:** <@${record.userId}>`,
        `**Closed by:** ${interaction.user}`,
        `**Claimed by:** ${record.claimedBy ? `<@${record.claimedBy}>` : 'Nobody'}`,
        `**Reason:** ${closeReason}`,
      ].join('\n'),
      0xed4245
    );

    await interaction.channel.delete(`Ticket closed by ${interaction.user.tag}: ${closeReason}`);
    removeTicket(record.channelId);
  } catch (error) {
    console.error('Failed to close ticket:', error);
    await interaction.editReply('❌ I could not delete this ticket channel. Check my **Manage Channels** permission.').catch(() => {});
  } finally {
    CLOSING.delete(record.channelId);
  }
}

export async function addTicketMember(interaction, user) {
  const { record, config } = activeTicketContext(interaction);
  if (!record || !config) {
    await replyEphemeral(interaction, '❌ Use this command inside an active ticket.');
    return;
  }
  if (!isTicketStaff(interaction, config)) {
    await replyEphemeral(interaction, '⛔ Only ticket staff can add members.');
    return;
  }
  if (user.bot) {
    await replyEphemeral(interaction, '❌ Bots cannot be added with this command.');
    return;
  }
  if (user.id === record.userId || record.addedUserIds.includes(user.id)) {
    await replyEphemeral(interaction, `${user} already has access to this ticket.`);
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    await interaction.channel.permissionOverwrites.edit(
      user.id,
      {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
        AttachFiles: true,
        EmbedLinks: true,
      },
      { reason: `Added to ticket by ${interaction.user.tag}` }
    );
    updateTicket(record.channelId, { addedUserIds: [...record.addedUserIds, user.id] });
    await interaction.channel.send(`➕ ${user} was added to the ticket by ${interaction.user}.`);
    await interaction.editReply(`✅ Added ${user} to this ticket.`);
    await sendTicketLog(
      interaction.client,
      record.guildId,
      '➕ Ticket member added',
      `${interaction.user} added ${user} to ${interaction.channel}.`,
      0x5865f2
    );
  } catch (error) {
    console.error('Failed to add ticket member:', error);
    await interaction.editReply('❌ I could not update this channel’s permissions.');
  }
}

export async function removeTicketMember(interaction, user) {
  const { record, config } = activeTicketContext(interaction);
  if (!record || !config) {
    await replyEphemeral(interaction, '❌ Use this command inside an active ticket.');
    return;
  }
  if (!isTicketStaff(interaction, config)) {
    await replyEphemeral(interaction, '⛔ Only ticket staff can remove members.');
    return;
  }
  if (user.id === record.userId) {
    await replyEphemeral(interaction, '❌ The ticket opener cannot be removed. Close the ticket instead.');
    return;
  }

  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (memberHasRole(member, config.supportRoleId) || isAdmin(member)) {
    await replyEphemeral(
      interaction,
      '❌ That member is ticket staff and keeps access through their role or Administrator permission.'
    );
    return;
  }

  const hasExplicitAccess = interaction.channel.permissionOverwrites.cache.has(user.id);
  if (!record.addedUserIds.includes(user.id) && !hasExplicitAccess) {
    await replyEphemeral(interaction, `${user} does not have added access to this ticket.`);
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    await interaction.channel.permissionOverwrites.delete(
      user.id,
      `Removed from ticket by ${interaction.user.tag}`
    );
    updateTicket(record.channelId, {
      addedUserIds: record.addedUserIds.filter((userId) => userId !== user.id),
    });
    await interaction.channel.send(`➖ ${user} was removed from the ticket by ${interaction.user}.`);
    await interaction.editReply(`✅ Removed ${user} from this ticket.`);
    await sendTicketLog(
      interaction.client,
      record.guildId,
      '➖ Ticket member removed',
      `${interaction.user} removed ${user} from ${interaction.channel}.`,
      0xfee75c
    );
  } catch (error) {
    console.error('Failed to remove ticket member:', error);
    await interaction.editReply('❌ I could not update this channel’s permissions.');
  }
}

// Routes ticket buttons. Returns true when the custom ID belongs to this system.
export async function handleTicketInteraction(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith('ticket:')) return false;

  const action = interaction.customId.slice('ticket:'.length);
  if (action === 'open') await openTicket(interaction);
  else if (action === 'claim') await claimTicket(interaction);
  else if (action === 'unclaim') await unclaimTicket(interaction);
  else if (action === 'close') await askToCloseTicket(interaction);
  else if (action === 'confirm-close') await closeTicket(interaction);
  else if (action === 'cancel-close') {
    await interaction.update({ content: '✅ Ticket closure cancelled.', components: [] });
  } else {
    return false;
  }

  return true;
}
