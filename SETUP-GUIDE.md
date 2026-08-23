# 🤖 How to Get Your Bot Online — Beginner Guide (No Coding Needed)

You will only **click buttons and copy-paste**. Total time: ~15 minutes.

---

## Part 1 — Create the bot on Discord's website (5 min)

1. Open **https://discord.com/developers/applications** and log in with your Discord account.
2. Click the blue **"New Application"** button (top right).
3. Give it a name (e.g. **My Bot**) → check the box → **Create**.
4. In the left menu, click **"Bot"**.
   - Click **"Reset Token"** → **Yes, do it!**
   - A long code appears. Click **Copy**. 📋
   - **Paste it somewhere safe (Notepad).** This is your **BOT TOKEN** — it's like a password. Never share it publicly!
5. Still on the **Bot** page, scroll down to **"Privileged Gateway Intents"**:
   - Turn ON **"Message Content Intent"** ✅
   - Click **Save Changes**.
6. In the left menu, click **"General Information"**:
   - Copy the **Application ID** and save it in your Notepad too. 📋

## Part 2 — Invite the bot to your server (2 min)

1. In the left menu, click **OAuth2**.
2. Scroll to **"OAuth2 URL Generator"**. Under **Scopes**, check:
   - ✅ `bot`
   - ✅ `applications.commands`
3. A new box appears below (**Bot Permissions**). Check:
   - ✅ `View Channels`
   - ✅ `Send Messages`
   - ✅ `Embed Links`
   - ✅ `Read Message History`
   - ✅ `Manage Messages` *(required for `/clear`)*
   - ✅ `Manage Channels` *(required for private support tickets and Muted channel rules)*
   - ✅ `Manage Roles` *(required for automatic buyer roles)*
4. Scroll to the bottom — copy the **Generated URL** and open it in a new browser tab.
5. Choose **your server** from the list → **Authorize**.

🎉 Your bot now appears in your server's member list — but it's **offline (grey)**. That's normal! It goes online in Part 4.

## Part 3 — Install the tools on your computer (3 min, one time only)

1. **Install Node.js**: go to **https://nodejs.org** → download the **LTS** version → run the installer → click Next-Next-Finish (default options are fine).
2. **Download your bot code**: go to **https://github.com/zwozaiden-glitch/discord-project** → green **"Code"** button → **"Download ZIP"** → unzip it somewhere easy, like your Desktop.

## Part 4 — Start the bot (5 min)

1. Open the unzipped **discord-project** folder.
2. Find the file **`.env.example`** — make a copy of it and rename the copy to just **`.env`**
   (On Windows: if you can't rename it, open it in Notepad and use "Save As" → filename: `.env` → type: All Files.)
3. Open **`.env`** in Notepad and fill in your saved values:
   ```
   DISCORD_TOKEN=paste-your-bot-token-here
   CLIENT_ID=paste-your-application-id-here
   GUILD_ID=paste-your-server-id-here
   # No other settings needed! In Discord, just run:
   #   /claimowner  -> you become the bot owner
   #   /setlog channel: #logs -> pick the log channel
   # The API token is generated automatically on first start (see bot logs).
   ```
   👉 To get your **server ID**: in Discord, go to **User Settings → Advanced → turn ON Developer Mode**. Then **right-click your server's icon → "Copy Server ID"**.
4. Open a **terminal in the folder**:
   - **Windows:** open the discord-project folder, click the address bar at the top, type `cmd`, press Enter.
   - **Mac:** right-click the folder → Services → "New Terminal at Folder" (or open Terminal and type `cd ` then drag the folder in).
5. Copy-paste these 3 commands, pressing **Enter** after each one:
   ```
   npm install
   npm run deploy-commands
   npm start
   ```
6. When you see **`✅ Logged in as ...`** — your bot is ONLINE! 🎉

## Part 5 — Try it out!

In your Discord server, type:
- `/ping` → the bot answers with its speed
- `/server` → the bot shows info about your server
- `/rolesetup` → creates the Admin, Moderator, Support, Developer, Buyer, Member, and Muted roles
- `/clear amount: 25` → removes recent messages (requires Manage Messages)
- `/setup script: luasnapper` → posts a **key whitelist panel** (like the Luarmor bots)
- `/generatekey script: luasnapper` → creates a key; `/whitelist user: @friend` grants access

📖 Every key-system command is explained in **KEY-SYSTEM-GUIDE.md**.

## Everyday use

- **Start the bot:** open the terminal in the folder and run `npm start`
- **Stop the bot:** press `Ctrl + C` in the terminal (or just close it)
- ⚠️ The bot is only online **while the terminal is open**. Close your PC = bot goes offline.

## ❓ Common problems

| Problem | Fix |
|---|---|
| `'npm' is not recognized` | Node.js isn't installed (or restart your PC after installing) |
| `An invalid token was provided` | Re-check `DISCORD_TOKEN` in `.env` — no spaces, full token. If unsure, Reset Token again in the Developer Portal and paste the new one |
| Slash commands don't appear | Make sure you ran `npm run deploy-commands` and that `GUILD_ID` is set. Also try restarting Discord (Ctrl+R) |
| Bot is online but doesn't reply | Make sure you enabled **Message Content Intent** (Part 1, step 5) |

## ☁️ Next level: keep it online 24/7

When you're ready, a cloud service can run the bot for you all the time — no PC needed:
- **Railway** (railway.app) — connects directly to your GitHub repo, ~$5 free credit/month
- **Render** (render.com) — similar, has a free tier

Ask me and I'll walk you through it — it takes about 10 minutes.
