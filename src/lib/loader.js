// Shared Protect-Vmax loadstring helpers. Users paste this into their executor.
import { CONFIG } from './config.js';
import { normalizeKey } from './keys.js';
import { db, save } from './store.js';

export function publicBaseUrl() {
  return String(CONFIG.publicUrl || `http://localhost:${CONFIG.apiPort}`).replace(/\/+$/, '');
}

function strHash(str) {
  let h = 5381;
  for (let i = 0; i < String(str).length; i++) {
    h = (h << 5) + h + String(str).charCodeAt(i);
    h |= 0;
  }
  return h >>> 0;
}

function hashHex(str, len) {
  let a = strHash(str);
  let s = '';
  while (s.length < len) {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    s += Math.floor(((t ^ (t >>> 14)) >>> 0) / 4294967296 * 16).toString(16);
  }
  return s.slice(0, len);
}

function ensureLoaders() {
  if (!db.loaders || Array.isArray(db.loaders)) db.loaders = {};
  return db.loaders;
}

export function mintLoaderToken(script, key) {
  const raw = normalizeKey(key) || String(key || '').replace(/[^A-Za-z0-9]/g, '');
  const token = hashHex(`${script}|${raw}`, 20);
  ensureLoaders()[token] = {
    script: String(script),
    key: raw,
    updatedAt: new Date().toISOString(),
  };
  save('loaders');
  return token;
}

export function getLoaderRecord(token) {
  if (!token) return null;
  return ensureLoaders()[String(token).replace(/\.lua$/i, '')] || null;
}

export function shortLoaderUrl(script, key) {
  if (key) {
    const token = mintLoaderToken(script, key);
    return `${publicBaseUrl()}/s/${token}.lua`;
  }
  const slug = encodeURIComponent(String(script || 'script').replace(/\s+/g, '-'));
  return `${publicBaseUrl()}/s/${slug}.lua`;
}

export function loadEndpoint(script) {
  const scriptQ = encodeURIComponent(script);
  return `${publicBaseUrl()}/api/v1/load?script=${scriptQ}&key=`;
}

// One-line GitHub-raw style loader:
//   loadstring(game:HttpGet("https://host/s/<token>.lua"))()
export function buildLoader(script, key) {
  const url = shortLoaderUrl(script, key);
  return `loadstring(game:HttpGet("${url}"))()`;
}

export function loaderMessage(script, key, { heading = true } = {}) {
  const block = `\`\`\`lua\n${buildLoader(script, key)}\n\`\`\``;
  if (!heading) return block;
  return `📦 **Protect-Vmax loader — ${script}**\nPaste this one line into your executor:\n${block}`;
}
