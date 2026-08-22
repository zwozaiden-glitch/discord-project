# 🤖 AI PROMPT — Protect-Vmax Website (Black & White Edition)

Copy everything inside the code block below and paste it into any AI (ChatGPT, Claude, Gemini, etc.).
It tells the AI exactly what to build.

---

```
You are a senior frontend developer + UI designer. Build a complete, production-ready
landing page for "Protect-Vmax" — a Lua script whitelist & protection service,
similar in style to getpolsec.com but with an aggressive BLACK & WHITE design.

DELIVERABLE
- A single-page static website, no frameworks, no build tools, no external libraries.
- Files: index.html, styles.css, script.js (plus an optional favicon.svg).
- Must work when hosted from a folder or GitHub Pages (use RELATIVE paths only).
- All animations must be CSS/vanilla JS (no jQuery, no GSAP).

BRAND
- Name: Protect-Vmax
- Tagline: "Protect your Lua scripts. Effortlessly."
- Audience: Lua script sellers & buyers (Roblox/Luau executors).
- Tone: dark, premium, futuristic, confident, developer-focused.

DESIGN — BLACK & WHITE GRADIENT ONLY
- Background: pure black (#000000) to very dark gray (#0a0a0a / #111111).
- ONLY use black, white and shades of gray — NO colors (no purple, no blue, no green).
- Use white-to-black / black-to-white GRADIENTS for:
  · gradient text on key words (e.g. "Lua scripts" in the H1)
  · primary buttons (white→light gray)
  · subtle borders and glow effects
- Glassmorphism cards: dark translucent backgrounds, thin white borders (rgba(255,255,255,0.1)).
- Typography: Inter or Space Grotesk for headings, JetBrains Mono for code/keys.
- Generous spacing, rounded corners (12–20px), soft shadows.

ANIMATIONS (make it feel alive)
1. Animated gradient background — slow-moving white/black gradient orbs/glow behind hero.
2. Fade grid/dots background in the hero.
3. Scroll-reveal: sections/cards fade in + slide up when they enter the viewport (IntersectionObserver).
4. Floating elements: a mock Discord whitelist panel card that gently floats; key chips float at different speeds.
5. Animated countdown bar on the "keydrop" visual (white bar shrinking) like a live key drop.
6. Button hover: lift + glow (white glow) transitions.
7. Typing effect OR animated gradient shimmer on the H1 text.
8. Smooth scrolling + sticky nav with blur backdrop; mobile hamburger menu with slide-down animation.
9. FAQ accordion with smooth open/close rotation of the "+" icon.
10. Respect prefers-reduced-motion.

SECTIONS (in this order)
1. NAV — logo (shield icon, made with inline SVG), links: Features, How it works, API, Pricing, FAQ, and a "Join Discord" button.
2. HERO — pill badge ("Now with key drops & auto-panels"), H1 with gradient word, subtitle,
   two CTA buttons ("Join our Discord" + "See how it works"), stats row (16+ Commands / 100% HWID locked / 1 Validation API / 24/7 Online),
   and the floating mock panel (Redeem Key / My Key / Reset HWID buttons + a "✅ Valid · HWID bound" key chip).
3. FEATURES — 6 cards with inline SVG icons:
   · HWID Locking — first run binds the key to the device; sharing = mismatch.
   · Discord Whitelist Bot — one-click panels, redeem keys, reset HWID.
   · Key Generation & Keydrops — single/bulk keys, expiry, public countdown drops.
   · Blacklist & Revoke — delete keys, block users forever even with new keys.
   · Full Validation API — authenticated REST endpoint for the loader.
   · Expiry & Auto-Renewal — 1/3/7/30 day keys, active users renew automatically.
4. HOW IT WORKS — 4 steps: 1) Add the bot & /claimowner  2) /setup + /bulkgen
   3) /whitelist buyers or /keydrop  4) Loader calls the API & HWID locks.
5. API — left: copy explaining the GET /api/v1/validate endpoint (+ response codes: hwid_bound, hwid_ok,
   blacklisted, hwid_mismatch, expired). Right: a dark code card showing a Luau loader example WITH
   syntax-highlighted colors (monochrome shades) and a working "Copy" button.
6. PRICING — 2 cards: Starter Free (unlimited scripts, HWID locking, key drops, Discord bot, API, community support)
   and Premium $4/mo (everything in Starter, managed 24/7 hosting, custom branding, priority support, early access).
   Premium card highlighted with a white border + "Most popular" tag.
7. FAQ — accordion with 6 Q&As:
   · What is HWID locking?
   · How do my users get keys?
   · Can keys expire?
   · What happens when I blacklist someone?
   · Can I use my own Discord bot?
   · How do I check a key from my script?
8. CTA — big centered section with glow: "Ready to protect your scripts?" + Join Discord button.
9. FOOTER — brand + short description, columns (Product / Resources / Legal), copyright with auto year.

PLACEHOLDERS (MUST be clearly marked with comments so the owner can edit them)
- DISCORD_INVITE_LINK — used by every "Join Discord" button (click → opens in new tab).
- API_HOST — e.g. "https://your-bot.railway.app" shown in the Luau example URL.
- API_TOKEN — shown as "YOUR_API_TOKEN" in the Authorization header example.
- SCRIPT_NAME — example: "luasnapper" (used in the example request + panel mock).
- Pricing prices in the pricing cards.
- Define all of these as JS constants at the TOP of script.js (e.g. const DISCORD_INVITE = "..."),
  and also note them in comments at the top of index.html.

REQUIREMENTS / ACCEPTANCE CHECKLIST
- [ ] 100% responsive: desktop, tablet, mobile (hamburger menu below ~720px).
- [ ] Only black, white, grays — zero colorful elements anywhere.
- [ ] At least 6 different animations listed above all working.
- [ ] Copy button on the code example copies the raw code.
- [ ] All links relative; fonts loaded from Google Fonts CDN.
- [ ] Clean, commented, readable code. No placeholder lorem ipsum — real copy from this prompt.
- [ ] 15-second startup check: open the page, EVERY section + animation works with zero console errors.

After building, output: 1) the file list, 2) a short "What to edit" checklist reminding the owner
to replace DISCORD_INVITE_LINK, API_HOST, API_TOKEN, and pricing before going live.
```

---

## 🛠️ What YOU need to replace after the AI builds it

| Placeholder | Replace with | Where to get it |
|---|---|---|
| `DISCORD_INVITE_LINK` | Your server invite (permanent) | Server Settings → Invites → "Never expire" → copy link |
| `API_HOST` | Your bot's public URL | Railway → service → Settings → Networking → public domain (e.g. `https://yourservice.up.railway.app`) |
| `API_TOKEN` | Your bot's API token | Bot logs at startup: `🔑 Generated API token (save it!): ...` |
| `SCRIPT_NAME` | Your script's exact name | What you created with `/setup script: ...` (e.g. `luasnapper`) |
| Pricing | Your real prices | Decide Free vs Premium price |

## 📁 How to host it

- **GitHub Pages:** Settings → Pages → branch `main`, folder with the HTML files → live at `https://YOURNAME.github.io/REPO/`
- **Railway:** new project from repo → Root Directory = website folder → start command `npx serve -s . -l $PORT`
- **Netlify/Vercel:** drag the folder in → instant URL
