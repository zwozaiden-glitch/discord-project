import { SlashCommandBuilder } from 'discord.js';
import { ensureAdmin } from '../lib/permissions.js';
import {
  ensureScript,
  makeKey,
  isWhitelisted,
  getUserWhitelist,
} from '../lib/keySystem.js';
import { formatKey, maskKey } from '../lib/keys.js';
import { sendDM, sendLog, clientEmbed } from '../lib/notify.js';
import { grantBuyerRole } from '../lib/roles.js';

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

    const record = await ensureScript(script);

    // ---- Single user ----
    if (user) {
      if (isWhitelisted(record.name, user.id)) {
        const existing = getUserWhitelist(user.id, record.name)[0];
        return interaction.reply({
          content: `ℹ️ <@${user.id}> is already whitelisted for **${record.name}** — key \`${maskKey(existing.key)}\`. Use \`/deletekey\` first to replace it.`,
          ephemeral: true,
        });
      }

      const raw = makeKey(record.name, { duration, createdBy: interaction.user.id, claimedBy: user.id });
      const formatted = formatKey(raw);
      const sent = await sendDM(interaction.client, user.id, {
        content: `🎫 You have been whitelisted for **${record.name}**!\nYour key: \`${formatted}\`\nRun the script — the first run binds this account (HWID) to it.`,
      });

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
      await grantBuyerRole(interaction.client, interaction.guild?.id, record.name, user.id);

      return interaction.reply({
        content: `✅ Whitelisted <@${user.id}> for **${record.name}** \`(${duration})\`.\nKey: \`${formatted}\`${sent ? '' : '\n⚠️ Could not DM them — send the key yourself!'}`,
        ephemeral: true,
      });
    }

    // ---- Everyone with a role ----
    await interaction.deferReply({ ephemeral: true });
    let members;
    try {
      await interaction.guild.members.fetch();
      members = [...(await interaction.guild.roles.fetch(role.id)).members.values()];
    } catch {
      return interaction.editReply({ content: '❌ Could not fetch role members (missing permission?).' });
    }

    let done = 0;
    const already = [];
    for (const member of members) {
      if (isWhitelisted(record.name, member.id)) {
        already.push(member.user.username);
        continue;
      }
      const raw = makeKey(record.name, { duration, createdBy: interaction.user.id, claimedBy: member.id });
      await sendDM(interaction.client, member.id, {
        content: `🎫 You have been whitelisted for **${record.name}**!\nYour key: \`${formatKey(raw)}\`\nRun the script — the first run binds this account (HWID) to it.`,
      });
      done += 1;
    }

    sendLog(
      interaction.client,
      clientEmbed(
        interaction.client,
        `✅ Role whitelist (${done})`,
        `${interaction.user} whitelisted <@&${role.id}> (**${members.length} members**) for **${record.name}** (${duration}).`,
        0x57f287,
      ),
      interaction.guild?.id
    );

    const summary = [
      `✅ Whitelisted **${done}** member(s) with <@&${role.id}> for **${record.name}** \`(${duration})\`.`,
      already.length ? `ℹ️ Already whitelisted (skipped): ${already.slice(0, 20).join(', ')}${already.length > 20 ? ` +${already.length - 20} more` : ''}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    await interaction.editReply({ content: summary });
  },
};
