# Discord Project

A Discord bot built with [discord.js](https://discord.js.org/) v14, with a complete **script key / whitelist system** (like Luarmor/Polsec-style bots), slash commands, interactive panels, script protection, analytics and a validation API for your scripts.

🌐 **Made by Zwoz** — Protect-Vmax

## Features

- ⚡ Slash commands + auto-registration on startup
- 👑 **No env config needed** — `/claimowner` makes you the bot owner, `/setlog` picks the log channel, API token auto-generates on first boot
- 🔐 **Key system**: `/generatekey`, `/bulkgen`, `/whitelist`, `/blacklist`, `/deletekey`, `/keydrop`, `/redeem`, `/keyinfo`, `/resethwid`, `/scripts`, `/setup`, `/unsetup`
- 📦 **Script protection** — `/apply` uploads your `.lua`; the bot wraps it with a runtime whitelist check and users get a Protect-Vmax loader from **Get Script** / `/getscript`
- 🎫 **Interactive panels** — users click **Redeem Key / Get Script / My Key / Reset HWID** buttons (no commands needed)
- 🏷️ **Auto buyer roles** — `/setbuyerrole` assigns a role automatically when users redeem; whitelist whole roles with `/whitelist role:`
- 📊 **Analytics** — `/analytics` shows runs per day, top keys, HWID/status activity (keys & HWIDs masked)
- 🔑 **HWID locking** — first run binds the key to the user's device; sharing = `HWID mismatch`
- 🛡️ **Blacklist** — revokes the key *and* blocks validation forever, even with new keys
- ⏳ Key expiry + auto-renewal for active users, HWID reset cooldowns
- 🌐 **HTTP API** — `/api/v1/validate` + `/api/v1/load` for scripts; `/api/v1/status` + `/api/v1/key` (token auth) for management
- 🧩 Modular structure — drop a file into `src/commands/` or `src/events/` and it's auto-loaded
- 🔐 Secrets kept in `.env` (never committed); data stored as JSON in `data/`

## Project structure

```
src/
├── index.js              # Bot entry point (loads commands & events, starts API)
├── deploy-commands.js    # Registers slash commands with Discord
├── commands/             # /ping, /server + all key-system & protection commands
├── events/
│   ├── ready.js          # Fired once when the bot logs in
│   └── interactionCreate.js  # Routes commands, panels, modals & autocomplete
└── lib/
    ├── keySystem.js      # Core key/whitelist/HWID logic
    ├── store.js          # JSON file database
    ├── settings.js       # Owner claim, log channel, buyer roles, API token
    ├── keys.js           # Key format/generate/normalize
    ├── panel.js          # Interactive panel buttons + redeem modal
    ├── protect.js        # Wraps scripts with the runtime whitelist check
    ├── analytics.js      # Validation run analytics
    ├── roles.js          # Auto buyer role assignment
    ├── api.js            # HTTP validation/load/status API
    ├── permissions.js    # Admin checks
    ├── config.js         # Env config
    └── notify.js         # DM + log-channel helpers
```

## Setup

1. **Create a Discord application** → [Developer Portal](https://discord.com/developers/applications)
   - **Bot** → Reset Token → copy it; turn ON **Message Content Intent**
   - **General Information** → copy the **Application ID**

2. **Invite the bot**: OAuth2 → URL Generator → scopes `bot` + `applications.commands` → permissions `Send Messages`, `Embed Links`, `Manage Roles` → open the URL → invite

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

## Quick start

```bash
/claimowner                                    # you become the bot owner
/setlog channel: #logs                         # audit log channel
/setbuyerrole role: @Buyers                    # auto role on redeem
/setup script: luasnapper channel: #whitelist  # post the panel
/apply script: luasnapper file: myscript.lua   # upload + protect script
/getscript script: luasnapper                  # get the Protect-Vmax loader
/bulkgen script: luasnapper amount: 10 duration: 7d   # make keys
/whitelist script: luasnapper user: @buyer     # give a buyer a key
/keydrop script: luasnapper amount: 3          # public drop
/analytics                                     # see script activity
```

➡️ Full docs: [KEY-SYSTEM-GUIDE.md](KEY-SYSTEM-GUIDE.md)

## Hosting

See [CHROMEBOOK-GUIDE.md](CHROMEBOOK-GUIDE.md) (Railway, no coding) or [SETUP-GUIDE.md](SETUP-GUIDE.md) (run on your PC).

## License

MIT — made with 💜 by Zwoz.
