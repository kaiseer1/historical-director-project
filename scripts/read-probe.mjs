/**
 * Read back what the probe wrote and say whether the perception layer works.
 *
 * The failure mode that matters is not an empty log but a line full of
 * unresolved data functions: CK3 does not error on a bad data function, it
 * prints the source text or nothing at all. So this checks the shape of what
 * came back, field by field, rather than merely that something came back.
 *
 *   node scripts/read-probe.mjs
 */
import fs from 'node:fs';
import { loadConfig } from '../src/config.js';
import { parseLine, toRealm } from '../src/bridge/protocol.js';
import { label } from '../src/director/regions.js';

const cfg = loadConfig();

if (!fs.existsSync(cfg.debugLogPath)) {
  console.error(`No debug.log at ${cfg.debugLogPath}`);
  process.exit(1);
}

// The log runs to tens of megabytes in a long session; only the tail matters.
const size = fs.statSync(cfg.debugLogPath).size;
const fd = fs.openSync(cfg.debugLogPath, 'r');
const span = Math.min(size, 3_000_000);
const buf = Buffer.allocUnsafe(span);
fs.readSync(fd, buf, 0, span, size - span);
fs.closeSync(fd);

const lines = buf.toString('utf8').split(/\r?\n/);
const begin = lines.map((l, i) => [l, i]).filter(([l]) => l.includes('HD:/;/probe_begin')).pop();

if (!begin) {
  console.log('\nNo probe output found in debug.log.\n');
  console.log('Did the console command run? In CK3 press ` and type:  run hd_probe.txt');
  console.log('If the console says the file is missing, check that the run folder is');
  console.log(`  ${cfg.ck3UserFolder}\\run`);
  process.exit(1);
}

const records = lines
  .slice(begin[1])
  .map(parseLine)
  .filter((r) => r !== null);

const realms = records.filter((r) => r.kind === 'realm').map((r) => toRealm(r.fields));
const regions = records.filter((r) => r.kind === 'in_region').map((r) => r.fields[0]);
const ended = records.some((r) => r.kind === 'probe_end');
const header = records.find((r) => r.kind === 'probe_begin');

console.log('\nHistorical Director - probe results\n');
console.log(`date          : ${header?.fields[0] ?? '?'}  (day ${header?.fields[1] ?? '?'})`);
console.log(`player id     : ${header?.fields[2] ?? '?'}`);
console.log(`regions hit   : ${regions.length ? regions.map(label).join(', ') : 'NONE - the player is outside every probed region'}`);
console.log(`realms found  : ${realms.length}`);
console.log(`sweep finished: ${ended ? 'yes' : 'NO - the region sweep did not complete'}`);

if (realms.length) {
  console.log('\nLargest realms in the swept region:\n');
  const top = [...realms].sort((a, b) => b.countiesInSphere - a.countiesInSphere).slice(0, 12);
  for (const r of top) {
    console.log(
      `  ${String(r.id).padEnd(10)} ${(r.ruler || '?').padEnd(28)} ` +
      `${(r.primaryTitle || '?').padEnd(26)} ${String(r.tier || '?').padEnd(9)} ` +
      `${String(r.countiesInSphere).padStart(3)}c  ${r.culture}/${r.faith}`,
    );
  }
}

// --- did every field actually resolve? ---
const problems = [];
const sample = realms[0];
if (!sample) {
  problems.push('no realm lines at all - the realm debug_log did not fire');
} else {
  const checks = [
    ['id', Number.isFinite(sample.id) && sample.id !== 0],
    ['ruler', Boolean(sample.ruler) && sample.ruler !== 'Unknown'],
    ['primaryTitle', Boolean(sample.primaryTitle)],
    ['tier', Boolean(sample.tier)],
    ['culture', Boolean(sample.culture)],
    ['faith', Boolean(sample.faith)],
    ['capital', Boolean(sample.capital)],
    ['government', Boolean(sample.government)],
  ];
  for (const [field, ok] of checks) if (!ok) problems.push(`field "${field}" did not resolve`);
  if (!realms.some((r) => r.countiesInSphere > 0)) {
    problems.push('countiesInSphere is zero everywhere - the counter variable did not resolve');
  }
}

console.log('');
if (problems.length === 0) {
  console.log('All fields resolved. The perception layer works against your live game.\n');
} else {
  console.log('Problems:\n');
  for (const p of problems) console.log(`  - ${p}`);
  console.log('\nRaw first realm line, for diagnosis:');
  const rawLine = lines.slice(begin[1]).find((l) => l.includes('HD:/;/realm'));
  console.log(`  ${rawLine?.trim() ?? '(none)'}\n`);
}
