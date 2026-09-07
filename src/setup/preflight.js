import fs from 'node:fs';
import path from 'node:path';
import { MOD_NAME } from './deployMod.js';

/**
 * Preflight, as data rather than as printed output.
 *
 * Almost every failure in a setup like this is environmental - the log is
 * missing, the run folder does not exist, the game was launched without
 * -debug_mode - and each of those looks identical from inside the app: nothing
 * happens. This says which one it is.
 *
 * It returns findings instead of printing them because there are now two
 * callers who want to say it differently: `npm run doctor` prints a checklist
 * and exits, while the executable folds the same findings into its startup
 * banner and then carries on running regardless. A tester whose game is not
 * open yet should be told so, not refused.
 *
 * @typedef {{ok: boolean, label: string, detail: string, fatal?: boolean}} Finding
 */

/**
 * @param {any} cfg
 * @returns {Finding[]}
 */
export function preflight(cfg) {
  /** @type {Finding[]} */
  const findings = [];
  const add = (ok, label, detail, fatal = false) => findings.push({ ok, label, detail, fatal });

  add(
    Number(process.versions.node.split('.')[0]) >= 20,
    'Node 20 or newer',
    `found ${process.versions.node}`,
  );

  const hasFolder = fs.existsSync(cfg.ck3UserFolder);
  add(
    hasFolder,
    'CK3 user folder',
    hasFolder ? cfg.ck3UserFolder : `not found: ${cfg.ck3UserFolder}. Set ck3UserFolder in config.json.`,
    true,
  );

  const logExists = fs.existsSync(cfg.debugLogPath);
  add(
    logExists,
    'debug.log present',
    logExists ? cfg.debugLogPath : 'Launch CK3 once with -debug_mode to create it.',
  );

  if (logExists) {
    const hd = findLastMarker(cfg.debugLogPath, 'HD:');

    add(
      hd.found,
      'the mod has written to the log',
      hd.found
        ? describeMarker(hd)
        : hd.truncated
          ? `no HD: records in the last ${mb(hd.scanned)} of the log. Enable the mod in the launcher, load a save, and arm the pump.`
          : 'no HD: records yet. Enable the mod in the launcher, load a save, and arm the pump.',
    );

    const votc = findLastMarker(cfg.debugLogPath, 'VOTC:');
    if (votc.found) {
      add(true, 'Voices of the Court is also running', 'that is fine; the two prefixes do not collide');
    }
  }

  const runDir = path.join(cfg.ck3UserFolder, 'run');
  add(fs.existsSync(runDir), 'run folder', runDir);

  const modFolder = path.join(cfg.ck3UserFolder, 'mod', MOD_NAME);
  add(
    fs.existsSync(modFolder),
    'companion mod deployed',
    fs.existsSync(modFolder) ? modFolder : 'Run: npm run deploy:mod',
  );

  add(
    Boolean(cfg.llm.apiKey),
    'API key',
    cfg.llm.apiKey
      ? 'set'
      : `not set. Put one in the ${cfg.llm.apiKeyEnv} environment variable, or paste one into the sidebar's Settings tab.`,
  );

  return findings;
}

/** @param {Finding[]} findings */
export function problemCount(findings) {
  return findings.filter((f) => !f.ok).length;
}

/** How much of the log to search before giving up, in bytes. */
const MAX_SCAN = 64 * 1024 * 1024;

/** Read backwards in pieces this size. */
const CHUNK = 1024 * 1024;

/** @param {number} bytes */
function mb(bytes) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}

/**
 * Find the most recent occurrence of a marker, searching backwards.
 *
 * This used to read a flat 400 KB from the end, on the reasoning that a
 * debug.log from a long session runs to hundreds of megabytes and preflight is
 * not a good enough reason to load one. That reasoning is still right; the
 * window was not.
 *
 * A live install proved it: the log held 13,161 HD records and *none* in the
 * last 400 KB, because another mod had written past that window in the five
 * minutes since the Director's last audit. Preflight reported "no HD: records
 * yet. Enable the mod in the launcher" to someone whose mod was enabled,
 * loaded, and had just completed an audit over 198 realms. A check that sends
 * you to fix a thing that is not broken is worse than no check.
 *
 * So: search backwards a chunk at a time and stop at the first hit, which on a
 * healthy install is immediate and costs no more than the old window did. The
 * cost is only paid when the answer is genuinely far back, which is exactly the
 * case that used to be reported wrong.
 *
 * @param {string} filePath
 * @param {string} marker
 * @returns {{found: boolean, bytesFromEnd: number, scanned: number, truncated: boolean, size: number}}
 */
function findLastMarker(filePath, marker) {
  const needle = Buffer.from(marker, 'utf8');
  let fd = null;
  try {
    const size = fs.statSync(filePath).size;
    fd = fs.openSync(filePath, 'r');

    // Chunks overlap by the marker length so a marker straddling a boundary is
    // still found rather than split in half and missed.
    const overlap = needle.length - 1;
    let end = size;
    let scanned = 0;

    while (end > 0 && scanned < MAX_SCAN) {
      const start = Math.max(0, end - CHUNK);
      const span = end - start;
      const buf = Buffer.alloc(span);
      fs.readSync(fd, buf, 0, span, start);
      scanned += span;

      const at = buf.lastIndexOf(needle);
      if (at !== -1) {
        return { found: true, bytesFromEnd: size - (start + at), scanned, truncated: false, size };
      }

      if (start === 0) break;
      end = start + overlap;
    }

    return { found: false, bytesFromEnd: 0, scanned, truncated: scanned >= MAX_SCAN, size };
  } catch {
    // An unreadable log is the "debug.log present" check's problem, not this
    // one's; answering "not found" here keeps the two findings independent.
    return { found: false, bytesFromEnd: 0, scanned: 0, truncated: false, size: 0 };
  } finally {
    if (fd !== null) try { fs.closeSync(fd); } catch { /* already gone */ }
  }
}

/**
 * Say not just that the mod has been heard, but how recently.
 *
 * Distance through the log is a rough proxy for "is it still talking", and on a
 * heavily modded install it is the difference between a Director that is
 * running and one that stopped three sessions ago while other mods kept
 * writing. The threshold is deliberately generous: a busy install can put a
 * megabyte between two audits without anything being wrong.
 *
 * @param {{bytesFromEnd: number, size: number}} hit
 */
function describeMarker(hit) {
  if (hit.bytesFromEnd <= 400_000) return 'found HD: records';
  return `found HD: records, but the most recent is ${mb(hit.bytesFromEnd)} back in a ${mb(hit.size)} log. `
    + 'Other mods are writing heavily; if the Director is running, that is normal.';
}
