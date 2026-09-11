/**
 * Answerable dispatches, exercised against synthetic snapshots.
 *
 * The cases that matter are the escalation ones. If a player can reach a
 * coalition without having been told three times what silence would cost, the
 * consent argument this design rests on is not true and the feature should not
 * ship.
 *
 *   node scripts/check-dispatches.mjs
 */
import { stanceToward } from '../src/director/stances.js';
import {
  REPLIES, REPLY_KEYS, dispatchFor, replyScript, pressureAfter, pressureNote, PRESSURE_BREAK,
} from '../src/director/dispatches.js';

let passed = 0;
let failed = 0;

/** @param {string} name @param {boolean} ok @param {string} [detail] */
function check(name, ok, detail = '') {
  if (ok) { passed += 1; console.log(`PASS  ${name}`); } else { failed += 1; console.log(`FAIL  ${name}`); }
  if (detail) console.log(`      ${detail}`);
}

function realm(over = {}) {
  return {
    id: 1,
    tag: 0,
    ruler: 'Someone',
    primaryTitle: 'Kingdom of Somewhere',
    tierKey: 'kingdom',
    countiesInSphere: 10,
    culture: 'Castilian',
    faith: 'Catholic',
    dynasty: 'Jimena',
    house: 'House of Jimena',
    independent: true,
    regions: ['world_europe_west_iberia'],
    inNeighbourhood: true,
    ...over,
  };
}

function baselineWith(losses = {}) {
  return {
    delta(r) {
      const lost = losses[r?.primaryTitle];
      if (lost === undefined) return { known: false, lost: null, label: 'no baseline' };
      return { known: true, lost: lost || null, label: lost ? `= Kingdom, ${lost}` : '= Kingdom' };
    },
  };
}

function snapshot(player, others) {
  const all = [player, ...others];
  return {
    player,
    playerId: player.id,
    realmsById: new Map(all.map((r) => [r.id, r])),
    wars: [],
    warBetween: () => null,
  };
}

// The Granada peninsula from check-stances, reused so the two modules are
// tested against the same world.
function iberia() {
  const granada = realm({
    id: 1, tag: 0, ruler: 'Muhammad I', primaryTitle: 'Taifa of Ghirnatah',
    faith: 'Ashari', culture: 'Andalusian', house: 'House of Nasr', dynasty: 'Nasrid',
    countiesInSphere: 22,
  });
  const castile = realm({
    id: 2, tag: 1, ruler: 'Fernando III', primaryTitle: 'Kingdom of Castile',
    faith: 'Catholic', countiesInSphere: 14,
  });
  const leon = realm({ id: 3, tag: 2, ruler: 'Alfonso IX', primaryTitle: 'Kingdom of Leon', faith: 'Catholic', countiesInSphere: 9 });
  const portugal = realm({ id: 4, tag: 3, ruler: 'Sancho II', primaryTitle: 'Kingdom of Portugal', faith: 'Catholic', countiesInSphere: 8 });
  const baseline = baselineWith({
    'Kingdom of Castile': 'down 6 of 20 counties',
    'Kingdom of Leon': 'down 5 of 14 counties',
    'Kingdom of Portugal': 'down 3 of 11 counties',
  });
  const state = snapshot(granada, [castile, leon, portugal]);
  const stance = stanceToward({ state, observer: castile, player: granada, baseline });
  return { state, granada, castile, baseline, stance };
}

// --------------------------------------------------------------------------
console.log('\nA dispatch is built from a stance, and not every stance sends one\n');

{
  const { state, granada, castile, stance } = iberia();
  const d = dispatchFor({ state, player: granada, from: castile, stance, pressure: 0 });
  check('D1. an alarmed Castile produces a dispatch',
    d !== null && d.from === 'Kingdom of Castile' && d.stance === 'alarmed',
    `${d?.from}: ${d?.posture}`);
  check('D2. it carries the map evidence, so the player can check the claim',
    (d?.evidence ?? []).some((e) => /realms of their faith have lost ground/.test(e)),
    d?.evidence.find((e) => /realms of their faith/.test(e)) ?? 'MISSING');
}
{
  const { state, granada, castile } = iberia();
  const watchful = { key: 'watchful', label: 'watchful', posture: 'no strong view', evidence: [], opinion: 0 };
  check('D3. a watchful realm sends nothing, because a living world is not spam',
    dispatchFor({ state, player: granada, from: castile, stance: watchful, pressure: 0 }) === null);
}

