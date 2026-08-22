/* ==========================================================================
   Protect-Vmax — script.js
   All interactivity for index.html:
   Discord links, Luau code sample + copy, scroll reveal, mobile menu,
   FAQ accordion, keydrop countdown, nav state, footer year.
   ========================================================================== */

/* ==========================================================================
   ✏️  EDIT THESE — site configuration
   These are the ONLY values you should need to change.
   --------------------------------------------------------------------------
   DISCORD_INVITE  -> your permanent server invite
                      (Server Settings -> Invites -> "Never expire" -> copy link)
   API_HOST        -> your bot's public URL (Railway public domain, e.g.
                      https://discord-project-production-cc27.up.railway.app)
   API_TOKEN       -> shown as "YOUR_API_TOKEN" in the example. ⚠️ NEVER paste
                      your REAL token into a public page — it is a secret.
   SCRIPT_NAME     -> the script name you registered with /setup (e.g. "luasnapper")
   LOADER_PATH     -> the endpoint the short loadstring loader fetches
                      (e.g. "/api/v1/load")
   DISCORD_TICKET_URL -> where the pricing "buy" buttons link. Point this at your
                      ticket channel invite or ticket-bot link.
   PRICING         -> reference only; also update the prices in index.html
                      (the three pricing cards).
   ========================================================================== */
const DISCORD_INVITE = "https://discord.gg/xFeX95Evce";
const API_HOST = "https://discord-project-production-a058.up.railway.app";
const API_TOKEN = "A2F7o-nCC04ed2SrUMftZmXQJ37qvvEn";
const SCRIPT_NAME = "Vmax";
const LOADER_PATH = "/api/v1/load";
const DISCORD_TICKET_URL = "https://discord.gg/xFeX95Evce";
const PRICING = { starter: "Free", enjoy: "$2/mo", vmax: "$5/mo" };
const KEYDROP_SECONDS = 12; // length of the demo keydrop countdown

/* ==========================================================================
   1. Link wiring
   ========================================================================== */
document.querySelectorAll("[data-discord]").forEach(function (a) {
  a.href = DISCORD_INVITE;
});

document.querySelectorAll("[data-ticket]").forEach(function (a) {
  a.href = DISCORD_TICKET_URL;
});

document.querySelectorAll("[data-script-name]").forEach(function (el) {
  el.textContent = SCRIPT_NAME;
});

/* ==========================================================================
   2. Luau loader code sample (rendered with monochrome syntax highlighting)
   ========================================================================== */
// NOTE: keep the lines flush-left — leading whitespace is rendered verbatim.
const CODE_SAMPLE = `-- Protect-Vmax loader — ${SCRIPT_NAME}
local key = "KEY-XXXX-XXXX" -- your user's key

loadstring(game:HttpGet(
    "${API_HOST}${LOADER_PATH}?script=${SCRIPT_NAME}&key=" .. key
))()`;

const LUAU_BUILTINS = new Set([
  "game", "workspace", "script", "print", "warn", "error", "typeof", "tick",
  "wait", "spawn", "task", "string", "table", "math", "pairs", "ipairs",
  "HttpService", "GetService", "RequestAsync", "JSONDecode", "format", "get",
  "loadstring", "HttpGet",
]);

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function highlightLua(src) {
  // Order matters: comments & strings are captured before bare identifiers.
  const re =
    /(--[^\n]*)|("(?:[^"\\]|\\.)*")|(\b(?:local|function|end|if|then|elseif|else|return|for|while|do|nil|true|false|and|or|not)\b)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)/g;

  let out = "";
  let last = 0;
  let m;

  while ((m = re.exec(src)) !== null) {
    out += escapeHtml(src.slice(last, m.index));

    const token = m[0];
    let cls = "c-ident";

    if (m[1]) cls = "c-comment";
    else if (m[2]) cls = "c-string";
    else if (m[3]) cls = "c-keyword";
    else if (m[4]) cls = "c-number";
    else if (m[5]) cls = LUAU_BUILTINS.has(m[5]) ? "c-builtin" : "c-ident";

    out += '<span class="' + cls + '">' + escapeHtml(token) + "</span>";
    last = m.index + token.length;
  }

  out += escapeHtml(src.slice(last));
  return out;
}

