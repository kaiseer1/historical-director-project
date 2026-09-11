/**
 * The war grammar, exercised against synthetic snapshots.
 *
 * DRAFT, alongside director/warKinds.js. These are the cases that decide
 * whether the map is really the binding constraint or whether it only looks
 * like one - so most of them are refusals, and the two that matter most are the
 * ones where a field is missing rather than false.
 *
 *   node scripts/check-war-kinds.mjs
 */
import { KINDS, KIND_KEYS, legalKinds, kindBriefing } from '../src/director/warKinds.js';

let passed = 0;
let failed = 0;

/** @param {string} name @param {boolean} ok @param {string} [detail] */
function check(name, ok, detail = '') {
  if (ok) { passed += 1; console.log(`PASS  ${name}`); } else { failed += 1; console.log(`FAIL  ${name}`); }
  if (detail) console.log(`      ${detail}`);
}

/** A realm with sane defaults, so each case states only what it is about. */
function realm(over = {}) {
  return {
    id: 1,
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

/** @param {any[]} realms */
function snapshot(realms, wars = []) {
  return { realmsById: new Map(realms.map((r) => [r.id, r])), wars };
}

const ctx = (attacker, defender, extra = {}) => ({
  state: snapshot([attacker, defender, ...(extra.others ?? [])], extra.wars ?? []),
  attacker,
  defender,
  baseline: extra.baseline ?? null,
});

// --------------------------------------------------------------------------
console.log('\nReconquest - a faith boundary on shared ground\n');

{
  const a = realm({ id: 1, faith: 'Catholic' });
  const b = realm({ id: 2, faith: 'Sunni', primaryTitle: 'Taifa of Qurtubah' });
  check('R1. faith differs and both stand in Iberia', KINDS.reconquest.legal(ctx(a, b)) === null);
}
{
  const a = realm({ id: 1, faith: 'Catholic' });
  const b = realm({ id: 2, faith: 'Catholic' });
  const why = KINDS.reconquest.legal(ctx(a, b));
  check('R2. same faith is refused, and says so', /faith boundary/.test(why ?? ''), why ?? '');
}
{
  // The case that matters most. A truncated log costs the faith field, and a
  // missing field must never read as a difference: unknown is not permission.
  const a = realm({ id: 1, faith: '' });
  const b = realm({ id: 2, faith: 'Sunni' });
  const why = KINDS.reconquest.legal(ctx(a, b));
  check('R3. a MISSING faith is refused, not treated as a difference',
    /does not carry/.test(why ?? ''), why ?? '');
}
{
  const a = realm({ id: 1, faith: 'Catholic', regions: ['world_europe_west_iberia'] });
  const b = realm({ id: 2, faith: 'Sunni', regions: ['world_india'] });
  const why = KINDS.reconquest.legal(ctx(a, b));
  check('R4. realms sharing no ground cannot fight a border war',
    /common region/.test(why ?? ''), why ?? '');
}

// --------------------------------------------------------------------------
console.log('\nSuccession - a shared line, which no argument can invent\n');

{
  const a = realm({ id: 1, house: 'House of Jimena' });
  const b = realm({ id: 2, house: 'House of Jimena', ruler: 'A cousin' });
  check('S1. a shared house permits it', KINDS.succession.legal(ctx(a, b)) === null);
}
{
  const a = realm({ id: 1, house: 'House of Jimena', dynasty: 'Jimena' });
  const b = realm({ id: 2, house: 'House of Hauteville', dynasty: 'Hauteville' });
  const why = KINDS.succession.legal(ctx(a, b));
  check('S2. unrelated lines are refused by name', /shared line/.test(why ?? ''), why ?? '');
}
{
  const a = realm({ id: 1, house: '', dynasty: '' });
  const b = realm({ id: 2, house: '', dynasty: '' });
  const why = KINDS.succession.legal(ctx(a, b));
  check('S3. two realms with no reported line do not match each other',
    /does not carry/.test(why ?? ''), why ?? '');
}

// --------------------------------------------------------------------------
console.log('\nIntervention - a war that already exists\n');

{
  const a = realm({ id: 1 });
  const b = realm({ id: 2 });
  const why = KINDS.intervention.legal(ctx(a, b, { wars: [] }));
  check('I1. no war under way is refused', /at peace/.test(why ?? ''), why ?? '');
}
{
  const a = realm({ id: 1 });
  const b = realm({ id: 2 });
  check('I2. a war the defender is in permits it',
    KINDS.intervention.legal(ctx(a, b, { wars: [{ id: 9, attacker: 3, defender: 2 }] })) === null);
}
{
  // A mod too old to emit wars leaves them undefined. "Not observed" and "no
  // war" are the same silence, and only one of them is permission.
  const a = realm({ id: 1 });
  const b = realm({ id: 2 });
  const state = { realmsById: new Map([[1, a], [2, b]]) };
  const why = KINDS.intervention.legal({ state, attacker: a, defender: b, baseline: null });
  check('I3. a snapshot that reports no wars at all is refused, not read as peace',
    /does not report them/.test(why ?? ''), why ?? '');
}

// --------------------------------------------------------------------------
console.log('\nCoalition - the hegemon case, measured rather than argued\n');

{
  const hegemon = realm({ id: 2, countiesInSphere: 40, primaryTitle: 'Empire of Hispania' });
  const small1 = realm({ id: 3, countiesInSphere: 8 });
  const small2 = realm({ id: 4, countiesInSphere: 6 });
  const a = realm({ id: 1, countiesInSphere: 7 });
  check('C1. a realm 5x its neighbours draws a coalition',
    KINDS.coalition.legal(ctx(a, hegemon, { others: [small1, small2] })) === null);
}
{
  const peer = realm({ id: 2, countiesInSphere: 12, primaryTitle: 'Kingdom of Leon' });
  const other1 = realm({ id: 3, countiesInSphere: 10 });
  const other2 = realm({ id: 4, countiesInSphere: 11 });
  const a = realm({ id: 1, countiesInSphere: 9 });
  const why = KINDS.coalition.legal(ctx(a, peer, { others: [other1, other2] }));
  check('C2. an ordinary large neighbour does not, and the ratio is quoted',
    /out of all proportion/.test(why ?? '') && /x the median/.test(why ?? ''), why ?? '');
}
{
  const hegemon = realm({ id: 2, countiesInSphere: 40 });
  const a = realm({ id: 1, countiesInSphere: 7 });
  const why = KINDS.coalition.legal(ctx(a, hegemon));
  check('C3. a power with fewer than two neighbours has no coalition to raise',
    /fewer than two/.test(why ?? ''), why ?? '');
}

// --------------------------------------------------------------------------
console.log('\nRestoration - the footprint signal, finally actionable\n');

{
  const a = realm({ id: 1, primaryTitle: 'Kingdom of Leon' });
  const b = realm({ id: 2 });
  const baseline = { delta: () => ({ known: true, lost: 'down 9 of 14 counties', label: '= Kingdom, down 9 of 14 counties' }) };
  check('T1. a realm that has demonstrably lost ground may try to recover it',
    KINDS.restoration.legal(ctx(a, b, { baseline })) === null);
}
{
  const a = realm({ id: 1 });
  const b = realm({ id: 2 });
  const baseline = { delta: () => ({ known: true, lost: null, label: '= Kingdom' }) };
  const why = KINDS.restoration.legal(ctx(a, b, { baseline }));
  check('T2. a realm that has lost nothing is refused, quoting its own column',
    /ground actually lost/.test(why ?? ''), why ?? '');
}
{
  const a = realm({ id: 1 });
  const b = realm({ id: 2 });
  const why = KINDS.restoration.legal(ctx(a, b, { baseline: null }));
  check('T3. no baseline is a refusal, never a default permit',
    /there is none yet/.test(why ?? ''), why ?? '');
}

// --------------------------------------------------------------------------
console.log('\nThe grammar as a whole\n');

{
  const a = realm({ id: 1, faith: 'Catholic' });
  const b = realm({ id: 2, faith: 'Sunni', house: 'House of Abbad', dynasty: 'Abbadid' });
  const { legal, refused } = legalKinds(ctx(a, b));
  check('G1. a Catholic/Muslim border pair supports reconquest and nothing it should not',
    legal.includes('reconquest') && !legal.includes('succession') && !legal.includes('coalition'),
    `legal: ${legal.join(', ') || 'none'}`);
  check('G2. every refusal carries a reason',
    Object.values(refused).every((r) => typeof r === 'string' && r.length > 20),
    `${Object.keys(refused).length} refused, all with stated cause`);
}
{
  // A grammar that throws on a malformed snapshot must not read as one that
  // permits. Same rule validate follows for a proposal it cannot parse.
  const { legal, refused } = legalKinds({ state: null, attacker: null, defender: null, baseline: null });
  check('G3. a snapshot that cannot be judged yields no legal kind',
    legal.length === 0 && Object.keys(refused).length === KIND_KEYS.length,
    'unjudgeable is refused, never permitted');
}
{
  const a = realm({ id: 1, faith: 'Catholic', primaryTitle: 'Kingdom of Castile' });
  const b = realm({ id: 2, faith: 'Sunni', primaryTitle: 'Taifa of Qurtubah' });
  const brief = kindBriefing(ctx(a, b));
  check('G4. the briefing shows what fits rather than listing what exists',
    brief.includes('reconquest') && !brief.includes('coalition'),
    brief.split('\n')[0]);
}
{
  check('G5. every kind names a casus belli and two modifiers to be built',
    KIND_KEYS.every((k) => KINDS[k].cb && KINDS[k].attackerModifier !== undefined),
    KIND_KEYS.map((k) => KINDS[k].cb).join(', '));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