// --------------------------------------------------------------------------
console.log('\nWhich replies the map allows\n');

{
  const { state, granada, castile, stance } = iberia();
  const d = dispatchFor({ state, player: granada, from: castile, stance, pressure: 0 });
  const keys = d.replies.map((r) => r.key);
  check('R1. an Ashari taifa may not appeal to Catholic Castile\'s shared faith',
    !keys.includes('appeal_to_faith') && /Ashari/.test(d.withheld.appeal_to_faith ?? ''),
    d.withheld.appeal_to_faith);
  check('R2. nor to a kinship with a Jimena it does not share',
    !keys.includes('appeal_to_kin'), d.withheld.appeal_to_kin);
  check('R3. but silence, gold, tribute and defiance are always open',
    ['ignore', 'conciliate', 'tribute', 'defy'].every((k) => keys.includes(k)),
    keys.join(', '));
}
{
  // Two Catholic realms of the same house: both appeals open.
  const player = realm({ id: 1, tag: 0, faith: 'Catholic', house: 'House of Jimena', countiesInSphere: 30 });
  const other = realm({ id: 2, tag: 1, faith: 'Catholic', house: 'House of Jimena', primaryTitle: 'Kingdom of Navarra', countiesInSphere: 8 });
  const state = snapshot(player, [other]);
  const stance = stanceToward({ state, observer: other, player });
  const d = dispatchFor({ state, player, from: other, stance, pressure: 0 });
  const keys = d.replies.map((r) => r.key);
  check('R4. a co-religionist kinsman opens both appeals',
    keys.includes('appeal_to_faith') && keys.includes('appeal_to_kin'), keys.join(', '));
}
{
  // A missing faith must not open an appeal to a faith nobody observed.
  const player = realm({ id: 1, tag: 0, faith: '' });
  const other = realm({ id: 2, tag: 1, faith: 'Catholic', countiesInSphere: 4 });
  const state = snapshot(player, [other]);
  const stance = stanceToward({ state, observer: other, player });
  const d = dispatchFor({ state, player, from: other, stance, pressure: 0 });
  check('R5. an unknown faith withholds the faith appeal rather than offering it',
    !d.replies.map((r) => r.key).includes('appeal_to_faith'), d.withheld.appeal_to_faith);
}

// --------------------------------------------------------------------------
console.log('\nEscalation - the consent argument, which either holds or it does not\n');

{
  let p = 0;
  const seq = [];
  for (let i = 0; i < 3; i += 1) { p = pressureAfter(p, 'ignore'); seq.push(p); }
  check('E1. three silences reach the break point and no sooner',
    seq[0] === 1 && seq[1] === 2 && seq[2] === PRESSURE_BREAK,
    `pressure after each silence: ${seq.join(', ')}`);
}
{
  const p = pressureAfter(pressureAfter(0, 'defy'), 'ignore');
  check('E2. defiance costs more than silence', p === 3, `defy then ignore: ${p}`);
}
{
  let p = pressureAfter(pressureAfter(0, 'ignore'), 'ignore');
  p = pressureAfter(p, 'conciliate');
  check('E3. answering cools it', p === 1, `ignore, ignore, conciliate: ${p}`);
}
{
  const p = pressureAfter(pressureAfter(0, 'ignore'), 'tribute');
  check('E4. tribute cools it further', p === 0, `ignore then tribute: ${p}`);
}
{
  check('E5. pressure never runs past the break point, however long it is ignored',
    pressureAfter(PRESSURE_BREAK, 'defy') === PRESSURE_BREAK,
    'pressure is a countdown to a consequence, not a score');
  check('E6. and never below zero', pressureAfter(0, 'tribute') === 0);
}
{
  // The sentence the whole consent argument rests on. A player who reaches a
  // coalition must be able to point at the warning that said so.
  const { state, granada, castile, stance } = iberia();
  const d = dispatchFor({ state, player: granada, from: castile, stance, pressure: PRESSURE_BREAK - 1 });
  const note = pressureNote(d);
  check('E7. the last warning says outright that it is the last',
    d.breaking && /last word/.test(note) && /stop writing and start acting/.test(note), note);
}
{
  const { state, granada, castile, stance } = iberia();
  const d = dispatchFor({ state, player: granada, from: castile, stance, pressure: 1 });
  check('E8. an earlier one says where it stands instead of crying wolf',
    !d.breaking && /Pressure 1 of 3/.test(pressureNote(d)), pressureNote(d));
}

