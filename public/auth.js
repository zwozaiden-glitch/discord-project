/* ==========================================================================
   Protect-Vmax — auth.js
   Discord login via OAuth 2.0 Authorization Code flow + PKCE.
   Works entirely client-side (no client secret needed) and stores the
   session in localStorage. Also powers the nav login chip on every page.
   ========================================================================== */

const PVAuth = (function () {
  "use strict";

  /* ----------------------------------------------------------------------
     CONFIG — the ONLY things you need to change for real Discord login:
       1. CLIENT_ID  -> your Discord application's Client ID
                         (Discord Developer Portal -> Application -> OAuth2)
       2. In the Developer Portal, add this site's dashboard page as a
          Redirect:  <your-site>/dashboard.html   (must match exactly)
       3. (optional) TOKEN_PROXY -> set this if your browser blocks the
          direct token exchange with CORS. See auth-proxy/server.mjs.
     ---------------------------------------------------------------------- */
  const CONFIG = {
    CLIENT_ID: "1540626944557850624", // <-- your Discord app's Client ID
    REDIRECT_PATH: "dashboard.html",
    SCOPES: "identify email",
    TOKEN_PROXY: "/token", // Proxies token exchange via backend to bypass browser CORS
    // Lets visitors open /dashboard.html?demo=1 to preview the UI without a
    // real Discord app. Turn off once CLIENT_ID is set if you don't want it.
    DEMO_ENABLED: true,
  };

  const DISCORD_AUTHORIZE = "https://discord.com/api/oauth2/authorize";
  const DISCORD_TOKEN = "https://discord.com/api/oauth2/token";
  const DISCORD_API = "https://discord.com/api";
  const DISCORD_CDN = "https://cdn.discordapp.com";

  const SS_VERIFIER = "pv_oauth_verifier";
  const SS_STATE = "pv_oauth_state";
  const LS_SESSION = "pv_session";

  /* ----------------------------- crypto helpers -------------------------- */
  function randomBytes(n) {
    const arr = new Uint8Array(n);
    crypto.getRandomValues(arr);
    return arr;
  }

  function b64url(bytes) {
    let str = "";
    for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
    return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  async function sha256B64url(str) {
    const data = new TextEncoder().encode(str);
    const dig = await crypto.subtle.digest("SHA-256", data);
    return b64url(new Uint8Array(dig));
  }

  function randToken(n) {
    return b64url(randomBytes(n));
  }

  /* ----------------------------- storage -------------------------------- */
  function getSession() {
    try {
      const raw = localStorage.getItem(LS_SESSION);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function setSession(obj) {
    localStorage.setItem(LS_SESSION, JSON.stringify(obj));
  }

  function clearSession() {
    localStorage.removeItem(LS_SESSION);
  }

  function isLoggedIn() {
    const s = getSession();
    return !!(s && s.access_token && s.user);
  }

  function getRedirectUri() {
    return new URL(CONFIG.REDIRECT_PATH, location.href).href;
  }

  function isDemoRequested() {
    const params = new URLSearchParams(location.search);
    return CONFIG.DEMO_ENABLED || params.get("demo") === "1";
  }

  /* ----------------------------- avatar --------------------------------- */
  function avatarUrl(user, size) {
    size = size || 128;
    if (!user) return null;
    if (user.avatar) {
      const fmt = user.avatar.startsWith("a_") ? "gif" : "png";
      return (
        DISCORD_CDN + "/avatars/" + user.id + "/" + user.avatar + "." + fmt +
        "?size=" + size
      );
    }
    // Default avatar (no custom upload).
    let idx;
    if (user.discriminator && user.discriminator !== "0") {
      idx = parseInt(user.discriminator, 10) % 5;
    } else {
      idx = Number((BigInt(user.id || "0") >> 22n) % 6n);
    }
    return DISCORD_CDN + "/embed/avatars/" + idx + ".png?size=" + size;
  }

  /* ----------------------------- demo session --------------------------- */
  function makeDemoSession() {
    const user = {
      id: "1000000000000000000",
      username: "DemoUser",
      global_name: "Demo User",
      discriminator: "0001",
      avatar: null,
      email: "demo@protect-vmax.example",
      demo: true,
    };
    return {
      access_token: "demo_access_token",
      refresh_token: "demo_refresh_token",
      expires_at: Date.now() + 7 * 864e5,
      user: user,
      demo: true,
    };
  }

  /* ----------------------------- login flow ----------------------------- */
  async function login() {
    // Not configured yet -> drop the visitor into the demo dashboard so the
    // UI is still viewable. Replace CLIENT_ID to enable real Discord login.
    if (CONFIG.CLIENT_ID === "YOUR_DISCORD_CLIENT_ID") {
      const sep = getRedirectUri().includes("?") ? "&" : "?";
      location.href = getRedirectUri() + sep + "demo=1&why=config";
      return;
    }

    const verifier = randToken(32);
    const state = randToken(16);
    const challenge = await sha256B64url(verifier);

    sessionStorage.setItem(SS_VERIFIER, verifier);
    sessionStorage.setItem(SS_STATE, state);

    const params = new URLSearchParams({
      response_type: "code",
      client_id: CONFIG.CLIENT_ID,
      scope: CONFIG.SCOPES,
      state: state,
      redirect_uri: getRedirectUri(),
      code_challenge: challenge,
      code_challenge_method: "S256",
    });

    location.href = DISCORD_AUTHORIZE + "?" + params.toString();
  }

  /* ----------------------------- token exchange ------------------------- */
  async function exchangeCode(code, verifier) {
    const body = new URLSearchParams({
      client_id: CONFIG.CLIENT_ID,
      grant_type: "authorization_code",
      code: code,
      redirect_uri: getRedirectUri(),
      code_verifier: verifier,
    });
    const res = await fetch(CONFIG.TOKEN_PROXY || DISCORD_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) {
      const txt = await res.text().catch(function () { return ""; });
      throw new Error("Token exchange failed (" + res.status + "): " + txt);
    }
    return res.json();
  }

  async function refreshToken(refresh_token) {
    const body = new URLSearchParams({
      client_id: CONFIG.CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refresh_token,
    });
    const res = await fetch(CONFIG.TOKEN_PROXY || DISCORD_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) throw new Error("Token refresh failed (" + res.status + ")");
    return res.json();
  }

  async function fetchUser(accessToken) {
    const res = await fetch(DISCORD_API + "/users/@me", {
      headers: { Authorization: "Bearer " + accessToken },
    });
    if (!res.ok) throw new Error("Failed to load user (" + res.status + ")");
    return res.json();
  }

  async function getValidToken() {
    const s = getSession();
    if (!s) return null;
    if (s.demo) return s.access_token;
    if (s.expires_at && Date.now() < s.expires_at - 5000) return s.access_token;
    if (s.refresh_token) {
      const t = await refreshToken(s.refresh_token);
      const updated = Object.assign({}, s, {
        access_token: t.access_token,
        refresh_token: t.refresh_token || s.refresh_token,
        expires_at: Date.now() + (t.expires_in || 604800) * 1000,
      });
      setSession(updated);
      return updated.access_token;
    }
    return s.access_token;
  }

  /* ----------------------------- callback ------------------------------- */
  async function handleCallback() {
    const params = new URLSearchParams(location.search);
    const code = params.get("code");
    const state = params.get("state");
    const err = params.get("error");

    if (err) throw new Error("Discord returned an error: " + err);
    if (!code) return false;

    const savedState = sessionStorage.getItem(SS_STATE);
    const verifier = sessionStorage.getItem(SS_VERIFIER);

    if (!verifier) {
      throw new Error("Missing PKCE verifier — please start the login again.");
    }
    if (savedState && state && savedState !== state) {
      throw new Error("State mismatch (possible CSRF). Please try logging in again.");
    }

    const tok = await exchangeCode(code, verifier);
    const user = await fetchUser(tok.access_token);

    const session = {
      access_token: tok.access_token,
      refresh_token: tok.refresh_token,
      expires_at: Date.now() + (tok.expires_in || 604800) * 1000,
      user: user,
      demo: false,
    };
    setSession(session);
    sessionStorage.removeItem(SS_VERIFIER);
    sessionStorage.removeItem(SS_STATE);
    history.replaceState(null, "", location.pathname);
    return true;
  }

  function logout() {
    clearSession();
  }

  /* ----------------------------- nav UI --------------------------------- */
  function initNavAuth() {
    const loginBtn = document.getElementById("nav-login");
    const userBox = document.getElementById("nav-user");
    const sideUser = document.getElementById("side-user");
    const hasAny = loginBtn || userBox || sideUser;
    if (!hasAny) return;

    function render() {
      const s = getSession();
      const loggedIn = isLoggedIn();

      // Top-nav chip (index.html / dashboard topbar)
      if (loginBtn) loginBtn.hidden = loggedIn;
      if (userBox) userBox.hidden = !loggedIn;
      if (loggedIn) {
        const av = document.getElementById("nav-avatar");
        const nm = document.getElementById("nav-username");
        const link = document.getElementById("nav-user-link");
        if (av) av.src = avatarUrl(s.user) || av.src;
        if (nm) nm.textContent = s.user.global_name || s.user.username;
        if (link) link.href = CONFIG.REDIRECT_PATH;
      }

      // Sidebar user card (dashboard.html)
      if (sideUser) {
        const sav = document.getElementById("side-avatar");
        const snm = document.getElementById("side-username");
        const spl = document.getElementById("side-plan");
        if (loggedIn) {
          if (sav) sav.src = avatarUrl(s.user) || sav.src;
          if (snm) snm.textContent = s.user.global_name || s.user.username;
          if (spl) spl.textContent = (s.demo ? "Demo" : "Free") + " plan";
        } else {
          if (sav) sav.src = "";
          if (snm) snm.textContent = "";
          if (spl) spl.textContent = "";
        }
      }
    }

    if (loginBtn) {
      loginBtn.addEventListener("click", function (e) {
        e.preventDefault();
        login();
      });
    }

    function doLogout(e) {
      if (e) e.preventDefault();
      logout();
      render();
      if (location.pathname.endsWith(CONFIG.REDIRECT_PATH)) {
        location.href = "index.html";
      }
    }

    const lo = document.getElementById("nav-logout");
    if (lo) lo.addEventListener("click", doLogout);
    const slo = document.getElementById("side-logout");
    if (slo) slo.addEventListener("click", doLogout);

    render();
  }

  return {
    CONFIG: CONFIG,
    login: login,
    logout: logout,
    getSession: getSession,
    isLoggedIn: isLoggedIn,
    getValidToken: getValidToken,
    handleCallback: handleCallback,
    avatarUrl: avatarUrl,
    initNavAuth: initNavAuth,
    makeDemoSession: makeDemoSession,
    isDemoRequested: isDemoRequested,
    getRedirectUri: getRedirectUri,
  };
})();

// Expose globally so dashboard.js (a separate <script>) can use it.
if (typeof window !== "undefined") window.PVAuth = PVAuth;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", PVAuth.initNavAuth);
} else {
  PVAuth.initNavAuth();
}
