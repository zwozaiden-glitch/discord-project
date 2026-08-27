import { SlashCommandBuilder } from 'discord.js';
import { isAdmin } from '../lib/permissions.js';
import {
  addForward,
  describeDest,
  isSnowflake,
  isWebhookUrl,
  listForwards,
  removeForward,
} from '../lib/forward.js';

export default {
  data: new SlashCommandBuilder()
    .setName('forward')
    .setDescription('Copy files and photos from this channel to your DMs or another channel the bot can see.')
    .addSubcommand((sub) =>
      sub
        .setName('setup')
        .setDescription('Start copying files/photos. Members: sent to your DMs. No webhook needed.')
        .addBooleanOption((o) =>
          o.setName('to_me').setDescription('Send every file/photo to YOUR DMs (works as a member)')
        )
        .addStringOption((o) =>
          o
            .setName('dest')
            .setDescription('Channel ID — only works if this bot is already in that server')
        )
        .addChannelOption((o) =>
          o.setName('source').setDescription('Channel to watch (defaults to this channel)')
        )
        .addStringOption((o) =>
          o.setName('webhook').setDescription('Optional webhook URL if a dest admin already gave you one')
        )
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('List your file/photo forward rules.'))
    .addSubcommand((sub) =>
      sub
        .setName('stop')
        .setDescription('Stop a forward rule.')
        .addStringOption((o) =>
          o.setName('id').setDescription('Rule id from /forward list').setRequired(true).setAutocomplete(true)
        )
    ),

  async autocomplete(interaction) {
    if (interaction.options.getSubcommand() !== 'stop') {
      return interaction.respond([]);
    }
    const focused = interaction.options.getFocused().toLowerCase();
    const choices = listForwards(interaction.guildId, {
      userId: interaction.user.id,
      admin: isAdmin(interaction),
    })
      .map((rule) => ({
        name: `${rule.id}  → ${rule.destUserId ? 'your DMs' : rule.destChannelId || 'webhook'}`,
        value: rule.id,
      }))
      .filter((choice) => choice.name.toLowerCase().includes(focused) || choice.value.includes(focused))
      .slice(0, 25);
    await interaction.respond(choices);
  },

  async execute(interaction) {
    const admin = isAdmin(interaction);
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const rules = listForwards(interaction.guildId, { userId: interaction.user.id, admin });
      if (!rules.length) {
        return interaction.reply({
          content:
            'No forward rules yet.\n' +
            'As a member, run `/forward setup to_me: True` — files posted here will be DMed to you.\n' +
            'You do **not** need channel settings or a webhook.',
          ephemeral: true,
        });
      }
      const lines = rules.map(
        (rule) => `• \`${rule.id}\`  <#${rule.sourceChannelId}> → ${describeDest(rule)}  · ${rule.forwarded || 0} file(s)`,
      );
      return interaction.reply({ content: `📨 **Forward rules**\n${lines.join('\n')}`, ephemeral: true });
    }

    if (sub === 'stop') {
      const id = interaction.options.getString('id', true).trim();
      const rule = listForwards(interaction.guildId, { userId: interaction.user.id, admin }).find((item) => item.id === id);
      if (!rule) {
        return interaction.reply({ content: '❌ Unknown rule id. Check `/forward list`.', ephemeral: true });
      }
      removeForward(id);
      return interaction.reply({ content: `🛑 Stopped forward \`${id}\`.`, ephemeral: true });
    }

    const toMe = interaction.options.getBoolean('to_me');
    const destInput = (interaction.options.getString('dest') || '').trim();
    const webhookInput = (interaction.options.getString('webhook') || '').trim();
    const source = interaction.options.getChannel('source') || interaction.channel;

    if (!source?.id) {
      return interaction.reply({ content: '❌ Could not resolve the source channel.', ephemeral: true });
    }

    // Members (and anyone who picks to_me): dump files into their DMs.
    // This needs no dest admin, no webhook, no bot in another server.
    const useDm = toMe === true || (!destInput && !webhookInput);
    if (useDm) {
      try {
        await interaction.user.send(
          '📨 Forward is on. I will DM you files and photos posted in that channel. If you did not get this, enable **Privacy Settings → Direct Messages** for this server.',
        );
      } catch {
        return interaction.reply({
          content:
            '❌ I cannot DM you. Open **User Settings → Privacy & Safety**, allow DMs from server members, then run `/forward setup to_me: True` again.',
          ephemeral: true,
        });
      }

      const rule = addForward({
        guildId: interaction.guildId,
        sourceChannelId: source.id,
        destUserId: interaction.user.id,
        createdBy: interaction.user.id,
      });

      return interaction.reply({
        content:
          `✅ Forward \`${rule.id}\` is live — **as a member, no webhook needed.**\n` +
          `Watching ${source} → **your DMs**.\n` +
          `Stop with \`/forward stop id: ${rule.id}\`.`,
        ephemeral: true,
      });
    }

    if (webhookInput && !isWebhookUrl(webhookInput)) {
      return interaction.reply({
        content: '❌ That webhook URL is invalid.',
        ephemeral: true,
      });
    }

    if (webhookInput && !admin) {
      return interaction.reply({
        content:
          '❌ Members cannot set a webhook dest (you also cannot *create* one without channel settings).\n' +
          'Use `/forward setup to_me: True` instead — files come to your DMs.',
        ephemeral: true,
      });
    }

    const destId = destInput.replace(/[<#>]/g, '');
    if (webhookInput) {
      const rule = addForward({
        guildId: interaction.guildId,
        sourceChannelId: source.id,
        destChannelId: isSnowflake(destId) ? destId : null,
        destWebhook: webhookInput,
        createdBy: interaction.user.id,
      });
      return interaction.reply({
        content: `✅ Forward \`${rule.id}\` → webhook.\nStop with \`/forward stop id: ${rule.id}\`.`,
        ephemeral: true,
      });
    }

    if (!admin) {
      return interaction.reply({
        content:
          '❌ **You don’t need dest admin / webhooks.** Discord will not let a member (or this bot) post into a channel just from an ID.\n\n' +
          'What you *can* do as a member:\n' +
          '• `/forward setup to_me: True` — every file/photo in this channel is DMed to **you**\n\n' +
          'A dest channel ID only works if **this bot is already invited** to that server (an admin there must invite it). Then an admin here can run `/forward setup dest: CHANNEL_ID`.',
        ephemeral: true,
      });
    }

    if (!isSnowflake(destId)) {
      return interaction.reply({
        content:
          '❌ `dest` must be a channel ID (right-click channel → Copy Channel ID).\n' +
          'Or skip dest and use `to_me: True`.',
        ephemeral: true,
      });
    }

    const dest = await interaction.client.channels.fetch(destId).catch(() => null);
    if (!dest?.isTextBased?.()) {
      return interaction.reply({
        content:
          '❌ I cannot send to that channel ID — **I am not in that server.**\n\n' +
          'Members cannot open channel settings or create webhooks, so that path is closed.\n\n' +
          '**Working options:**\n' +
          '1. Ask an admin of the dest server to **invite this bot**, then rerun `/forward setup dest: ID`\n' +
          '2. `/forward setup to_me: True` — files go to **your DMs** (works as a member, no dest admin)',
        ephemeral: true,
      });
    }

    const rule = addForward({
      guildId: interaction.guildId,
      sourceChannelId: source.id,
      destChannelId: destId,
      createdBy: interaction.user.id,
    });

    await interaction.reply({
      content:
        `✅ Forward \`${rule.id}\` is live.\n` +
        `Watching ${source} → ${dest}\n` +
        `Stop with \`/forward stop id: ${rule.id}\`.`,
      ephemeral: true,
    });
  },
};
