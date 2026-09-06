/**
 * Verification for the mod's localization.
 *
 * This closes a real gap. The smoke test speaks the wire protocol end to end
 * and never renders a single string, so nothing in the harness had ever looked
 * at a .yml file. Three event descriptions had been wrapping onto a second
 * physical line for several versions - CK3 reports "Missing colon (:)
 * separator" and drops the entry, so hd_event.0100 through 0102 had no readable
 * description at all - and the only reason it was ever noticed was someone
 * reading error.log from a live campaign.
 *
 * Two properties, both of which the engine enforces silently:
 *
 *   1. One entry per line. A quoted string running onto the next line is not a
 *      continuation; the reader treats that line as a new entry and fails.
 *   2. Every key the mod references exists. A missing one renders as the raw
 *      key in game, which is how hd_rearm_director_decision_confirm was found.
 *
 *   node scripts/check-localization.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOC_DIR = path.join(ROOT, 'mod', 'localization', 'english');

let passed = 0;
let failed = 0;

function check(label, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) console.log(`      ${detail}`);
  ok ? (passed += 1) : (failed += 1);
}

console.log('\nHistorical Director - localization\n');

// --- 1. the file parses the way CK3 parses it -------------------------------

const files = fs.existsSync(LOC_DIR)
  ? fs.readdirSync(LOC_DIR).filter((f) => f.endsWith('.yml'))
  : [];

/** @type {Map<string, string>} key -> file it was defined in */
const defined = new Map();

for (const file of files) {
  const full = path.join(LOC_DIR, file);
  const raw = fs.readFileSync(full, 'utf8');

  // CK3 wants UTF-8 with a BOM on localization files and silently misreads
  // accented characters without one.
  check(`${file} is UTF-8 with a BOM`, raw.charCodeAt(0) === 0xfeff, raw.charCodeAt(0) === 0xfeff ? '' : 'no BOM; add one or accented text will be misread');

  const lines = raw.replace(/^﻿/, '').split(/\r?\n/);
  /** @type {string[]} */
  const malformed = [];

  lines.forEach((line, i) => {
    const n = i + 1;
    const t = line.trim();
    if (n === 1) {
      if (t !== 'l_english:') malformed.push(`line 1 must be "l_english:", found "${t.slice(0, 40)}"`);
      return;
    }
    if (!t || t.startsWith('#')) return;

    // key:N "value" - the version number is optional in practice but the colon
    // is not, and an unterminated quote means the entry wrapped.
    const m = t.match(/^([A-Za-z0-9_.]+):\d*\s+"(.*)"$/);
    if (!m) {
      malformed.push(`line ${n}: ${t.slice(0, 60)}`);
      return;
    }
    if (defined.has(m[1])) malformed.push(`line ${n}: duplicate key ${m[1]}`);
    defined.set(m[1], file);
  });

  check(
    `${file} is one entry per line`,
    malformed.length === 0,
    malformed.length ? malformed.join('\n      ') : `${defined.size} entries, none wrapped`,
  );
}

check('a localization file exists at all', files.length > 0, files.join(', ') || 'none found');

// --- 2. every key the mod references is defined -----------------------------
//
// Scanned narrowly on purpose. `name =` also appears in set_variable blocks and
// in GUI widget names, so only the fields that genuinely carry localization are
// read, and only values that look like this mod's keys are collected.

/** @type {Map<string, string>} key -> where it is referenced */
const referenced = new Map();

function scan(dir, fields, valuePattern) {
  const full = path.join(ROOT, 'mod', dir);
  if (!fs.existsSync(full)) return;
  for (const entry of fs.readdirSync(full, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.txt')) continue;
    const file = path.join(entry.parentPath ?? entry.path, entry.name);
    const text = fs.readFileSync(file, 'utf8');
    text.split(/\r?\n/).forEach((line, i) => {
      const m = line.match(new RegExp(`^\\s*(${fields.join('|')})\\s*=\\s*([A-Za-z0-9_.]+)\\s*$`));
      if (!m) return;
      if (!valuePattern.test(m[2])) return;
      referenced.set(m[2], `${path.relative(ROOT, file)}:${i + 1}`);
    });
  }
}

// Events: title, desc, and the name of each option.
scan('events', ['title', 'desc', 'name'], /^hd_event\.\d+\.[a-z]+$/);
// Decisions: the description and tooltip keys.
scan('common/decisions', ['desc', 'selection_tooltip', 'confirm_text'], /^hd_[a-z0-9_]+$/);

// A decision also needs a key named exactly after itself, and a _confirm. CK3
// does not reference those anywhere in script - it looks them up by convention -
// so they have to be derived rather than scanned. That is precisely how
// hd_rearm_director_decision_confirm came to be missing.
const decisionsDir = path.join(ROOT, 'mod', 'common', 'decisions');
if (fs.existsSync(decisionsDir)) {
  for (const file of fs.readdirSync(decisionsDir).filter((f) => f.endsWith('.txt'))) {
    const full = path.join(decisionsDir, file);
    const text = fs.readFileSync(full, 'utf8');
    for (const m of text.matchAll(/^([a-z0-9_]+)\s*=\s*\{/gm)) {
      referenced.set(m[1], `${path.join('mod/common/decisions', file)} (decision name)`);
      referenced.set(`${m[1]}_confirm`, `${path.join('mod/common/decisions', file)} (decision confirm, required by convention)`);
    }
  }
}

const missing = [...referenced].filter(([key]) => !defined.has(key));
check(
  'every key the mod references is defined',
  missing.length === 0,
  missing.length
    ? missing.map(([key, where]) => `${key}  <- ${where}`).join('\n      ')
    : `${referenced.size} references, all resolved`,
);

// The reverse is a warning rather than a failure: an unused entry costs
// nothing, and a key referenced only from a GUI file would look unused here.
const unused = [...defined.keys()].filter((k) => !referenced.has(k));
if (unused.length) {
  console.log(`note  ${unused.length} defined but not referenced from script: ${unused.slice(0, 6).join(', ')}${unused.length > 6 ? ' ...' : ''}`);
  console.log('      harmless; GUI files and dynamic lookups are not scanned.');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
