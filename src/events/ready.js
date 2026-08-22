import { Events } from 'discord.js';

export default {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(`✅ Logged in as ${client.user.tag}`);

    // Auto-register slash commands on startup (no separate deploy step needed)
    try {
      const commands = client.commands.map((cmd) => cmd.data.toJSON());
      if (process.env.GUILD_ID) {
        // Instant registration in one server (great for testing)
        const guild = await client.guilds.fetch(process.env.GUILD_ID);
        await guild.commands.set(commands);
        console.log(`✅ Registered ${commands.length} slash command(s) in ${guild.name}`);
      } else {
        // Global registration (works in every server, may take up to 1h to appear)
        await client.application.commands.set(commands);
        console.log(`✅ Registered ${commands.length} global slash command(s)`);
      }
    } catch (error) {
      console.error('Failed to register slash commands:', error);
    }
  },
};
