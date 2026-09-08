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
import { fileURLToPath } from 'node:url';
import { SnapshotAssembler, renderRealmTable, cleanWarName } from '../src/model/WorldState.js';
import { parseLine } from '../src/bridge/protocol.js';
import { Baseline } from '../src/model/Baseline.js';
import { AuditClock } from '../src/model/AuditClock.js';
import { validateProposal } from '../src/director/toolkit.js';
import { Director } from '../src/director/Director.js';
import { momentumScript, MOMENTUM_KEYS, setMomentumSupport } from '../src/director/momentum.js';
import { compareVersions, deployedModVersion, momentumSupport, macroSupport, momentSupport as resolveMomentSupport, MACRO_MIN_MOD, MOMENT_MIN_MOD, setObservedModVersion, observedModVersion } from '../src/setup/modVersion.js';
import { setMacroSupport } from '../src/director/macroEvents.js';
import { MOMENTS, MOMENT_KEYS, ALL_MOMENT_KEYS, setMomentSupport, applicableMoments, momentBriefing } from '../src/director/moments.js';
import { snapshotScript } from '../src/bridge/ck3Script.js';
import { preflight } from '../src/setup/preflight.js';
import { LoreBook } from '../src/lore/LoreBook.js';
import { INTENSITY, INTENSITY_KEYS, intensityBand, hasRegionData } from '../src/director/macroEvents.js';

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
    // Three rings. Default is home, which implies near; a case sets ring
    // 'near' or 'distant' to move a realm outwards.
    if ((r.ring ?? 'home') === 'home') feed(`HD:/;/realm_home/;/${r.id}`);
    if ((r.ring ?? 'home') !== 'distant') feed(`HD:/;/realm_near/;/${r.id}`);
    for (const reg of r.regions ?? []) feed(`HD:/;/realm_in_region/;/${r.id}/;/${reg}`);
  }
  return feed(`HD:/;/snapshot_end/;/${token}`).snapshot;
}

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
    // Either phrasing is correct here and which one appears depends on whether
    // the baseline recorded a sphere. What this case guards is that an absent
    // realm is refused for want of a reference, not which of the two reasons
    // the Director gives for having none.
    !r.ok && /no reference for its rank|No reference, so no claim/.test(r.error),
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

// --- 34-38. locality -------------------------------------------------------
// Seeing a realm and being entitled to act on it stopped being the same thing
// when the sphere became a dial. At reach 4 an Egyptian player's sphere reaches
// Bengal, and the Director proposed granting the King of France a claim on the
// Almoravids: two realms on opposite edges of the window, neither of them the
// player. Bounded attention had become unbounded agency.

/** Two rulers on the rim of the sphere, and one next door. */
function rings() {
  return snapshot({
    token: '40',
    date: '1250.1.1',
    totalDays: 456252,
    realms: [
      { id: 1, ruler: 'al-Mustansir', title: 'Caliphate of Arabia', rank: 'Empire', tierKey: 'empire', faith: 'Zaydism', ring: 'home' },
      { id: 2, ruler: 'Louis IX', title: 'Kingdom of France', rank: 'Kingdom', tierKey: 'kingdom', faith: 'Catholic', ring: 'distant' },
      { id: 3, ruler: 'Abu Yaqub', title: 'the Almoravid Sultanate', rank: 'Kingdom', tierKey: 'kingdom', faith: 'Maliki', ring: 'distant' },
      { id: 4, ruler: 'Bohemond', title: 'Principality of Antioch', rank: 'Duchy', tierKey: 'duchy', faith: 'Catholic', ring: 'near' },
    ],
  });
}

{
  // The exact proposal from the 1250 campaign.
  const snap = rings();
  const r = validateProposal({ action: 'grant_claim', args: { actor: 2, target: 3 } }, snap, null);
  check(
    '34. locality refuses a claim between two realms on the rim',
    !r.ok && /at least one party/.test(r.error),
    r.ok ? 'ACCEPTED, which is the France-Almoravids proposal all over again' : r.error,
  );
}

{
  const snap = rings();
  const near = validateProposal({ action: 'grant_claim', args: { actor: 4, target: 3 } }, snap, null);
  const home = validateProposal({ action: 'grant_claim', args: { actor: 1, target: 3 } }, snap, null);
  check(
    '35. but allows one where either party is near or at home',
    near.ok && home.ok,
    near.ok ? 'nearby actor and home actor both permitted' : near.error,
  );
  check(
    '35b. and the preview says the other party is far away',
    home.ok && /lies outside your neighbourhood/.test(home.preview),
    home.ok ? home.preview : home.error,
  );
}

{
  const snap = rings();
  const rel = validateProposal({ action: 'set_relations', args: { actor: 2, target: 3, value: -50 } }, snap, null);
  const evt = validateProposal({ action: 'trigger_event', args: { actor: 2, event: 'hd_event.0100' } }, snap, null);
  check(
    '36. set_relations and trigger_event are bound by the same rule',
    !rel.ok && /at least one party/.test(rel.error) && !evt.ok && /at least one party/.test(evt.error),
    rel.ok || evt.ok ? 'one of them ACCEPTED' : 'both refused',
  );
}

{
  // adjust_title_tier corrects the shape of the map, which is worth doing
  // wherever it has gone wrong. It must stay global.
  const realm = { id: 5, ruler: 'Someone', title: 'the invented Empire', rank: 'Empire', tierKey: 'empire', ring: 'distant' };
  const b = baselineAt(1218, realm);
  const now = snapshot({ token: '41', date: '1250.1.1', totalDays: 456252, realms: [realm] });
  const r = validateProposal({ action: 'adjust_title_tier', args: { actor: 5, target_tier: 'kingdom' } }, now, b);
  check(
    '37. adjust_title_tier stays global, and the empire check with it',
    r.ok,
    r.ok ? 'a distant unlisted empire is still correctable' : 'REJECTED: ' + r.error,
  );
}

{
  // Degrade, do not fail closed. A snapshot with no marking at all means the
  // marking did not happen, not that nothing is near.
  const unmarked = snapshot({
    token: '42',
    date: '1250.1.1',
    totalDays: 456252,
    realms: [
      { id: 6, ruler: 'A', title: 'Realm A', rank: 'Kingdom', tierKey: 'kingdom', ring: 'distant' },
      { id: 7, ruler: 'B', title: 'Realm B', rank: 'Kingdom', tierKey: 'kingdom', ring: 'distant' },
    ],
  });
  const r = validateProposal({ action: 'grant_claim', args: { actor: 6, target: 7 } }, unmarked, null);
  check(
    '38. an unmarked snapshot is treated as missing data, not as a refusal',
    r.ok && !/lies outside/.test(r.preview),
    r.ok ? 'permitted, and the preview makes no distance claim it cannot support' : r.error,
  );
}

// --- 39-40. the audit clock ------------------------------------------------
// The cadence lived only in memory, so every start of the orchestrator reset it
// to "never" and the next heartbeat audited. One testing session produced
// twenty-nine audits across six in-game years against a five-year cadence,
// eight of them inside 1245 - each a retrieval pass and a paid completion over
// a hundred-and-twenty-realm prompt.

{
  const clockPath = path.join(os.tmpdir(), `hd-clock-${Date.now()}.json`);
  try { fs.unlinkSync(clockPath); } catch { /* first run */ }

  const first = new AuditClock(clockPath);
  const fresh = first.lastAuditYear;
  first.record(1245, 454427);

  // A second instance is what a restarted orchestrator sees.
  const afterRestart = new AuditClock(clockPath);
  check(
    '39. the audit clock survives a restart',
    fresh === -Infinity && afterRestart.lastAuditYear === 1245,
    `before: ${fresh}, after a restart: ${afterRestart.lastAuditYear}`,
  );

  // Same campaign, later date: the clock stands.
  const kept = afterRestart.reconcile(456252);
  check(
    '39b. and stands while the campaign moves forward',
    kept === false && afterRestart.lastAuditYear === 1245,
    'still 1245, so the cadence is not restarted every heartbeat',
  );

  // An earlier date is a different campaign or an earlier save, and a cadence
  // carried over from a future that no longer exists would suppress audits for
  // decades.
  const dropped = afterRestart.reconcile(390000);
  check(
    '40. but is discarded when the game goes backwards in time',
    dropped === true && afterRestart.lastAuditYear === -Infinity && !fs.existsSync(clockPath),
    'cleared, and the file removed with it',
  );

  try { fs.unlinkSync(clockPath); } catch { /* already gone */ }
}

// --- 41-43. realms the baseline never saw -----------------------------------
// The baseline is scoped to the sphere it was captured from. A player who moves
// their capital or widens the reach acquires realms it never held - not because
// they are new, but because nobody was looking. A live campaign hit exactly
// this: a 1218 baseline taken in Iberia, a player now at Cairo in 1250, and
// almost every realm in the sphere unknown to it.

{
  // Mid-campaign baseline, realm absent from it, empire tier, not on the
  // 1178 roster: the bookmark tables can speak even though the baseline cannot.
  const seen = { id: 20, ruler: 'Someone', title: 'Kingdom of Navarra', rank: 'Kingdom', tierKey: 'kingdom' };
  const b = baselineAt(1218, seen);
  const unseen = { id: 21, ruler: 'al-Mustansir', title: 'Empire of Caliphate of Arabia', rank: 'Empire', tierKey: 'empire' };
  const now = snapshot({ token: '50', date: '1250.1.1', totalDays: 456252, realms: [unseen] });
  const r = validateProposal({ action: 'adjust_title_tier', args: { actor: 21, target_tier: 'kingdom' } }, now, b);
  check(
    '41. a realm the baseline never saw still reaches the bookmark tables',
    r.ok,
    r.ok ? r.preview : 'REJECTED, so moving your capital silences the Director: ' + r.error,
  );
}

{
  // Same situation at a rank the tables say nothing about: still refused, and
  // the reason now says which kind of silence it is.
  const seen = { id: 22, ruler: 'Someone', title: 'Kingdom of Navarra', rank: 'Kingdom', tierKey: 'kingdom' };
  const b = baselineAt(1218, seen);
  const unseen = { id: 23, ruler: 'A Sheikh', title: 'Sheikhdom of Aden', rank: 'Duchy', tierKey: 'duchy' };
  const now = snapshot({ token: '51', date: '1250.1.1', totalDays: 456252, realms: [unseen] });
  const r = validateProposal({ action: 'adjust_title_tier', args: { actor: 23, target_tier: 'county' } }, now, b);
  check(
    '42. but an unremarkable one is still refused, and says why accurately',
    !r.ok && /never saw/.test(r.error) && /No reference, so no claim/.test(r.error),
    r.ok ? 'ACCEPTED, so absence has become licence' : r.error,
  );
}

