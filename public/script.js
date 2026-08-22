/**
 * ==============================================================================
 * PROTECT-VMAX — Web Frontend Script
 * Connected to Discord Bot & Validation API on Railway
 *
 * OWNER CUSTOMIZATION:
 * Replace the constants below to match your setup:
 * ==============================================================================
 */
const CONFIG = {
  // Your permanent Discord server invite link:
  DISCORD_INVITE_LINK: 'https://discord.gg/yourserver',

  // Your public Railway API host (auto-detects current domain):
  API_HOST: window.location.origin,

  // Default script name used in previews and code blocks:
  SCRIPT_NAME: 'luasnapper',

  // Example API Token shown in docs:
  API_TOKEN: 'YOUR_API_TOKEN',
};

document.addEventListener('DOMContentLoaded', () => {
  initDiscordLinks();
  initBotStatusCheck();
  initCodeBlockAndCopy();
  initKeydropSimulation();
  initFaqAccordion();
  initMobileMenu();
  initScrollReveal();
  initKeyTester();
  initFooterYear();
});

/**
 * Connects all Discord CTA buttons to the configured invite link.
 */
function initDiscordLinks() {
  const discordLinks = document.querySelectorAll('.discord-link-target');
  discordLinks.forEach((link) => {
    link.href = CONFIG.DISCORD_INVITE_LINK;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  });
}

/**
 * Checks the live status of the bot / web server via /health and /api/v1/info.
 */
async function initBotStatusCheck() {
  const badge = document.getElementById('botStatusBadge');
  if (!badge) return;

  const dot = badge.querySelector('.status-dot');
  const label = badge.querySelector('.status-label');

  try {
    const res = await fetch('/health', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (data.ok) {
        label.textContent = data.bot && data.bot !== 'starting' ? `Online: ${data.bot}` : 'Railway Online';
        dot.style.backgroundColor = '#ffffff';
        dot.style.boxShadow = '0 0 8px #ffffff';
      }
    } else {
      label.textContent = 'Server Active';
    }
  } catch (err) {
    label.textContent = 'Bot Standby';
    dot.style.backgroundColor = '#888888';
    dot.style.boxShadow = 'none';
  }
}

/**
 * Updates the Luau loader code block with the active host and enables 1-click copy.
 */
function initCodeBlockAndCopy() {
  const codeBlock = document.getElementById('luauCodeBlock');
  const copyBtn = document.getElementById('copyCodeBtn');
  if (!codeBlock || !copyBtn) return;

  const origin = window.location.origin.includes('localhost')
    ? 'https://discord-project-production-a058.up.railway.app'
    : window.location.origin;

  const rawLuau = [
    `-- Protect-Vmax loader — ${CONFIG.SCRIPT_NAME}`,
    '-- Protected & Verified by Zwoz',
    '',
    'local key = "LSN-98X2K-4M19Q-Z9A2B" -- user key',
    '',
    'loadstring(game:HttpGet(',
    `    "${origin}/api/v1/load?script=${CONFIG.SCRIPT_NAME}&key=" .. key`,
    '))()',
  ].join('\n');

  codeBlock.innerHTML = `
<span class="token-comment">-- Protect-Vmax loader — ${CONFIG.SCRIPT_NAME}</span>
<span class="token-comment">-- Protected &amp; Verified by Zwoz</span>

<span class="token-keyword">local</span> key = <span class="token-string">"LSN-98X2K-4M19Q-Z9A2B"</span> <span class="token-comment">-- user key</span>

<span class="token-function">loadstring</span>(game:<span class="token-function">HttpGet</span>(
    <span class="token-string">"${origin}/api/v1/load?script=${CONFIG.SCRIPT_NAME}&amp;key="</span> .. key
))()`.trim();

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(rawLuau);
      const textSpan = copyBtn.querySelector('.copy-text');
      const originalText = textSpan.textContent;
      textSpan.textContent = 'Copied!';
      copyBtn.style.borderColor = '#ffffff';
      setTimeout(() => {
        textSpan.textContent = originalText;
        copyBtn.style.borderColor = '';
      }, 2000);
    } catch {
      // Fallback prompt if clipboard API blocked
      window.prompt('Copy loader code:', rawLuau);
    }
  });
}

