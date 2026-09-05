/**
 * Write a self-contained probe into the CK3 run folder.
 *
 * The point is to test the perception layer without installing anything. The
 * probe depends on no scripted effects of ours, so it can be run from the
 * console of a game that is already in progress, and it exercises exactly the
 * parts most likely to be wrong: the data functions in the realm line, the
 * region-membership trigger, and the county sweep that builds a snapshot.
 *
 *   node scripts/make-probe.mjs [region]
 *
 * Then in game, with the console open (`), type:  run hd_probe.txt
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';

const cfg = loadConfig();
const region = process.argv[2] ?? 'world_europe_west_iberia';

// Same field order as hd_log_realm in the mod, so a working probe means a
// working perception layer rather than merely a working probe.
const REALM_LINE =
  'HD:/;/realm/;/[THIS.Char.GetID]/;/[THIS.Char.GetTitledFirstNameNicknamedNoTooltipRegnal]' +
  '/;/[THIS.Char.GetPrimaryTitle.GetNameNoTooltip]/;/[THIS.Char.GetPrimaryTitle.GetRankConcept]' +
  "/;/[THIS.Char.Var('hd_probe_counties').GetValue]/;/[THIS.Char.GetCulture.GetName]" +
  '/;/[THIS.Char.GetFaith.GetName]/;/[THIS.Char.GetCapitalLocation.GetNameNoTooltip]' +
  '/;/[THIS.Char.GetDynasty.GetName]/;/[THIS.Char.GetHouse.GetName]' +
  '/;/[THIS.Char.IsIndependentRuler]/;/[THIS.Char.GetGovernment.GetNameNoTooltip]';

const REGIONS = [
  'world_europe_west_iberia', 'world_europe_west_francia', 'world_europe_west_britannia',
  'world_europe_west_germania', 'world_europe_north', 'world_europe_east',
  'world_europe_south', 'world_europe_south_italy', 'world_europe_south_east',
  'world_asia_minor', 'world_middle_east', 'world_mesopotamia', 'world_persia',
  'world_africa_north_west', 'world_africa_north_east',
  'world_india', 'world_steppe_west', 'world_steppe_east', 'world_asia_east',
];

const script = `# Historical Director - standalone probe, safe to run mid-campaign.
# Reads state and writes log lines. The only mutation is a counter variable
# that is removed again on the way out.

debug_log = "HD:/;/probe_begin/;/[GetCurrentDate.GetStringShort]/;/[GetCurrentDate.GetDateAsTotalDays]/;/[GetPlayer.GetID]"

# 1. Does the realm line resolve? Runs in a character scope, exactly as
#    hd_log_realm does when driven by every_in_global_list.
every_player = {
\tdebug_log = "${REALM_LINE}"
}

# 2. Does region membership resolve, and where does the game think we are?
every_player = {
${REGIONS.map((r) => `\tif = {
\t\tlimit = { capital_county.title_province ?= { geographical_region = ${r} } }
\t\tdebug_log = "HD:/;/in_region/;/${r}"
\t}`).join('\n')}
}

# 3. The expensive one: sweep a region, walk each county up to its top liege,
#    de-duplicate, and count the footprint in a single pass.
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
\tdebug_log = "${REALM_LINE}"
\tremove_variable = hd_probe_counties
}

clear_global_variable_list = hd_probe_set
debug_log = "HD:/;/probe_end/;/${region}"
`;

const runDir = path.join(cfg.ck3UserFolder, 'run');
fs.mkdirSync(runDir, { recursive: true });
const out = path.join(runDir, 'hd_probe.txt');
fs.writeFileSync(out, script, 'utf8');

console.log(`Wrote ${out}`);
console.log(`Sweeping region: ${region}`);
console.log('');
console.log('In CK3, open the console with ` and type:');
console.log('');
console.log('    run hd_probe.txt');
console.log('');
console.log('Then run:  node scripts/read-probe.mjs');