{
  // A bookmark-start baseline is unchanged: it saw the whole opening map of its
  // sphere, so absence from it is still meaningful and still refuses.
  //
  // "Of its sphere" is the load-bearing half, and this case used not to
  // establish it. A baseline that recorded no sphere cannot support the claim
  // that a realm was absent rather than unwatched, so the window is now stated
  // and unchanged, which is the condition under which the guard actually holds.
  const seen = { id: 24, ruler: 'Philippe', title: 'Kingdom of France', rank: 'Kingdom', tierKey: 'kingdom' };
  const b = fresh();
  b.offer(snapshot({ date: '1066.1.1', totalDays: 1066 * 365, realms: [seen] }), ['world_europe_west_francia']);
  b.observing(['world_europe_west_francia']);

  const unseen = { id: 25, ruler: 'Bohemond', title: 'Principality of Antioch', rank: 'Empire', tierKey: 'empire' };
  const now = snapshot({ token: '52', date: '1100.1.1', totalDays: 401000, realms: [unseen] });
  const r = validateProposal({ action: 'adjust_title_tier', args: { actor: 25, target_tier: 'kingdom' } }, now, b);
  check(
    '43. a bookmark-start baseline with a stated, unchanged window still refuses the unseen',
    !r.ok && /was not present when the baseline was captured/.test(r.error),
    r.ok ? 'ACCEPTED, which loosens the case the baseline exists to guard' : r.error,
  );
}

// --- Macro Event Library: iberian_pressure ----------------------------------
{
  // A peninsula the model might reasonably want to act on: mostly Andalusian
  // ground with Christian realms pressing on it.
  const iberia = (andalusi, other) => {
    const realms = [
      ...andalusi.map((c, i) => ({ id: 100 + i, ruler: `A${i}`, title: `Taifa ${i}`, rank: 'Duchy', tierKey: 'duchy', counties: c, culture: 'Andalusian' })),
      ...other.map((c, i) => ({ id: 200 + i, ruler: `C${i}`, title: `Crown ${i}`, rank: 'Kingdom', tierKey: 'kingdom', counties: c, culture: 'Castilian' })),
    ];
    return snapshot({ realms });
  };
  const bl = stubBaseline({ label: '= Duchy', risen: false, known: true });

  // Bands, from the live balance.
  const wide = iberia([30, 20], [8]);
  const narrow = iberia([6], [30, 25]);
  check(
    '44. the intensity band follows the live balance of the peninsula',
    intensityBand(wide, bl).allowed.length === 3 && intensityBand(narrow, bl).allowed.length <= 1,
    `Andalusian-heavy: ${intensityBand(wide, bl).allowed.join(',')} | Christian-heavy: ${intensityBand(narrow, bl).allowed.join(',') || 'none'}`,
  );

  // Out-of-band intensity is refused, and the refusal reports its figures.
  const mid = iberia([12], [18]);
  const band = intensityBand(mid, bl);
  const outOfBand = validateProposal(
    { action: 'iberian_pressure', args: { unifier: 100, partners: [200], intensity: 'crusade' } },
    mid, bl,
  );
  check(
    '45. an out-of-band intensity is rejected with the figures behind it',
    !outOfBand.ok && /out of band/.test(outOfBand.error) && /counties/.test(outOfBand.error),
    outOfBand.ok ? `ACCEPTED though the band was ${band.allowed.join(',')}` : outOfBand.error,
  );

  // A partner outside the peninsula.
  const withOutsider = snapshot({
    realms: [
      { id: 1, ruler: 'Al-Mamun', title: 'Taifa of Toledo', rank: 'Duchy', tierKey: 'duchy', counties: 20, culture: 'Andalusian' },
      { id: 2, ruler: 'Harald', title: 'Kingdom of Norway', rank: 'Kingdom', tierKey: 'kingdom', counties: 9, culture: 'Norse' },
    ],
  });
  const outsider = validateProposal(
    { action: 'iberian_pressure', args: { unifier: 1, partners: [2], intensity: 'smoldering' } },
    withOutsider, bl,
  );
  check(
    '46. a partner outside the peninsula is rejected',
    !outsider.ok && /not of the peninsula/.test(outsider.error),
    outsider.ok ? 'ACCEPTED a Norse partner in an Iberian event' : outsider.error,
  );

  // The script, per tier: right level, right event, both branches, and none of
  // the things this action promises never to do.
  for (const key of INTENSITY_KEYS) {
    const args = { unifier: 100, partners: [101, 200], intensity: key };
    const r = validateProposal({ action: 'iberian_pressure', args }, wide, bl);
    if (!r.ok) { check(`47.${key} script generation`, false, r.error); continue; }
    const script = r.action.toScript(args, 900, wide).join('\n');
    const level = INTENSITY[key].level;
    check(
      `47.${key} generates one guarded batch at level ${level}`,
      script.includes(`hd_pressure_level value = ${level}`)
        && script.includes('trigger_event = hd_event.0200')
        && script.includes('/;/applied/') && script.includes('/;/refused/')
        && !/start_war|destroy_title|create_title/.test(script),
      `level ${level}, no war, no title transfer`,
    );
  }

  // Preview completeness: every effect the tier claims, plus the tier and band.
  const args = { unifier: 100, partners: [101], intensity: 'crusade' };
  const cru = validateProposal({ action: 'iberian_pressure', args }, wide, bl);
  const undisclosed = cru.ok ? INTENSITY.crusade.effects.filter((e) => !cru.preview.includes(e)) : ['(rejected)'];
  check(
    '48. the preview discloses every mechanical effect, the tier and the band',
    cru.ok && undisclosed.length === 0 && /crusade/.test(cru.preview) && /Intensity band/.test(cru.preview),
    undisclosed.length ? `undisclosed: ${undisclosed.join('; ')}` : 'all effects named',
  );

  // The narrative is prose and must not be reachable as a parameter.
  const poisoned = validateProposal(
    { action: 'iberian_pressure', args: { unifier: 100, partners: [101], intensity: 'fervent', narrative: 'add_gold = 99999' } },
    wide, bl,
  );
  check(
    '49. a narrative offered as an action parameter is rejected',
    !poisoned.ok && /unexpected parameters/.test(poisoned.error),
    poisoned.ok ? 'ACCEPTED prose as a parameter' : poisoned.error,
  );
}

// --- geography, not culture -------------------------------------------------
// The bug a live 1257 campaign exposed: an Andalusian player in Cairo and an
// Andalusian sheikhdom in Libya both read as Iberian, and the band divided
// Andalusian counties by every county from Nubia to Germania.
{
  const IB = 'world_europe_west_iberia';
  const EG = 'world_africa_north_east';
  const MA = 'world_africa_north_west';
  const bl = stubBaseline({ label: '= Duchy', risen: false, known: true });

  const live = snapshot({
    realms: [
      { id: 1, ruler: 'Caliph', title: 'Empire of Caliphate of Arabia', rank: 'Empire', tierKey: 'empire', counties: 191, culture: 'Andalusian', regions: [EG] },
      { id: 2, ruler: 'Sheikh', title: 'Sheikhdom of Murzuk', rank: 'Duchy', tierKey: 'duchy', counties: 1, culture: 'Andalusian', regions: [MA] },
      { id: 3, ruler: 'Afonso', title: 'Kingdom of Portugal', rank: 'Kingdom', tierKey: 'kingdom', counties: 11, culture: 'Portuguese', regions: [IB] },
      { id: 4, ruler: 'al-Mutamid', title: 'Taifa of Sevilla', rank: 'Duchy', tierKey: 'duchy', counties: 9, culture: 'Andalusian', regions: [IB] },
      { id: 5, ruler: 'Fernando', title: 'Kingdom of Castile', rank: 'Kingdom', tierKey: 'kingdom', counties: 14, culture: 'Castilian', regions: [IB] },
    ],
  });

  check(
    '50. region records reach the snapshot',
    hasRegionData(live) && live.realmsById.get(4).regions.includes(IB) && !live.realmsById.get(1).regions.includes(IB),
    `Sevilla: ${live.realmsById.get(4).regions.join(',')} | Cairo: ${live.realmsById.get(1).regions.join(',')}`,
  );

  const band = intensityBand(live, bl);
  check(
    '51. the band measures the peninsula, not the whole sphere',
    band.byGeography && band.andalusiCounties === 9 && band.christianCounties === 25,
    band.reason,
  );

  const cairo = validateProposal(
    { action: 'iberian_pressure', args: { unifier: 1, partners: [4], intensity: 'smoldering' } },
    live, bl,
  );
  const libya = validateProposal(
    { action: 'iberian_pressure', args: { unifier: 4, partners: [2], intensity: 'smoldering' } },
    live, bl,
  );
  const proper = validateProposal(
    { action: 'iberian_pressure', args: { unifier: 4, partners: [3, 5], intensity: 'smoldering' } },
    live, bl,
  );
  check(
    '52. a realm of Iberian culture outside Iberia is refused, one inside is not',
    !cairo.ok && /holds no land in Iberia/.test(cairo.error)
      && !libya.ok && /holds no land in Iberia/.test(libya.error)
      && proper.ok,
    `Cairo and Murzuk refused by geography; Sevilla with Portugal and Castile accepted`,
  );

  // And the fallback: a snapshot with no region records at all must not refuse
  // everything, because missing data is not a verdict.
  const legacy = snapshot({
    realms: [
      { id: 6, ruler: 'al-Mutamid', title: 'Taifa of Sevilla', rank: 'Duchy', tierKey: 'duchy', counties: 9, culture: 'Andalusian' },
      { id: 7, ruler: 'Fernando', title: 'Kingdom of Castile', rank: 'Kingdom', tierKey: 'kingdom', counties: 14, culture: 'Castilian' },
    ],
  });
  const legacyBand = intensityBand(legacy, bl);
  check(
    '53. without region records it falls back to culture and says so',
    !legacyBand.byGeography && legacyBand.allowed.length > 0 && /no geography/.test(legacyBand.reason),
    legacyBand.reason,
  );
}

