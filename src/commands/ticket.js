import { SlashCommandBuilder } from 'discord.js';
import {
  addTicketMember,
  claimTicket,
  closeTicket,
  removeTicketMember,
  unclaimTicket,
} from '../lib/tickets.js';

export default {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Manages the current support ticket.')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('add')
        .setDescription('Adds a member to this private ticket.')
        .addUserOption((option) =>
          option.setName('user').setDescription('Member to add').setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('remove')
        .setDescription('Removes an added member from this private ticket.')
        .addUserOption((option) =>
          option.setName('user').setDescription('Member to remove').setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('claim').setDescription('Claims this ticket as the responding staff member.')
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('unclaim').setDescription('Releases your claim so another staff member can take it.')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('close')
        .setDescription('Closes and permanently deletes this ticket channel.')
        .addStringOption((option) =>
          option
            .setName('reason')
            .setDescription('Why the ticket is being closed')
            .setMaxLength(300)
        )
    ),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ content: 'This command only works in a server.', ephemeral: true });
    }

    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'add') {
      return addTicketMember(interaction, interaction.options.getUser('user', true));
    }
    if (subcommand === 'remove') {
      return removeTicketMember(interaction, interaction.options.getUser('user', true));
    }
    if (subcommand === 'claim') return claimTicket(interaction);
    if (subcommand === 'unclaim') return unclaimTicket(interaction);
    if (subcommand === 'close') {
      return closeTicket(interaction, interaction.options.getString('reason'));
    }
  },
};
