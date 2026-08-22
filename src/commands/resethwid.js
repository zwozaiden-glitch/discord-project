import { SlashCommandBuilder } from 'discord.js';
import { isAdmin } from '../lib/permissions.js';
import { getUserWhitelist, resetHwidForUser } from '../lib/keySystem.js';
import { sendDM, sendLog, clientEmbed } from '../lib/notify.js';

export default {
  data: new SlashCommandBuilder()
    .setName('resethwid')
    .setDescription('Unbinds your HWID from a key (admin: reset for any user with no cooldown).')
    .addStringOption((o) =>
      o.setName('script').setDescription('Script to reset (omitted = all your scripts)').setAutocomplete(true)
    )
    .addUserOption((o) => o.setName('user').setDescription('Admin: reset this user’s HWID')),

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
    const script = interaction.options.getString('script');
    const targetUser = interaction.options.getUser('user');
    const admin = isAdmin(interaction);

    // Self-service path (user or admin resetting themselves).
    if (!targetUser || targetUser.id === interaction.user.id) {
      const entries = getUserWhitelist(interaction.user.id, script || null);
      if (!entries.length) {
        return interaction.reply({
          content: script ? `ℹ️ You have no key for **${script}**.` : 'ℹ️ You have no whitelisted keys yet.',
          ephemeral: true,
        });
      }

      const result = resetHwidForUser(interaction.user.id, { script, admin });
      if (!result.ok) {
        return interaction.reply({
          content: `⏳ HWID reset is on cooldown. Try again <t:${Math.floor((Date.now() + result.cooldownMs) / 1000)}:R>.`,
          ephemeral: true,
        });
      }

      const names = result.reset.map((r) => `**${r.script}**`).join(', ') || (script || 'all scripts');
      sendLog(
        interaction.client,
        clientEmbed(
          interaction.client,
          '🔄 HWID reset',
          `${interaction.user}${admin ? ' (admin)' : ''} reset their HWID for ${names}.`,
          0x5865f2
        )
      );

      return interaction.reply({
        content: `🔄 HWID reset for ${names}. The key is unbound — the next run of the script will bind the new device.`,
        ephemeral: true,
      });
    }

    // Admin resetting someone else — no cooldown is required.
    if (!admin) {
      return interaction.reply({
        content: '⛔ You can only reset **your own** HWID.',
        ephemeral: true,
      });
    }

    const entries = getUserWhitelist(targetUser.id, script || null);
    if (!entries.length) {
      return interaction.reply({
        content: `ℹ️ <@${targetUser.id}> has no key${script ? ` for **${script}**` : ''}.`,
        ephemeral: true,
      });
    }

    const result = resetHwidForUser(targetUser.id, { script, admin: true });
    const names = result.reset.map((r) => `**${r.script}**`).join(', ');
    const dm = await sendDM(interaction.client, targetUser.id, {
      content: `🔄 An admin reset your HWID${names ? ` for ${names}` : ''}. The next run of the script will bind the new device.`,
    });

    sendLog(
      interaction.client,
      clientEmbed(
        interaction.client,
        '🔄 HWID reset (admin)',
        `${interaction.user} reset ${targetUser}'s HWID${names ? ` for ${names}` : ''}.`,
        0x5865f2
      )
    );

    await interaction.reply({
      content: `✅ Reset <@${targetUser.id}>'s HWID${names ? ` for ${names}` : ''}.${dm ? '' : ' ⚠️ Could not DM them.'}`,
      ephemeral: true,
    });
  },
};
