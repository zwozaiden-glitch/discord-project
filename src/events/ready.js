import { Events } from 'discord.js';
import { syncSlashCommands } from '../lib/commandSync.js';

export default {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(`✅ Logged in as ${client.user.tag}`);

    // Auto-register slash commands on startup (no separate deploy step needed).
    // Also clears the opposite scope so commands never appear twice in Discord.
    try {
      await syncSlashCommands(client);
    } catch (error) {
      console.error('Failed to register slash commands:', error);
    }
  },
};
