/**
 * Verification for the ahistorical holding detector.
 *
 * The case that matters most is B9, and it is worth saying why before the ones
 * that look more like the feature. A realm that did not report a seat is not a
 * foreigner - it may simply be ruled from outside the swept sphere, or the
 * probe may not have run at all. Read the wrong way round, that silence
 * manufactures exactly the finding the feature exists to detect, which is the
 * worst failure available to it because it is indistinguishable from working.
 *
 * The rest of the cases are the ordinary ones: a distant seat is flagged, a
 * neighbour over the line is not, and the player is never flagged on their own
 * ground.
 *
 *   node scripts/check-border-gore.mjs
 */
import { SnapshotAssembler } from '../src/model/WorldState.js';
import { parseLine } from '../src/bridge/protocol.js';
import { outsiders, borderGoreBriefing } from '../src/director/borderGore.js';
import { snapshotScript } from '../src/bridge/ck3Script.js';

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

// --- 2. the seat and title probes reach the parser --------------------------

const probe = snapshotScript([ANATOLIA, FRANCIA], 9, [ANATOLIA], [ANATOLIA], []).join('\n');
check(
  'B1. the sweep asks every realm where it is ruled from',
  probe.includes(`limit = { capital_county.title_province ?= { geographical_region = ${ANATOLIA} } }`)
    && probe.includes('HD:/;/realm_capital/;/[THIS.Char.GetID]'),
  'the same test the player\'s own locate probe uses, run over the sweep',
);

check(
  'B2. and which duchies and kingdoms it holds there',
  probe.includes('every_held_title = {')
    && probe.includes('limit = { tier = tier_duchy }')
    && probe.includes('limit = { tier = tier_kingdom }')
    && probe.includes('[THIS.Title.GetHolder.GetID]'),
  'the holder is read off the title, because scope: does not resolve in a batch file',
);

const world = snapshot(REALMS);
check(
  'B3. the seat and the title arrive attached to the right realm',
  world.realmsById.get(2).capitalRegions?.[0] === FRANCIA
    && world.realmsById.get(2).majorTitles?.[0]?.name === 'Duchy of Anatolia'
    && world.seatsObserved === true,
  `France is seated in ${FRANCIA} and holds the Duchy of Anatolia`,
);

// --- 3. the detector -------------------------------------------------------

const found = outsiders({ state: world, home: [ANATOLIA] });
const flaggedIds = found.flagged.map((f) => f.id);

check(
  'B4. a king seated across the continent holding a duchy here is flagged',
  flaggedIds.includes(2),
  found.flagged.find((f) => f.id === 2)?.seatNote,
);

check(
  'B5. and a ruler seated outside the observed sphere entirely',
  flaggedIds.includes(5),
  found.flagged.find((f) => f.id === 5)?.seatNote,
);

check(
  'B6. a neighbour holding land over the line is a frontier, not a divergence',
  !flaggedIds.includes(3) && found.frontier.some((f) => f.id === 3),
  'Serbia is seated next door; borders have always worked this way',
);

check(
  'B7. a local duke is not flagged for being local',
  !flaggedIds.includes(4) && !found.frontier.some((f) => f.id === 4),
  'seated on the same ground they hold',
);

check(
  'B8. and the player is never flagged on their own ground',
  !flaggedIds.includes(1),
  'the Director puts history in front of the player; it does not tidy up after them',
);

// The one that matters most: absence of the probe must not read as a verdict.
const blind = snapshot(REALMS, { seats: false });
const blindFound = outsiders({ state: blind, home: [ANATOLIA] });
check(
  'B9. with no seat records at all, nobody is a foreigner and the section says why',
  blindFound.observed === false && blindFound.flagged.length === 0
    && /Not measured this audit/.test(borderGoreBriefing({ state: blind, home: [ANATOLIA] })),
  blindFound.reason.slice(0, 96),
);

const briefing = borderGoreBriefing({ state: world, home: [ANATOLIA] });
check(
  'B10. the briefing names the title rather than only the county count',
  briefing.includes('Duchy of Anatolia (duchy)') && briefing.includes('id 2'),
  briefing.split('\n')[1]?.slice(0, 120),
);

check(
  'B11. and says out loud which holders were considered and set aside',
  /set aside/.test(briefing) && briefing.includes('Kingdom of Serbia'),
  'a list that silently drops the frontier cases invites the model to re-derive them',
);

console.log(`
${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
