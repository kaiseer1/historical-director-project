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
    // Only the tail is read. A debug.log from a long session runs to hundreds
    // of megabytes, and preflight is not a good enough reason to load one.
    const size = fs.statSync(cfg.debugLogPath).size;
    const fd = fs.openSync(cfg.debugLogPath, 'r');
    const span = Math.min(size, 400_000);
    const buf = Buffer.alloc(span);
    fs.readSync(fd, buf, 0, span, Math.max(0, size - span));
    fs.closeSync(fd);
    const text = buf.toString('utf8');

    add(
      text.includes('HD:'),
      'the mod has written to the log',
      text.includes('HD:')
        ? 'found HD: records'
        : 'no HD: records yet. Enable the mod in the launcher, load a save, and arm the pump.',
    );
    if (text.includes('VOTC:')) {
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
