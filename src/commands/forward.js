import { SlashCommandBuilder } from 'discord.js';
import { ensureAdmin } from '../lib/permissions.js';
import {
  DEFAULT_MAX_FILE_SIZE_BYTES,
  SUPPORTED_FORWARD_TYPES,
  addForward,
  createRuleSummary,
  describeDest,
  getForward,
  getForwardStatus,
  isSnowflake,
  isWebhookUrl,
  listForwards,
  removeForward,
  sendForwardTest,
  setForwardEnabled,
  validateDestinationChannelAccess,
} from '../lib/forward.js';

function maxSizeMbDefault() {
  return Math.floor(DEFAULT_MAX_FILE_SIZE_BYTES / (1024 * 1024));
}

function trimId(value) {
  return String(value || '').trim();
}

function formatRuleLine(rule) {
  return [
    `• \`${rule.id}\``,
    `${rule.enabled ? '🟢' : '⚪'} **${rule.sourceChannelName || rule.sourceChannelId}** → **${describeDest(rule)}**`,
    `types: ${rule.allowedFileTypes.includes('all') ? 'all safe types' : rule.allowedFileTypes.join(', ')}`,
    `max: ${(rule.maxFileSizeBytes / (1024 * 1024)).toFixed(0)} MB`,
    `text: ${rule.forwardText ? 'yes' : 'no'}`,
    `embeds: ${rule.forwardEmbeds ? 'yes' : 'no'}`,
    `author: ${rule.showAuthor ? 'yes' : 'no'}`,
    `forwarded: ${rule.stats.forwardedCount || 0}`,
  ].join(' · ');
}

