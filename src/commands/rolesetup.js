import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { ensureAdmin } from '../lib/permissions.js';
import { getServerRoles, setBuyerRole, setServerRoles } from '../lib/settings.js';

const ROLE_PRESET = [
  {
    name: 'Admin',
    color: 0xed4245,
    hoist: true,
    permissions: [PermissionFlagsBits.Administrator],
  },
  {
    name: 'Moderator',
    color: 0xfee75c,
    hoist: true,
    permissions: [
      PermissionFlagsBits.ViewAuditLog,
      PermissionFlagsBits.ManageMessages,
      PermissionFlagsBits.ModerateMembers,
      PermissionFlagsBits.KickMembers,
      PermissionFlagsBits.BanMembers,
    ],
  },
  {
    name: 'Support',
    color: 0x5865f2,
    hoist: true,
    permissions: [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory],
  },
  {
    name: 'Developer',
    color: 0x9b59b6,
    hoist: true,
    permissions: [],
  },
  {
    name: 'Buyer',
    color: 0x57f287,
    hoist: false,
    permissions: [],
  },
  {
    name: 'Member',
    color: 0x95a5a6,
    hoist: false,
    permissions: [],
  },
  {
    name: 'Muted',
    color: 0x4f545c,
    hoist: false,
    permissions: [],
  },
];

function mutedOverwrite(channel) {
  const deny = {};
  if (channel.type === ChannelType.GuildCategory || channel.isTextBased?.()) {
    deny.SendMessages = false;
    deny.AddReactions = false;
    deny.CreatePublicThreads = false;
    deny.CreatePrivateThreads = false;
    deny.SendMessagesInThreads = false;
  }
  if (channel.type === ChannelType.GuildCategory || channel.isVoiceBased?.()) {
    deny.Speak = false;
    deny.Stream = false;
  }
  return deny;
}

export default {
  data: new SlashCommandBuilder()
    .setName('rolesetup')
    .setDescription('Creates a ready-made role set for this server.'),

  async execute(interaction) {
    if (!(await ensureAdmin(interaction))) return;
    if (!interaction.guild) {
      return interaction.reply({ content: 'This command only works in a server.', ephemeral: true });
    }

    const me = interaction.guild.members.me || (await interaction.guild.members.fetchMe());
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({
        content: '❌ I need **Manage Roles**. Also place my bot role above the roles I need to manage.',
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });
    await interaction.guild.roles.fetch().catch(() => {});

    const stored = getServerRoles(interaction.guild.id);
    const resolved = {};
    const created = [];
    const existing = [];
    const failed = [];

    // Creating these from highest to lowest gives them the intended relative
    // order because Discord inserts each new role just above @everyone.
    for (const definition of ROLE_PRESET) {
      let role = stored[definition.name]
        ? interaction.guild.roles.cache.get(stored[definition.name])
        : null;
      if (!role) {
        role = interaction.guild.roles.cache.find(
          (candidate) =>
            !candidate.managed &&
            candidate.id !== interaction.guild.roles.everyone.id &&
            candidate.name.toLowerCase() === definition.name.toLowerCase()
        );
      }

      if (role) {
        resolved[definition.name] = role.id;
        existing.push(role);
        continue;
      }

      try {
        role = await interaction.guild.roles.create({
          name: definition.name,
          color: definition.color,
          hoist: definition.hoist,
          mentionable: false,
          permissions: definition.permissions,
          reason: `Server role setup requested by ${interaction.user.tag}`,
        });
        resolved[definition.name] = role.id;
        created.push(role);
      } catch (error) {
        console.error(`Failed to create ${definition.name} role:`, error);
        failed.push(definition.name);
      }
    }

    setServerRoles(interaction.guild.id, resolved);

    // Connect the preset Buyer role to the existing key system. Script-specific
    // buyer-role settings still take priority over this guild-wide default.
    if (resolved.Buyer) setBuyerRole(interaction.guild.id, null, resolved.Buyer);

    // A role cannot deny chat permissions globally, so apply Muted denies to
    // every current channel/category. Future channels should inherit from a
    // configured category or have the overwrite applied manually.
    let mutedUpdated = 0;
    let mutedTotal = 0;
    const mutedRole = resolved.Muted
      ? interaction.guild.roles.cache.get(resolved.Muted)
      : null;

    if (mutedRole) {
      await interaction.guild.channels.fetch().catch(() => {});
      const channels = [...interaction.guild.channels.cache.values()].filter(
        (channel) => channel.permissionOverwrites?.edit && !channel.isThread?.()
      );
      mutedTotal = channels.length;

      for (const channel of channels) {
        const overwrite = mutedOverwrite(channel);
        if (!Object.keys(overwrite).length) {
          mutedTotal -= 1;
          continue;
        }
        try {
          await channel.permissionOverwrites.edit(mutedRole, overwrite, {
            reason: `Muted role setup requested by ${interaction.user.tag}`,
          });
          mutedUpdated += 1;
        } catch {
          // Report the partial count below; one locked channel should not stop setup.
        }
      }
    }

    const lines = ['✅ **Server role setup complete.**'];
    if (created.length) lines.push(`**Created:** ${created.join(', ')}`);
    if (existing.length) {
      lines.push(`**Already existed:** ${existing.join(', ')} *(permissions unchanged)*`);
    }
    if (resolved.Buyer) lines.push(`**Auto buyer role:** <@&${resolved.Buyer}>`);
    if (resolved.Muted) {
      lines.push(`**Muted restrictions:** applied to ${mutedUpdated}/${mutedTotal} current channels`);
    }
    if (failed.length) lines.push(`**Could not create:** ${failed.join(', ')}`);
    if (mutedUpdated < mutedTotal) {
      lines.push('⚠️ Give me **Manage Channels** in any channels where the Muted overwrite failed.');
    }
    lines.push('Roles are not assigned automatically; assign staff/member roles from Discord’s server settings.');

    await interaction.editReply(lines.join('\n'));
  },
};
