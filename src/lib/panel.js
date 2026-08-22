// Interactive panel: /setup posts an embed with buttons, users redeem keys via
// a modal and view/reset their HWID without typing commands.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { CONFIG } from './config.js';
import { db, save } from './store.js';
import { getScript, getUserWhitelist, claimKey, resetHwidForUser, getCooldownRemaining } from './keySystem.js';
import { formatKey } from './keys.js';
import { sendLog, clientEmbed } from './notify.js';

function button(id, label, style, emoji) {
  return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setEmoji(emoji);
}

function row(...buttons) {
  return new ActionRowBuilder().addComponents(...buttons);
}

export function panelEmbed(client, script, description) {
  const desc =
    description ||
    `Whitelist yourself for **${script}** — redeem a key, check your key or reset your device (HWID) below.`;
  const embed = {
    title: `🔐 ${script}`,
    description: desc,
    color: 0x5865f2,
    timestamp: new Date().toISOString(),
  };
  if (CONFIG.supportUrl) embed.footer = { text: `Need help? ${CONFIG.supportUrl}` };
  else if (client?.user) embed.footer = { text: client.user.username };
  return embed;
}

export function panelRows(script) {
  return [
    row(button(`redeem:${script}`, 'Redeem Key', ButtonStyle.Primary, '🎫')),
    row(
      button(`mykey:${script}`, 'My Key', ButtonStyle.Secondary, '🔑'),
      button(`resethwid:${script}`, 'Reset HWID', ButtonStyle.Success, '🔄')
    ),
  ];
}

export async function createPanel(client, channel, script, description) {
  const message = await channel.send({
    embeds: [panelEmbed(client, script, description)],
    components: panelRows(script),
  });
  db.panels[script] = {
    channelId: channel.id,
    messageId: message.id,
    description: description || null,
    updatedAt: new Date().toISOString(),
  };
  save('panels');
  return message;
}

export async function removePanel(client, script) {
  const panel = db.panels[script];
  if (!panel) return false;
  try {
    const channel = await client.channels.fetch(panel.channelId);
    const message = await channel?.messages?.fetch?.(panel.messageId);
    await message?.delete?.();
  } catch {
    // Message may already be gone — that's fine.
  }
  delete db.panels[script];
  save('panels');
  return true;
}

function redeemModal(script) {
  const modal = new ModalBuilder().setCustomId(`redeemmodal:${script}`).setTitle(`Redeem Key — ${script}`);
  const keyInput = new TextInputBuilder()
    .setCustomId('key')
    .setLabel('Your key')
    .setPlaceholder('LSN-XXXXX-XXXXX-XXXXX')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(64)
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(keyInput));
  return modal;
}

const CLAIM_MESSAGES = {
  invalid: 'That does not look like a valid key. Check for missing/extra characters.',
  not_found: 'Key not found. Double-check it was copied completely.',
  wrong_script: 'That key belongs to a different script.',
  voided: 'This key has been revoked. Ask an admin for a new one.',
  expired: 'This key has expired. Ask an admin for a new one.',
  claimed: 'This key belongs to someone else.',
};

// Routes every panel interaction. Returns true if it was handled.
export async function handlePanelInteraction(interaction) {
  if (!interaction.isButton() && !interaction.isModalSubmit()) return false;
  const [action, script] = interaction.customId.split(':');
  if (!['redeem', 'mykey', 'resethwid', 'redeemmodal'].includes(action)) return false;
  if (!getScript(script)) {
    await interaction.reply({ content: '❌ This panel is for an unknown script.', ephemeral: true });
    return true;
  }

  if (action === 'redeem' && interaction.isButton()) {
    await interaction.showModal(redeemModal(script));
    return true;
  }

  if (action === 'redeemmodal' && interaction.isModalSubmit()) {
    const keyInput = interaction.fields.getTextInputValue('key');
    const result = claimKey(keyInput, interaction.user.id, script);
    if (!result.ok) {
      await interaction.reply({
        content: `❌ ${CLAIM_MESSAGES[result.reason] || 'Invalid key.'}`,
        ephemeral: true,
      });
      return true;
    }
    sendLog(
      interaction.client,
      clientEmbed(
        interaction.client,
        '🎫 Key redeemed (panel)',
        `${interaction.user} redeemed \`${formatKey(result.raw)}\` for **${script}**.`,
        0x57f287,
      ),
      interaction.guild?.id
    );

    await interaction.reply({
      content: `✅ You are whitelisted for **${script}**!\nYour key: \`${formatKey(result.raw)}\`\nRun the script — the first run binds this account to it.`,
      ephemeral: true,
    });
    return true;
  }

  if (action === 'mykey' && interaction.isButton()) {
    const entry = getUserWhitelist(interaction.user.id, script)[0];
    if (!entry) {
      await interaction.reply({ content: '🔑 You do not have a key for this script yet.', ephemeral: true });
      return true;
    }
    const rec = db.keys[entry.key];
    const lines = [
      `**Script:** ${script}`,
      `**Key:** \`${formatKey(entry.key)}\``,
      `**Status:** ${rec?.voided ? '❌ Revoked' : rec?.expiresAt && Date.parse(rec.expiresAt) < Date.now() ? '❌ Expired' : '✅ Valid'}`,
      `**Bound to:** \`${rec?.hwid ? `${rec.hwid.slice(0, 24)}…` : 'not yet — the first run of the script binds it'}\``,
    ];
    if (rec?.expiresAt) lines.push(`**Expires:** <t:${Math.floor(Date.parse(rec.expiresAt) / 1000)}:R>`);
    await interaction.reply({ content: lines.join('\n'), ephemeral: true });
    return true;
  }

  if (action === 'resethwid' && interaction.isButton()) {
    const entry = getUserWhitelist(interaction.user.id, script)[0];
    if (!entry) {
      await interaction.reply({ content: 'You do not have a key for this script yet.', ephemeral: true });
      return true;
    }
    await interaction.deferReply({ ephemeral: true });
    const cd = getCooldownRemaining(interaction.user.id);
    if (cd > 0) {
      await interaction.editReply({
        content: `⏳ HWID reset is on cooldown. Try again <t:${Math.floor((Date.now() + cd) / 1000)}:R>.`,
      });
      return true;
    }
    const result = resetHwidForUser(interaction.user.id, { script, admin: false });
    if (!result.ok) {
      await interaction.editReply({ content: '⚠️ HWID reset is on cooldown.' });
      return true;
    }
    sendLog(
      interaction.client,
      clientEmbed(
        interaction.client,
        '🔄 HWID reset (panel)',
        `${interaction.user} reset their HWID for **${script}**.`,
        0x5865f2,
      ),
      interaction.guild?.id
    );

    await interaction.editReply({
      content: `🔄 HWID reset for **${script}**. The key is unbound — the next run of the script will bind the new device.`,
    });
    return true;
  }

  return false;
}
