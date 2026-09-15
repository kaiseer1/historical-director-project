/**
 * Verification for the watchlist and the probe that feeds it.
 *
 * Same discipline as the detector it ships beside, pointed at a different fact:
 * **a watched ruler the game did not mention is not dead.** V4, V8 and V9 are
 * the cases that say so - a ruler who has left the observed window, a field the
 * report could not fill, and a tag the game never answered on. Each of them,
 * read as a change, would interrupt the audit cadence to correct a death that
 * never happened.
 *
 *   node scripts/check-watchlist.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SnapshotAssembler } from '../src/model/WorldState.js';
import { parseLine } from '../src/bridge/protocol.js';
import { Watchlist, describeDivergences } from '../src/model/Watchlist.js';
import { watchScript } from '../src/bridge/ck3Script.js';

let passed = 0;
let failed = 0;

function check(label, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) console.log(`      ${detail}`);
  ok ? (passed += 1) : (failed += 1);
}

const ANATOLIA = 'world_asia_minor';
const FRANCIA = 'world_europe_west_francia';
const BALKANS = 'world_europe_south_east';

/**
 * A snapshot the way the game would report one, including the v0.11.0 seat and
 * title records.
 */
function snapshot(realms, { seats = true, date = '1071.8.26', totalDays = 391_000 } = {}) {
  const a = new SnapshotAssembler();
  const feed = (line) => {
    const rec = parseLine(`[00:00:00][effect.cpp:1]: ${line}`);
    return rec ? a.ingest(rec) : null;
  };
  feed(`HD:/;/snapshot_begin/;/1/;/${date}/;/${totalDays}/;/1`);
  for (const r of realms) {
    for (const reg of r.holds ?? []) feed(`HD:/;/realm_in_region/;/${r.id}/;/${reg}`);
    feed(
      `HD:/;/realm/;/${r.id}/;/${r.ruler}/;/${r.title}/;/King/;/${r.counties ?? 4}`
      + `/;/${r.culture ?? 'Greek'}/;/${r.faith ?? 'Orthodox'}/;/Constantinople/;/Doukas/;/House Doukas/;/yes/;/Feudal`,
    );
    feed(`HD:/;/realm_tier/;/${r.id}/;/${r.tierKey ?? 'kingdom'}`);
    feed(`HD:/;/realm_home/;/${r.id}`);
    feed(`HD:/;/realm_near/;/${r.id}`);
    if (seats) for (const s of r.seat ?? []) feed(`HD:/;/realm_capital/;/${r.id}/;/${s}`);
    for (const t of r.titles ?? []) feed(`HD:/;/realm_title/;/${r.id}/;/${t.region}/;/${t.tier}/;/${t.name}`);
  }
  return feed('HD:/;/snapshot_end/;/1').snapshot;
}

const REALMS = [
  { id: 1, ruler: 'Romanos', title: 'Byzantine Empire', tierKey: 'empire', holds: [ANATOLIA], seat: [ANATOLIA], counties: 20 },
  {
    id: 2,
    ruler: 'Philippe',
    title: 'Kingdom of France',
    culture: 'French',
    faith: 'Catholic',
    holds: [ANATOLIA, FRANCIA],
    seat: [FRANCIA],
    counties: 9,
    titles: [{ region: ANATOLIA, tier: 'duchy', name: 'Duchy of Anatolia' }],
  },
  { id: 3, ruler: 'Mihailo', title: 'Kingdom of Serbia', culture: 'Serbian', holds: [ANATOLIA, BALKANS], seat: [BALKANS], counties: 6 },
  { id: 4, ruler: 'Theodoros', title: 'Duchy of Thrakesion', tierKey: 'duchy', holds: [ANATOLIA], seat: [ANATOLIA], counties: 5 },
  { id: 5, ruler: 'Ibrahim', title: 'Sultanate of Rum', culture: 'Turkish', faith: 'Sunni', holds: [ANATOLIA], seat: [], counties: 7 },
];

// The map the list is nominated from. Only the ids and the tags matter here;
// the seats and titles the detector reads are beside the point.
const world = snapshot(REALMS);

// --- the watchlist ---------------------------------------------------------

const tmp = path.join(os.tmpdir(), `hd-watchlist-${process.pid}.json`);
fs.rmSync(tmp, { force: true });
const list = new Watchlist(tmp);