/**
 * Simulates a live countdown keydrop animation on the mock Discord panel.
 */
function initKeydropSimulation() {
  const timer = document.getElementById('keydropTimer');
  const bar = document.getElementById('keydropBar');
  if (!timer || !bar) return;

  let totalSeconds = 10;
  let remaining = totalSeconds;

  setInterval(() => {
    remaining -= 1;
    if (remaining < 0) {
      remaining = totalSeconds;
    }
    const secStr = remaining < 10 ? `0${remaining}` : `${remaining}`;
    timer.textContent = `00:${secStr}`;
    const pct = (remaining / totalSeconds) * 100;
    bar.style.width = `${pct}%`;
  }, 1000);
}

/**
 * Handles FAQ accordion open / close toggle.
 */
function initFaqAccordion() {
  const questions = document.querySelectorAll('.faq-question');
  questions.forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = btn.parentElement;
      const isOpen = item.classList.contains('active');

      // Close all others
      document.querySelectorAll('.faq-item').forEach((el) => {
        el.classList.remove('active');
        el.querySelector('.faq-question').setAttribute('aria-expanded', 'false');
      });

      if (!isOpen) {
        item.classList.add('active');
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  });
}

/**
 * Mobile navigation menu hamburger toggle.
 */
function initMobileMenu() {
  const toggle = document.getElementById('menuToggle');
  const nav = document.getElementById('mainNav');
  if (!toggle || !nav) return;

  toggle.addEventListener('click', () => {
    nav.classList.toggle('open');
  });

  nav.querySelectorAll('.nav-link').forEach((link) => {
    link.addEventListener('click', () => {
      nav.classList.remove('open');
    });
  });
}

/**
 * Scroll reveal animations via IntersectionObserver.
 */
function initScrollReveal() {
  const reveals = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)) {
    reveals.forEach((el) => el.classList.add('revealed'));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
  );

  reveals.forEach((el) => observer.observe(el));
}

/**
 * Interactive key validation tester.
 */
function initKeyTester() {
  const input = document.getElementById('testKeyInput');
  const btn = document.getElementById('testKeyBtn');
  const result = document.getElementById('testKeyResult');
  if (!input || !btn || !result) return;

  btn.addEventListener('click', async () => {
    const rawKey = input.value.trim();
    if (!rawKey) {
      result.style.display = 'block';
      result.innerHTML = '<span style="color:#a3a3a3;">Please enter a key to test.</span>';
      return;
    }

    result.style.display = 'block';
    result.innerHTML = '<span style="color:#a3a3a3;">Validating against API...</span>';

    try {
      const res = await fetch(`/api/v1/validate?key=${encodeURIComponent(rawKey)}&hwid=WEB-CLIENT-DEMO&script=${encodeURIComponent(CONFIG.SCRIPT_NAME)}`);
      const data = await res.json();

      if (data.status === 'valid') {
        result.innerHTML = `✅ <strong style="color:#fff;">Valid Key</strong> (${data.code}) — Hardware locked to your session.`;
      } else {
        result.innerHTML = `❌ <strong style="color:#fff;">Rejected</strong>: <code>${data.code || data.message || 'invalid'}</code>`;
      }
    } catch {
      result.innerHTML = '⚠️ Could not connect to the validation server.';
    }
  });
}

/**
 * Interactive demo action for mock panel buttons.
 */
window.demoPanelAction = function (action) {
  const messages = {
    'Redeem Key': '🎫 Discord modal opens: users paste their key to claim whitelist access and auto-assign buyer roles.',
    'Get Script': '📦 Discord responds with their personal loadstring containing their unique key.',
    'My Key': '🔑 Shows the user their key status, expiration date, and bound hardware ID in an ephemeral embed.',
    'Reset HWID': '🔄 Clears their bound device so they can switch PCs (subject to the configured cooldown).',
  };

  alert(`[Discord Panel Demo — ${action}]\n\n${messages[action] || 'Action triggered.'}\n\nRun /setup in your server to create this panel!`);
};

/**
 * Sets current year in the footer.
 */
function initFooterYear() {
  const span = document.getElementById('yearSpan');
  if (span) {
    span.textContent = new Date().getFullYear();
  }
}