// --- 54-59. spawn_character: a person with somewhere to go -------------------
// The Director proposed "Restore the Premyslid heir to the Imperial court" and
// reasoned about a re-established Kingdom of Bohemia. What it executed was a
// courtier with a generated dynasty, no claim, and - because create_character
// has no `sex` key - a gender the engine picked for itself. Four things the
// card promised that the script did not do.

/** A Kaiser, a Bohemian king, and a ruler out on the rim. */
function bohemia() {
  return snapshot({
    token: '54',
    date: '1257.6.1',
    totalDays: 458_800,
    realms: [
      { id: 30, ruler: 'Kaiser Heinrich VII', title: 'Holy Roman Empire', rank: 'Empire', tierKey: 'empire', ring: 'home' },
      { id: 31, ruler: 'Vaclav', title: 'Kingdom of Bohemia', rank: 'Kingdom', tierKey: 'kingdom', ring: 'near' },
      { id: 32, ruler: 'Batu', title: 'the Golden Horde', rank: 'Empire', tierKey: 'empire', ring: 'distant' },
    ],
  });
}

{
  const snap = bohemia();
  const args = { name: 'Ottokar', sex: 'male', age: 30, host: 30 };
  const r = validateProposal({ action: 'spawn_character', args }, snap, risenBaseline);
  check(
    '54. a bare spawn says on the card that it creates a courtier and nothing more',
    r.ok && /no claim and no title/.test(r.preview),
    r.ok ? r.preview : r.error,
  );
}

{
  const snap = bohemia();
  const args = { name: 'Ottokar', sex: 'male', age: 30, host: 30 };
  const r = validateProposal({ action: 'spawn_character', args }, snap, risenBaseline);
  const script = r.ok ? r.action.toScript(args, 54, snap).join('\n') : '';
  check(
    '55. the script emits gender, which CK3 reads, and never sex, which it ignores',
    script.includes('gender = male') && !/\bsex = /.test(script),
    script.includes('gender = male') ? 'gender = male' : script,
  );
}

{
  const snap = bohemia();
  const args = { name: 'Ottokar', sex: 'male', age: 30, host: 30, house: 31, claim: 31 };
  const r = validateProposal({ action: 'spawn_character', args }, snap, risenBaseline);
  const script = r.ok ? r.action.toScript(args, 56, snap).join('\n') : '';
  check(
    '56. an endowed spawn carries the house and the claim, and guards both',
    r.ok
      && script.includes('dynasty_house = scope:hd_kin.house')
      && !script.includes('dynasty = generate')
      && /after_creation = \{\s*\n\s*add_pressed_claim = scope:hd_claim\.primary_title/.test(script)
      && script.includes('exists = scope:hd_kin.house')
      && script.includes('exists = scope:hd_claim.primary_title'),
    r.ok ? 'house from scope:hd_kin, claim inside after_creation, both guarded' : r.error,
  );
  check(
    '56b. and the card names the title, its tier, and who may press it',
    r.ok && /kingdom-tier title Kingdom of Bohemia/.test(r.preview) && /No war starts/.test(r.preview),
    r.ok ? r.preview : r.error,
  );
}

{
  // The endowments are optional, so a proposal that names one the snapshot does
  // not contain must be refused rather than executed as the bare spawn it
  // would otherwise silently become.
  const snap = bohemia();
  const badHouse = validateProposal(
    { action: 'spawn_character', args: { name: 'Ottokar', sex: 'male', age: 30, host: 30, house: 999 } },
    snap, risenBaseline,
  );
  const badClaim = validateProposal(
    { action: 'spawn_character', args: { name: 'Ottokar', sex: 'male', age: 30, host: 30, claim: 999 } },
    snap, risenBaseline,
  );
  check(
    '57. an unresolvable house or claim is refused by name, not quietly dropped',
    !badHouse.ok && /house 999 is not a ruler/.test(badHouse.error)
      && !badClaim.ok && /claim 999 is not a ruler/.test(badClaim.error),
    badHouse.ok ? 'ACCEPTED, which would spawn a courtier the card called a claimant' : badHouse.error,
  );
}

{
  // A claim is an act against the title's holder, so it takes grant_claim's
  // locality rule. A bare spawn does not.
  const snap = bohemia();
  const rim = validateProposal(
    { action: 'spawn_character', args: { name: 'Ottokar', sex: 'male', age: 30, host: 32, claim: 32 } },
    snap, risenBaseline,
  );
  const bare = validateProposal(
    { action: 'spawn_character', args: { name: 'Ottokar', sex: 'male', age: 30, host: 32 } },
    snap, risenBaseline,
  );
  check(
    '58. a claim across the rim is refused by locality; a bare spawn there is not',
    !rim.ok && /at least one party/.test(rim.error) && bare.ok,
    rim.ok ? 'ACCEPTED a claimant war arranged on the far edge of the sphere' : rim.error,
  );
}

{
  // The invariant every action shares.
  const snap = bohemia();
  const args = { name: 'Ottokar', sex: 'male', age: 30, host: 30, claim: 31 };
  const script = validateProposal({ action: 'spawn_character', args }, snap, risenBaseline)
    .action.toScript(args, 59, snap).join('\n');
  check(
    '59. and it still reports both outcomes',
    script.includes('HD:/;/applied/;/59/;/spawn_character') && script.includes('HD:/;/refused/;/59/;/spawn_character'),
  );
}

// --- 60-66. footprint and disappearance -------------------------------------
// Rank was the only axis the baseline measured, and a live 1197 campaign showed
// what that misses: a Kingdom of Calatayud that never existed, an Aragon under a
// King-Bishop, and no Castile at all - reported as "on track" for thirty-seven
// consecutive audits, because Leon was a kingdom at capture and a kingdom still.

const IB = ['world_europe_west_iberia', 'world_africa_north_west'];

/** Iberia at capture, and the same Iberia after Castile is taken apart. */
function iberiaAt(counties) {
  return snapshot({
    token: '60',
    date: '1178.10.1',
    totalDays: 430_000,
    realms: [
      { id: 60, ruler: 'Alfonso VIII', title: 'Kingdom of Castile', rank: 'Kingdom', tierKey: 'kingdom', counties: counties.castile, regions: IB },
      { id: 61, ruler: 'Fernando II', title: 'Kingdom of León', rank: 'Kingdom', tierKey: 'kingdom', counties: counties.leon, regions: IB },
      { id: 62, ruler: 'Sancho I', title: 'Kingdom of Portugal', rank: 'Kingdom', tierKey: 'kingdom', counties: 8, regions: IB },
      { id: 63, ruler: 'Pedro', title: 'County of Tudela', rank: 'County', tierKey: 'county', counties: 1, regions: IB },
    ],
  });
}

{
  const bl = fresh();
  bl.offer(iberiaAt({ castile: 15, leon: 10 }), IB);
  bl.observing(IB);

  const now = iberiaAt({ castile: 5, leon: 10 });
  const castile = bl.delta(now.realmsById.get(60));
  const leon = bl.delta(now.realmsById.get(61));

  check(
    '60. a realm that kept its crown and lost its land now says so',
    /= Kingdom, down 10 of 15 counties/.test(castile.label) && castile.risen === false,
    castile.label,
  );
  check(
    '60b. and a realm that lost nothing still reads as unchanged',
    leon.label === '= Kingdom' && !leon.lost,
    leon.label,
  );
  check(
    '60c. losing ground is never a licence to demote',
    validateProposal(
      { action: 'adjust_title_tier', args: { actor: 60, target_tier: 'duchy' } }, now, bl,
    ).ok === false,
    'adjust_title_tier still requires a rise, not a fall',
  );
}

{
  // Widening the sphere adds counties to realms straddling the old edge, so a
  // reported *gain* may be an artefact of the window. Losses cannot be.
  const bl = fresh();
  bl.offer(iberiaAt({ castile: 15, leon: 10 }), IB);
  bl.observing(IB);
  const grown = iberiaAt({ castile: 25, leon: 10 });
  const d = bl.delta(grown.realmsById.get(60));
  check(
    '61. growth is not reported, because a wider window can manufacture it',
    d.label === '= Kingdom' && d.lost === null,
    d.label,
  );
}

{
  const bl = fresh();
  bl.offer(iberiaAt({ castile: 15, leon: 10 }), IB);
  bl.observing(IB);
  const nibbled = iberiaAt({ castile: 14, leon: 10 });
  check(
    '62. ordinary churn is below the threshold and stays out of the table',
    bl.delta(nibbled.realmsById.get(60)).label === '= Kingdom',
    'one county of fifteen is not a divergence',
  );
}

{
  // The guard that makes the whole signal safe.
  const bl = fresh();
  bl.offer(iberiaAt({ castile: 15, leon: 10 }), IB);

  bl.observing([...IB, 'world_europe_west_francia']); // widened
  const wider = bl.delta(iberiaAt({ castile: 5, leon: 10 }).realmsById.get(60));

  bl.observing(['world_europe_west_iberia']); // narrowed
  const narrower = bl.delta(iberiaAt({ castile: 5, leon: 10 }).realmsById.get(60));

  check(
    '63. a widened window still reports the loss; a narrowed one suppresses it',
    /down 10 of 15/.test(wider.label) && narrower.label === '= Kingdom' && narrower.lost === null,
    `widened: ${wider.label} | narrowed: ${narrower.label}`,
  );
}

{
  // A baseline written before the sphere was recorded cannot verify the window.
  // It reports the signal marked, rather than silently or as though certain.
  const bl = fresh();
  bl.offer(iberiaAt({ castile: 15, leon: 10 })); // no sphere argument
  bl.observing(IB);
  const d = bl.delta(iberiaAt({ castile: 5, leon: 10 }).realmsById.get(60));
  check(
    '64. an unverifiable comparison is flagged rather than hidden or trusted',
    /down 10 of 15 counties\?/.test(d.label) && d.lost.verified === false,
    d.label,
  );
}

{
  // Castile gone entirely: the case the realm table structurally cannot show,
  // because a table of what exists has no row for what does not.
  const bl = fresh();
  bl.offer(iberiaAt({ castile: 15, leon: 10 }), IB);
  bl.observing(IB);

  const without = snapshot({
    token: '65',
    date: '1197.1.1',
    totalDays: 437_000,
    realms: [
      { id: 61, ruler: 'Fernando III', title: 'Kingdom of León', rank: 'Kingdom', tierKey: 'kingdom', counties: 10, regions: IB },
      { id: 62, ruler: 'Sancho I', title: 'Kingdom of Portugal', rank: 'Kingdom', tierKey: 'kingdom', counties: 8, regions: IB },
    ],
  });

  const gone = bl.vanished(without);
  check(
    '65. a kingdom that no longer exists is reported, and trivia is not',
    gone.total === 1 && gone.list[0].primaryTitle === 'Kingdom of Castile' && gone.verified,
    `${gone.total} gone: ${gone.list.map((r) => r.primaryTitle).join(', ')} (the one-county Tudela is correctly ignored)`,
  );

  bl.observing(['world_europe_west_iberia']);
  check(
    '65b. and a narrowed window reports none, because absence is then ambiguous',
    bl.vanished(without).list.length === 0,
    'suppressed rather than guessed',
  );
}

{
  const bl = fresh();
  bl.offer(iberiaAt({ castile: 15, leon: 10 }), IB);
  bl.observing(IB);
  check(
    '66. nothing is claimed gone while everything is still there',
    bl.vanished(iberiaAt({ castile: 15, leon: 10 })).total === 0,
    'no false positives on an unchanged world',
  );
}

// --- the macro-event version gate ------------------------------------------
// Momentum had this check and macro events did not. The Iberian pressure action
// applies three character modifiers, fires an event chain and unlocks a
// decision - all of it mod content - while the descriptor stayed at 0.4.2, the
// same version that predates them. A mod deployed before those commits and one
// deployed after reported the same version, so no check could tell them apart:
// every validation passed, the preview promised an accord, and the batch
// reported `applied ... ok` having done none of it.

/** A CK3 user folder with a mod of the given version deployed into it. */
function modAt(version) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-modver-'));
  const inner = path.join(dir, 'mod', 'historical_director');
  fs.mkdirSync(inner, { recursive: true });
  fs.writeFileSync(path.join(inner, 'descriptor.mod'), 'version="' + version + '"\nname="Historical Director"\n', 'utf8');
  return dir;
}

