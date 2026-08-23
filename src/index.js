import 'dotenv/config';
import { Client, Collection, GatewayIntentBits } from 'discord.js';
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { loadCommandModules } from './lib/commandSync.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Keep the bot alive: log async errors instead of letting them crash the process.
process.on('unhandledRejection', (err) => {
  console.error('💥 Unhandled promise rejection (bot stays online):', err);
});
process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught exception (bot stays online):', err);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ---- Load commands ----
client.commands = new Collection();
await loadCommandModules(client.commands);

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
const { ensureApiToken, getStoredOwnerId } = await import('./lib/settings.js');

purgeExpired();

// Make sure a validation API token always exists.
const { token: apiToken, generated } = ensureApiToken();
console.log(
  generated
    ? `🔑 Generated API token (save it!): ${apiToken}`
    : `🔑 Validation API token ready (${process.env.API_TOKEN ? 'from API_TOKEN env' : 'from data/settings.json'})`
);
if (!getStoredOwnerId()) {
  console.log('ℹ️ No bot owner yet — run /claimowner in your server (the first person to run it becomes the owner).');
}

// Start HTTP Web & Validation API server on Railway
startApiServer(client);

// Connect Discord Bot
const token = (process.env.DISCORD_TOKEN || '').trim();
if (!token || token === 'your-bot-token-here') {
  console.warn('⚠️ DISCORD_TOKEN is missing or not set.');
  console.warn('🌐 Web landing page & validation API are active on Railway.');
  console.warn('👉 To connect the Discord bot, set DISCORD_TOKEN in Railway (Service -> Variables tab) or .env');
} else {
  client.login(token).catch((err) => {
    console.error('❌ Failed to log in to Discord:', err.message);
    console.error('👉 Please verify your DISCORD_TOKEN in Railway Variables / .env');
  });
}
