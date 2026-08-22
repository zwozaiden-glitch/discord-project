// Shared Protect-Vmax loadstring helpers. Users paste this into their executor.
import { CONFIG } from './config.js';
import { formatKey } from './keys.js';

export function publicBaseUrl() {
  return String(CONFIG.publicUrl || `http://localhost:${CONFIG.apiPort}`).replace(/\/+$/, '');
}

export function loadEndpoint(script) {
  const scriptQ = encodeURIComponent(script);
  return `${publicBaseUrl()}/api/v1/load?script=${scriptQ}&key=`;
}

// Matches the public loader format:
//
//   -- Protect-Vmax loader — Vmax
//   local key = "KEY-XXXX-XXXX" -- your user's key
//   loadstring(game:HttpGet("https://host/api/v1/load?script=Vmax&key=" .. key))()
export function buildLoader(script, key) {
  const formatted = key ? formatKey(key) : 'YOUR-KEY-HERE';
  const urlPrefix = loadEndpoint(script);
  return [
    `-- Protect-Vmax loader — ${script}`,
    '',
    `local key = "${formatted}" -- your user's key`,
    '',
    'loadstring(game:HttpGet(',
    `    "${urlPrefix}" .. key`,
    '))()',
  ].join('\n');
}

export function loaderMessage(script, key, { heading = true } = {}) {
  const block = `\`\`\`lua\n${buildLoader(script, key)}\n\`\`\``;
  if (!heading) return block;
  return `📦 **Protect-Vmax loader — ${script}**\nPaste this into your executor:\n${block}`;
}
