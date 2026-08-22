# 💻 Chromebook Guide — Get Your Bot Online Without Any Coding

Everything happens **in your browser**. No terminal, no downloads, no code. ~15 minutes.

Your code already lives at: **https://github.com/zwozaiden-glitch/discord-project**
A free cloud service called **Railway** will run it for you, 24/7.

---

## Part 1 — Create the bot on Discord's website (5 min)

1. Open **https://discord.com/developers/applications** and log in.
2. Click **"New Application"** (top right) → give it a name (e.g. **My Bot**) → **Create**.
3. Left menu → **"Bot"**:
   - Click **"Reset Token"** → **Yes, do it!** → **Copy** the long code that appears.
   - 📋 **Save it somewhere** (e.g. Google Keep or a Doc). This is your **BOT TOKEN** — treat it like a password!
   - Scroll down to **"Privileged Gateway Intents"** → turn ON **"Message Content Intent"** → **Save Changes**.

## Part 2 — Invite the bot to your server (2 min)

1. Left menu → **OAuth2** → scroll to **"OAuth2 URL Generator"**.
2. Under **Scopes** check: ✅ `bot` ✅ `applications.commands`
3. Under **Bot Permissions** (appears below) check: ✅ `Send Messages` ✅ `Embed Links`
4. Copy the **Generated URL** at the bottom → open it in a new tab → pick **your server** → **Authorize**.

The bot now shows in your member list as **offline (grey)** — that's normal until Part 3 is done.

## Part 3 — Make Railway run your bot (8 min)

1. Go to **https://railway.app** → **Login** → choose **"Login with GitHub"** → authorize it.
   (Use the same GitHub account: **zwozaiden-glitch**)
2. Click **"New Project"** → **"Deploy from GitHub repo"**.
   - If asked, click **"Configure GitHub App"** and give Railway access to your repos.
3. Choose **`discord-project`** from the list.
4. Railway starts building. Now add your bot token:
   - Click on the service (the box with your repo name)
   - Open the **"Variables"** tab → **"New Variable"**:
     - Name: `DISCORD_TOKEN`
     - Value: *paste your bot token from Part 1*
   - Click **Add** / **Deploy**.
5. Open the **"Deployments"** tab → click the latest deployment → **"View Logs"**.
   When you see:
   ```
   ✅ Logged in as My Bot#1234
   ✅ Registered 2 global slash command(s)
   ```
   …your bot is **ONLINE — 24/7!** 🎉 (green dot in Discord)

## Part 4 — Try it in Discord!

Type in any channel of your server:
- `/ping` → bot replies with its speed
- `/server` → bot shows server info

⏳ **Note:** slash commands are registered "globally" which can take **up to 1 hour** to show up the very first time. Usually it's much faster. If you don't see them, wait a bit and restart Discord (Ctrl+R).

## ❓ Common problems

| Problem | Fix |
|---|---|
| Railway logs say `An invalid token was provided` | The `DISCORD_TOKEN` variable is wrong. Reset the token in the Discord Developer Portal, copy the NEW one, update the variable in Railway |
| Slash commands don't appear after 1 hour | Check the logs show "Registered 2 global slash command(s)". Restart Discord with Ctrl+R |
| Bot shows offline | Check Railway → Deployments → Logs for a red error message, and tell me what it says |
| Railway asks for a payment method | The free trial gives ~$5 of credit; a hobby bot uses only cents per month. Render.com is an alternative with a free tier |

## 💡 Good to know

- **Updating the bot:** whenever the code on GitHub changes (e.g. I add a command for you), Railway **automatically redeploys** it. Zero work for you.
- **Stopping the bot:** in Railway, open the service → Settings → "Remove" (or just pause the deployment).
- **Costs:** Railway's trial credit lasts a long time for a small bot. If it runs out, tell me and we'll move to a free alternative.
