import { SlashCommandBuilder } from 'discord.js';
import { ensureAdmin } from '../lib/permissions.js';
import { addForward, isSnowflake, isWebhookUrl, listForwards, removeForward } from '../lib/forward.js';

export default {
  data: new SlashCommandBuilder()
    .setName('forward')
    .setDescription('Forward files and photos from a channel to another channel ID (or webhook).')
    .addSubcommand((sub) =>
      sub
        .setName('setup')
        .setDescription('Start forwarding files/photos to another channel ID or webhook.')
        .addStringOption((o) =>
          o
            .setName('dest')
            .setDescription('Destination channel ID (the channel that should receive every file/photo)')
            .setRequired(true)
        )
        .addChannelOption((o) =>
          o.setName('source').setDescription('Channel to watch (defaults to this channel)')
        )
        .addStringOption((o) =>
          o
            .setName('webhook')
            .setDescription('Destination webhook URL — use this if the bot is NOT in the dest server')
        )
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('List file/photo forward rules in this server.'))
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
    const choices = listForwards(interaction.guildId)
      .map((rule) => ({
        name: `${rule.id}  #${rule.sourceChannelId} → ${rule.destChannelId || 'webhook'}`,
        value: rule.id,
      }))
      .filter((choice) => choice.name.toLowerCase().includes(focused) || choice.value.includes(focused))
      .slice(0, 25);
    await interaction.respond(choices);
  },

  async execute(interaction) {
    if (!(await ensureAdmin(interaction))) return;

    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const rules = listForwards(interaction.guildId);
      if (!rules.length) {
        return interaction.reply({
          content: 'No forward rules yet. Use `/forward setup dest: CHANNEL_ID`.',
          ephemeral: true,
        });
      }
      const lines = rules.map((rule) => {
        const dest = rule.destWebhook ? 'webhook (bot not required in dest)' : `<#${rule.destChannelId}> \`${rule.destChannelId}\``;
        return `• \`${rule.id}\`  <#${rule.sourceChannelId}> → ${dest}  · ${rule.forwarded || 0} file(s)`;
      });
      return interaction.reply({ content: `📨 **Forward rules**\n${lines.join('\n')}`, ephemeral: true });
    }

    if (sub === 'stop') {
      const id = interaction.options.getString('id', true).trim();
      const rule = listForwards(interaction.guildId).find((item) => item.id === id);
      if (!rule) {
        return interaction.reply({ content: '❌ Unknown rule id. Check `/forward list`.', ephemeral: true });
      }
      removeForward(id);
      return interaction.reply({ content: `🛑 Stopped forward \`${id}\`.`, ephemeral: true });
    }

    const destInput = interaction.options.getString('dest', true).trim();
    const webhookInput = (interaction.options.getString('webhook') || '').trim();
    const source = interaction.options.getChannel('source') || interaction.channel;

    if (!source?.id) {
      return interaction.reply({ content: '❌ Could not resolve the source channel.', ephemeral: true });
    }

    const destLooksLikeWebhook = isWebhookUrl(destInput);
    const webhook = webhookInput || (destLooksLikeWebhook ? destInput : '');
    const destId = destLooksLikeWebhook ? null : destInput.replace(/[<#>]/g, '');

    if (webhook && !isWebhookUrl(webhook)) {
      return interaction.reply({
        content: '❌ That webhook URL is invalid. It should look like `https://discord.com/api/webhooks/ID/TOKEN`.',
        ephemeral: true,
      });
    }
    if (!webhook && !isSnowflake(destId)) {
      return interaction.reply({
        content:
          '❌ `dest` must be a channel ID (right-click channel → Copy Channel ID) or a webhook URL.\n' +
          'Enable Developer Mode in Discord settings to copy IDs.',
        ephemeral: true,
      });
    }

    let destChannelId = destId;
    let destWebhook = webhook || null;
    let destNote = '';

    if (!destWebhook && destChannelId) {
      const dest = await interaction.client.channels.fetch(destChannelId).catch(() => null);
      if (dest?.isTextBased?.()) {
        destNote = `Bot can see dest ${dest}. Files will be posted there.`;
      } else {
        return interaction.reply({
          content:
            '❌ I cannot send to that channel ID — I am not in that server (or it is not a text channel).\n\n' +
            '**To forward without the bot in the dest server:**\n' +
            '1. Open the dest channel → Edit Channel → Integrations → Webhooks → New Webhook\n' +
            '2. Copy the webhook URL\n' +
            '3. Re-run `/forward setup dest: CHANNEL_ID webhook: THE_URL`\n\n' +
            'A webhook is the only way Discord allows posting when the bot is not in that server.',
          ephemeral: true,
        });
      }
    } else {
      destNote = 'Dest uses a webhook, so the bot does **not** need to be in that server.';
    }

    const rule = addForward({
      guildId: interaction.guildId,
      sourceChannelId: source.id,
      destChannelId: destWebhook ? destChannelId : destChannelId,
      destWebhook,
      createdBy: interaction.user.id,
    });

    await interaction.reply({
      content:
        `✅ Forward **\`${rule.id}\`** is live.\n` +
        `Watching ${source} for files & photos → ${destWebhook ? 'webhook dest' : `<#${destChannelId}>`}\n` +
        `${destNote}\n` +
        `Stop with \`/forward stop id: ${rule.id}\`.`,
      ephemeral: true,
    });
  },
};
