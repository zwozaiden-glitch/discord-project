import { SlashCommandBuilder } from 'discord.js';
import { ensureAdmin } from '../lib/permissions.js';
import {
  ensureScript,
  makeKey,
  isWhitelisted,
  getUserWhitelist,
  persistKeyState,
} from '../lib/keySystem.js';
import { formatKey, maskKey } from '../lib/keys.js';
import { sendDM, sendLog, clientEmbed } from '../lib/notify.js';
import { grantBuyerRole } from '../lib/roles.js';
import { loaderMessage } from '../lib/loader.js';
import { fetchRoleMembers, mapPool } from '../lib/util.js';
import { db } from '../lib/store.js';

function whitelistDm(script, raw) {
  const hasSource = Boolean(db.scriptsources?.[script]?.source);
  const keyLine = `🎫 You have been whitelisted for **${script}**!\nYour key: \`${formatKey(raw)}\``;
  if (!hasSource) {
    return `${keyLine}\nRun the script — the first run binds this account (HWID) to it.`;
  }
  return `${keyLine}\n\n${loaderMessage(script, raw)}`;
}

export default {
  data: new SlashCommandBuilder()
    .setName('whitelist')
    .setDescription('Whitelist a Discord user or everyone with a role for one of your scripts.')
    .addStringOption((o) =>
      o.setName('script').setDescription('Script to whitelist for').setRequired(true).setAutocomplete(true)
    )
    .addStringOption((o) =>
      o
        .setName('duration')
        .setDescription('How long the key stays valid')
        .addChoices(
          { name: 'Never expires', value: 'never' },
          { name: '1 day', value: '1d' },
          { name: '3 days', value: '3d' },
          { name: '7 days', value: '7d' },
          { name: '30 days', value: '30d' }
        )
    )
    .addUserOption((o) => o.setName('user').setDescription('Whitelist this user (optional)'))
    .addRoleOption((o) => o.setName('role').setDescription('Whitelist everyone with this role (optional)')),

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
    if (!interaction.guild) {
      return interaction.reply({ content: 'This command only works in a server.', ephemeral: true });
    }

    const script = interaction.options.getString('script', true).trim();
    const duration = interaction.options.getString('duration') || 'never';
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

    // Acknowledge immediately — DMs / member fetch / role grants can exceed Discord's 3s window.
    await interaction.deferReply({ ephemeral: true });

    const record = await ensureScript(script);

    // ---- Single user ----
    if (user) {
      if (isWhitelisted(record.name, user.id)) {
        const existing = getUserWhitelist(user.id, record.name)[0];
        return interaction.editReply({
          content: `ℹ️ <@${user.id}> is already whitelisted for **${record.name}** — key \`${maskKey(existing.key)}\`. Use \`/deletekey\` first to replace it.`,
        });
      }

      const raw = makeKey(record.name, { duration, createdBy: interaction.user.id, claimedBy: user.id });
      const formatted = formatKey(raw);
      const [sent] = await Promise.all([
        sendDM(interaction.client, user.id, { content: whitelistDm(record.name, raw) }),
        grantBuyerRole(interaction.client, interaction.guild?.id, record.name, user.id),
      ]);

      sendLog(
        interaction.client,
        clientEmbed(
          interaction.client,
          '✅ User whitelisted',
          `${interaction.user} whitelisted ${user} for **${record.name}** (${duration}).`,
          0x57f287,
        ),
        interaction.guild?.id
      );

      return interaction.editReply({
        content:
          `✅ Whitelisted <@${user.id}> for **${record.name}** \`(${duration})\`.\nKey: \`${formatted}\`${sent ? '' : '\n⚠️ Could not DM them — send the key yourself!'}` +
          (db.scriptsources?.[record.name]?.source ? `\n\n${loaderMessage(record.name, raw)}` : ''),
      });
    }

    // ---- Everyone with a role ----
    let members;
    try {
      members = await fetchRoleMembers(interaction.guild, role.id);
    } catch {
      return interaction.editReply({
        content:
          '❌ Could not fetch role members. Enable **Server Members Intent** in the Discord Developer Portal (Bot → Privileged Gateway Intents) so I can see everyone with that role.',
      });
    }

    if (!members.length) {
      return interaction.editReply({
        content:
          `ℹ️ No members found with <@&${role.id}>. If people should be in that role, enable **Server Members Intent** so I can see them.`,
      });
    }

    const created = [];
    const already = [];
    for (const member of members) {
      if (member.user?.bot) continue;
      if (isWhitelisted(record.name, member.id)) {
        already.push(member.user.username);
        continue;
      }
      const raw = makeKey(record.name, {
        duration,
        createdBy: interaction.user.id,
        claimedBy: member.id,
        persist: false,
      });
      created.push({ member, raw });
    }
    persistKeyState();

    let dmFailed = 0;
    await mapPool(created, 8, async ({ member, raw }) => {
      const [sent] = await Promise.all([
        sendDM(interaction.client, member.id, { content: whitelistDm(record.name, raw) }),
        grantBuyerRole(interaction.client, interaction.guild?.id, record.name, member.id),
      ]);
      if (!sent) dmFailed += 1;
    });

    sendLog(
      interaction.client,
      clientEmbed(
        interaction.client,
        `✅ Role whitelist (${created.length})`,
        `${interaction.user} whitelisted <@&${role.id}> (**${members.length} members**) for **${record.name}** (${duration}).`,
        0x57f287,
      ),
      interaction.guild?.id
    );

    const summary = [
      `✅ Whitelisted **${created.length}** member(s) with <@&${role.id}> for **${record.name}** \`(${duration})\`.`,
      already.length
        ? `ℹ️ Already whitelisted (skipped): ${already.slice(0, 20).join(', ')}${already.length > 20 ? ` +${already.length - 20} more` : ''}`
        : '',
      dmFailed ? `⚠️ Could not DM **${dmFailed}** member(s) — they may have DMs closed.` : '',
    ]
      .filter(Boolean)
      .join('\n');

    await interaction.editReply({ content: summary });
  },
};
