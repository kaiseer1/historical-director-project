/**
 * Probe 2: settle how a character variable is read from a data function.
 *
 * The first probe returned ERROR for [THIS.Char.Var('x').GetValue]. Vanilla
 * localisation uses <Object>.MakeScope.Var('x'), and VOTC uses THIS.Var('x')
 * directly on a scope, so at least one of those should resolve. Rather than
 * guess and burn a console round trip per attempt, emit all three candidates
 * on one line and read off which produced a number.
 *
 *   node scripts/make-probe2.mjs [region]
 *   then in game:  run hd_probe2.txt
 *   then:          node scripts/read-probe2.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';

const cfg = loadConfig();
const region = process.argv[2] ?? 'world_europe_west_iberia';

const script = `# Historical Director - probe 2: variable data-function syntax.

clear_global_variable_list = hd_probe_set
every_county_in_region = {
\tregion = ${region}
\tlimit = { exists = holder }
\tholder = {
\t\ttop_liege = {
\t\t\tif = {
\t\t\t\tlimit = {
\t\t\t\t\tNOT = { is_target_in_global_variable_list = { name = hd_probe_set target = this } }
\t\t\t\t}
\t\t\t\tadd_to_global_variable_list = { name = hd_probe_set target = this }
\t\t\t\tset_variable = { name = hd_probe_counties value = 0 }
\t\t\t}
\t\t\tchange_variable = { name = hd_probe_counties add = 1 }
\t\t}
\t}
}

every_in_global_list = {
\tvariable = hd_probe_set
\tdebug_log = "HD:/;/vartest/;/[THIS.Char.GetID]/;/A=[THIS.Var('hd_probe_counties').GetValue]/;/B=[THIS.Char.MakeScope.Var('hd_probe_counties').GetValue]/;/C=[THIS.MakeScope.Var('hd_probe_counties').GetValue]"
\tremove_variable = hd_probe_counties
}

clear_global_variable_list = hd_probe_set
debug_log = "HD:/;/probe2_end/;/${region}"
`;

const out = path.join(cfg.ck3UserFolder, 'run', 'hd_probe2.txt');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, script, 'utf8');

console.log(`Wrote ${out}`);
console.log('');
console.log('In CK3 console:   run hd_probe2.txt');
console.log('Then:             node scripts/read-probe2.mjs');