// --------------------------------------------------------------------------
console.log('\nWhat reaches the game\n');

{
  const { state, granada, castile, stance } = iberia();
  const ctx = { state, player: granada, from: castile, stance, pressure: 0 };
  const script = replyScript('ignore', ctx, 42).join('\n');
  check('S1. silence stages NOTHING - it is not a message',
    script === '',
    'an empty batch would be the orchestrator inventing an event the world never saw');
}
{
  const { state, granada, castile, stance } = iberia();
  const ctx = { state, player: granada, from: castile, stance, pressure: 0 };
  const script = replyScript('conciliate', ctx, 42).join('\n');
  check('S2. reassurance costs the player gold and moves THEIR opinion of you',
    /add_gold = -150/.test(script)
      && /scope:hd_sender = \{/.test(script)
      && /target = scope:hd_player/.test(script),
    'the dispatch came from them, so it is their opinion that moves');
  check('S3. and it reports both outcomes, like every other staged action',
    /applied\/;\/42\/;\/dispatch_reply/.test(script) && /refused\/;\/42\/;\/dispatch_reply/.test(script));
}
{
  const { state, granada, castile, stance } = iberia();
  const ctx = { state, player: granada, from: castile, stance, pressure: 0 };
  check('S4. a reply the map does not allow composes no script, even if asked directly',
    replyScript('appeal_to_faith', ctx, 42).length === 0,
    're-checked at execution, not only when the buttons were drawn');
  check('S5. a key that is not in the table yields nothing rather than a bad line',
    replyScript('burn_their_capital', ctx, 42).length === 0
      && replyScript('', ctx, 42).length === 0);
}
{
  // A realm the snapshot cannot tag cannot be addressed, and the honest
  // response is no script rather than a run file naming a scope that is never
  // resolved.
  const { state, granada, stance } = iberia();
  const untagged = realm({ id: 9, tag: undefined, primaryTitle: 'Kingdom of Nowhere' });
  state.realmsById.set(9, untagged);
  const ctx = { state, player: granada, from: untagged, stance, pressure: 0 };
  check('S6. an untagged sender composes nothing',
    replyScript('conciliate', ctx, 42).length === 0);
}
{
  // Braces are legitimate CK3 syntax and testing for them proves nothing. The
  // two characters that are never legitimate in anything this module composes
  // are $ - CK3's parameter substitution, which mangles quoted debug_log
  // strings - and a backslash. Neither has any business in a file built
  // entirely from constants, so either one appearing means something reached
  // the script that was not looked up.
  const script = REPLY_KEYS
    .flatMap((k) => {
      const { state, granada, castile, stance } = iberia();
      return replyScript(k, { state, player: granada, from: castile, stance, pressure: 0 }, 1);
    })
    .join('\n');
  check('S7. no reply can stage a $ or a backslash',
    script.length > 0 && !script.includes('$') && !script.includes('\\'),
    `${script.split('\n').length} lines composed, all from constants`);
}
{
  // The stronger version of the same claim: a sender whose NAME is hostile
  // cannot get that name into the script, because no reply ever emits a name.
  const { state, granada, stance } = iberia();
  const hostile = realm({
    id: 8, tag: 4,
    ruler: 'Al" = { add_gold = 99999 } #',
    primaryTitle: 'Taifa of ${EXPLOIT}',
  });
  state.realmsById.set(8, hostile);
  const script = replyScript('conciliate', { state, player: granada, from: hostile, stance, pressure: 0 }, 1).join('\n');
  check('S8. a hostile ruler name cannot reach the run file at all',
    script.length > 0 && !script.includes('add_gold = 99999') && !script.includes('EXPLOIT'),
    'replies address realms by tag, never by name - the same rule the toolkit follows');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
