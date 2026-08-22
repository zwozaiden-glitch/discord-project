import { SlashCommandBuilder } from 'discord.js';
import { ensureAdmin } from '../lib/permissions.js';
import {
  ensureScript,
  blacklistUser,
  unblacklistUser,
  isBlacklisted,
  getUserWhitelist,
} from '../lib/keySystem.js';
import { formatKey } from '../lib/keys.js';
import { sendLog, clientEmbed } from '../lib/notify.js';

export default {
  data: new SlashCommandBuilder()
    .setName('blacklist')
    .setDescription('Blacklists a user from a script — deletes their key and revokes access.')
    .addStringOption((o) =>
      o.setName('script').setDescription('Script to blacklist from').setRequired(true).setAutocomplete(true)
    )
    .addUserOption((o) => o.setName('user').setDescription('User to blacklist'))
    .addRoleOption((o) => o.setName('role').setDescription('Blacklist everyone with this role'))
    .addStringOption((o) => o.setName('reason').setDescription('Reason shown to the user (optional)').setMaxLength(300)),

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
    const reason = interaction.options.getString('reason');

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
      if (isBlacklisted(record.name, user.id)) {
        unblacklistUser(record.name, user.id);
        sendLog(
          interaction.client,
          clientEmbed(
            interaction.client,
            '♻️ Blacklist cleared',
            `${interaction.user} unblacklisted ${user} for **${record.name}**.`,
            0x5865f2
          )
        );
        return interaction.reply({
          content: `♻️ <@${user.id}> was already blacklisted — **removed from the blacklist**. They are not whitelisted; run \`/whitelist\` to re-grant a key.`,
          ephemeral: true,
        });
      }

      const existing = getUserWhitelist(user.id, record.name)[0];
      const result = blacklistUser(record.name, user.id, {
        reason,
        by: interaction.user.id,
      });

      sendLog(
        interaction.client,
        clientEmbed(
          interaction.client,
          '⛔ User blacklisted',
          `${interaction.user} blacklisted ${user} from **${record.name}**${reason ? ` — ${reason}` : ''}.`,
          0xed4245
        )
      );

      const lines = [`⛔ Blacklisted <@${user.id}> from **${record.name}**.`];
      if (result.removed) lines.push(`Their key \`${formatKey(result.raw)}\` was deleted and revoked.`);
      if (!result.removed && existing) lines.push('Their key was already gone.');
      if (!result.removed && !existing) lines.push('They had no key, but are now blocked from validating.');
      return interaction.reply({ content: lines.join('\n'), ephemeral: true });
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

    let blacklisted = 0;
    let hadKey = 0;
    for (const member of members) {
      const before = isBlacklisted(record.name, member.id);
      const result = blacklistUser(record.name, member.id, { reason, by: interaction.user.id });
      if (!before) blacklisted += 1;
      if (result.removed) hadKey += 1;
    }

    sendLog(
      interaction.client,
      clientEmbed(
        interaction.client,
        `⛔ Role blacklist (${blacklisted})`,
        `${interaction.user} blacklisted <@&${role.id}> (**${members.length} members**) from **${record.name}**${reason ? ` — ${reason}` : ''}.`,
        0xed4245
      )
    );

    await interaction.editReply({
      content: `⛔ Blacklisted **${blacklisted}** member(s) with <@&${role.id}> from **${record.name}** (${hadKey} had keys that were revoked).`,
    });
  },
};
