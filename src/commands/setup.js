import { SlashCommandBuilder, ChannelType, PermissionFlagsBits } from 'discord.js';
import { ensureAdmin } from '../lib/permissions.js';
import { ensureScript, listScripts } from '../lib/keySystem.js';
import { createPanel } from '../lib/panel.js';

export default {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Creates a ready-made whitelist panel for this channel.')
    .addStringOption((o) =>
      o.setName('script').setDescription('Script the panel is for').setRequired(true).setAutocomplete(true)
    )
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Channel to post the panel in (defaults to this one)')
        .addChannelTypes(ChannelType.GuildText)
    )
    .addStringOption((o) =>
      o.setName('description').setDescription('Custom text shown on the panel (optional)').setMaxLength(1000)
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().toLowerCase();
    await interaction.respond(
      listScripts()
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

    const scriptName = interaction.options.getString('script', true).trim();
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    const description = interaction.options.getString('description');

    const me = channel.guild.members.me;
    if (!channel.permissionsFor(me).has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
      return interaction.reply({
        content: `❌ I need **View Channel**, **Send Messages** and **Embed Links** in ${channel} to post a panel there.`,
        ephemeral: true,
      });
    }

    const script = await ensureScript(scriptName);
    const message = await createPanel(interaction.client, channel, script.name, description);
    const location = channel.id === interaction.channel.id ? '' : ` in ${channel}`;

    await interaction.reply({
      content: `✅ Panel created${location} for **${script.name}**: ${message.url}`,
      ephemeral: true,
    });
  },
};
