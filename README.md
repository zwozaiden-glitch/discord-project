# Discord Project

A Discord bot built with [discord.js](https://discord.js.org/) v14. This repository now includes a production-oriented **Discord attachment forwarding system** that can relay images, videos, documents, and other safe files from monitored source channels into either:

- a **destination Discord webhook** (for servers where the bot is *not* installed), or
- a **destination channel ID** the bot can already access directly.

It also still contains the older Protect-Vmax key-system modules already present in the project.

🌐 **Made by Zwoz** — now extended with **VMax Forwarder Dashboard**

## VMax Forwarder highlights

- **Source → bot → destination webhook/channel** forwarding flow
- `/forward add`, `/forward remove`, `/forward list`, `/forward enable`, `/forward disable`, `/forward test`, `/forward status`
- Multiple forwarding rules at the same time
- Per-rule controls for:
  - source server/channel
  - destination webhook URL or destination channel ID
  - enabled/disabled status
  - allowed file types
  - maximum file size
  - forward text captions on/off
  - forward embeds on/off
  - show original author info on/off
- Duplicate protection with a persistent processed-message / processed-attachment history
- Safe attachment handling with type checks, size checks, timeout-protected downloads, and graceful oversize failures
- Redacted webhook display in commands, logs, and dashboard responses
- Detailed forward history + operational logs persisted in `data/`
- **VMax Forwarder Dashboard** with Discord login, stats cards, rule creation, activity history, error logs, enable/disable, delete, and test-send actions

## Important Discord limitation

This system is intentionally designed around the official Discord rules:

- The bot can only read source channels in servers where it has been invited and granted access.
- For a destination server where the bot is not installed, the destination administrator must intentionally create and provide a **Discord webhook URL**.
- This project does **not** use self-bots, user-account automation, permission bypassing, scraping, or any attempt to access private channels without authorization.

## Features

- ⚡ Slash commands + auto-registration on startup
- 👑 **No env config needed** — `/claimowner` makes you the bot owner, `/setlog` picks the log channel, API token auto-generates on first boot
- 🔐 **Key system**: `/generatekey`, `/bulkgen`, `/whitelist`, `/blacklist`, `/deletekey`, `/keydrop`, `/redeem`, `/keyinfo`, `/resethwid`, `/scripts`, `/setup`, `/unsetup`
- 📦 **Script protection** — `/apply` uploads your `.lua`; the bot wraps it with a runtime whitelist check and users get a Protect-Vmax loader from **Get Script** / `/getscript`
- 🎫 **Interactive key panels** — users click **Redeem Key / Get Script / My Key / Reset HWID** buttons (no commands needed)
- 📨 **Private support tickets** — `/ticketsetup` creates an Open Ticket panel with one-ticket-per-user protection, staff claim/unclaim/close buttons, member add/remove commands, and a dedicated audit log
- 🏷️ **One-command role setup** — `/rolesetup name: Vmax` creates 13 roles such as Admin Vmax, Staff Vmax, Buyer Vmax, Member Vmax, and Muted Vmax
- ✨ **Short feature menu** — `/features` shows all main bot features in one compact list
- 🧬 **Lua deobfuscator** — `/deobf` auto-detects Luraph, IronBrew2, MoonSec V2/V3, WeAreDevs, Prometheus, AztupBrew (or pick one) then returns a cleaned `.lua` file
- 🧪 **ENV logger** — `/envlog` gives an executor script that dumps `getsenv` functions/values/upvalues
- 📨 **Discord attachment forwarding** — admins create source → destination rules using webhooks or bot-accessible channel IDs, with duplicate blocking, size limits, logging, and dashboard management
- 🧾 **One-line loaders** — buyers paste `loadstring(game:HttpGet("https://your-host/s/<token>.lua"))()`
- 🧹 **Message cleanup** — `/clear amount:` lets members with Manage Messages remove up to 100 recent messages
- 🏷️ **Auto buyer roles** — `/setbuyerrole` assigns a role automatically when users redeem; whitelist whole roles with `/whitelist role:`
- 📊 **Analytics** — `/analytics` shows runs per day, top keys, HWID/status activity (keys & HWIDs masked)
- 🔑 **HWID locking** — first run binds the key to the user's device; sharing = `HWID mismatch`
- 🛡️ **Blacklist** — revokes the key *and* blocks validation forever, even with new keys
- ⏳ Key expiry + auto-renewal for active users, HWID reset cooldowns
- 🌐 **Web Landing Page & HTTP API** — Monochrome Black & White landing page at `/`; `/api/v1/validate` + `/api/v1/load` for scripts; `/api/v1/status` + `/api/v1/key` (token auth) for management
- 🔐 **Discord OAuth login** — the website starts login at `/auth/discord`; Discord returns to `/callback`, then the server creates a secure session and opens the dashboard (needs `DISCORD_CLIENT_SECRET`; redirect URI = `PUBLIC_URL` + `/callback`). The callback is an endpoint, not the website homepage.
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
    ├── loader.js         # One-line loadstring(game:HttpGet("/s/token.lua"))()
    ├── deobfuscator.js   # Obfuscator detect + Luraph/IB2/MoonSec/WRD passes
    ├── forward.js        # VMax attachment forwarding engine, rule store, logging & dedupe
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

2. **Invite the bot**: OAuth2 → URL Generator → scopes `bot` + `applications.commands` → permissions `View Channels`, `Send Messages`, `Embed Links`, `Read Message History`, `Manage Messages`, `Manage Channels`, and `Manage Roles` → open the URL → invite

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
/rolesetup name: Vmax                          # create 13 roles, e.g. Member Vmax
/features                                      # show the short 25-feature list
/clear amount: 25                              # delete recent messages
/setlog channel: #logs                         # audit log channel
/setbuyerrole role: @Buyers                    # auto role on redeem
/setup script: luasnapper channel: #whitelist  # post the panel
/apply script: luasnapper file: myscript.lua   # upload + protect script
/getscript script: luasnapper                  # get the Protect-Vmax loader
/bulkgen script: luasnapper amount: 10 duration: 7d   # make keys
/whitelist script: luasnapper user: @buyer     # give a buyer a key
/keydrop script: luasnapper amount: 3          # public drop
/analytics                                     # see script activity
/deobf file: obfuscated.lua                    # auto-detect obfuscator, then deobf
/deobf file: obfuscated.lua obfuscator: luraph # force a specific pipeline
/envlog                                        # get the ENV-Logger dump script
/forward add source_channel: #uploads destination_webhook: https://discord.com/api/webhooks/... allowed_types: png,jpg,gif,mp4 max_size_mb: 8
/forward add source_channel: #docs destination_channel_id: 123456789012345678 allowed_types: pdf,zip,txt,json
/forward list
/forward test id: fwd_xxxxxxxx
/forward status

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