{
  // The exact situation the live 1199 session was in: a mod new enough for
  // momentum and too old for macro events, reporting "ok" to the only question
  // anyone was asking it.
  const dir = modAt('0.4.2');
  const mom = momentumSupport(dir);
  const macro = macroSupport(dir);
  check(
    'M1. a v0.4.2 mod supports momentum but not macro events',
    mom.ok && !macro.ok && macro.version === '0.4.2' && /v0\.4\.3 or newer/.test(macro.reason),
    'momentum ok, macro: ' + macro.reason,
  );
  fs.rmSync(dir, { recursive: true, force: true });
}

{
  const dir = modAt('0.4.3');
  const macro = macroSupport(dir);
  check(
    'M2. the version that ships the content enables it',
    macro.ok && macro.version === MACRO_MIN_MOD,
    'v' + macro.version + ', macro events available',
  );
  fs.rmSync(dir, { recursive: true, force: true });
}

{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-nomod-macro-'));
  const macro = macroSupport(dir);
  check(
    'M3. an undeployed mod refuses macro events and names the fix',
    !macro.ok && macro.version === null && /deploy:mod/.test(macro.reason),
    macro.reason,
  );
  fs.rmSync(dir, { recursive: true, force: true });
}

{
  // And the toolkit acts on it. A stale mod must refuse before any of the
  // geography, locality or intensity reasoning runs, because none of that
  // matters when the effects cannot land.
  const snap = snapshot({
    token: '60',
    date: '1199.1.1',
    totalDays: 437000,
    realms: [
      { id: 1, ruler: 'an-Nasir', title: 'Almohadi Caliphate', rank: 'Empire', tierKey: 'empire', culture: 'Andalusian' },
      { id: 2, ruler: 'Alfonso', title: 'Kingdom of Leon', rank: 'Kingdom', tierKey: 'kingdom', culture: 'Castilian' },
    ],
  });

  setMacroSupport({ ok: false, version: '0.4.2', reason: 'the deployed companion mod is v0.4.2 and the Iberian pressure event needs v0.4.3 or newer' });
  const stale = validateProposal(
    { action: 'iberian_pressure', args: { unifier: 1, partners: [2], intensity: 'smoldering' } },
    snap,
    null,
  );
  check(
    'M4. the toolkit refuses iberian_pressure on a stale mod, before anything else',
    !stale.ok && /cannot be executed/.test(stale.error) && /v0\.4\.3 or newer/.test(stale.error),
    stale.ok ? 'ACCEPTED, so the preview promises an accord the mod cannot execute' : stale.error,
  );

  // Restored, so later cases and the rest of the suite see a capable mod.
  setMacroSupport({ ok: true, version: '0.4.3', reason: '' });
  const fresh = validateProposal(
    { action: 'iberian_pressure', args: { unifier: 1, partners: [2], intensity: 'smoldering' } },
    snap,
    null,
  );
  check(
    'M5. and stops refusing once the mod is current',
    !(!fresh.ok && /cannot be executed/.test(fresh.error)),
    fresh.ok ? 'permitted' : 'refused for a different, non-version reason: ' + fresh.error,
  );
}

// --- preflight's log window -------------------------------------------------
// It used to read a flat 400 KB from the end of debug.log. A live install held
// 13,161 HD records and none in that window, because another mod had written
// past it in the five minutes since the last audit - so preflight told someone
// whose mod was enabled, loaded and mid-audit to go and enable their mod. A
// check that sends you to fix a thing that is not broken is worse than none.

/** A CK3 folder whose debug.log is built to order. */
function logWith(build) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-preflight-'));
  fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'run'), { recursive: true });
  const logPath = path.join(dir, 'logs', 'debug.log');
  fs.writeFileSync(logPath, build(), 'utf8');
  return {
    dir,
    cfg: {
      ck3UserFolder: dir,
      debugLogPath: logPath,
      llm: { apiKey: 'x', apiKeyEnv: 'HD_API_KEY' },
    },
  };
}

const heard = (findings) => findings.find((f) => f.label === 'the mod has written to the log');

{
  // The live failure, reproduced: HD records at the front, then far more than
  // 400 KB of another mod's noise.
  const noise = '[00:00:00][D][other_mod.cpp:1]: RICE something happened here\n'.repeat(40000);
  const { dir, cfg } = logWith(() => 'HD:/;/date/;/1 Jan 1199/;/437637\n' + noise);
  const f = heard(preflight(cfg));
  const sizeMB = (fs.statSync(cfg.debugLogPath).size / 1024 / 1024).toFixed(1);
  check(
    'P1. a marker buried behind megabytes of other mods is still found',
    f.ok && /most recent is/.test(f.detail),
    f.ok ? f.detail + '  (log is ' + sizeMB + ' MB)' : 'MISSED: ' + f.detail,
  );
  fs.rmSync(dir, { recursive: true, force: true });
}

{
  // And a log with no HD records at all still fails, which is the whole point
  // of the check. Widening the search must not make it answer "yes" to
  // everything.
  const { dir, cfg } = logWith(() => '[00:00:00][D][other.cpp:1]: nothing of ours\n'.repeat(20000));
  const f = heard(preflight(cfg));
  check(
    'P2. a log genuinely without HD records still reports so',
    !f.ok && /Enable the mod/.test(f.detail),
    f.ok ? 'PASSED, so the check now says yes to anything' : f.detail,
  );
  fs.rmSync(dir, { recursive: true, force: true });
}

{
  // A recent record reports plainly, with no distance noise.
  const { dir, cfg } = logWith(() => 'noise\n'.repeat(100) + 'HD:/;/snapshot_end/;/277884\n');
  const f = heard(preflight(cfg));
  check(
    'P3. a recent record is reported without qualification',
    f.ok && f.detail === 'found HD: records',
    f.detail,
  );
  fs.rmSync(dir, { recursive: true, force: true });
}

