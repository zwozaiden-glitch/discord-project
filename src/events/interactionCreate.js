import { Events } from 'discord.js';
import { handlePanelInteraction } from '../lib/panel.js';
import { handleTicketInteraction } from '../lib/tickets.js';

export default {
  name: Events.InteractionCreate,
  async execute(interaction) {
    // Slash command autocomplete
    if (interaction.isAutocomplete()) {
      const command = interaction.client.commands.get(interaction.commandName);
      if (command?.autocomplete) {
        try {
          await command.autocomplete(interaction);
        } catch (error) {
          console.error(`Autocomplete failed for /${interaction.commandName}:`, error);
        }
      }
      return;
    }

    // Ticket controls + key-system panel buttons/modals.
    if (interaction.isButton() || interaction.isModalSubmit()) {
      try {
        if (await handleTicketInteraction(interaction)) return;
        if (await handlePanelInteraction(interaction)) return;
      } catch (error) {
        console.error(`Component interaction failed (${interaction.customId}):`, error);
        const reply = { content: '❌ That action failed. Please try again or contact an administrator.', ephemeral: true };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(reply).catch(() => {});
        } else {
          await interaction.reply(reply).catch(() => {});
        }
        return;
      }
    }

    if (!interaction.isChatInputCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) {
      // Usually a stale duplicate from an old registration. The sync on startup
      // removes them; this keeps users informed instead of silently ignoring.
      console.warn(`No command matching "${interaction.commandName}" was found.`);
      await interaction
        .reply({
          content:
            '⚠️ This is an old copy of the command and no longer works. ' +
            'Restart your Discord client (Ctrl+R) — the duplicates disappear after the bot re-synced its commands.',
          ephemeral: true,
        })
        .catch(() => {});
      return;
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(error);
      const reply = { content: 'There was an error while executing this command.', ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply);
      } else {
        await interaction.reply(reply);
      }
    }
  },
};
