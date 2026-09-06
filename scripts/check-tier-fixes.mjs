/**
 * Verification for the tier-demotion fixes.
 *
 * There is no test runner in this project, so this is a plain script: it builds
 * snapshots by hand, pushes them through the real parser, baseline and toolkit,
 * and prints a pass/fail line per case. Run it after touching anything in
 * src/model, src/bridge or src/director/toolkit.js.
 *
 *   node scripts/check-tier-fixes.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SnapshotAssembler, renderRealmTable } from '../src/model/WorldState.js';
import { parseLine } from '../src/bridge/protocol.js';
import { Baseline } from '../src/model/Baseline.js';
import { validateProposal } from '../src/director/toolkit.js';
import { momentumScript, MOMENTUM_KEYS, setMomentumSupport } from '../src/director/momentum.js';
import { compareVersions, deployedModVersion, momentumSupport } from '../src/setup/modVersion.js';

let passed = 0;
let failed = 0;

/**
 * A baseline stub that reports whatever delta a case needs.
 *
 * Cases that are testing the tier arithmetic rather than the gate use
 * `risenBaseline`, so that the gate passes and the check under test is the one
 * that actually decides the outcome.
 */
const stubBaseline = (delta) => ({ captured: true, delta: () => delta });
const risenBaseline = stubBaseline({ label: 'Kingdom -> Empire', risen: true, known: true });

function check(label, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) console.log(`      ${detail}`);
  ok ? (passed += 1) : (failed += 1);
}

/** Build a snapshot the way the game would report one. */
function snapshot({ token = '1', date = '1066.9.15', totalDays = 389_000, realms }) {
  const a = new SnapshotAssembler();
  const feed = (line) => {
    const rec = parseLine(`[00:00:00][effect.cpp:1]: ${line}`);
    return rec ? a.ingest(rec) : null;
  };
  feed(`HD:/;/snapshot_begin/;/${token}/;/${date}/;/${totalDays}/;/1`);
  for (const r of realms) {
    feed(
      `HD:/;/realm/;/${r.id}/;/${r.ruler}/;/${r.title}/;/${r.rank}/;/${r.counties ?? 5}` +
      `/;/${r.culture ?? 'Frankish'}/;/${r.faith ?? 'Catholic'}/;/Paris/;/Capet/;/House Capet/;/yes/;/Feudal`,
    );
    if (r.tierKey) feed(`HD:/;/realm_tier/;/${r.id}/;/${r.tierKey}`);
  }
  return feed(`HD:/;/snapshot_end/;/${token}`).snapshot;
}

const tmp = path.join(os.tmpdir(), `hd-baseline-${Date.now()}.json`);
const fresh = () => {
  try { fs.unlinkSync(tmp); } catch { /* first run */ }
  return new Baseline(tmp);
};

console.log('\nHistorical Director — tier-demotion fixes\n');

// --- 1. failure A: a duke told to become a duke -----------------------------
{
  const snap = snapshot({
    realms: [{ id: 2, ruler: 'William', title: 'Duchy of Normandy', rank: 'Duchy', tierKey: 'duchy' }],
  });
  const r = validateProposal({ action: 'adjust_title_tier', args: { actor: 2, target_tier: 'duchy' } }, snap, risenBaseline);
  check(
    '1. duke -> duchy is rejected as a same-tier collision',
    !r.ok && /already duchy tier/.test(r.error),
    r.ok ? 'ACCEPTED, which is the original failure A' : r.error,
  );
}

// --- 2. failure B: the HRE at its starting rank -----------------------------
{
  const opening = snapshot({
    realms: [
      { id: 1, ruler: 'Henry IV', title: 'Holy Roman Empire', rank: 'Empire', tierKey: 'empire', counties: 40 },
      { id: 10, ruler: 'Philip I', title: 'Kingdom of France', rank: 'Kingdom', tierKey: 'kingdom', counties: 12 },
    ],
  });
  const b = fresh();
  b.offer(opening);

  const hre = opening.realms.find((r) => r.id === 1);
  const fr = opening.realms.find((r) => r.id === 10);
  check(
    '2. HRE unchanged since capture reads "= Empire", not a rise',
    b.delta(hre).label === '= Empire' && b.delta(hre).risen === false,
    `HRE: ${b.delta(hre).label}   France: ${b.delta(fr).label}`,
  );

  // The table is what the model actually reads, so assert the column reaches it.
  const table = renderRealmTable(opening, 40, b);
  check(
    '2b. the baseline column reaches the prompt table',
    table.includes('= Empire') && table.includes('= Kingdom'),
    table.split('\n')[0],
  );
}