{
  // The subtle one. The search reads backwards a megabyte at a time, so a
  // marker lying across a chunk boundary would be split in half and missed
  // without the overlap. Positioned so "HD:" straddles the first boundary.
  const CHUNK = 1024 * 1024;
  const { dir, cfg } = logWith(() => {
    const tail = 'x'.repeat(CHUNK - 1);       // the last chunk, minus one byte
    const head = 'y'.repeat(CHUNK);            // enough to force a second read
    return head + 'HD:' + tail;                // "HD:" begins one byte before the boundary
  });
  const f = heard(preflight(cfg));
  check(
    'P4. a marker straddling a chunk boundary is not split in half and lost',
    f.ok,
    f.ok ? 'found across the boundary' : 'MISSED, so the chunk overlap is wrong',
  );
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- absence, and whether the Director was looking ---------------------------
// A realm missing from the baseline means "it did not exist then" only if the
// window has not grown since. A live 1178 campaign whose sphere had widened to
// twenty regions refused a Grand Emirate of Sahara as "not present when the
// baseline was captured" - from a baseline that recorded no sphere at all, over
// ground it may never have been watching. The refusal was right; its stated
// reason was a guess.

const IBERIA = 'world_europe_west_iberia';
const SAHARA = 'world_africa_sahara';

/** A bookmark-start baseline, captured across a named sphere. */
function baselineAcross(year, sphere, realms) {
  const b = fresh();
  b.offer(snapshot({ date: year + '.1.1', totalDays: year * 365, realms }), sphere);
  return b;
}

{
  // Captured across Iberia only, now looking at Iberia and the Sahara. A realm
  // in view but absent from the baseline could have stood there all along.
  const b = baselineAcross(1178, [IBERIA], [
    { id: 1, ruler: 'Muhammad', title: 'Emirate of Ghirnatah', rank: 'Kingdom', tierKey: 'kingdom' },
  ]);
  b.observing([IBERIA, SAHARA]);

  const now = snapshot({
    token: '70',
    date: '1199.1.1',
    totalDays: 437637,
    realms: [{ id: 2, ruler: 'A Sheikh', title: 'Grand Emirate of Sahara', rank: 'Kingdom', tierKey: 'kingdom' }],
  });
  const r = validateProposal({ action: 'adjust_title_tier', args: { actor: 2, target_tier: 'duchy' } }, now, b);
  check(
    'S1. a widened sphere stops the gate claiming a realm is new',
    !r.ok && /the sphere has widened/.test(r.error) && !/was not present when the baseline was captured/.test(r.error),
    r.ok ? 'ACCEPTED, which is not the fix' : r.error,
  );
  check(
    'S1b. and absenceMeansNew says why',
    b.absenceMeansNew === false,
    'the window grew, so absence proves nothing',
  );
}

{
  // Same shape, but the window has not grown. Here absence really does mean the
  // realm was not there, and the firm refusal is correct.
  const b = baselineAcross(1178, [IBERIA, SAHARA], [
    { id: 1, ruler: 'Muhammad', title: 'Emirate of Ghirnatah', rank: 'Kingdom', tierKey: 'kingdom' },
  ]);
  b.observing([IBERIA, SAHARA]);

  const now = snapshot({
    token: '71',
    date: '1199.1.1',
    totalDays: 437637,
    realms: [{ id: 2, ruler: 'A Sheikh', title: 'Grand Emirate of Sahara', rank: 'Kingdom', tierKey: 'kingdom' }],
  });
  const r = validateProposal({ action: 'adjust_title_tier', args: { actor: 2, target_tier: 'duchy' } }, now, b);
  check(
    'S2. an unchanged window keeps the firm "was not present" refusal',
    !r.ok && /was not present when the baseline was captured/.test(r.error) && b.absenceMeansNew === true,
    r.error,
  );
}

{
  // The live case: a baseline recording no sphere at all, which is every
  // baseline.json written before the sphere was stored. It cannot support the
  // claim either.
  const b = fresh();
  b.offer(snapshot({
    date: '1178.1.1',
    totalDays: 1178 * 365,
    realms: [{ id: 1, ruler: 'Muhammad', title: 'Emirate of Ghirnatah', rank: 'Kingdom', tierKey: 'kingdom' }],
  }));
  b.observing([IBERIA, SAHARA]);
  check(
    'S3. a baseline that recorded no sphere cannot claim newness either',
    b.absenceMeansNew === false,
    'unverified rather than assumed, the same choice as "= Empire since load"',
  );
}

{
  // And the door this opens is narrow. An empire the 1178 roster does not carry,
  // absent from a baseline whose window has grown, now reaches the tables - and
  // the tables permit it, which is the whole point of having them.
  const b = baselineAcross(1178, [IBERIA], [
    { id: 1, ruler: 'Muhammad', title: 'Emirate of Ghirnatah', rank: 'Kingdom', tierKey: 'kingdom' },
  ]);
  b.observing([IBERIA, SAHARA]);

  const now = snapshot({
    token: '72',
    date: '1199.1.1',
    totalDays: 437637,
    realms: [{ id: 3, ruler: 'Someone', title: 'the invented Empire', rank: 'Empire', tierKey: 'empire' }],
  });
  const r = validateProposal({ action: 'adjust_title_tier', args: { actor: 3, target_tier: 'kingdom' } }, now, b);
  check(
    'S4. an unlisted empire now reaches the bookmark tables and is permitted',
    r.ok,
    r.ok ? r.preview : 'REJECTED: ' + r.error,
  );
}

{
  // But the Holy Roman Empire is still safe, because the tables name it.
  const b = baselineAcross(1178, [IBERIA], [
    { id: 1, ruler: 'Muhammad', title: 'Emirate of Ghirnatah', rank: 'Kingdom', tierKey: 'kingdom' },
  ]);
  b.observing([IBERIA, SAHARA]);

  const now = snapshot({
    token: '73',
    date: '1199.1.1',
    totalDays: 437637,
    realms: [{ id: 4, ruler: 'Heinrich', title: 'Holy Roman Empire', rank: 'Empire', tierKey: 'empire' }],
  });
  const r = validateProposal({ action: 'adjust_title_tier', args: { actor: 4, target_tier: 'kingdom' } }, now, b);
  check(
    'S5. and the Holy Roman Empire is still refused by name',
    !r.ok && /nothing to bring down/.test(r.error),
    r.ok ? 'ACCEPTED, which reopens failure B through the new door' : r.error,
  );
}

// --- the historical moment library ------------------------------------------
// A moment licenses and equips; it transfers no titles and starts no wars. The
// claim is the mechanism because a pressed claim on a kingdom-tier title
// carries the de jure vassals on victory - that is a union - and claim_cb is
// not one of the four vanilla CBs that call
// struggle_blocks_invasion_conquest_cb_trigger, so the Iberian struggle does
// not touch it in any phase.

/** Two Iberian crowns, with the per-realm geography a moment requires. */
function crowns({ actorRegion = 'world_europe_west_iberia', targetRegion = 'world_europe_west_iberia', year = 1205 } = {}) {
  return {
    year,
    realmsById: new Map([
      [1, { id: 1, tag: 0, ruler: 'Alfonso VIII', primaryTitle: 'Kingdom of Castile', tierKey: 'kingdom', culture: 'Castilian', inNeighbourhood: true, regions: [actorRegion] }],
      [2, { id: 2, tag: 1, ruler: 'Alfonso IX', primaryTitle: 'Kingdom of Leon', tierKey: 'kingdom', culture: 'Castilian', inNeighbourhood: true, regions: [targetRegion] }],
    ]),
  };
}

const moment = (args, st) => validateProposal({ action: 'historical_moment', args }, st, null);

{
  const r = moment({ moment: 'iberian_union', actor: 1, target: 2 }, crowns());
  check(
    'H1. a curated moment validates, and the preview itemises what it grants',
    r.ok
      && /pressed claim/.test(r.preview)
      && /600 gold/.test(r.preview)
      && /25-year/.test(r.preview)
      && /No war is started and no title changes hands/.test(r.preview),
    r.ok ? r.preview.slice(0, 130) + '...' : r.error,
  );
}

{
  // The date. A moment outside its window is a different process wearing its
  // name; almohad_decline is 1212 give or take 60.
  const r = moment({ moment: 'almohad_decline', actor: 1, target: 2 }, crowns({ year: 900 }));
  check(
    'H2. a moment outside its window is refused, and the refusal shows the arithmetic',
    !r.ok && /belongs to 1212 give or take 60 years, and the campaign is at 900/.test(r.error),
    r.ok ? 'ACCEPTED nine centuries early' : r.error,
  );
}

{
  // The place. Both realms must hold land where the moment happened.
  const r = moment({ moment: 'iberian_union', actor: 1, target: 2 }, crowns({ targetRegion: 'world_khorasan' }));
  check(
    'H3. a realm outside the moment\'s region is refused by name',
    !r.ok && /Kingdom of Leon does not hold land where/.test(r.error),
    r.ok ? 'ACCEPTED in Khorasan' : r.error,
  );
}

{
  // Declared but not curated. abbasid_twilight is in the table and must not be
  // reachable, because its actor is genuinely ambiguous.
  const r = moment({ moment: 'abbasid_twilight', actor: 1, target: 2 }, crowns());
  check(
    'H4. a declared but unoffered moment cannot be chosen',
    !r.ok && /is not an offered moment/.test(r.error)
      && ALL_MOMENT_KEYS.includes('abbasid_twilight')
      && !MOMENT_KEYS.includes('abbasid_twilight'),
    'declared in the table, absent from the enum the model sees',
  );
}

{
  const r = moment({ moment: 'iberian_union', actor: 1, target: 1 }, crowns());
  check(
    'H5. a realm cannot be both subject and object',
    !r.ok && /subject and the object/.test(r.error),
    r.error,
  );
}

{
  // Snapshots without per-realm geography cannot confirm either realm belongs
  // to the moment, so the action is refused rather than guessed at.
  const blind = {
    year: 1205,
    realmsById: new Map([
      [1, { id: 1, tag: 0, ruler: 'A', primaryTitle: 'Kingdom of Castile', tierKey: 'kingdom', inNeighbourhood: true }],
      [2, { id: 2, tag: 1, ruler: 'B', primaryTitle: 'Kingdom of Leon', tierKey: 'kingdom', inNeighbourhood: true }],
    ]),
  };
  const r = moment({ moment: 'iberian_union', actor: 1, target: 2 }, blind);
  check(
    'H6. a snapshot without geography refuses rather than assumes',
    !r.ok && /carries no per-realm geography/.test(r.error),
    r.error,
  );
}

{
  // The version gate, on its own threshold. A 0.4.3 mod runs Iberian pressure
  // perfectly well and has none of this library's content.
  setMomentSupport({ ok: false, version: '0.4.3', reason: 'the deployed companion mod is v0.4.3 and the historical moment library needs v0.5.0 or newer' });
  const stale = moment({ moment: 'iberian_union', actor: 1, target: 2 }, crowns());
  setMomentSupport({ ok: true, version: '0.5.0', reason: '' });
  const fresh = moment({ moment: 'iberian_union', actor: 1, target: 2 }, crowns());
  check(
    'H7. a mod too old for the library refuses before any other reasoning',
    !stale.ok && /cannot be executed/.test(stale.error) && /v0\.5\.0 or newer/.test(stale.error) && fresh.ok,
    stale.ok ? 'ACCEPTED on a mod without the events' : stale.error,
  );
}

{
  const st = crowns();
  const r = moment({ moment: 'iberian_union', actor: 1, target: 2 }, st);
  const script = r.ok ? r.action.toScript({ moment: 'iberian_union', actor: 1, target: 2 }, 88, st).join('\n') : '';
  check(
    'H8. the staged script licenses and equips, and starts nothing',
    r.ok
      && /add_pressed_claim = scope:hd_target\.primary_title/.test(script)
      && /add_gold = 600/.test(script)
      && /modifier = hd_moment_union/.test(script)
      && /trigger_event = hd_event\.0210/.test(script)
      && !/start_war/.test(script)
      && !/change_title_holder/.test(script)
      // One guard around all of it, and the refusal branch intact.
      && /HD:\/;\/refused\/;\/88\/;\/historical_moment/.test(script),
    r.ok ? 'claim, gold, modifier and event inside one guard; no start_war, no title transfer' : r.error,
  );
}

{
  // Every offered moment must name mod content that actually exists, or it
  // fails the way a missing modifier always does: a line in error.log.
  const modFile = fs.readFileSync(path.join(ROOT_DIR, 'mod', 'common', 'modifiers', 'hd_modifiers.txt'), 'utf8');
  const eventFile = fs.readFileSync(path.join(ROOT_DIR, 'mod', 'events', 'hd_events.txt'), 'utf8');
  const missing = [];
  for (const key of MOMENT_KEYS) {
    const m = MOMENTS[key];
    if (!modFile.includes(m.modifier + ' = {')) missing.push(key + ': modifier ' + m.modifier);
    if (!eventFile.includes(m.event + ' = {')) missing.push(key + ': event ' + m.event);
  }
  check(
    'H9. every offered moment names mod content that exists',
    missing.length === 0,
    missing.length ? missing.join('; ') : MOMENT_KEYS.length + ' moments, all their events and modifiers defined',
  );
}

// --- what the running game loaded -------------------------------------------
// The descriptor answers "what is deployed" and the gate treated that as "what
// can the game execute". They part company in exactly one window: after a
// deploy and before CK3 restarts. In that window the gate reported a feature as
// available while the loaded mod had none of it - the precise failure the gate
// exists to prevent, arriving through the check itself. The mod now reports its
// own version on every batch, and that answer wins.

/** A CK3 folder with a mod of the given version deployed. */
function deployedAt(version) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-obs-'));
  const inner = path.join(dir, 'mod', 'historical_director');
  fs.mkdirSync(inner, { recursive: true });
  fs.writeFileSync(path.join(inner, 'descriptor.mod'), 'version="' + version + '"\n', 'utf8');
  return dir;
}

