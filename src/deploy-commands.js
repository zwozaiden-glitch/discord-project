// Manual slash-command deployment. Uses the exact same sync logic as the
// bot's startup (src/lib/commandSync.js), so it can never register commands
// in a different scope than the bot itself — which caused every command to
// show up twice in Discord.
//
// Scope (same as startup):
//   - GUILD_ID set   → registers in that one guild (instant) and clears globals
//   - GUILD_ID unset → registers globally (up to 1h to appear) and clears guild copies
import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import { syncSlashCommands } from './lib/commandSync.js';

const token = (process.env.DISCORD_TOKEN || '').trim();
if (!token) {
  console.error('❌ DISCORD_TOKEN is not set. Add it to .env / Railway Variables first.');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

try {
  await client.login(token);
  await syncSlashCommands(client);
  await client.destroy();
} catch (error) {
  console.error('❌ Failed to deploy commands:', error);
  process.exitCode = 1;
  await client.destroy().catch(() => {});
}
