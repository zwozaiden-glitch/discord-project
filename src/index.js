import 'dotenv/config';
import { Client, Collection, GatewayIntentBits } from 'discord.js';
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ---- Load commands ----
client.commands = new Collection();
const commandsPath = join(__dirname, 'commands');
for (const file of readdirSync(commandsPath).filter((f) => f.endsWith('.js'))) {
  const command = (await import(pathToFileURL(join(commandsPath, file)))).default;
  if (command?.data && command?.execute) {
    client.commands.set(command.data.name, command);
  } else {
    console.warn(`[WARN] Command ${file} is missing "data" or "execute".`);
  }
}

// ---- Load events ----
const eventsPath = join(__dirname, 'events');
for (const file of readdirSync(eventsPath).filter((f) => f.endsWith('.js'))) {
  const event = (await import(pathToFileURL(join(eventsPath, file)))).default;
  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args));
  } else {
    client.on(event.name, (...args) => event.execute(...args));
  }
}

// ---- Start the validation API & clean up expired keys ----
const { startApiServer } = await import('./lib/api.js');
const { purgeExpired } = await import('./lib/keySystem.js');

purgeExpired();
startApiServer(client);

client.login(process.env.DISCORD_TOKEN);
