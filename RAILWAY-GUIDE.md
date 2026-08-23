# 🚂 Complete Railway Connection Guide — Protect-Vmax Web & Discord Bot

This guide walks you through connecting your Discord bot and Protect-Vmax web landing page to **Railway** for 24/7 cloud hosting with automatic GitHub deployments.

---

## ⚡ Overview of What Runs on Railway

When deployed to Railway, your project runs **both**:
1. 🤖 **Discord Bot** — listens for slash commands (`/setup`, `/apply`, `/bulkgen`, `/whitelist`, `/redeem`), interactive buttons, and modals.
2. 🌐 **Protect-Vmax Web & Validation API** — serves the monochrome landing page at `https://your-domain.up.railway.app/`, validates keys/HWIDs at runtime for executors, and handles Discord OAuth login at `/callback`.

---

## 📋 Step 1 — Get Your Discord Bot Credentials

1. Open **[Discord Developer Portal](https://discord.com/developers/applications)** and click your bot application.
2. **Bot Token**:
   - Go to **Bot** (left menu) → click **Reset Token** → **Copy**.
   - Under **Privileged Gateway Intents**, turn **ON** `Message Content Intent` ✅ and click **Save Changes**.
3. **Application ID**:
   - Go to **General Information** → copy the **Application ID**.
4. **OAuth2 Secret** (for the "Login with Discord" web button):
   - Go to **OAuth2** (left menu) → **Client Secret** → click **Reset Secret** → **Copy**.
5. **Invite / update the bot permissions**:
   - Go to **OAuth2 → URL Generator** and select scopes `bot` + `applications.commands`.
   - Select `View Channels`, `Send Messages`, `Embed Links`, `Read Message History`, `Manage Channels`, and `Manage Roles`.
   - Open the generated URL and authorize the bot in your server. `Manage Channels` is required by the support-ticket feature.

---

## 🚀 Step 2 — Deploy to Railway

1. Go to **[Railway.app](https://railway.app)** and log in with GitHub (`zwozaiden-glitch`).
2. Click **+ New Project** → choose **Deploy from GitHub repo**.
3. Select your repository: **`discord-project`**.
4. Railway will create a new service and begin building automatically.

---

## 🌐 Step 3 — Generate Your Public Web Domain

To make your web landing page and validation API accessible from the internet:

1. In your Railway project, click on your **`discord-project`** service box.
2. Go to the **Settings** tab.
3. Scroll down to the **Networking** section → click **Generate Domain**.
4. Railway will assign a public domain like:
   `https://discord-project-production-xxxx.up.railway.app`
5. Copy this URL (you will need it in Step 4 and Step 5).

---

## 🔑 Step 4 — Set Environment Variables in Railway

1. In Railway, open your service and click the **Variables** tab.
2. Add the following variables (click **New Variable** for each):

| Variable Name | Value | Description |
|---|---|---|
| `DISCORD_TOKEN` | *your-bot-token* | **Required.** Copied in Step 1. |
| `CLIENT_ID` | *your-application-id* | Developer Portal Application ID. |
| `DISCORD_CLIENT_ID` | *your-application-id* | Same as CLIENT_ID. |
| `DISCORD_CLIENT_SECRET` | *your-oauth-secret* | For Discord login button (`/callback`). |
| `PUBLIC_URL` | *https://your-domain.up.railway.app* | Your Railway domain generated in Step 3. |
| `KEY_PREFIX` | `LSN` | Key prefix (e.g. `LSN-XXXXX-XXXXX`). |
| `CREDIT_NAME` | `Zwoz` | Author/Branding shown on panels. |
| `DATA_DIR` | `/data` | Recommended if using a Railway Volume (Step 6). |

3. Click **Deploy** / save changes. Railway will automatically restart with your variables.

---

## 🔗 Step 5 — Configure Discord OAuth2 Redirects

To enable the web landing page's **"Login with Discord"** button:

1. Return to the **[Discord Developer Portal](https://discord.com/developers/applications)**.
2. Click your application → **OAuth2** (left menu) → **Redirects**.
3. Click **Add Redirect** and paste your Railway callback URL:
   ```
   https://your-domain.up.railway.app/callback
   ```
   *(Replace with your actual Railway domain generated in Step 3)*.
4. Click **Save Changes**.

---

## 💾 Step 6 — (Optional but Recommended) Persistent Storage Volume

To ensure your keys, blacklist, and settings persist across rebuilds:

1. In Railway, right-click on your project canvas or click **+ New** (top right) → choose **Volume**.
2. Mount the volume to your service with Mount Path:
   ```
   /data
   ```
3. Make sure `DATA_DIR=/data` is set in your Railway Variables.

---

## ✅ Step 7 — Verify Everything is Online

1. In Railway, open the **Deployments** tab → click the latest deployment → **View Logs**.
2. Look for the startup logs:
   ```
   ✅ Protect-Vmax Web & API listening on http://0.0.0.0:3000
   ✅ Logged in as YourBot#1234
   ✅ Registered 23 global slash command(s)
   🔑 Validation API token ready
   ```
3. Open your Railway public domain in your browser (`https://your-domain.up.railway.app`):
   - You will see the **Protect-Vmax Web Landing Page** with live bot status, loader code generator, and features.
4. In your Discord server:
   - Run `/claimowner` to become the master owner.
   - Run `/setlog channel: #audit-logs` to configure key-system logging.
   - Run `/setup script: luasnapper` to deploy your whitelist panel.
   - Optional: run `/ticketsetup` and select a ticket category, support role, log channel, and panel channel to deploy private support tickets.

---

## 🛠️ Troubleshooting

| Issue | Solution |
|---|---|
| Bot is offline in Discord | Verify `DISCORD_TOKEN` in Railway Variables. Ensure *Message Content Intent* is enabled in the Developer Portal. |
| Website shows 502 / Bad Gateway | Make sure Railway has finished building and logs show `API listening on http://0.0.0.0:3000`. |
| "Login with Discord" shows `invalid_grant` or redirect error | Check Developer Portal → OAuth2 → Redirects. The URL must match `PUBLIC_URL + "/callback"` exactly. |
| Slash commands don't appear in Discord | Global slash commands can take up to 1 hour to propagate. To make them appear instantly, set `GUILD_ID` in Railway Variables with your Server ID and restart. |