const codeBlock = document.getElementById("code-block");
if (codeBlock) {
  codeBlock.innerHTML = highlightLua(CODE_SAMPLE);
}

/* Copy button */
const copyBtn = document.getElementById("copy-btn");

function fallbackCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
  } catch (e) {
    /* ignore */
  }
  document.body.removeChild(ta);
}

if (copyBtn) {
  copyBtn.addEventListener("click", function () {
    const done = function () {
      copyBtn.textContent = "Copied!";
      copyBtn.classList.add("copied");
      setTimeout(function () {
        copyBtn.textContent = "Copy";
        copyBtn.classList.remove("copied");
      }, 1800);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(CODE_SAMPLE).then(done, function () {
        fallbackCopy(CODE_SAMPLE);
        done();
      });
    } else {
      fallbackCopy(CODE_SAMPLE);
      done();
    }
  });
}

/* ==========================================================================
   3. Scroll reveal (IntersectionObserver)
   ========================================================================== */
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const revealEls = document.querySelectorAll(".reveal");

if (reducedMotion || !("IntersectionObserver" in window)) {
  revealEls.forEach(function (el) {
    el.classList.add("is-visible");
  });
} else {
  const observer = new IntersectionObserver(
    function (entries, obs) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          obs.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
  );

  revealEls.forEach(function (el) {
    observer.observe(el);
  });
}

/* ==========================================================================
   4. Mobile hamburger menu
   ========================================================================== */
const hamburger = document.getElementById("hamburger");
const navLinks = document.getElementById("nav-links");

if (hamburger && navLinks) {
  hamburger.addEventListener("click", function () {
    const open = navLinks.classList.toggle("open");
    hamburger.setAttribute("aria-expanded", open ? "true" : "false");
  });

  // Close the menu when a link inside it is clicked.
  navLinks.addEventListener("click", function (e) {
    if (e.target.tagName === "A") {
      navLinks.classList.remove("open");
      hamburger.setAttribute("aria-expanded", "false");
    }
  });
}

/* ==========================================================================
   5. FAQ accordion
   ========================================================================== */
document.querySelectorAll(".faq-item").forEach(function (item) {
  const btn = item.querySelector(".faq-q");

  btn.addEventListener("click", function () {
    const isOpen = item.classList.contains("open");

    // Close any other open item (one-at-a-time accordion).
    document.querySelectorAll(".faq-item.open").forEach(function (openItem) {
      if (openItem !== item) {
        openItem.classList.remove("open");
        openItem.querySelector(".faq-q").setAttribute("aria-expanded", "false");
      }
    });

    item.classList.toggle("open", !isOpen);
    btn.setAttribute("aria-expanded", !isOpen ? "true" : "false");
  });
});

/* ==========================================================================
   6. Keydrop countdown bar (live demo)
   ========================================================================== */
const countEl = document.getElementById("keydrop-count");
const barEl = document.getElementById("keydrop-bar");

function pad2(n) {
  return String(n).padStart(2, "0");
}

if (countEl && barEl) {
  if (reducedMotion) {
    // Static, calm version for users who prefer reduced motion.
    countEl.textContent = "LIVE";
    barEl.style.width = "100%";
  } else {
    let kdStart = null;

    function tickKeydrop() {
      const now = performance.now();
      if (kdStart === null) kdStart = now;

      let elapsed = (now - kdStart) / 1000;
      if (elapsed >= KEYDROP_SECONDS) {
        kdStart = now; // loop the drop
        elapsed = 0;
      }

      const remaining = KEYDROP_SECONDS - elapsed;
      const secs = Math.ceil(remaining);
      countEl.textContent = "00:" + pad2(secs);
      barEl.style.width = (remaining / KEYDROP_SECONDS) * 100 + "%";
    }

    tickKeydrop();
    setInterval(tickKeydrop, 200);
  }
}

/* ==========================================================================
   7. Nav background on scroll
   ========================================================================== */
const nav = document.getElementById("nav");
if (nav) {
  function onScroll() {
    nav.classList.toggle("scrolled", window.scrollY > 10);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}

/* ==========================================================================
   8. Footer year (auto)
   ========================================================================== */
const yearEl = document.getElementById("year");
if (yearEl) {
  yearEl.textContent = new Date().getFullYear();
}