{
  // The live situation: 0.5.0 on disk, an older mod still loaded in the running
  // game. Disk alone would say yes.
  const dir = deployedAt('0.5.0');
  setObservedModVersion(null);
  const byDisk = resolveMomentSupport(dir);

  setObservedModVersion('0.4.3');
  const byGame = resolveMomentSupport(dir);
  setObservedModVersion(null);

  check(
    'V1. the running game overrides the descriptor, and the descriptor alone would be wrong',
    byDisk.ok && !byGame.ok && byGame.version === '0.4.3' && byGame.source === 'game',
    'disk said available; the game said v0.4.3 and it is not',
  );
  check(
    'V1b. and the refusal names the right fix - restart, not redeploy',
    /restart CK3 to pick it up/.test(byGame.reason) && !/npm run deploy:mod/.test(byGame.reason),
    byGame.reason,
  );
  fs.rmSync(dir, { recursive: true, force: true });
}

{
  // Genuinely stale on disk too: the fix really is a deploy, and the message
  // must not tell them to restart into the same old mod.
  const dir = deployedAt('0.4.3');
  setObservedModVersion('0.4.3');
  const r = resolveMomentSupport(dir);
  setObservedModVersion(null);
  check(
    'V2. when disk is stale too, the fix named is the deploy',
    !r.ok && /npm run deploy:mod/.test(r.reason),
    r.reason,
  );
  fs.rmSync(dir, { recursive: true, force: true });
}

{
  const dir = deployedAt('0.5.1');
  setObservedModVersion('0.5.1');
  const r = resolveMomentSupport(dir);
  setObservedModVersion(null);
  check(
    'V3. a game running a current mod enables the library',
    r.ok && r.source === 'game' && r.version === '0.5.1',
    'v' + r.version + ' reported by the game, ' + MOMENT_MIN_MOD + ' required',
  );
  fs.rmSync(dir, { recursive: true, force: true });
}

{
  // Before the pump has run once there is no report, and saying so is the
  // honest state rather than pretending disk is the answer to a question it
  // cannot answer.
  setObservedModVersion(null);
  check(
    'V4. nothing is observed until the game says so',
    observedModVersion() === null,
    'null before the first batch, not a guess',
  );
}

{
  // The version the mod reports is a literal in its own script, and the
  // descriptor is a literal in another file. Two places holding one truth is
  // how they drift, so this asserts they have not.
  const descriptor = fs.readFileSync(path.join(ROOT_DIR, 'mod', 'descriptor.mod'), 'utf8');
  const effects = fs.readFileSync(path.join(ROOT_DIR, 'mod', 'common', 'scripted_effects', 'hd_perception_effects.txt'), 'utf8');
  const declared = descriptor.match(/version\s*=\s*"([^"]+)"/)?.[1] ?? null;
  const reported = effects.match(/HD:\/;\/mod_version\/;\/([0-9.]+)/)?.[1] ?? null;
  check(
    'V5. the version the mod reports matches the version it declares',
    declared !== null && reported !== null && declared === reported,
    'descriptor ' + declared + ', reported ' + reported,
  );
}

// --- the Director re-proposing its own work ---------------------------------
// The prompt was handed a "do not raise again" list built only from declines,
// so approvals were never suppressed. A live campaign approved Alfonso VIII's
// claim on Leon in 1193, 1199, 1200, 1201 and 1205, and the same claim on
// Calatayud twice in six months - 28 of 34 ledger entries were approvals and a
// large share were repeats.
//
// The redundant half is harmless: a pressed claim already held is a no-op. The
// momentum granted with it is not. Every repeat added another thousand gold,
// another thousand prestige and a fresh thirty-year appetite for war, so the
// duplicates compounded into the kind of distorted map the Director exists to
// correct.

/** A ledger in a scratch file. */
function ledger() {
  const f = path.join(os.tmpdir(), 'hd-ledger-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.json');
  return { book: new LoreBook(f), file: f };
}

{
  const { book, file } = ledger();
  book.record({ date: '2 Jan 1199', year: 1199, verdict: 'approved', action: 'grant_claim', args: { actor: 1, target: 2, momentum: 'reconquista' }, summary: 'Alfonso -> Leon' });

  // The live case exactly: same pair, different momentum, six years later.
  const repeat = book.approvedMatch('grant_claim', { actor: 1, target: 2, momentum: 'succession_pressure' }, 1205);
  check(
    'D1. the same action against the same pair is caught, whatever momentum it carries',
    repeat !== null && repeat.date === '2 Jan 1199',
    repeat ? 'matched the approval of ' + repeat.date : 'MISSED, which is the live bug',
  );
  fs.rmSync(file, { force: true });
}

{
  const { book, file } = ledger();
  book.record({ date: '2 Jan 1199', year: 1199, verdict: 'approved', action: 'grant_claim', args: { actor: 1, target: 2 }, summary: 'x' });
  check(
    'D2. a different target is not a repeat',
    book.approvedMatch('grant_claim', { actor: 1, target: 9 }, 1205) === null,
    'the guard identifies the pair, not the action alone',
  );
  check(
    'D3. and a different action against the same pair is not a repeat',
    book.approvedMatch('set_relations', { actor: 1, target: 2 }, 1205) === null,
    'grant_claim and set_relations are different things to have done',
  );
  fs.rmSync(file, { force: true });
}

{
  const { book, file } = ledger();
  book.record({ date: '2 Jan 1199', year: 1199, verdict: 'approved', action: 'grant_claim', args: { actor: 1, target: 2 }, summary: 'x' });
  check(
    'D4. the suppression expires, so a changed situation is judged again',
    book.approvedMatch('grant_claim', { actor: 1, target: 2 }, 1206) !== null
      && book.approvedMatch('grant_claim', { actor: 1, target: 2 }, 1240) === null,
    'blocked seven years later, allowed forty-one years later',
  );
  fs.rmSync(file, { force: true });
}

{
  const { book, file } = ledger();
  book.record({ date: '2 Jan 1199', year: 1199, verdict: 'declined', action: 'grant_claim', args: { actor: 1, target: 2 }, summary: 'x' });
  check(
    'D5. a decline never blocks - that is the other list\'s job',
    book.approvedMatch('grant_claim', { actor: 1, target: 2 }, 1205) === null,
    'declines are suppressed by instruction, approvals by this guard',
  );
  fs.rmSync(file, { force: true });
}

{
  // Entries written before arguments were recorded carry none, and cannot be
  // matched this way. They are covered by the prompt instruction instead, which
  // is why both halves exist.
  const { book, file } = ledger();
  book.record({ date: '2 Jan 1199', year: 1199, verdict: 'approved', action: 'grant_claim', summary: 'a legacy entry with no args' });
  check(
    'D6. a legacy entry without arguments cannot be matched, and says nothing false',
    book.approvedMatch('grant_claim', { actor: 1, target: 2 }, 1205) === null
      && book.approvedSummaries().length === 1,
    'unmatched by the guard, still named in the instruction',
  );
  fs.rmSync(file, { force: true });
}

{
  // The whole point: the guard runs inside audit, so a repeat never reaches the
  // player at all. Exercised through the real Director with a stub model.
  const { book, file } = ledger();
  book.record({ date: '2 Jan 1199', year: 1199, verdict: 'approved', action: 'grant_claim', args: { actor: 1, target: 2 }, summary: 'Alfonso -> Leon' });

  const snap = snapshot({
    token: '80', date: '1205.1.1', totalDays: 439000,
    realms: [
      { id: 1, ruler: 'Alfonso VIII', title: 'Kingdom of Castile', rank: 'Kingdom', tierKey: 'kingdom' },
      { id: 2, ruler: 'Fernando III', title: 'Kingdom of Leon', rank: 'Kingdom', tierKey: 'kingdom' },
    ],
  });

  const director = new Director({
    llm: { completeJson: async () => ({ assessment: '', proposals: [{ action: 'grant_claim', args: { actor: 1, target: 2 }, headline: 'again' }] }) },
    loreBook: book,
    knowledge: { enabled: false },
    log: () => {},
  });

  director.audit(snap, ['world_europe_west_iberia']).then((r) => {
    check(
      'D7. a repeat is dropped inside audit and never reaches the player',
      r.proposals.length === 0 && r.rejected.some((x) => /already approved on 2 Jan 1199/.test(x)),
      r.proposals.length ? 'REACHED the player, which is the bug' : r.rejected[0],
    );
    fs.rmSync(file, { force: true });
    console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
    process.exit(failed === 0 ? 0 : 1);
  });
}

// --- showing the model which moments fit -------------------------------------
// A live 1205 audit proposed the Castile-Leon union - which is exactly
// iberian_union, with the library loaded and applicable - as a bare grant_claim,
// because nothing put the fitting moment in front of it. Computed and shown,
// for the same reason the bookmark briefing is: a rule competes with everything
// else in the prompt, a fact does not.

