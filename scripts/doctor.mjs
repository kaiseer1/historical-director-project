/**
 * Preflight. Almost every failure in a setup like this is environmental —
 * the log is missing, the run folder does not exist, the game was launched
 * without -debug_mode — and each of those looks identical from inside the app:
 * nothing happens. This tells the user which one it is.
 *
 * The checks themselves live in src/setup/preflight.js, because the executable
 * runs the same ones at startup and two copies would eventually disagree about
 * what "ready" means.
 */
import { loadConfig } from '../src/config.js';
import { preflight, problemCount } from '../src/setup/preflight.js';

const cfg = loadConfig();
const findings = preflight(cfg);

console.log('\nHistorical Director - preflight\n');

for (const f of findings) {
  console.log(`${f.ok ? ' ok ' : 'FAIL'}  ${f.label}`);
  if (f.detail) console.log(`      ${f.detail}`);
}

const problems = problemCount(findings);
console.log(`\n${problems === 0 ? 'All clear.' : `${problems} problem(s) to fix.`}\n`);
process.exit(problems === 0 ? 0 : 1);