// --- 3. a genuine rise, demoted one step ------------------------------------
{
  const opening = snapshot({
    totalDays: 389_000,
    realms: [{ id: 3, ruler: 'Roger', title: 'Kingdom of Sicily', rank: 'Kingdom', tierKey: 'kingdom' }],
  });
  const b = fresh();
  b.offer(opening);

  const later = snapshot({
    token: '2',
    date: '1090.1.1',
    totalDays: 398_000,
    realms: [{ id: 3, ruler: 'Roger', title: 'Kingdom of Sicily', rank: 'Empire', tierKey: 'empire' }],
  });
  const risen = later.realms[0];
  const d = b.delta(risen);

  const r = validateProposal({ action: 'adjust_title_tier', args: { actor: 3, target_tier: 'kingdom' } }, later, b);
  check(
    '3. a realm risen to empire accepts a one-step demotion',
    d.risen && d.label === 'Kingdom -> Empire' && r.ok,
    r.ok ? `delta ${d.label}` : r.error,
  );
  check(
    '3b. its preview names both tiers and warns about vassals',
    r.ok && /empire tier down to kingdom tier/.test(r.preview) && /become independent/.test(r.preview),
    r.ok ? r.preview : '(rejected, so no preview)',
  );
}

// --- 4. no tierKey means fail closed ----------------------------------------
{
  const snap = snapshot({
    realms: [{ id: 4, ruler: 'Nobody', title: 'Realm Of Unknown Rank', rank: 'Herzogtum' }],
  });
  const r = validateProposal({ action: 'adjust_title_tier', args: { actor: 4, target_tier: 'county' } }, snap, risenBaseline);
  check(
    '4. absent tierKey is rejected, not permitted via the localised name',
    !r.ok && /no script-derived tier/.test(r.error),
    r.ok ? 'ACCEPTED on a localised string, which is the bug' : r.error,
  );
}

// --- 5. legacy snapshots still parse ----------------------------------------
{
  const snap = snapshot({
    realms: [
      { id: 5, ruler: 'Alfonso VI', title: 'Kingdom of Leon', rank: 'Kingdom' },
      { id: 6, ruler: 'Henry IV', title: 'Holy Roman Empire', rank: 'Empire' },
    ],
  });
  const parsedFine =
    snap.realms.length === 2 &&
    snap.realms[0].primaryTitle === 'Kingdom of Leon' &&
    snap.realms[0].government === 'Feudal' &&
    snap.realms[0].culture === 'Frankish';
  const allRejected = snap.realms.every(
    (r) => !validateProposal({ action: 'adjust_title_tier', args: { actor: r.id, target_tier: 'duchy' } }, snap, risenBaseline).ok,
  );
  check('5. legacy realm lines parse unchanged', parsedFine, `fields: ${snap.realms[0].primaryTitle} / ${snap.realms[0].culture} / ${snap.realms[0].government}`);
  check('5b. and every demotion against them is rejected', allRejected);
}

// --- 6. an earlier save re-captures the baseline ----------------------------
{
  const b = fresh();
  b.offer(snapshot({ totalDays: 389_000, realms: [{ id: 1, ruler: 'A', title: 'T', rank: 'Empire', tierKey: 'empire' }] }));
  const before = b.capturedYear;
  const verdict = b.offer(
    snapshot({ token: '9', date: '867.1.1', totalDays: 316_000, realms: [{ id: 1, ruler: 'B', title: 'T', rank: 'Duchy', tierKey: 'duchy' }] }),
  );
  check(
    '6. a snapshot earlier than the baseline re-captures it',
    verdict === 'recaptured' && b.lookup('T').tierKey === 'duchy',
    `${before} -> ${b.capturedYear}, verdict "${verdict}"`,
  );
}