function iberiaSnapshot(year) {
  return {
    year,
    byRelevance: [
      { id: 11, primaryTitle: 'Kingdom of Castile', tierKey: 'kingdom', countiesInSphere: 24, regions: ['world_europe_west_iberia'] },
      { id: 12, primaryTitle: 'Kingdom of Leon', tierKey: 'kingdom', countiesInSphere: 18, regions: ['world_europe_west_iberia'] },
      { id: 14, primaryTitle: 'Kingdom of Bengal', tierKey: 'kingdom', countiesInSphere: 9, regions: ['world_india_bengal'] },
    ],
  };
}

{
  const fit = applicableMoments(iberiaSnapshot(1205), 1205);
  check(
    'B1. both Iberian moments fit a 1205 peninsula',
    fit.length === 2 && fit.map((f) => f.key).sort().join(',') === 'almohad_decline,iberian_union',
    fit.map((f) => f.key).join(', '),
  );
}

{
  const text = momentBriefing(iberiaSnapshot(1205), 1205);
  check(
    'B2. the briefing names the candidate realms by id, not just the moment',
    /11 Kingdom of Castile/.test(text) && /12 Kingdom of Leon/.test(text) && /historical_moment rather than as a bare grant_claim/.test(text),
    'ids and the instruction both present',
  );
  check(
    'B3. and it does not offer realms from another region as candidates',
    !/Bengal/.test(text),
    'Bengal is in the snapshot and correctly absent from an Iberian moment',
  );
}

{
  // Out of window, so nothing fits and the section disappears rather than
  // announcing its own emptiness.
  const text = momentBriefing(iberiaSnapshot(700), 700);
  check(
    'B4. nothing fits in 700, and the briefing is empty rather than noisy',
    text === '' && applicableMoments(iberiaSnapshot(700), 700).length === 0,
    'empty string, so the prompt section is omitted entirely',
  );
}

{
  // A moment needs someone to act and someone to act upon.
  const lonely = {
    year: 1205,
    byRelevance: [
      { id: 11, primaryTitle: 'Kingdom of Castile', tierKey: 'kingdom', countiesInSphere: 24, regions: ['world_europe_west_iberia'] },
    ],
  };
  check(
    'B5. one realm in the region is not enough for a moment to fit',
    applicableMoments(lonely, 1205).length === 0,
    'an actor with nobody to act upon is not a moment',
  );
}

{
  // Unoffered moments must never appear in the briefing, for the same reason
  // they are absent from the enum.
  const arabia = {
    year: 1258,
    byRelevance: [
      { id: 21, primaryTitle: 'Abbasid Caliphate', tierKey: 'empire', countiesInSphere: 20, regions: ['world_middle_east_arabia'] },
      { id: 22, primaryTitle: 'Ilkhanate', tierKey: 'empire', countiesInSphere: 30, regions: ['world_middle_east_arabia'] },
    ],
  };
  check(
    'B6. a declared but unoffered moment is never briefed',
    applicableMoments(arabia, 1258).every((f) => f.key !== 'abbasid_twilight'),
    'abbasid_twilight is in the table, in window, with candidates present, and still not offered',
  );
}

// --- geography arriving before the realms ------------------------------------
// The mod emits realm_in_region from inside each region's sweep, and the realm
// lines afterwards from a single pass over the collected set. So the geography
// arrives first, a lookup on arrival found an empty list every time, and all of
// it was silently dropped: a live snapshot carried 966 such records and not one
// reached a realm. Every action that asks where a realm is fell back to
// culture - the proxy the geography was added to replace - and
// historical_moment, which refuses rather than falling back, could never be
// proposed at all.

/** Feed records in the order the game actually emits them. */
function snapshotWithGeography({ regionsFirst = true } = {}) {
  const a = new SnapshotAssembler();
  const feed = (line) => {
    const rec = parseLine('[00:00:00][effect.cpp:1]: ' + line);
    return rec ? a.ingest(rec) : null;
  };
  // With their tier records, as a real snapshot always carries them: the
  // toolkit refuses rather than guesses when the script-derived tier is absent.
  const realms = [
    'HD:/;/realm/;/11/;/Alfonso/;/Kingdom of Castile/;/Kingdom/;/24/;/Castilian/;/Catholic/;/Burgos/;/Jimena/;/House Jimena/;/yes/;/Feudal',
    'HD:/;/realm_tier/;/11/;/kingdom',
    'HD:/;/realm/;/12/;/Fernando/;/Kingdom of Leon/;/Kingdom/;/18/;/Castilian/;/Catholic/;/Leon/;/Jimena/;/House Jimena/;/yes/;/Feudal',
    'HD:/;/realm_tier/;/12/;/kingdom',
  ];
  const regions = [
    'HD:/;/realm_in_region/;/11/;/world_europe_west_iberia',
    'HD:/;/realm_in_region/;/12/;/world_europe_west_iberia',
    'HD:/;/realm_in_region/;/12/;/world_africa_north_west',
  ];

  feed('HD:/;/snapshot_begin/;/90/;/1205.1.1/;/439000/;/11');
  for (const l of regionsFirst ? [...regions, ...realms] : [...realms, ...regions]) feed(l);
  return feed('HD:/;/snapshot_end/;/90').snapshot;
}

{
  const snap = snapshotWithGeography({ regionsFirst: true });
  const castile = snap.realmsById.get(11);
  const leon = snap.realmsById.get(12);
  check(
    'G1. geography emitted before the realm lines still reaches the realms',
    Array.isArray(castile.regions) && castile.regions.includes('world_europe_west_iberia')
      && Array.isArray(leon.regions) && leon.regions.length === 2,
    'Castile ' + JSON.stringify(castile.regions) + ', Leon ' + JSON.stringify(leon.regions),
  );
}

{
  // Order must not matter in either direction, so a later change to the mod's
  // emission order cannot quietly break this again.
  const snap = snapshotWithGeography({ regionsFirst: false });
  check(
    'G2. and so does geography emitted after them',
    snap.realmsById.get(11).regions?.includes('world_europe_west_iberia') === true,
    'buffered either way',
  );
}

{
  // The consequence that mattered: with geography present, historical_moment
  // can be proposed at all. Without it the action refuses outright.
  const snap = snapshotWithGeography();
  snap.year = 1205;
  for (const r of snap.realms) r.inNeighbourhood = true;
  const r = validateProposal(
    { action: 'historical_moment', args: { moment: 'iberian_union', actor: 11, target: 12 } },
    snap,
    null,
  );
  check(
    'G3. and historical_moment can now be proposed against a real snapshot',
    r.ok,
    r.ok ? 'validates against geography from the wire' : 'REJECTED: ' + r.error,
  );
}

// --- what claiming a primary title actually takes -----------------------------
// A live proposal described itself, in one sentence, as both "the empire-tier
// title the Mu'minid Empire" and as a claim "which at kingdom tier carries its
// de jure vassals with it". The second half was hardcoded. Understating what
// approval does is the one failure the approval gate exists to prevent, and the
// target there held 97 counties.

function tierPair(targetTier) {
  return {
    year: 1205,
    realmsById: new Map([
      [1, { id: 1, tag: 0, ruler: 'Alfonso', primaryTitle: 'Kingdom of Castile', tierKey: 'kingdom', inNeighbourhood: true, regions: ['world_europe_west_iberia'] }],
      [2, { id: 2, tag: 1, ruler: 'an-Nasir', primaryTitle: 'the Muminid Empire', tierKey: targetTier, inNeighbourhood: true, regions: ['world_europe_west_iberia'] }],
    ]),
  };
}
const stage = (moment, st) => validateProposal({ action: 'historical_moment', args: { moment, actor: 1, target: 2 } }, st, null);

{
  const r = stage('almohad_decline', tierPair('empire'));
  check(
    'T1. a moment aimed above its declared rank is refused, and says what that would take',
    !r.ok && /whole empire in one war/.test(r.error) && /kingdom-tier realm at most/.test(r.error),
    r.ok ? 'ACCEPTED a claim on a 97-county empire' : r.error.slice(0, 120),
  );
}

{
  const r = stage('almohad_decline', tierPair('kingdom'));
  check(
    'T2. and permitted once the collapse has produced a kingdom-sized piece',
    r.ok && /carries its de jure vassals with it/.test(r.preview),
    r.ok ? 'permitted, preview states kingdom tier' : r.error,
  );
}

{
  // The preview must track the target rather than assume one.
  const duchy = tierPair('duchy');
  const r = stage('iberian_union', duchy);
  check(
    'T3. the preview states the tier the target actually holds',
    r.ok && /a single duchy and the counties under it/.test(r.preview) && !/at kingdom tier/.test(r.preview),
    r.ok ? r.preview.match(/primary title - ([^-]+) -/)?.[1]?.trim() : r.error,
  );
}

{
  // Fail closed where the tier is unknown: without it the Director cannot say
  // what a claim would carry, and the preview must not invent an answer.
  const unknown = tierPair(null);
  const r = stage('iberian_union', unknown);
  check(
    'T4. an unknown target tier is refused rather than guessed',
    !r.ok && /no script-derived tier/.test(r.error),
    r.error.slice(0, 110),
  );
}

// --- the same effect under a second name --------------------------------------
// The guard first fingerprinted the verb. Alfonso VIII had been granted a
// pressed claim on Leon six times as grant_claim, and historical_moment
// proposed a seventh because it is spelled differently - both grant a pressed
// claim on the same title, and the war chest beside it is not a no-op.

{
  const { book, file } = ledger();
  book.record({ date: '7 Jan 1201', year: 1201, verdict: 'approved', action: 'grant_claim', args: { actor: 1, target: 2 }, summary: 'Alfonso -> Leon' });
  const repeat = book.approvedMatch('historical_moment', { moment: 'iberian_union', actor: 1, target: 2 }, 1205);
  check(
    'T5. a moment repeating a claim already granted is caught across action names',
    repeat !== null && repeat.date === '7 Jan 1201',
    repeat ? 'matched the grant_claim of ' + repeat.date : 'MISSED, which is the seventh claim',
  );
  fs.rmSync(file, { force: true });
}

