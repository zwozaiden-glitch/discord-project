# Discord Project

A Discord bot built with [discord.js](https://discord.js.org/) v14, with a complete **script key / whitelist system** (like Luarmor-style bots), slash commands, interactive panels and a validation API for your scripts.

## Features

- ⚡ Slash commands + auto-registration on startup
- 👑 **No env config needed** — `/claimowner` makes you the bot owner, `/setlog` picks the log channel, API token auto-generates on first boot
- 🔐 **Key system**: `/generatekey`, `/bulkgen`, `/whitelist`, `/blacklist`, `/deletekey`, `/keydrop`, `/redeem`, `/keyinfo`, `/resethwid`, `/scripts`, `/setup`, `/unsetup`
- 🎫 **Interactive panels** — post a panel in a channel: users click **Redeem Key / My Key / Reset HWID** (no commands needed)
- 🔑 **HWID locking** — first run binds the key to the user's device; sharing = `HWID mismatch`
- 🛡️ **Blacklist** — revokes the key *and* blocks validation forever, even with new keys
- ⏳ Key expiry + auto-renewal for active users, HWID reset cooldowns
- 🌐 **HTTP validation API** (`/api/v1/validate`) so your Luasnapper script can check keys/HWIDs directly
- 🧩 Modular structure — drop a file into `src/commands/` or `src/events/` and it's auto-loaded
- 🔐 Secrets kept in `.env` (never committed); data stored as JSON in `data/`

## Project structure

```
src/
├── index.js              # Bot entry point (loads commands & events, starts API)
├── deploy-commands.js    # Registers slash commands with Discord
├── commands/             # /ping, /server + all key-system commands
├── events/
│   ├── ready.js          # Fired once when the bot logs in
│   └── interactionCreate.js  # Routes commands, panels, modals & autocomplete
└── lib/
    ├── keySystem.js      # Core key/whitelist/HWID logic
    ├── store.js          # JSON file database
    ├── settings.js       # Owner claim, log channels, API token
    ├── keys.js           # Key format/generate/normalize
    ├── panel.js          # Interactive panel buttons + redeem modal
    ├── api.js            # HTTP validation API
    ├── permissions.js    # Admin checks
    ├── config.js         # Env config
    └── notify.js         # DM + log-channel helpers
```

## Setup

1. **Create a Discord application** → [Developer Portal](https://discord.com/developers/applications) → **New Application**
   - **Bot** → Reset Token → copy it; turn ON **Message Content Intent**
   - **General Information** → copy the **Application ID**

2. **Invite the bot**: OAuth2 → URL Generator → scopes `bot` + `applications.commands` → permissions `Send Messages`, `Embed Links`, `Manage Roles` (for role-based whitelisting) → open the URL → pick your server

3. **Configure**:
   ```bash
   cd discord-project
   npm install
   cp .env.example .env
   # edit .env — see KEY-SYSTEM-GUIDE.md for every option
   ```

4. **Run**:
   ```bash
   npm start        # commands auto-register on startup
   npm run dev      # auto-restart on file changes
   npm test         # run the key-system smoke tests
   ```

## Quick start (key system)

```bash
/setup script: luasnapper channel: #whitelist   # post the panel
/bulkgen script: luasnapper amount: 10 duration: 7d
/whitelist script: luasnapper user: @buyer duration: 30d
/keydrop script: luasnapper amount: 3           # public drop
/blacklist script: luasnapper user: @leaker     # revoke + block
```

➡️ Full docs: [KEY-SYSTEM-GUIDE.md](KEY-SYSTEM-GUIDE.md)

## Hosting

See [CHROMEBOOK-GUIDE.md](CHROMEBOOK-GUIDE.md) (Railway, no coding) or [SETUP-GUIDE.md](SETUP-GUIDE.md) (run on your PC).

## License

MIT