// --- 7. multi-rank demotion is refused --------------------------------------
{
  const snap = snapshot({
    realms: [{ id: 7, ruler: 'Henry IV', title: 'HRE', rank: 'Empire', tierKey: 'empire' }],
  });
  const r = validateProposal({ action: 'adjust_title_tier', args: { actor: 7, target_tier: 'duchy' } }, snap, risenBaseline);
  check(
    '7. empire -> duchy is refused as more than one rank',
    !r.ok && /more than one rank/.test(r.error),
    r.error,
  );
}

// --- 8. the script asserts the observed tier --------------------------------
{
  const snap = snapshot({
    realms: [{ id: 8, ruler: 'Roger', title: 'Kingdom of Sicily', rank: 'Kingdom', tierKey: 'kingdom' }],
  });
  const r = validateProposal({ action: 'adjust_title_tier', args: { actor: 8, target_tier: 'duchy' } }, snap, risenBaseline);
  const script = r.ok ? r.action.toScript({ actor: 8, target_tier: 'duchy' }, 99, snap).join('\n') : '';
  check(
    '8. the guard asserts the tier observed at proposal time',
    r.ok && script.includes('scope:hd_actor.primary_title.tier = tier_kingdom'),
    r.ok ? 'asserts tier_kingdom' : r.error,
  );
  check(
    '8b. and still carries both applied and refused branches',
    script.includes('HD:/;/applied/') && script.includes('HD:/;/refused/'),
  );
}

// --- 9. grant_claim names the tier it is claiming ---------------------------
{
  const snap = snapshot({
    realms: [
      { id: 20, ruler: 'Robert', title: 'Duchy of Apulia', rank: 'Duchy', tierKey: 'duchy' },
      { id: 21, ruler: 'Henry IV', title: 'Holy Roman Empire', rank: 'Empire', tierKey: 'empire' },
    ],
  });
  const r = validateProposal({ action: 'grant_claim', args: { actor: 20, target: 21 } }, snap, risenBaseline);
  check(
    '9. grant_claim preview names the claimed title tier',
    r.ok && /empire-tier title Holy Roman Empire/.test(r.preview),
    r.ok ? r.preview : r.error,
  );
}

// --- 10. failure B, enforced rather than merely displayed -------------------
// Cases 1-9 exercise the tier arithmetic. This is the one that matters most:
// the HRE at its starting rank is a coherent one-rank demotion by every other
// measure, and only the baseline gate refuses it.
{
  const opening = snapshot({
    realms: [{ id: 1, ruler: 'Henry IV', title: 'Holy Roman Empire', rank: 'Empire', tierKey: 'empire', counties: 40 }],
  });
  const b = fresh();
  b.offer(opening);

  const r = validateProposal({ action: 'adjust_title_tier', args: { actor: 1, target_tier: 'kingdom' } }, opening, b);
  check(
    '10. HRE at its starting rank is REJECTED, not just labelled',
    !r.ok && /since the campaign began/.test(r.error) && /= Empire/.test(r.error),
    r.ok ? 'ACCEPTED, which is failure B: the gate is advisory only' : r.error,
  );
}

// --- 11. a realm the baseline never saw -------------------------------------
{
  const opening = snapshot({
    realms: [{ id: 1, ruler: 'Henry IV', title: 'Holy Roman Empire', rank: 'Empire', tierKey: 'empire' }],
  });
  const b = fresh();
  b.offer(opening);

  // A realm that appeared after capture: conquest, or simply outside the sphere
  // at the time. Either way there is no reference for its rank.
  const later = snapshot({
    token: '4',
    date: '1100.1.1',
    totalDays: 402_000,
    realms: [{ id: 30, ruler: 'Bohemond', title: 'Principality of Antioch', rank: 'Kingdom', tierKey: 'kingdom' }],
  });
  const r = validateProposal({ action: 'adjust_title_tier', args: { actor: 30, target_tier: 'duchy' } }, later, b);
  check(
    '11. a realm absent from the baseline is rejected',
    !r.ok && /no reference for its rank/.test(r.error),
    r.ok ? 'ACCEPTED without any reference, which is the gap' : r.error,
  );
}

