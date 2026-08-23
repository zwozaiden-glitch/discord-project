# Discord Project

A Discord bot built with [discord.js](https://discord.js.org/) v14, with a complete **script key / whitelist system** (like Luarmor/Polsec-style bots), slash commands, interactive panels, script protection, analytics, web landing page, and a validation API for your scripts.

🌐 **Made by Zwoz** — Protect-Vmax

## Features

- ⚡ Slash commands + auto-registration on startup
- 👑 **No env config needed** — `/claimowner` makes you the bot owner, `/setlog` picks the log channel, API token auto-generates on first boot
- 🔐 **Key system**: `/generatekey`, `/bulkgen`, `/whitelist`, `/blacklist`, `/deletekey`, `/keydrop`, `/redeem`, `/keyinfo`, `/resethwid`, `/scripts`, `/setup`, `/unsetup`
- 📦 **Script protection** — `/apply` uploads your `.lua`; the bot wraps it with a runtime whitelist check and users get a Protect-Vmax loader from **Get Script** / `/getscript`
- 🎫 **Interactive key panels** — users click **Redeem Key / Get Script / My Key / Reset HWID** buttons (no commands needed)
- 📨 **Private support tickets** — `/ticketsetup` creates an Open Ticket panel with one-ticket-per-user protection, staff claim/unclaim/close buttons, member add/remove commands, and a dedicated audit log
- 🏷️ **Auto buyer roles** — `/setbuyerrole` assigns a role automatically when users redeem; whitelist whole roles with `/whitelist role:`
- 📊 **Analytics** — `/analytics` shows runs per day, top keys, HWID/status activity (keys & HWIDs masked)
- 🔑 **HWID locking** — first run binds the key to the user's device; sharing = `HWID mismatch`
- 🛡️ **Blacklist** — revokes the key *and* blocks validation forever, even with new keys
- ⏳ Key expiry + auto-renewal for active users, HWID reset cooldowns
- 🌐 **Web Landing Page & HTTP API** — Monochrome Black & White landing page at `/`; `/api/v1/validate` + `/api/v1/load` for scripts; `/api/v1/status` + `/api/v1/key` (token auth) for management
- 🔐 **Discord OAuth login** — the website's "Login with Discord" button redirects to `/callback`, which exchanges the code and shows who logged in (needs `DISCORD_CLIENT_SECRET`; redirect URI = `PUBLIC_URL` + `/callback`)
- 🚂 **Railway 24/7 Hosting Ready** — automatic port binding, railway schema config, volume persistence support
- 🧩 Modular structure — drop a file into `src/commands/` or `src/events/` and it's auto-loaded
- 🔐 Secrets kept in `.env` (never committed); data stored as JSON in `data/`

## Project structure

```
src/
├── index.js              # Bot entry point (loads commands & events, starts Web & API)
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
    ├── panel.js          # Interactive key-panel buttons + redeem modal
    ├── tickets.js        # Ticket panels, private channels, and staff controls
    ├── ticketStore.js    # Persistent ticket configuration/open-ticket records
    ├── protect.js        # Wraps scripts with the runtime whitelist check
    ├── analytics.js      # Validation run analytics
    ├── roles.js          # Auto buyer role assignment
    ├── api.js            # HTTP validation/load/status API & Web static server
    ├── permissions.js    # Admin checks
    ├── config.js         # Env config
    └── notify.js         # DM + log-channel helpers
public/                   # Web landing page assets
├── index.html            # Protect-Vmax Landing Page
├── styles.css            # Black & white design system
├── script.js             # Client scripts, copy loader, status check
└── favicon.svg           # Shield icon
```

## Setup

1. **Create a Discord application** → [Developer Portal](https://discord.com/developers/applications)
   - **Bot** → Reset Token → copy it; turn ON **Message Content Intent**
   - **General Information** → copy the **Application ID**

2. **Invite the bot**: OAuth2 → URL Generator → scopes `bot` + `applications.commands` → permissions `View Channels`, `Send Messages`, `Embed Links`, `Read Message History`, `Manage Channels`, and `Manage Roles` → open the URL → invite

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

# Ticket setup (choose these from Discord's slash-command option menus):
/ticketsetup category: Tickets support_role: @Support log_channel: #ticket-logs panel_channel: #open-a-ticket
```

### Ticket staff workflow

- A member presses **Open Ticket** and receives one private channel. The same member cannot open a second ticket until the first is closed.
- The configured support role can use the **Claim**, **Unclaim**, and **Close** buttons.
- Staff can run `/ticket add user: @member` or `/ticket remove user: @member` inside a ticket.
- Staff or the ticket opener can run `/ticket close reason: ...`; button closes require confirmation.
- Open, claim, unclaim, member-access, and close events are written to the configured ticket log channel.
- Ticket configuration and open-ticket records persist in `DATA_DIR`, so a Railway volume at `/data` is recommended.

➡️ Full key-system docs: [KEY-SYSTEM-GUIDE.md](KEY-SYSTEM-GUIDE.md)

## Hosting on Railway

See [RAILWAY-GUIDE.md](RAILWAY-GUIDE.md) for 24/7 cloud hosting with web landing page, domain generation, Discord OAuth callback, and persistent data volumes.

Also see [CHROMEBOOK-GUIDE.md](CHROMEBOOK-GUIDE.md) (browser-only setup) or [SETUP-GUIDE.md](SETUP-GUIDE.md) (run on your PC).

## License

MIT — made with 💜 by Zwoz.
