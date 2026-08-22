import { SlashCommandBuilder, ChannelType, PermissionFlagsBits } from 'discord.js';
import { ensureAdmin } from '../lib/permissions.js';
import { setLogChannel } from '../lib/settings.js';
import { clientEmbed, sendLog } from '../lib/notify.js';

export default {
  data: new SlashCommandBuilder()
    .setName('setlog')
    .setDescription('Sets where the bot logs key events (claims, blacklists, keydrops) in this server.')
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Log channel (leave empty if you only want to clear it)')
        .addChannelTypes(ChannelType.GuildText)
    )
    .addBooleanOption((o) => o.setName('clear').setDescription('Stop logging instead of setting a channel')),

  async execute(interaction) {
    if (!(await ensureAdmin(interaction))) return;
    if (!interaction.guild) {
      return interaction.reply({ content: 'This command only works in a server.', ephemeral: true });
    }

    const channel = interaction.options.getChannel('channel');
    const clear = interaction.options.getBoolean('clear') || false;

    if (clear) {
      setLogChannel(interaction.guild.id, null);
      return interaction.reply({ content: '🗑️ Logging stopped for this server.', ephemeral: true });
    }

    if (!channel) {
      return interaction.reply({
        content: '❌ Provide a **channel** to set, or use `clear: true` to stop logging.',
        ephemeral: true,
      });
    }

    const me = interaction.guild.members.me;
    if (!channel.permissionsFor(me).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
      return interaction.reply({
        content: `❌ I need **View Channel**, **Send Messages** and **Embed Links** in ${channel} to log there.`,
        ephemeral: true,
      });
    }

    setLogChannel(interaction.guild.id, channel.id);
    await channel.send({
      embeds: [
        clientEmbed(
          interaction.client,
          '📋 Log channel set',
          `Key events for **${interaction.guild.name}** will be logged here.\nSet by ${interaction.user}.`,
          0x5865f2
        ),
      ],
    });

    await interaction.reply({ content: `✅ Log channel set to ${channel}.`, ephemeral: true });
  },
};
