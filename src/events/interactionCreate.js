import { Events } from 'discord.js';
import { handlePanelInteraction } from '../lib/panel.js';

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

    // Panel buttons + redeem modal
    if (interaction.isButton() || interaction.isModalSubmit()) {
      const handled = await handlePanelInteraction(interaction);
      if (handled) return;
    }

    if (!interaction.isChatInputCommand()) return;

    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) {
      console.warn(`No command matching "${interaction.commandName}" was found.`);
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