// --- 12. no baseline argument at all ----------------------------------------
{
  const snap = snapshot({
    realms: [{ id: 1, ruler: 'Henry IV', title: 'Holy Roman Empire', rank: 'Empire', tierKey: 'empire' }],
  });
  const r = validateProposal({ action: 'adjust_title_tier', args: { actor: 1, target_tier: 'kingdom' } }, snap);
  check(
    '12. an absent baseline fails closed',
    !r.ok && /no baseline for this campaign/.test(r.error),
    r.ok ? 'ACCEPTED with no baseline at all' : r.error,
  );

  const uncaptured = validateProposal(
    { action: 'adjust_title_tier', args: { actor: 1, target_tier: 'kingdom' } },
    snap,
    { captured: false, delta: () => ({ label: 'no baseline', risen: false, known: false }) },
  );
  check(
    '12b. and so does a baseline that has not captured yet',
    !uncaptured.ok && /no baseline for this campaign/.test(uncaptured.error),
    uncaptured.ok ? 'ACCEPTED against an uncaptured baseline' : uncaptured.error,
  );
}

// --- 13. the gate does not block real drift ---------------------------------
// Restating case 3 as a gate test: the point of the gate is to refuse the map
// as it started, not to refuse everything.
{
  const opening = snapshot({
    realms: [{ id: 3, ruler: 'Roger', title: 'Kingdom of Sicily', rank: 'Kingdom', tierKey: 'kingdom' }],
  });
  const b = fresh();
  b.offer(opening);

  const later = snapshot({
    token: '5',
    date: '1090.1.1',
    totalDays: 398_000,
    realms: [{ id: 3, ruler: 'Roger', title: 'Kingdom of Sicily', rank: 'Empire', tierKey: 'empire' }],
  });
  const r = validateProposal({ action: 'adjust_title_tier', args: { actor: 3, target_tier: 'kingdom' } }, later, b);
  check(
    '13. a genuinely risen realm still passes the gate',
    r.ok,
    r.ok ? r.preview : `REJECTED, so the gate is blocking real drift: ${r.error}`,
  );
}

// --- 14-21. the mid-campaign baseline ---------------------------------------
// A campaign joined from an existing save captures its baseline mid-campaign,
// so "unchanged since the baseline" carries no evidence about the world at all.
// These cases are the whole of bookmarkTiers.js: the one door it opens, and the
// several it deliberately leaves shut.

/** A baseline captured at `year`, holding this realm at the rank it now has. */
function baselineAt(year, realm) {
  const b = fresh();
  b.offer(snapshot({ date: year + '.1.1', totalDays: year * 365, realms: [realm] }));
  return b;
}

const FRANCE = { id: 1, ruler: 'Philippe', title: 'Kingdom of France', rank: 'Kingdom', tierKey: 'kingdom' };

{
  check(
    '14. a 1066 baseline is not mid-campaign; a 1218 one is',
    !baselineAt(1066, FRANCE).midCampaign && baselineAt(1218, FRANCE).midCampaign && !fresh().midCampaign,
    'and an uncaptured baseline is neither',
  );
}

{
  // The case from PROGRESS.md section 3, end to end.
  const realm = { id: 9, ruler: 'Zahir III', title: 'the banu zahir Empire', rank: 'Empire', tierKey: 'empire', counties: 65 };
  const b = baselineAt(1218, realm);
  const now = snapshot({ token: '9', date: '1222.1.1', totalDays: 446000, realms: [realm] });
  const r = validateProposal({ action: 'adjust_title_tier', args: { actor: 9, target_tier: 'kingdom' } }, now, b);
  check(
    '15. an empire the record does not carry, on a mid-campaign baseline, is permitted',
    r.ok,
    r.ok ? r.preview : 'REJECTED, so the 1217 save is still silent: ' + r.error,
  );
}

{
  // The same shape at kingdom tier. The empire roster is short enough for its
  // silence to mean something; no other rank is, so this must stay refused.
  const realm = { id: 10, ruler: 'Sancho', title: 'Kingdom of Navarra', rank: 'Kingdom', tierKey: 'kingdom' };
  const b = baselineAt(1218, realm);
  const now = snapshot({ token: '10', date: '1222.1.1', totalDays: 446000, realms: [realm] });
  const r = validateProposal({ action: 'adjust_title_tier', args: { actor: 10, target_tier: 'duchy' } }, now, b);
  check(
    '16. an unremarkable kingdom on the same baseline is still refused',
    !r.ok && /no reference, so no claim/i.test(r.error),
    r.ok ? 'ACCEPTED, so absence from the tables is being read as licence' : r.error,
  );
}

