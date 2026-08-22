# Discord Project

A Discord bot built with [discord.js](https://discord.js.org/) v14, featuring slash commands and a clean, modular command/event structure.

## Features

- ⚡ Slash commands (`/ping`, `/server`)
- 🧩 Modular structure — drop a file into `src/commands/` or `src/events/` and it's auto-loaded
- 🔐 Secrets kept in `.env` (never committed)

## Project structure

```
src/
├── index.js              # Bot entry point (loads commands & events)
├── deploy-commands.js    # Registers slash commands with Discord
├── commands/
│   ├── ping.js           # /ping — latency check
│   └── server.js         # /server — server info embed
└── events/
    ├── ready.js          # Fired once when the bot logs in
    └── interactionCreate.js  # Routes slash commands to handlers
```

## Setup

1. **Create a Discord application**
   - Go to the [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**
   - Under **Bot**, click **Reset Token** and copy the token
   - Under **General Information**, copy the **Application ID**

2. **Invite the bot to your server**
   - Under **OAuth2 → URL Generator**, select scopes `bot` + `applications.commands`
   - Pick the permissions you need, open the generated URL, and invite it

3. **Configure the project**
   ```bash
   git clone <this-repo>
   cd discord-project
   npm install
   cp .env.example .env
   # edit .env with your token, application ID, and (optionally) a guild ID
   ```

4. **Register slash commands**
   ```bash
   npm run deploy-commands
   ```
   With `GUILD_ID` set, commands appear instantly in that server. Without it, they register globally (can take up to an hour).

5. **Run the bot**
   ```bash
   npm start        # production
   npm run dev      # auto-restarts on file changes
   ```

## Adding a command

Create a new file in `src/commands/`, e.g. `hello.js`:

```js
import { SlashCommandBuilder } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('hello')
    .setDescription('Says hello!'),
  async execute(interaction) {
    await interaction.reply(`Hello, ${interaction.user.username}! 👋`);
  },
};
```

Then re-run `npm run deploy-commands` and restart the bot.

## License

MIT