{
  // But only where the effect really is the same. iberian_pressure grants
  // truces, alliances and hooks, and is not a pressed claim by another name.
  const { book, file } = ledger();
  book.record({ date: '7 Jan 1201', year: 1201, verdict: 'approved', action: 'grant_claim', args: { actor: 1, target: 2 }, summary: 'x' });
  check(
    'T6. and actions with genuinely different effects are still separate',
    book.approvedMatch('iberian_pressure', { unifier: 1, partners: [2] }, 1205) === null
      && book.approvedMatch('set_relations', { actor: 1, target: 2 }, 1205) === null,
    'grouping is by effect, not by convenience',
  );
  fs.rmSync(file, { force: true });
}

// --- wars the Director could not see -----------------------------------------
// The snapshot carried rank, size, culture, faith and geography, and not the
// one fact that decides whether a claim means anything: who is already
// fighting. County counts change only once a war has been *won*, so Castile and
// Leon sat at 16 and 14 counties from July 1205 to March 1206 and the Director
// read a peninsula mid-campaign as a peninsula at rest.

/** Castile attacking Leon, in the four-field shape the mod emits. */
const WAR = 'HD:/;/war/;/501/;/11/;/12/;/Claim on the Kingdom of Leon';

/** A snapshot with two realms and whatever wars a case needs. */
function snapshotWithWars(warLines = []) {
  const a = new SnapshotAssembler();
  const feed = (line) => {
    const rec = parseLine('[00:00:00][effect.cpp:1]: ' + line);
    return rec ? a.ingest(rec) : null;
  };
  feed('HD:/;/snapshot_begin/;/91/;/1205.7.12/;/440000/;/11');
  feed('HD:/;/realm/;/11/;/Alfonso/;/Kingdom of Castile/;/Kingdom/;/16/;/Castilian/;/Catholic/;/Burgos/;/Jimena/;/House Jimena/;/yes/;/Feudal');
  feed('HD:/;/realm/;/12/;/Alfonso IX/;/Kingdom of Leon/;/Kingdom/;/14/;/Castilian/;/Catholic/;/Leon/;/Jimena/;/House Jimena/;/yes/;/Feudal');
  feed('HD:/;/realm_tier/;/11/;/kingdom');
  feed('HD:/;/realm_tier/;/12/;/kingdom');
  feed('HD:/;/realm_in_region/;/11/;/world_europe_west_iberia');
  feed('HD:/;/realm_in_region/;/12/;/world_europe_west_iberia');
  for (const w of warLines) feed(w);
  const snap = feed('HD:/;/snapshot_end/;/91').snapshot;
  for (const r of snap.realms) r.inNeighbourhood = true;
  return snap;
}

{
  const snap = snapshotWithWars([WAR]);
  check(
    'W1. a war reported over the wire reaches the snapshot',
    snap.wars.length === 1 && snap.wars[0].attacker === 11 && snap.wars[0].defender === 12
      && snap.wars[0].name === 'Claim on the Kingdom of Leon',
    JSON.stringify(snap.wars[0] ?? null),
  );
}

{
  // The same war arrives once per belligerent inside the sphere, by design:
  // emitting from both sides is what lets a war be seen when only one of its
  // belligerents is somewhere the Director is looking. The war id is what makes
  // that affordable.
  const snap = snapshotWithWars([WAR, WAR]);
  check(
    'W1b. the same war reported from both sides is counted once',
    snap.wars.length === 1,
    `${snap.wars.length} war(s) after two records for war 501`,
  );
}

{
  // A field the game cannot resolve comes back as the literal "ERROR:[...]"
  // rather than as a failure - which is exactly what the first version of this
  // script produced, thirty times, before anyone knew it had. A war nobody can
  // identify is worse than no war, because it would read as a fact.
  const snap = snapshotWithWars([
    'HD:/;/war/;/502/;/ERROR:[scope:hd_belligerent.Char.GetID]/;/12/;/ERROR:[scope:hd_war.War.GetName]',
  ]);
  check(
    'W1c. a record the game could not fill in is dropped, not half-believed',
    snap.wars.length === 0,
    JSON.stringify(snap.wars),
  );
}

{
  // Direction-insensitive: the question is whether these two are fighting, and
  // which of them declared does not change the answer.
  const snap = snapshotWithWars([WAR]);
  check(
    'W2. warBetween answers in either direction, and stays silent otherwise',
    snap.warBetween(11, 12) !== null && snap.warBetween(12, 11) !== null && snap.warBetween(11, 99) === null,
    'both directions matched, unrelated pair did not',
  );
}

{
  // The reason this was built. A claim cannot start a war against someone you
  // are already fighting, so the claim sits idle - but 1000 gold, 1000 prestige
  // and a 30-year war modifier land immediately, on a belligerent, mid-campaign.
  const snap = snapshotWithWars([WAR]);
  const r = validateProposal(
    { action: 'grant_claim', args: { actor: 11, target: 12, momentum: 'none' } },
    snap,
    null,
  );
  check(
    'W3. a claim between two realms already at war is refused',
    !r.ok && /already at war/.test(r.error) && /war chest/.test(r.error),
    r.ok ? 'ACCEPTED, granting a war chest mid-war' : r.error.slice(0, 130),
  );
}

{
  const snap = snapshotWithWars(['HD:/;/war/;/503/;/12/;/11/;/Claim on the Kingdom of Castile']);
  const r = validateProposal(
    { action: 'historical_moment', args: { moment: 'iberian_union', actor: 11, target: 12 } },
    snap,
    null,
  );
  check(
    'W4. and so is a curated moment, including when the target is the attacker',
    !r.ok && /already at war/.test(r.error),
    r.ok ? 'ACCEPTED' : r.error.slice(0, 110),
  );
}

{
  // The guard must not become a blanket refusal. A war elsewhere says nothing
  // about this pair.
  const snap = snapshotWithWars(['HD:/;/war/;/504/;/11/;/77/;/Claim on somewhere else']);
  const r = validateProposal(
    { action: 'historical_moment', args: { moment: 'iberian_union', actor: 11, target: 12 } },
    snap,
    null,
  );
  check(
    'W5. a war against a third party does not block the pair',
    r.ok,
    r.ok ? 'still proposable' : 'OVER-REFUSED: ' + r.error,
  );
}

{
  // Fails open where wars are not reported at all. A mod too old to emit them
  // leaves no war list, and refusing every claim on that basis would break the
  // toolkit for anyone who has not redeployed.
  const snap = snapshotWithWars();
  const noWars = { ...snap, warBetween: undefined };
  const r = validateProposal(
    { action: 'grant_claim', args: { actor: 11, target: 12, momentum: 'none' } },
    noWars,
    null,
  );
  check(
    'W6. silence about wars is treated as "not observed", not as "no wars"',
    r.ok,
    r.ok ? 'old mod still works' : 'BROKE the old-mod path: ' + r.error,
  );
}

{
  // A ruler fighting on two fronts is not short of a casus belli, and the
  // prompt says so per realm rather than making the model scan the list.
  const snap = snapshotWithWars([
    WAR,
    'HD:/;/war/;/505/;/77/;/11/;/Claim on the Kingdom of Castile',
  ]);
  check(
    'W7. warsOf finds a realm on both sides of the list',
    snap.warsOf(11).length === 2 && snap.warsOf(12).length === 1 && snap.warsOf(5).length === 0,
    'Castile in 2 wars, Leon in 1, a bystander in none',
  );
}

{
  // The emitted script has to be the script the game will actually run. Every
  // name in it was checked against the game files first, because an unknown
  // data function inside a quoted debug_log produces an unparseable line rather
  // than an error - the failure class that once meant snapshots never arrived.
  const lines = snapshotScript(['world_europe_west_iberia'], 90, ['world_europe_west_iberia']).join('\n');
  check(
    'W8. the snapshot script reads every war field off the war itself',
    /every_character_war = \{/.test(lines)
      && !/save_scope_as = hd_belligerent/.test(lines)
      && !/scope:hd_war/.test(lines)
      && /HD:\/;\/war\/;\/\[THIS\.War\.GetID\]\/;\/\[THIS\.War\.GetActiveCB\.GetAttacker\.GetID\]\/;\/\[THIS\.War\.GetActiveCB\.GetDefender\.GetID\]\/;\/\[THIS\.War\.GetName\]/.test(lines),
    lines.split('\n').filter((l) => /war/i.test(l)).map((l) => l.trim()).join(' | ').slice(0, 200) || 'no war lines emitted',
  );
}

// --- war names as the game actually returns them -----------------------------
// War.GetName returns the string the game would render in its UI, not the one
// it would show a reader. A live probe of 128 wars came back full of click
// targets and tooltip bindings: instructions to a renderer that does not exist
// here, which would otherwise reach the model as part of the war's name.

{
  const raw = 'ONCLICK:TITLE,11849 TOOLTIP:LANDED_TITLE,11849 L; Tsang!!! Claim on the ONCLICK:TITLE,11773 TOOLTIP:LANDED_TITLE,11773 L; Duchy of Yarlung!!!';
  check(
    'W9. markup is stripped and every word between it is kept',
    cleanWarName(raw) === 'Tsang Claim on the Duchy of Yarlung',
    cleanWarName(raw),
  );
}

{
  // The other shape the probe returned: a game-concept tooltip rather than a
  // title link, and a two-bang span terminator rather than three.
  const raw = 'E; TOOLTIP:GAME_CONCEPT,holy_war Holy War!! for the ONCLICK:TITLE,3177 TOOLTIP:LANDED_TITLE,3177 L; Kingdom of Lithuania!!!';
  check(
    'W10. and concept tooltips go the same way',
    cleanWarName(raw) === 'Holy War for the Kingdom of Lithuania',
    cleanWarName(raw),
  );
}

{
  // Most war names carry no markup at all, and must come through untouched.
  check(
    'W11. a plain name is left exactly as it was',
    cleanWarName('Independence War') === 'Independence War'
      && cleanWarName('Buryat Daoxue Nomadic Uprising') === 'Buryat Daoxue Nomadic Uprising',
    'unchanged',
  );
}

{
  // Conservative by design: an unrecognised marker should leave an odd name
  // rather than an empty one, because an empty name reads as "no war name" and
  // that is a different claim.
  check(
    'W12. an unfamiliar marker degrades to an odd name, never to nothing',
    cleanWarName('WHATSIT:THING,4 Siege of Zaragoza') === 'WHATSIT:THING,4 Siege of Zaragoza'
      && cleanWarName('') === '',
    cleanWarName('WHATSIT:THING,4 Siege of Zaragoza'),
  );
}

try { fs.unlinkSync(tmp); } catch { /* already gone */ }
