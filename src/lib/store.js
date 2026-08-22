// Tiny JSON-file database with atomic writes.
// Files live in <repo>/data (override with DATA_DIR, e.g. a Railway volume).
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR || join(__dirname, '..', '..', 'data');

const COLLECTIONS = ['scripts', 'keys', 'whitelist', 'blacklist', 'cooldowns', 'panels', 'settings', 'scriptsources', 'analytics', 'buyerroles'];

const DEFAULT_VALUES = {
  analytics: [],
};

mkdirSync(DATA_DIR, { recursive: true });

export const db = {};

for (const name of COLLECTIONS) {
  const file = join(DATA_DIR, `${name}.json`);
  try {
    db[name] = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    db[name] = DEFAULT_VALUES[name] ? structuredClone(DEFAULT_VALUES[name]) : {};
  }
}

export function save(name) {
  if (!COLLECTIONS.includes(name)) throw new Error(`Unknown collection: ${name}`);
  const file = join(DATA_DIR, `${name}.json`);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(db[name], null, 2));
  renameSync(tmp, file);
}

export function saveAll() {
  for (const name of COLLECTIONS) save(name);
}