const adopted = list.adopt(
  [
    { id: 2, why: 'A French king in Anatolia; if he dies the holding likely fragments.' },
    { id: 5, why: 'The Seljuk advance rests on him.' },
    { id: 404, why: 'Nobody.' },
  ],
  world,
  5,
);
check(
  'V1. nominations are validated against the snapshot that produced them',
  adopted.kept.length === 2 && adopted.rejected.length === 1 && /404/.test(adopted.rejected[0]),
  adopted.rejected[0],
);

check(
  'V2. an entry is described from the game, not from what the model said about it',
  adopted.kept[0].ruler === 'Philippe' && adopted.kept[0].primaryTitle === 'Kingdom of France'
    && adopted.kept[0].tag === world.realmsById.get(2).tag,
  'the tag comes with it, because a tag is the only handle an action has on a runtime ruler',
);

// A later snapshot: France converts, Rum falls out of the window entirely.
const later = snapshot(
  [
    REALMS[0],
    { ...REALMS[1], faith: 'Orthodox' },
    REALMS[2],
    REALMS[3],
  ],
  { date: '1074.3.1', totalDays: 392_000 },
);
const refreshed = list.refresh(later);
check(
  'V3. a change the snapshot can see is a divergence',
  refreshed.divergences.length === 1 && refreshed.divergences[0].kind === 'changed_faith',
  refreshed.divergences[0]?.what,
);

check(
  'V4. a watched ruler who has left the window is unobserved, not dead',
  refreshed.unobserved.length === 1 && refreshed.unobserved[0].id === 5
    && !refreshed.divergences.some((d) => d.id === 5),
  'out of the sphere and out of the world are different facts, and only one of them is a finding',
);

check(
  'V5. and the same change is not reported twice',
  list.refresh(later).divergences.length === 0,
  'the entry is re-described after the comparison, so the next check measures against now',
);

// The cheap probe.
const probed = list.applyProbe(
  [
    { tag: world.realmsById.get(2).tag, alive: false, id: 2, primaryTitle: '', culture: '', faith: '' },
  ],
  '1076.5.1',
);
check(
  'V6. the probe reports a death as one divergence, not as a death plus a lost title',
  probed.divergences.length === 1 && probed.divergences[0].kind === 'died',
  probed.divergences[0]?.what,
);

check(
  'V7. and carries the reason the Director asked to be told',
  /fragments/.test(probed.divergences[0].why ?? ''),
  'the note reaches the divergence audit, so it opens with what was expected',
);

const list2 = new Watchlist(path.join(os.tmpdir(), `hd-watchlist2-${process.pid}.json`));
list2.adopt([{ id: 4, why: 'A local duke.' }], world, 5);
const quiet = list2.applyProbe(
  [{ tag: world.realmsById.get(4).tag, alive: true, id: 4, primaryTitle: '', culture: '', faith: '' }],
  '1076.5.1',
);
check(
  'V8. a field the report could not fill is not a change',
  quiet.divergences.length === 0,
  'an empty title is "not asked", and reading it as "lost their title" would invent a divergence out of a truncated log',
);

const missing = list2.applyProbe([], '1077.1.1');
check(
  'V9. and a tag the game did not report on is unobserved',
  missing.divergences.length === 0 && missing.unobserved.length === 1,
  'the list has lost its handle on them; the next snapshot re-points it',
);

check(
  'V10. a save from before the list was written is a different campaign',
  list2.reconcile(100_000) === true && list2.size === 0,
  'character ids do not carry across campaigns, and a stranger\'s death would read as a finding',
);

const watch = watchScript([{ tag: 3 }, { tag: 7 }], 55).join('\n');
check(
  'V11. the probe asks by tag, brackets its answer, and asks whether they are alive first',
  watch.includes('HD:/;/watch_begin/;/55')
    && watch.includes('HD:/;/watch_end/;/55')
    && watch.includes('limit = { var:hd_tag = 3 }')
    && watch.includes('limit = { is_alive = yes }')
    && watch.includes('HD:/;/watch/;/7/;/dead'),
  'a dead character\'s GetPrimaryTitle returns the literal text ERROR:[...], which would arrive looking like a title',
);

check(
  'V12. and it costs a handful of lines, not a sweep',
  watch.split('\n').filter((l) => l.includes('debug_log')).length <= 8 && !watch.includes('every_county_in_region'),
  `${watch.split('\n').filter((l) => l.includes('debug_log')).length} log lines for two watched rulers`,
);

check(
  'V13. divergences read as one sentence for the log',
  describeDivergences(probed.divergences).includes('Philippe'),
  describeDivergences(probed.divergences),
);

fs.rmSync(tmp, { force: true });
fs.rmSync(path.join(os.tmpdir(), `hd-watchlist2-${process.pid}.json`), { force: true });

console.log(`
${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