{
  // Curated and matching: the record agrees with the campaign, so there is
  // nothing to bring down however weak the sources say the ruler was.
  const b = baselineAt(1218, FRANCE);
  const now = snapshot({ token: '11', date: '1222.1.1', totalDays: 446000, realms: [FRANCE] });
  const r = validateProposal({ action: 'adjust_title_tier', args: { actor: 1, target_tier: 'duchy' } }, now, b);
  check(
    '17. a realm the record puts at the rank it holds is refused by name',
    !r.ok && /nothing to bring down/.test(r.error),
    r.ok ? 'ACCEPTED, so France is demotable again' : r.error,
  );
}

{
  // Curated and exceeded: the Zirids at empire tier, which the record puts at
  // kingdom. This is the correction a live 1066 campaign approved.
  const realm = { id: 12, ruler: 'Tamim', title: 'the Zirid Grand Emirate', rank: 'Empire', tierKey: 'empire' };
  const b = baselineAt(1218, realm);
  const now = snapshot({ token: '12', date: '1222.1.1', totalDays: 446000, realms: [realm] });
  const r = validateProposal({ action: 'adjust_title_tier', args: { actor: 12, target_tier: 'kingdom' } }, now, b);
  check('18. a realm above its curated rank is permitted', r.ok, r.ok ? r.preview : r.error);
}

{
  // The HRE on a mid-campaign baseline. Curated as an empire at 1178, so the
  // relaxed path must not become a way to demote it after all.
  const realm = { id: 13, ruler: 'Friedrich', title: 'Holy Roman Empire', rank: 'Empire', tierKey: 'empire' };
  const b = baselineAt(1218, realm);
  const now = snapshot({ token: '13', date: '1222.1.1', totalDays: 446000, realms: [realm] });
  const r = validateProposal({ action: 'adjust_title_tier', args: { actor: 13, target_tier: 'kingdom' } }, now, b);
  check(
    '19. the Holy Roman Empire survives the mid-campaign path too',
    !r.ok && /nothing to bring down/.test(r.error),
    r.ok ? 'ACCEPTED, which reopens failure B by another door' : r.error,
  );
}

{
  // The column the model reads has to say which of the two claims it is making.
  // delta() keys on primaryTitle, so it has to be asked about a realm that has
  // been through the parser rather than about the scenario literal.
  const spec = { id: 14, ruler: 'Zahir', title: 'the banu zahir Empire', rank: 'Empire', tierKey: 'empire' };
  const parsed = snapshot({ token: '14', date: '1222.1.1', totalDays: 446000, realms: [spec] }).realms[0];
  const mid = baselineAt(1218, spec);
  const early = baselineAt(1066, spec);
  check(
    '20. the "since start" column distinguishes the two baselines',
    mid.delta(parsed).label === '= Empire since load' && early.delta(parsed).label === '= Empire',
    'mid-campaign "' + mid.delta(parsed).label + '", from a bookmark "' + early.delta(parsed).label + '"',
  );
}

{
  // Demoting your own realm is a legitimate thing to want and a terrible thing
  // to do by accident.
  const realm = { id: 15, ruler: 'Zahir', title: 'the banu zahir Empire', rank: 'Empire', tierKey: 'empire' };
  const b = baselineAt(1218, realm);
  const now = snapshot({ token: '15', date: '1222.1.1', totalDays: 446000, realms: [realm] });
  now.playerId = 15;
  const r = validateProposal({ action: 'adjust_title_tier', args: { actor: 15, target_tier: 'kingdom' } }, now, b);
  check(
    '21. a proposal against the realm you play says so in the preview',
    r.ok && /your own realm/.test(r.preview),
    r.ok ? r.preview : r.error,
  );
}

// --- 22-29. momentum on grant_claim -----------------------------------------
// A pressed claim is a reason to go to war. Momentum is the capacity to act on
// it, and it is the largest thing the toolkit can do without destroying
// anything, so most of these cases are about what it refuses.