export default {
  data: new SlashCommandBuilder()
    .setName('forward')
    .setDescription('Manage attachment forwarding rules for this server.')
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Create a new forwarding rule.')
        .addChannelOption((option) =>
          option
            .setName('source_channel')
            .setDescription('Source channel to monitor (defaults to this channel).'),
        )
        .addStringOption((option) =>
          option
            .setName('destination_webhook')
            .setDescription('Destination Discord webhook URL (recommended for external servers).'),
        )
        .addStringOption((option) =>
          option
            .setName('destination_channel_id')
            .setDescription('Destination channel ID if the bot is already allowed to post there.'),
        )
        .addStringOption((option) =>
          option
            .setName('allowed_types')
            .setDescription('Comma-separated types like png,jpg,pdf,zip or all.')
            .setMaxLength(200),
        )
        .addIntegerOption((option) =>
          option
            .setName('max_size_mb')
            .setDescription(`Maximum file size in MB (default ${maxSizeMbDefault()} MB).`)
            .setMinValue(1)
            .setMaxValue(100),
        )
        .addBooleanOption((option) =>
          option
            .setName('forward_text')
            .setDescription('Also forward the original message text/caption (default true).'),
        )
        .addBooleanOption((option) =>
          option
            .setName('forward_embeds')
            .setDescription('Also forward Discord embeds from the source message (default false).'),
        )
        .addBooleanOption((option) =>
          option
            .setName('show_author')
            .setDescription('Show the original author name/avatar in forwarded posts (default true).'),
        )
        .addBooleanOption((option) =>
          option
            .setName('enabled')
            .setDescription('Enable the rule immediately (default true).'),
        ),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('List forwarding rules for this server.'))
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Remove a forwarding rule.')
        .addStringOption((option) =>
          option.setName('id').setDescription('Rule ID from /forward list.').setRequired(true).setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('enable')
        .setDescription('Enable a forwarding rule.')
        .addStringOption((option) =>
          option.setName('id').setDescription('Rule ID from /forward list.').setRequired(true).setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('disable')
        .setDescription('Disable a forwarding rule.')
        .addStringOption((option) =>
          option.setName('id').setDescription('Rule ID from /forward list.').setRequired(true).setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('test')
        .setDescription('Send a test payload through an existing forwarding rule.')
        .addStringOption((option) =>
          option.setName('id').setDescription('Rule ID from /forward list.').setRequired(true).setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) => sub.setName('status').setDescription('Show forwarding health and totals.')),

  async autocomplete(interaction) {
    const sub = interaction.options.getSubcommand();
    if (!['remove', 'enable', 'disable', 'test'].includes(sub)) {
      await interaction.respond([]);
      return;
    }

    const focused = interaction.options.getFocused().toLowerCase();
    const rules = listForwards(interaction.guildId, {
      userId: interaction.user.id,
      admin: true,
    })
      .map((rule) => ({
        name: `${rule.id} · ${rule.sourceChannelName || rule.sourceChannelId} → ${describeDest(rule)}`.slice(0, 100),
        value: rule.id,
      }))
      .filter((choice) => choice.name.toLowerCase().includes(focused) || choice.value.includes(focused))
      .slice(0, 25);

    await interaction.respond(rules);
  },

  async execute(interaction) {
    if (!(await ensureAdmin(interaction))) return;
    if (!interaction.inGuild()) {
      await interaction.reply({ content: '❌ This command can only be used inside a server.', ephemeral: true });
      return;
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const rules = listForwards(interaction.guildId, { admin: true });
      if (!rules.length) {
        await interaction.reply({
          content:
            'No forwarding rules are configured for this server yet.\n\n' +
            'Use `/forward add` and set either a destination webhook URL or a destination channel ID.',
          ephemeral: true,
        });
        return;
      }

      const lines = rules.map(formatRuleLine);
      await interaction.reply({
        content: `## VMax Forwarder Rules\n${lines.join('\n')}`.slice(0, 1990),
        ephemeral: true,
      });
      return;
    }

    if (sub === 'status') {
      const status = getForwardStatus(interaction.client);
      const rules = listForwards(interaction.guildId, { admin: true });
      const serverActive = rules.filter((rule) => rule.enabled).length;
      const serverForwarded = rules.reduce((sum, rule) => sum + Number(rule.stats.forwardedCount || 0), 0);
      const serverFailed = rules.reduce((sum, rule) => sum + Number(rule.stats.failedCount || 0), 0);
      const lastError = status.lastError?.message ? `\nLast error: ${status.lastError.message}` : '';

      await interaction.reply({
        content:
          `## VMax Forwarder Status\n` +
          `Bot: ${status.botConnected ? `online as **${status.botTag}**` : 'offline'}\n` +
          `This server: **${serverActive}** active rule(s), **${rules.length}** total rule(s)\n` +
          `Forwarded files (this server): **${serverForwarded}**\n` +
          `Failures (this server): **${serverFailed}**\n` +
          `Duplicate blocks (global): **${status.duplicatesBlocked}**\n` +
          `Oversized blocks (global): **${status.oversizedBlocked}**\n` +
          `Official limitation: the bot can only read channels it has access to. External destination servers must provide a Discord webhook intentionally created by their administrator.${lastError}`,
        ephemeral: true,
      });
      return;
    }

    if (['remove', 'enable', 'disable', 'test'].includes(sub)) {
      const id = trimId(interaction.options.getString('id', true));
      const rule = getForward(id);
      if (!rule || rule.guildId !== interaction.guildId) {
        await interaction.reply({ content: '❌ Unknown rule ID for this server.', ephemeral: true });
        return;
      }

      if (sub === 'remove') {
        removeForward(id, interaction.user.id);
        await interaction.reply({ content: `🗑️ Removed forwarding rule \`${id}\`.`, ephemeral: true });
        return;
      }

      if (sub === 'enable' || sub === 'disable') {
        const enabled = sub === 'enable';
        const updated = setForwardEnabled(id, enabled, interaction.user.id);
        await interaction.reply({
          content: `${enabled ? '🟢 Enabled' : '⚪ Disabled'} rule \`${id}\` → ${describeDest(updated)}.`,
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply({ ephemeral: true });
      try {
        await sendForwardTest(id, interaction.client, interaction.user.id);
        await interaction.editReply('🧪 Test payload sent successfully. Check the destination channel/webhook.');
      } catch (error) {
        await interaction.editReply(`❌ Test failed: ${error.message}`);
      }
      return;
    }

    const sourceChannel = interaction.options.getChannel('source_channel') || interaction.channel;
    const destinationWebhook = trimId(interaction.options.getString('destination_webhook'));
    const destinationChannelId = trimId(interaction.options.getString('destination_channel_id'));
    const allowedTypes = trimId(interaction.options.getString('allowed_types')) || 'all';
    const maxSizeMb = interaction.options.getInteger('max_size_mb') ?? maxSizeMbDefault();
    const forwardText = interaction.options.getBoolean('forward_text');
    const forwardEmbeds = interaction.options.getBoolean('forward_embeds');
    const showAuthor = interaction.options.getBoolean('show_author');
    const enabled = interaction.options.getBoolean('enabled');

    if (!sourceChannel?.id || !sourceChannel.isTextBased?.()) {
      await interaction.reply({ content: '❌ The source channel must be a text-based channel.', ephemeral: true });
      return;
    }

    if (!destinationWebhook && !destinationChannelId) {
      await interaction.reply({
        content: '❌ Provide either `destination_webhook` or `destination_channel_id`.',
        ephemeral: true,
      });
      return;
    }

    if (destinationWebhook && destinationChannelId) {
      await interaction.reply({
        content: '❌ Choose only one destination type: webhook OR destination channel ID.',
        ephemeral: true,
      });
      return;
    }

    if (destinationWebhook && !isWebhookUrl(destinationWebhook)) {
      await interaction.reply({ content: '❌ The destination webhook URL is invalid.', ephemeral: true });
      return;
    }

    let destinationMeta = {
      destinationType: destinationWebhook ? 'webhook' : 'channel',
      destinationChannelId: null,
      destinationGuildId: null,
      destinationGuildName: null,
      destinationChannelName: null,
      destWebhook: destinationWebhook || null,
    };

    if (destinationChannelId) {
      if (!isSnowflake(destinationChannelId)) {
        await interaction.reply({ content: '❌ `destination_channel_id` must be a valid Discord channel ID.', ephemeral: true });
        return;
      }

      const checked = await validateDestinationChannelAccess(
        interaction.client,
        destinationChannelId,
        interaction.guildId,
        interaction.user.id,
      );
      if (!checked.ok) {
        await interaction.reply({ content: `❌ ${checked.message}`, ephemeral: true });
        return;
      }

      destinationMeta = {
        destinationType: 'channel',
        destinationChannelId: checked.destination.id,
        destinationGuildId: checked.destination.guildId || null,
        destinationGuildName: checked.destination.guild?.name || null,
        destinationChannelName:
          checked.destination.name ||
          checked.destination.id,
        destWebhook: null,
      };
    }

    const rule = addForward({
      guildId: interaction.guildId,
      sourceGuildId: interaction.guildId,
      sourceGuildName: interaction.guild?.name || null,
      sourceChannelId: sourceChannel.id,
      sourceChannelName: sourceChannel.name || sourceChannel.id,
      createdBy: interaction.user.id,
      updatedBy: interaction.user.id,
      allowedFileTypes: allowedTypes,
      maxFileSizeBytes: maxSizeMb * 1024 * 1024,
      forwardText: forwardText ?? true,
      forwardEmbeds: forwardEmbeds ?? false,
      showAuthor: showAuthor ?? true,
      enabled: enabled ?? true,
      ...destinationMeta,
    });

    await interaction.reply({
      content:
        `✅ Forwarding rule created.\n\n` +
        `${createRuleSummary(rule)}\n\n` +
        `Supported type shortcuts: ${SUPPORTED_FORWARD_TYPES.slice(0, 12).join(', ')}…\n` +
        `Security note: this bot will only use the official Discord Bot API and Discord Webhooks. It will not bypass server permissions or access channels where it has not been invited.`,
      ephemeral: true,
    });
  },
};
