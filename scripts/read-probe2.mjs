/**
 * Read probe 2 and report which variable syntax resolved.
 */
import fs from 'node:fs';
import { loadConfig } from '../src/config.js';

const cfg = loadConfig();
const size = fs.statSync(cfg.debugLogPath).size;
const fd = fs.openSync(cfg.debugLogPath, 'r');
const span = Math.min(size, 2_000_000);
const buf = Buffer.allocUnsafe(span);
fs.readSync(fd, buf, 0, span, size - span);
fs.closeSync(fd);

const lines = buf.toString('utf8').split(/\r?\n/).filter((l) => l.includes('HD:/;/vartest'));
if (lines.length === 0) {
  console.log('\nNo probe 2 output found. In CK3 console:  run hd_probe2.txt\n');
  process.exit(1);
}

console.log(`\nProbe 2 - ${lines.length} realm line(s)\n`);
for (const l of lines.slice(0, 4)) console.log('  ' + l.split('HD:/;/')[1]);

const joined = lines.join('\n');
const verdict = (tag) => {
  const vals = [...joined.matchAll(new RegExp(`${tag}=([^/\n]*)`, 'g'))].map((m) => m[1].trim());
  const numeric = vals.filter((v) => /^\d+$/.test(v) && v !== '0');
  return { vals: vals.slice(0, 3), ok: numeric.length > 0 };
};

console.log('\nWhich syntax resolved:\n');
const forms = {
  A: "THIS.Var('x').GetValue",
  B: "THIS.Char.MakeScope.Var('x').GetValue",
  C: "THIS.MakeScope.Var('x').GetValue",
};
let winner = null;
for (const [tag, form] of Object.entries(forms)) {
  const v = verdict(tag);
  console.log(`  ${tag}  ${v.ok ? 'WORKS ' : 'fails '} ${form.padEnd(40)} -> ${v.vals.join(', ')}`);
  if (v.ok && !winner) winner = tag;
}
console.log(winner ? `\nUse form ${winner}: ${forms[winner]}\n` : '\nNone resolved; the counter needs a different approach.\n');
