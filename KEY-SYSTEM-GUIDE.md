# 🔑 Key / Whitelist System — Full Guide

Your bot now has a complete license-key system, like the Luarmor-style bots you've seen:

- **Keys** look like `LSN-XXXXX-XXXXX-XXXXX` (prefix configurable with `KEY_PREFIX`).
- A key is **unredeemed** until a user claims it with `/redeem` or the panel button.
- The first time the script validates the key, it **binds the user's HWID** to it.
- Sharing a key doesn't help: another device gets `HWID mismatch`.
- Users can reset their HWID every `RESET_COOLDOWN_DAYS` (default 7) — or admins can do it anytime.
- **Blacklisting** a user revokes their key *and* blocks any future validation, even with a new key.
- Keys can **expire** (1d / 3d / 7d / 30d) — expiring keys renew automatically while actively used.

---

## Commands

| Command | Who | What it does |
|---|---|---|
| `/setup script: name [channel] [description]` | Admin | Posts the interactive panel (**Redeem Key / Get Script / My Key / Reset HWID** buttons) |
| `/apply script: name file: script.lua [overwrite]` | Owner/Admin | Uploads your script — the bot wraps it with the whitelist check and serves a protected loadstring |
| `/getscript script: name [user]` | Everyone | Gives you the Protect-Vmax loader (admins can fetch another user's) |
| `/setbuyerrole role: @Buyers [script] [clear]` | Owner/Admin | Auto-assigns a role when users redeem (per script or all) |
| `/analytics [script]` | Owner/Admin | Run analytics: per-day chart, top keys, recent activity (masked) |
| `/credits` | Everyone | Shows the credit — Protect-Vmax by **Zwoz** |
| `/unsetup script: name` | Admin | Deletes the panel |
| `/generatekey script: name [duration] [user]` | Admin | Makes one unredeemed key (only you see it). With `user:`, whitelists them immediately |
| `/bulkgen script: name amount: N [duration]` | Admin | Makes N unredeemed keys (only you see them) |
| `/whitelist script: name user:/role: [duration]` | Admin | Grants a key to a user — or to **everyone with a role** |
| `/blacklist script: name user:/role: [reason]` | Admin | Deletes their key, revokes access, blocks future validation |
| `/deletekey script: name user:/role:` | Admin | Deletes/revokes keys without blacklisting |
| `/keydrop script: name [amount]` | Admin | Public countdown drop of unredeemed keys — first claim wins |
| `/setlog channel: #logs` | Owner/Admin | Sets where this server's key events are logged |
| `/claimowner` | First user | Claims the bot — the first person to run it becomes the owner |
| `/resethwid [script] [user]` | Everyone | Self-service HWID unbind (cooldown applies). Admins can reset anyone, no cooldown |
| `/redeem key: LSN-...` | Everyone | Claims a key you were given |
| `/keyinfo [key]` | Everyone | Your key status + HWID binding (admins can inspect any key) |
| `/scripts` | Everyone | Lists all scripts + whether you're whitelisted |

**Permissions:** run `/claimowner` — the first user to run it becomes the bot owner and can use every admin command. (You can also pre-set the owner with `OWNER_IDS` in the environment. Anyone with the **Administrator** permission can also use admin commands.)

---

## Example flows

**1. Sell keys / whitelist a buyer**
```
/bulkgen script: luasnapper amount: 10 duration: 7d
/whitelist script: luasnapper user: @buyer duration: 30d
```
The buyer gets a DM with their key. They run the script; the first run binds their HWID.

**2. Public drop**
```
/keydrop script: luasnapper amount: 3
```
A countdown embed counts down, then reveals 3 keys in chat. Users run `/redeem <key>` to grab one.

**3. Remove a leaker**
```
/blacklist script: luasnapper user: @leaker reason: sharing keys
```

**4. Buyer changed PC**
```
/resethwid @buyer        (admin, no cooldown)
```
…or the buyer runs `/resethwid` themselves (7-day cooldown).

---

## Panel

`/setup` posts this into a channel (users just click buttons — no commands needed):

- **🎫 Redeem Key** — opens a modal, user types their key → instantly whitelisted + buyer role
- **📦 Get Script** — gives the user their Protect-Vmax loader (key already filled in)
- **🔑 My Key** — shows their key + HWID binding status
- **🔄 Reset HWID** — unbinds their HWID (cooldown applies)

Example:
```
/setup script: luasnapper channel: #whitelist description: "Buy a key from #shop, then redeem it here."
```

## Script protection (`/apply`)

1. Upload your `.lua` / `.luau` file:
   ```
   /apply script: luasnapper file: myscript.lua
   ```
2. The bot stores the protected script (max 512 KB) and wraps it with a **runtime whitelist check** — it validates the key + HWID against the API before your code runs.
3. Users click **📦 Get Script** on the panel (or run `/getscript`) and get:
   ```lua
   -- Protect-Vmax loader — luasnapper

   local key = "LSN-XXXXX-XXXXX-XXXXX" -- your user's key

   loadstring(game:HttpGet(
       "https://discord-project-production-a058.up.railway.app/api/v1/load?script=luasnapper&key=" .. key
   ))()
   ```
4. First run binds their HWID automatically. The wrapped source is credited to **Zwoz**.

> Loadstrings use `PUBLIC_URL` (default `https://discord-project-production-a058.up.railway.app`).
> The `/api/v1/load` endpoint only needs a valid key to serve the source. HWID is bound the first time the script runs.

## Auto buyer roles

```
/setbuyerrole role: @Buyers              # assign @Buyers on every redeem
/setbuyerrole role: @Luasnapper script: luasnapper   # only for one script
/setbuyerrole clear: true                # stop assigning
```
Everyone who redeems (via panel or `/redeem`) or is whitelisted by admin gets the role automatically. Note: the bot needs **Manage Roles** permission.

You can also whitelist an entire role at once: `/whitelist script: luasnapper role: @Buyers` (every member gets a key by DM).

---

## Validation API (for your Luasnapper script)

The bot starts a tiny HTTP server on `API_PORT` (default 3000). Your loader calls it to check a key + HWID instead of talking to Discord directly.

### Endpoints

**`GET /api/v1/validate?key=<KEY>&hwid=<HWID>&script=<script>`**

| Response | Status | Meaning |
|---|---|---|
| `200, code: hwid_bound` | valid | First run on this device — key is now bound |
| `200, code: hwid_ok` | valid | Valid + HWID matches |
| `403, code: hwid_mismatch` | invalid | Key bound to a different device |
| `403, code: blacklisted` | invalid | User is blacklisted |
| `403, code: voided / expired / unclaimed / invalid_key / key_not_found / wrong_script / missing_hwid` | invalid | See `message` |

Example response:
```json
{
  "status": "valid",
  "code": "hwid_ok",
  "message": "Key is valid.",
  "script": "luasnapper",
  "discord_id": "123456789012345678",
  "key": "LSN-ABCDE-FGHJK-MNPQR",
  "hwid": "my-hwid",
  "expires_at": "2026-09-22T10:00:00.000Z",
  "server_time": "2026-08-22T10:00:00.000Z"
}
```

**`GET /api/v1/load?script=<script>&key=<KEY>`** — returns the **protected Lua source** (validates the key first; 403 + JSON if the key is invalid). Public + rate-limited — this is what `loadstring(game:HttpGet(...))` fetches. HWID is checked later when the wrapped script calls `/validate`.

**`GET /api/v1/status?user_id=<discord-id>&script=<script>`** — whitelist/blacklist status + key info for a user. *(token required)*
**`GET /api/v1/key?key=<KEY>`** — one key's record (claimed by, hwid, expiry). *(token required)*
**`GET /health`** — bot is up (no auth needed).

> 🔓 `/api/v1/validate` and `/api/v1/load` are public (no token) because protected scripts call them at runtime — they're rate-limited per IP and only reveal validity. **Never call your real payment/admin flows with them.** `/api/v1/status` & `/api/v1/key` still require the API token.

### Auth

Send it on every request:

```
Authorization: Bearer YOUR_TOKEN
```

**Where to get it:** you don't sign up anywhere — the bot **creates it for you**. On first start it generates a random token, saves it in `data/settings.json` and prints it in the logs:

```
🔑 Generated API token (save it!): YI3TrxAF_aYP39d2kQl9LX4ezBrH98Ro
```

Copy that line from your bot logs (Railway → Deployments → Logs, or your terminal). Optionally you can set your own via `API_TOKEN` in `.env`/Railway Variables — that value wins.

Quick test:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:3000/api/v1/validate?key=LSN-ABCDE-FGHJK-MNPQR&hwid=my-pc-id&script=luasnapper"
```

> ⚠️ Only your scripts should know this token — anyone with it can check/validate keys. Keep `API_PORT` reachable only by your scripts (on Railway it's public, so the token is your security).

### Lua example (Luau / executor HTTP)

```lua
local KEY = "LSN-ABCDE-FGHJK-MNPQR"   -- inserted by your loader
local HWID = your_hwid_function()
local resp = request({
  Url = "https://discord-project-production-a058.up.railway.app/api/v1/validate?key=" .. KEY .. "&hwid=" .. HWID .. "&script=luasnapper",
  Headers = { ["Authorization"] = "Bearer YOUR_SECRET_TOKEN" },
  Method = "GET"
})
local data = game:GetService("HttpService"):JSONDecode(resp.Body)
if data.status == "valid" then
  -- proceed; on first run data.code == "hwid_bound"
else
  return print("❌ " .. data.message)  -- e.g. "This key is bound to a different device (HWID)."
end
```

---

## Data & storage

Everything is stored as JSON in `data/` (inside the repo, ignored by git):

```
data/scripts.json     # script names
data/keys.json        # every key (raw, claimedBy, hwid, expiresAt, voided)
data/whitelist.json   # script:userId -> key
data/blacklist.json   # script:userId -> reason
data/cooldowns.json   # hwid-reset cooldowns
data/panels.json      # where each panel lives
```

💾 **Back up the whole `data/` folder.** On Railway, set `DATA_DIR=/data` and attach a volume so keys survive redeploys.

## Recommended `.env`

```
DISCORD_TOKEN=...
CLIENT_ID=...
GUILD_ID=...                # for instant command registration
KEY_PREFIX=LSN
RESET_COOLDOWN_DAYS=7
KEYDROP_COUNTDOWN=10
SUPPORT_URL=https://discord.gg/...
PUBLIC_URL=https://discord-project-production-a058.up.railway.app
API_PORT=3000
# DATA_DIR=/data            # Railway volume
```

Everything else is set **inside Discord, no env needed**:
- `/claimowner` → you become the bot owner
- `/setlog channel: #logs` → audit log channel
- API token → auto-generated on first boot (look in the bot logs for `🔑 Generated API token (save it!)`)
