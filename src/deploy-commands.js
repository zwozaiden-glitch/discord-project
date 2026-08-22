import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const commands = [];
const commandsPath = join(__dirname, 'commands');
for (const file of readdirSync(commandsPath).filter((f) => f.endsWith('.js'))) {
  const command = (await import(pathToFileURL(join(commandsPath, file)))).default;
  if (command?.data) commands.push(command.data.toJSON());
}

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

try {
  console.log(`Registering ${commands.length} slash command(s)...`);

  // Register to a single guild for instant updates during development.
  // For global registration (takes up to 1h to propagate), use:
  //   Routes.applicationCommands(process.env.CLIENT_ID)
  const route = process.env.GUILD_ID
    ? Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID)
    : Routes.applicationCommands(process.env.CLIENT_ID);

  const data = await rest.put(route, { body: commands });
  console.log(`Successfully registered ${data.length} command(s).`);
} catch (error) {
  console.error(error);
}
