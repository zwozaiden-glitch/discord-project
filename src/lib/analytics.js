// Validation analytics — every API validation call is recorded here and
// displayed with /analytics (keys and HWIDs are masked for privacy).
import { db, save } from './store.js';
import { maskKey, maskHwid, normalizeKey } from './keys.js';

const MAX_EVENTS = 50000;
const MAX_AGE_MS = 90 * 24 * 3600e3;
let saveTimer = null;

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    save('analytics');
  }, 5000);
  saveTimer.unref?.();
}

export function recordValidation({ script, code, key, hwid, ip }) {
  const events = db.analytics || (db.analytics = []);
  events.push({
    t: Date.now(),
    script: String(script || ''),
    code: String(code || ''),
    key: maskKey(normalizeKey(key) || key || ''),
    hwid: maskHwid(hwid || ''),
    ip: String(ip || ''),
  });

  // Trim old events (keep things snappy forever).
  const cutoff = Date.now() - MAX_AGE_MS;
  while (events.length && events[0].t < cutoff) events.shift();
  while (events.length > MAX_EVENTS) events.shift();

  scheduleSave();
}

export function analyticsStats({ script = null, days = 7 } = {}) {
  const events = db.analytics || [];
  const now = Date.now();
  const dayMs = 24 * 3600e3;

  const filtered = script ? events.filter((e) => e.script === script) : events;
  const last24h = filtered.filter((e) => now - e.t < dayMs).length;
  const last7d = filtered.filter((e) => now - e.t < 7 * dayMs).length;

  const byScript = {};
  for (const e of filtered) {
    byScript[e.script] = (byScript[e.script] || 0) + 1;
  }

  const byCode = {};
  for (const e of filtered) byCode[e.code] = (byCode[e.code] || 0) + 1;

  const byDay = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const start = now - (i + 1) * dayMs;
    const end = start + dayMs;
    const count = filtered.filter((e) => e.t >= start && e.t < end).length;
    const date = new Date(start);
    byDay.push({
      label: `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}`,
      count,
    });
  }

  const byKey = {};
  for (const e of filtered) {
    if (!e.key) continue;
    byKey[e.key] = (byKey[e.key] || 0) + 1;
  }
  const topKeys = Object.entries(byKey)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key, count]) => ({ key, count }));

  const recent = [...filtered].sort((a, b) => b.t - a.t).slice(0, 8);

  return { total: filtered.length, last24h, last7d, byScript, byCode, byDay, topKeys, recent };
}
