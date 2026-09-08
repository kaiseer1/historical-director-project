/**
 * A fake CK3, for testing the orchestrator without launching the game.
 *
 * It does the two things the companion mod does: append HD: records to a log
 * file, and watch the run file for staged effects, answering them the way the
 * pump would. That makes the whole loop — locate, snapshot, audit, approve,
 * apply — testable in seconds, which matters because the alternative is a
 * five-minute game load for every change to the parser.
 *
 *   node scripts/simulate-game.mjs [--iberia|--byzantium] [--log <path>]
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const args = process.argv.slice(2);
const scenarioName = args.includes('--byzantium') ? 'byzantium' : args.includes('--andalus') ? 'andalus' : 'iberia';
const logIdx = args.indexOf('--log');
const defaultCk3 = path.join(os.homedir(), 'Documents', 'Paradox Interactive', 'Crusader Kings III');
const logPath = logIdx !== -1 ? args[logIdx + 1] : path.join(defaultCk3, 'logs', 'debug.log');
// The run file always sits beside the log folder, so a --log pointing at a
// scratch folder moves the whole fake game there rather than half of it.
const ck3 = path.resolve(path.dirname(logPath), '..');
const runPath = path.join(ck3, 'run', 'hd.txt');

const SCENARIOS = {
  // Toledo, 1066: the design's own worked example. The drift planted here is
  // Toledo sitting at kingdom tier when the taifas were duchy-tier polities.
  iberia: {
    date: '1066.9.15',
    totalDays: 389_000,
    playerId: 1001,
    regions: ['world_europe_west_iberia'],
    player: { capital: 'Toledo', culture: 'Andalusian', faith: 'Sunni', title: 'Kingdom of Toledo', tier: 'Kingdom' },
    realms: [
      [1001, 'Al-Mamun', 'Kingdom of Toledo', 'Kingdom', 9, 'Andalusian', 'Sunni', 'Toledo', 'Dhulnunid', 'House Dhulnunid', 'yes', 'Feudal'],
      [1002, 'Alfonso VI', 'Kingdom of Leon', 'Kingdom', 14, 'Castilian', 'Catholic', 'Leon', 'Jimena', 'House Jimena', 'yes', 'Feudal'],
      [1003, 'Al-Mutamid', 'Duchy of Sevilla', 'Duchy', 6, 'Andalusian', 'Sunni', 'Sevilla', 'Abbadid', 'House Abbadid', 'yes', 'Feudal'],
      [1004, 'Sancho Ramirez', 'Kingdom of Aragon', 'Kingdom', 5, 'Catalan', 'Catholic', 'Jaca', 'Jimena', 'House Jimena', 'yes', 'Feudal'],
      [1005, 'Al-Muqtadir', 'Duchy of Zaragoza', 'Duchy', 7, 'Andalusian', 'Sunni', 'Zaragoza', 'Hudid', 'House Hudid', 'yes', 'Feudal'],
    ],
  },
  // Constantinople, 867. Sphere reaches the Balkans, Italy and Anatolia.
  byzantium: {
    date: '867.9.16',
    totalDays: 316_600,
    playerId: 2001,
    regions: ['world_europe_south_east'],
    player: { capital: 'Constantinople', culture: 'Greek', faith: 'Orthodox', title: 'Byzantine Empire', tier: 'Empire' },
    realms: [
      [2001, 'Basileios I', 'Byzantine Empire', 'Empire', 31, 'Greek', 'Orthodox', 'Constantinople', 'Makedon', 'House Makedon', 'yes', 'Feudal'],
      [2002, 'Boris I', 'Kingdom of Bulgaria', 'Kingdom', 12, 'Bulgarian', 'Tengri', 'Preslav', 'Krum', 'House Krum', 'yes', 'Tribal'],
      [2003, 'Muhammad I', 'Duchy of Sicily', 'Duchy', 4, 'Berber', 'Sunni', 'Palermo', 'Aghlabid', 'House Aghlabid', 'yes', 'Feudal'],
    ],
  },
  // Cordoba, 1218. Modelled on the campaign in PROGRESS.md section 3: an
  // alt-history Andalusian empire spanning Iberia, the Maghreb and Sicily,
  // joined from an existing save so the baseline is captured mid-campaign.
  //
  // This is the case the Director was silent on. It exercises three things at
  // once: a realm whose footprint covers three regions and must seed a sphere
  // from all of them, a baseline forty years past the 1178 bookmark, and an
  // empire-tier realm no encyclopedia carries.
  andalus: {
    date: '1218.4.2',
    totalDays: 444_907,
    playerId: 3001,
    regions: ['world_europe_west_iberia'],
    realmRegions: ['world_europe_west_iberia', 'world_africa_north_west', 'world_europe_south_italy'],
    player: { capital: 'Qurtubah', culture: 'Andalusian', faith: 'Sunni', title: 'the banu zahir Empire', tier: 'Empire' },
    realms: [
      [3001, 'Zahir III', 'the banu zahir Empire', 'Empire', 65, 'Andalusian', 'Sunni', 'Qurtubah', 'Banu Zahir', 'House Zahir', 'yes', 'Feudal'],
      [3002, 'Sancho VII', 'Kingdom of Navarra', 'Kingdom', 6, 'Basque', 'Catholic', 'Pamplona', 'Jimena', 'House Jimena', 'yes', 'Feudal'],
      [3003, 'Yahya ibn Ghaniya', 'Grand Emirate of Maghreb', 'Kingdom', 7, 'Berber', 'Sunni', 'Tilimsan', 'Ghaniyid', 'House Ghaniya', 'yes', 'Feudal'],
      [3004, 'Federico', 'Empire of Italia', 'Empire', 22, 'Italian', 'Catholic', 'Palermo', 'Hohenstaufen', 'House Hohenstaufen', 'yes', 'Feudal'],
      [3005, 'Alfonso IX', 'Kingdom of Leon', 'Kingdom', 11, 'Castilian', 'Catholic', 'Leon', 'Jimena', 'House Jimena', 'yes', 'Feudal'],
    ],
    // A war already being fought, so the smoke run exercises the whole path
    // rather than only the empty case. Navarra is the smallest realm on the
    // board and is being invaded by the largest: the Director should be able to
    // see that before it offers anyone a claim on Pamplona.
    //
    // Keyed by war id, because the real script emits one record per belligerent
    // in the sphere and both of these are in it. The duplicate is the point:
    // the parser has to collapse it.
    wars: [[4001, 3001, 3002, 'Conquest of Navarra']],
  },
};

const scenario = SCENARIOS[scenarioName];

fs.mkdirSync(path.dirname(logPath), { recursive: true });
fs.mkdirSync(path.dirname(runPath), { recursive: true });

function emit(line) {
  fs.appendFileSync(logPath, `[00:00:00][effect.cpp:1]: ${line}\n`, 'utf8');
}

function emitLocate() {
  const p = scenario.player;
  emit(`HD:/;/locate_begin/;/${scenario.playerId}/;/${p.capital}/;/${p.culture}/;/${p.faith}/;/${p.title}/;/${p.tier}/;/${scenario.date}`);
  for (const r of scenario.regions) emit(`HD:/;/in_region/;/${r}`);
  // Where the realm holds land, as opposed to where the capital sits. A
  // scenario that does not declare these falls back to the capital alone,
  // which is what a mod build predating the probe would do.
  for (const r of scenario.realmRegions ?? []) emit(`HD:/;/realm_region/;/${r}`);
  emit(`HD:/;/locate_end/;/${scenario.playerId}`);
  console.log(`[sim] answered locate: ${p.title} at ${p.capital}`);
}

function emitSnapshot(token) {
  emit(`HD:/;/snapshot_begin/;/${token}/;/${scenario.date}/;/${scenario.totalDays}/;/${scenario.playerId}`);
  for (const r of scenario.realms) {
    emit(`HD:/;/realm/;/${r.join('/;/')}`);
    // The real mod derives this from primary_title.tier rather than from the
    // printed rank; here the scenario's rank word stands in for it. Emitted as
    // its own record, exactly as the game does, so the parser is exercised the
    // same way.
    if (!process.argv.includes('--legacy')) {
      emit(`HD:/;/realm_tier/;/${r[0]}/;/${String(r[3]).toLowerCase()}`);
      // Every realm in these small scenarios sits in the player's own regions,
      // so all of them are neighbours. A real sweep marks only those actually
      // holding land in a home region.
      //
      // A scenario lists ids in `distant` to put them on the rim of the sphere,
      // which is how the locality rule gets exercised: home implies near, so a
      // realm that is neither cannot be pushed into anyone. Realm rows are
      // arrays, so the opt-out is keyed on the id rather than a row property.
      if (!(scenario.distant ?? []).includes(r[0])) {
        emit(`HD:/;/realm_home/;/${r[0]}`);
        emit(`HD:/;/realm_near/;/${r[0]}`);
      }
    }
  }
  // Wars, emitted exactly as the mod does: from inside the same per-realm loop
  // that writes the realm lines, once for every belligerent that is in the
  // sphere. Both sides are in these scenarios, so each war is emitted twice and
  // the parser is made to collapse it - which is the behaviour the real game
  // produces, and the reason the record carries a war id at all.
  for (const [id, attacker, defender, name] of scenario.wars ?? []) {
    for (const _ of [attacker, defender]) emit(`HD:/;/war/;/${id}/;/${attacker}/;/${defender}/;/${name}`);
  }
  emit(`HD:/;/snapshot_end/;/${token}`);
  const wars = (scenario.wars ?? []).length;
  console.log(`[sim] answered snapshot ${token}: ${scenario.realms.length} realms${wars ? `, ${wars} war(s)` : ''}`);
}

// Play the role of the execution pump: notice staged script and respond.
let lastSeen = '';
setInterval(() => {
  let text = '';
  try { text = fs.readFileSync(runPath, 'utf8'); } catch { return; }
  if (!text.trim() || text === lastSeen) return;
  lastSeen = text;

  // The run file always carries the liveness marker now; a file holding only
  // that is the pump idling, not a batch to answer.
  const withoutAlive = text.replace(/hd_mark_alive = yes/g, '').trim();
  if (!withoutAlive) return;

  const token = text.match(/value = (\d+)/)?.[1] ?? '0';
  if (text.includes('hd_locate_player') || text.includes('locate_begin')) emitLocate();
  else if (text.includes('snapshot_begin')) emitSnapshot(token);
  else {
    // Toolkit actions now carry their own applied/refused records, so the fake
    // pump just replays whichever branch a real game would have taken. It
    // always takes the success branch: exercising the refusal path is what
    // --refuse is for.
    const m = text.match(/HD:\/;\/applied\/;\/(\d+)\/;\/(\w+)/);
    if (!m) return;
    const [, tok, action] = m;

    // Report the effects the batch actually carries. The orchestrator clears
    // the run file as soon as it sees the applied record, so this is the only
    // race-free moment at which anything can observe what was staged - which
    // matters for an action like grant_claim whose momentum effects are the
    // whole point and are invisible in the applied record itself.
    const carried = ['add_pressed_claim', 'add_gold', 'add_prestige', 'add_piety', 'add_character_modifier', 'start_war']
      .filter((effect) => text.includes(effect));
    if (carried.length) console.log(`[sim] batch carries: ${carried.join(', ')}`);
    if (process.argv.includes('--refuse')) {
      emit(`HD:/;/refused/;/${tok}/;/${action}/;/precondition_failed`);
      console.log(`[sim] refused ${action} (precondition false)`);
    } else {
      emit(`HD:/;/applied/;/${tok}/;/${action}/;/ok`);
      console.log(`[sim] executed ${action} and confirmed it`);
    }
  }
}, 700);

console.log(`[sim] pretending to be CK3, scenario "${scenarioName}"`);
console.log(`[sim] log: ${logPath}`);
console.log(`[sim] run: ${runPath}`);
console.log('[sim] sending a date heartbeat every 3s; Ctrl+C to stop\n');

setInterval(() => emit(`HD:/;/date/;/${scenario.date}/;/${scenario.totalDays}`), 3000);
emit(`HD:/;/date/;/${scenario.date}/;/${scenario.totalDays}`);
