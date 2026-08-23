/* ==========================================================================
   Protect-Vmax — auth.js
   Discord OAuth is handled by the backend:
     /auth/discord     starts login
     /callback         receives Discord's one-time code
     /api/auth/session exposes only the signed-in user

   The Discord client secret and access token never enter browser JavaScript.
   ========================================================================== */

const PVAuth = (function () {
  "use strict";

  const CONFIG = {
    LOGIN_PATH: "/auth/discord",
    LOGOUT_PATH: "/auth/logout",
    SESSION_PATH: "/api/auth/session",
    REDIRECT_PATH: "/dashboard.html",
    DEMO_ENABLED: true,
  };

  const DISCORD_CDN = "https://cdn.discordapp.com";
  const LS_SESSION = "pv_session";

  function getSession() {
    try {
      const raw = localStorage.getItem(LS_SESSION);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function setSession(session) {
    localStorage.setItem(LS_SESSION, JSON.stringify(session));
  }

  function clearSession() {
    localStorage.removeItem(LS_SESSION);
  }

  function isLoggedIn() {
    const session = getSession();
    return Boolean(session && session.user && (session.server || session.demo));
  }

  async function restoreSession() {
    const current = getSession();
    if (current && current.demo) return current;

    try {
      const response = await fetch(CONFIG.SESSION_PATH, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Session check failed (" + response.status + ")");
      const data = await response.json();
      if (data.authenticated && data.user) {
        const session = {
          user: data.user,
          expires_at: data.expires_at || null,
          server: true,
          demo: false,
        };
        setSession(session);
        return session;
      }
      if (current && current.server) clearSession();
      return null;
    } catch (error) {
      // A temporary network failure should not flash a logged-in user back to
      // the login screen. Protected API requests still validate the cookie.
      return current && current.server ? current : null;
    }
  }

  function login() {
    location.href = CONFIG.LOGIN_PATH;
  }

  function logout() {
    clearSession();
    fetch(CONFIG.LOGOUT_PATH, {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
    }).catch(function () {});
  }

  async function handleCallback() {
    // The backend processes /callback and redirects to /dashboard.html. This
    // method remains for callers from older cached dashboard.js versions.
    const params = new URLSearchParams(location.search);
    if (params.get("error")) {
      throw new Error("Discord returned an error: " + params.get("error"));
    }
    return restoreSession();
  }

  function isDemoRequested() {
    return CONFIG.DEMO_ENABLED && new URLSearchParams(location.search).get("demo") === "1";
  }

  function makeDemoSession() {
    return {
      user: {
        id: "1000000000000000000",
        username: "DemoUser",
        global_name: "Demo User",
        discriminator: "0",
        avatar: null,
        email: "demo@protect-vmax.example",
        demo: true,
      },
      expires_at: Date.now() + 24 * 60 * 60 * 1000,
      server: false,
      demo: true,
    };
  }

  function avatarUrl(user, size) {
    size = size || 128;
    if (!user) return null;
    if (user.avatar) {
      const format = user.avatar.startsWith("a_") ? "gif" : "png";
      return (
        DISCORD_CDN + "/avatars/" + user.id + "/" + user.avatar + "." + format +
        "?size=" + size
      );
    }

    let index;
    if (user.discriminator && user.discriminator !== "0") {
      index = parseInt(user.discriminator, 10) % 5;
    } else {
      try {
        index = Number((BigInt(user.id || "0") >> 22n) % 6n);
      } catch (error) {
        index = 0;
      }
    }
    return DISCORD_CDN + "/embed/avatars/" + index + ".png?size=" + size;
  }

  async function initNavAuth() {
    await restoreSession();

    const loginButton = document.getElementById("nav-login");
    const userBox = document.getElementById("nav-user");
    const sideUser = document.getElementById("side-user");
    if (!loginButton && !userBox && !sideUser) return;

    function render() {
      const session = getSession();
      const loggedIn = isLoggedIn();

      if (loginButton) loginButton.hidden = loggedIn;
      if (userBox) userBox.hidden = !loggedIn;
      if (loggedIn) {
        const avatar = document.getElementById("nav-avatar");
        const name = document.getElementById("nav-username");
        const link = document.getElementById("nav-user-link");
        if (avatar) avatar.src = avatarUrl(session.user) || "";
        if (name) name.textContent = session.user.global_name || session.user.username;
        if (link) link.href = CONFIG.REDIRECT_PATH;
      }

      if (sideUser) {
        sideUser.hidden = !loggedIn;
        const avatar = document.getElementById("side-avatar");
        const name = document.getElementById("side-username");
        const plan = document.getElementById("side-plan");
        if (loggedIn) {
          if (avatar) avatar.src = avatarUrl(session.user) || "";
          if (name) name.textContent = session.user.global_name || session.user.username;
          if (plan) plan.textContent = (session.demo ? "Demo" : "Vmax") + " plan";
        }
      }
    }

    if (loginButton) {
      loginButton.addEventListener("click", function (event) {
        event.preventDefault();
        login();
      });
    }

    function doLogout(event) {
      if (event) event.preventDefault();
      logout();
      render();
      if (location.pathname.endsWith("dashboard.html")) location.href = "/";
    }

    const navLogout = document.getElementById("nav-logout");
    if (navLogout) navLogout.addEventListener("click", doLogout);
    const sideLogout = document.getElementById("side-logout");
    if (sideLogout) sideLogout.addEventListener("click", doLogout);

    render();
  }

  return {
    CONFIG: CONFIG,
    login: login,
    logout: logout,
    getSession: getSession,
    isLoggedIn: isLoggedIn,
    restoreSession: restoreSession,
    handleCallback: handleCallback,
    // Kept for compatibility; browser code no longer receives OAuth tokens.
    getValidToken: async function () { return null; },
    avatarUrl: avatarUrl,
    initNavAuth: initNavAuth,
    makeDemoSession: makeDemoSession,
    isDemoRequested: isDemoRequested,
  };
})();

if (typeof window !== "undefined") window.PVAuth = PVAuth;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", function () { PVAuth.initNavAuth(); });
} else {
  PVAuth.initNavAuth();
}