/** Two rulers, whose faiths a case can set. */
function pair({ actorFaith = 'Sunni', targetFaith = 'Catholic' } = {}) {
  return snapshot({
    token: '30',
    date: '1218.4.2',
    totalDays: 444907,
    realms: [
      { id: 1, ruler: 'Zahir III', title: 'the banu zahir Empire', rank: 'Empire', tierKey: 'empire', faith: actorFaith },
      { id: 2, ruler: 'Alfonso IX', title: 'Kingdom of Leon', rank: 'Kingdom', tierKey: 'kingdom', faith: targetFaith },
    ],
  });
}

const claim = (args, snap) => validateProposal({ action: 'grant_claim', args }, snap, null);

{
  // The backward-compatibility case. An omitted momentum and an explicit "none"
  // must both produce exactly what the action produced before momentum existed.
  const snap = pair();
  const omitted = claim({ actor: 1, target: 2 }, snap);
  const explicit = claim({ actor: 1, target: 2, momentum: 'none' }, snap);
  const scriptOf = (r) => r.action.toScript({ actor: 1, target: 2 }, 99, snap).join('\n');
  check(
    '22. momentum defaults to none, and none changes nothing',
    omitted.ok && explicit.ok
      && omitted.preview === explicit.preview
      && !/Momentum:/.test(omitted.preview)
      && !/add_gold|add_character_modifier/.test(scriptOf(omitted)),
    omitted.ok ? omitted.preview : omitted.error,
  );
}

{
  const snap = pair();
  const results = MOMENTUM_KEYS.map((m) => [m, claim({ actor: 1, target: 2, momentum: m }, snap)]);
  const bad = results.filter(([, r]) => !r.ok);
  check(
    '23. every declared momentum validates against differing faiths',
    bad.length === 0,
    bad.length ? bad.map(([m, r]) => m + ': ' + r.error).join('; ') : MOMENTUM_KEYS.join(', '),
  );
}

{
  const r = claim({ actor: 1, target: 2, momentum: 'total_war' }, pair());
  check(
    '24. an unknown momentum is refused by name, not silently downgraded',
    !r.ok && /not one of/.test(r.error) && /total_war/.test(r.error),
    r.ok ? 'ACCEPTED, so an unvalidated enum reaches toScript' : r.error,
  );
}

{
  const r = claim({ actor: 1, target: 2, momentum: 'holy_war' }, pair({ actorFaith: 'Sunni', targetFaith: 'Sunni' }));
  check(
    '25. a holy war between co-religionists is refused',
    !r.ok && /faith difference/.test(r.error),
    r.ok ? 'ACCEPTED, so the Director can call a Sunni-on-Sunni war a holy war' : r.error,
  );
}

{
  // Fail closed: a snapshot that lost its faith fields must not read as
  // "the faiths differ".
  const r = claim({ actor: 1, target: 2, momentum: 'holy_war' }, pair({ actorFaith: '', targetFaith: '' }));
  check(
    '26. holy war fails closed when the snapshot carries no faiths',
    !r.ok && /does not carry them/.test(r.error),
    r.ok ? 'ACCEPTED on missing data, which is not permission' : r.error,
  );
}

{
  const snap = pair();
  const r = claim({ actor: 1, target: 2, momentum: 'holy_war' }, snap);
  check(
    '27. the preview names the momentum and its magnitude',
    r.ok
      && /pressed claim/.test(r.preview)
      && /Momentum: holy war/.test(r.preview)
      && /1000 gold/.test(r.preview)
      && /1000 piety/.test(r.preview)
      && /30-year/.test(r.preview)
      && /does not start a war/.test(r.preview),
    r.ok ? r.preview : r.error,
  );
}

{
  const snap = pair();
  const r = claim({ actor: 1, target: 2, momentum: 'reconquista' }, snap);
  const script = r.ok ? r.action.toScript({ actor: 1, target: 2, momentum: 'reconquista' }, 77, snap).join('\n') : '';
  check(
    '28. the script keeps its guard and adds the momentum block inside it',
    r.ok
      && /add_pressed_claim = scope:hd_target\.primary_title/.test(script)
      && /add_gold = 1000/.test(script)
      && /modifier = hd_reconquista_momentum/.test(script)
      && /years = 30/.test(script)
      // Prestige for a reconquest, piety only for a holy war.
      && /add_prestige = 1000/.test(script) && !/add_piety/.test(script)
      // Everything sits inside the one guarded block, so claim and momentum
      // land together or not at all, and the refusal branch still exists.
      && script.indexOf('add_character_modifier') < script.indexOf('HD:/;/applied')
      && /HD:\/;\/refused\/;\/77\/;\/grant_claim/.test(script)
      // And nothing starts a war. The Director sets the stage.
      && !/start_war/.test(script),
    r.ok ? 'guarded, and no start_war' : r.error,
  );
}

