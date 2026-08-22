// Key generation, formatting and normalization.
import { randomBytes } from 'node:crypto';
import { CONFIG } from './config.js';

// No 0/O/1/I to avoid confusion when keys are copied by hand.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomSegment(len = 5) {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

// Raw storage format: PREFIX + 15 chars (no dashes) — fast object-key lookups.
export function generateRawKey() {
  return CONFIG.keyPrefix + randomSegment(5) + randomSegment(5) + randomSegment(5);
}

// Pretty format: PREFIX-XXXXX-XXXXX-XXXXX
export function formatKey(raw) {
  const body = String(raw || '').slice(CONFIG.keyPrefix.length);
  const chunks = body.match(/.{1,5}/g) || [];
  return `${CONFIG.keyPrefix}-${chunks.join('-')}`;
}

// Uppercase, strip everything except A-Z0-9. Returns the raw form or null.
export function normalizeKey(input) {
  const cleaned = String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleaned.startsWith(CONFIG.keyPrefix)) return null;
  if (cleaned.length < CONFIG.keyPrefix.length + 5) return null;
  return cleaned;
}

export function maskKey(raw) {
  const parts = formatKey(raw).split('-');
  if (parts.length < 4) return formatKey(raw);
  return `${parts[0]}-${parts[1]}-*****-${parts[3]}`;
}

export function maskHwid(hwid) {
  const h = String(hwid || '');
  if (h.length <= 8) return h ? '********' : 'None';
  return `${h.slice(0, 4)}…${h.slice(-4)}`;
}
