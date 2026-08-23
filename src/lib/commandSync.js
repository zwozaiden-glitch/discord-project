// Single source of truth for loading & registering slash commands.
// Used by both src/index.js (on startup) and src/deploy-commands.js,
// so the bot can never end up with commands registered twice.
import { Collection } from 'discord.js';
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Load every command module from src/commands, guarding against duplicates.
 * @param {Collection} [collection] Optional Collection to populate (client.commands).
 * @returns {Promise<Array>} The loaded command modules.
 */
export async function loadCommandModules(collection) {
  const commandsPath = join(__dirname, '..', 'commands');
  const modules = [];
  const seen = new Map(); // name -> file

  for (const file of readdirSync(commandsPath).filter((f) => f.endsWith('.js')).sort()) {
    const command = (await import(pathToFileURL(join(commandsPath, file)))).default;
    if (!command?.data || !command?.execute) {
      console.warn(`[WARN] Command ${file} is missing "data" or "execute".`);
      continue;
    }
    if (seen.has(command.data.name)) {
      // Two files with the same command name would make Discord reject the
      // whole registration, leaving stale commands behind. Skip the dupe.
      console.warn(
        `[WARN] Duplicate command name "${command.data.name}" in ${file} ` +
          `(already defined in ${seen.get(command.data.name)}) — skipping ${file}.`
      );
      continue;
    }
    seen.set(command.data.name, file);
    modules.push(command);
    collection?.set(command.data.name, command);
  }
  return modules;
}

/**
 * Register slash commands in exactly ONE scope:
 *   - GUILD_ID set  → guild commands (instant updates) in that server
 *   - GUILD_ID unset → global commands (all servers, up to 1h to appear)
 *
 * Whatever the other scope contains is cleared, so users never see the
 * same command twice (which happens when the scope was switched between
 * deployments — old global + new guild copies both stay visible).
 * @param {import('discord.js').Client} client A logged-in client.
 */
export async function syncSlashCommands(client) {
  const modules = await loadCommandModules();
  const commands = modules.map((cmd) => cmd.data.toJSON());
  const guildId = (process.env.GUILD_ID || '').trim();

  if (guildId) {
    const guild = await client.guilds.fetch(guildId);
    await guild.commands.set(commands);
    console.log(`✅ Registered ${commands.length} slash command(s) in ${guild.name}`);

    // Remove stale GLOBAL copies so commands don't show up twice.
    const globalCommands = await client.application.commands.fetch();
    if (globalCommands.size > 0) {
      await client.application.commands.set([]);
      console.log(
        `🧹 Cleared ${globalCommands.size} stale global command(s) — they were showing as duplicates.`
      );
    }
  } else {
    await client.application.commands.set(commands);
    console.log(`✅ Registered ${commands.length} global slash command(s)`);

    // Remove stale per-guild copies in every server so commands don't show up twice.
    for (const guild of client.guilds.cache.values()) {
      try {
        const guildCommands = await guild.commands.fetch();
        if (guildCommands.size > 0) {
          await guild.commands.set([]);
          console.log(
            `🧹 Cleared ${guildCommands.size} duplicate command(s) from "${guild.name}" — they were showing as duplicates.`
          );
        }
      } catch (error) {
        console.warn(`[WARN] Could not clean up guild commands in ${guild.name}:`, error.message);
      }
    }
  }
}