{
  // The last line of defence. validate rejects an unknown momentum, but if it
  // ever failed to, the fragment builder must still emit nothing rather than
  // interpolate whatever it was handed.
  const hostile = 'none } add_gold = 99999 scope:hd_actor = {';
  check(
    '29. an unvalidated momentum key yields no script at all',
    momentumScript(hostile, 'scope:hd_actor').length === 0
      && momentumScript('none', 'scope:hd_actor').length === 0
      && momentumScript(undefined, 'scope:hd_actor').length === 0,
    'unknown, none and undefined all produce zero lines',
  );
}

// --- 30-33. the preview may not promise what the mod cannot execute --------
// The orchestrator and the companion mod are versioned and deployed
// separately. Momentum is the only thing that needs them to agree, because it
// applies a character modifier the mod has to define - and a missing definition
// fails as a line in error.log and nothing in the game, while the applied
// record still says ok. This was live: a 1250 campaign ran a v0.4 orchestrator
// against a v0.3.0 mod.

{
  check(
    '30. version comparison orders releases numerically',
    compareVersions('0.4.0', '0.3.0') > 0
      && compareVersions('0.3.0', '0.4.0') < 0
      && compareVersions('0.4.1', '0.4.1') === 0
      && compareVersions('0.10.0', '0.9.0') > 0
      && compareVersions('1.0', '0.9.9') > 0,
    '0.10.0 > 0.9.0, so this is not a string comparison',
  );
}

{
  // A folder with no mod in it is the "not deployed" case.
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-nomod-'));
  const support = momentumSupport(empty);
  check(
    '31. an undeployed mod reports momentum unavailable, and names the fix',
    !support.ok && support.version === null && /deploy:mod/.test(support.reason),
    support.reason,
  );
  check(
    '31b. and no descriptor means no version',
    deployedModVersion(empty) === null,
    'null rather than a guess',
  );
  fs.rmSync(empty, { recursive: true, force: true });
}

{
  // A deployed but stale mod: exactly the 1250 campaign's situation.
  const stale = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-stalemod-'));
  const dir = path.join(stale, 'mod', 'historical_director');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'descriptor.mod'), 'version="0.3.0"\nname="Historical Director"\n', 'utf8');
  const support = momentumSupport(stale);
  check(
    '32. a stale companion mod is detected and reported by version',
    !support.ok && support.version === '0.3.0' && /v0\.3\.0/.test(support.reason) && /restart CK3/.test(support.reason),
    support.reason,
  );

  // And the toolkit refuses momentum rather than previewing it.
  setMomentumSupport(support);
  const snap = pair();
  const refused = claim({ actor: 1, target: 2, momentum: 'holy_war' }, snap);
  const bare = claim({ actor: 1, target: 2 }, snap);
  check(
    '32b. the toolkit then refuses momentum but still allows a bare claim',
    !refused.ok && /cannot be executed/.test(refused.error) && bare.ok && !/Momentum:/.test(bare.preview),
    refused.ok ? 'ACCEPTED, so the sidebar would promise an effect the mod cannot land' : refused.error,
  );

  fs.rmSync(stale, { recursive: true, force: true });
}

{
  // A current mod restores it. Left in this state for any later case.
  const current = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-curmod-'));
  const dir = path.join(current, 'mod', 'historical_director');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'descriptor.mod'), 'version="0.4.1"\nname="Historical Director"\n', 'utf8');
  const support = momentumSupport(current);
  setMomentumSupport(support);
  const r = claim({ actor: 1, target: 2, momentum: 'holy_war' }, pair());
  check(
    '33. a current mod re-enables momentum',
    support.ok && support.version === '0.4.1' && r.ok && /Momentum: holy war/.test(r.preview),
    support.ok ? 'v' + support.version + ', momentum available' : support.reason,
  );
  fs.rmSync(current, { recursive: true, force: true });
}

try { fs.unlinkSync(tmp); } catch { /* already gone */ }

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
