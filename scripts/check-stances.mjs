/**
 * The stance engine, exercised against synthetic snapshots.
 *
 * The scenario that matters most is the last one, and it is the project owner's
 * own campaign: a Muslim taifa in Iberia winning, and the Christian kingdoms
 * around it having something to say about that. If the engine cannot produce
 * "Castile is alarmed, and here is the map-derived reason", nothing else here
 * is worth much.
 *
 *   node scripts/check-stances.mjs
 */
import { stanceToward, dispatches, stanceBriefing } from '../src/director/stances.js';

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
    ruler: 'Someone',
    primaryTitle: 'Kingdom of Somewhere',
    tierKey: 'kingdom',
    countiesInSphere: 10,
    culture: 'Castilian',
    faith: 'Catholic',
    independent: true,
    regions: ['world_europe_west_iberia'],
    inNeighbourhood: true,
    ...over,
  };
}

/** A baseline whose delta is driven by a table of primaryTitle -> lost string. */
function baselineWith(losses = {}) {
  return {
    delta(r) {
      const lost = losses[r?.primaryTitle];
      if (lost === undefined) return { known: false, lost: null, label: 'no baseline' };
      return { known: true, lost: lost || null, label: lost ? `= Kingdom, ${lost}` : '= Kingdom' };
    },
  };
}

function snapshot(player, others, opts = {}) {
  const all = [player, ...others];
  return {
    player,
    playerId: player.id,
    realmsById: new Map(all.map((r) => [r.id, r])),
    wars: opts.wars ?? [],
    warBetween: opts.warBetween ?? (() => null),
  };
}

// --------------------------------------------------------------------------
console.log('\nSilence where silence is honest\n');

{
  const p = realm({ id: 1 });
  const s = snapshot(p, []);
  check('N1. the player holds no stance toward themself',
    stanceToward({ state: s, observer: p, player: p }) === null);
}
{
  const p = realm({ id: 1 });
  const far = realm({ id: 2, regions: ['world_india'], inNeighbourhood: false });
  const s = snapshot(p, [far]);
  check('N2. a distant realm with no reason to care says nothing',
    stanceToward({ state: s, observer: far, player: p }) === null,
    'a world where every realm has a feeling about you is as unconvincing as one where none does');
}
{
  // Unknown is not a stance. A faith lost to log truncation must not manufacture
  // a religious grievance.
  const p = realm({ id: 1, faith: '' });
  const o = realm({ id: 2, faith: 'Sunni', countiesInSphere: 10 });
  const st = stanceToward({ state: snapshot(p, [o]), observer: o, player: p });
  check('N3. a MISSING faith produces no faith-based stance',
    st !== null && !/are Sunni|are you/.test(st.evidence.join(' ')) && st.key !== 'alarmed',
    `stance: ${st?.key}, evidence: ${st?.evidence.join('; ') || 'none'}`);
}

// --------------------------------------------------------------------------
console.log('\nPower, read off the map\n');

{
  const p = realm({ id: 1, countiesInSphere: 40 });
  const o = realm({ id: 2, countiesInSphere: 8 });
  const st = stanceToward({ state: snapshot(p, [o]), observer: o, player: p });
  check('P1. a small neighbour beside a dominant player is threatened',
    st?.key === 'threatened', `${st?.label}: ${st?.evidence.join('; ')}`);
}
{
  const p = realm({ id: 1, countiesInSphere: 5 });
  const o = realm({ id: 2, countiesInSphere: 30 });
  const st = stanceToward({ state: snapshot(p, [o]), observer: o, player: p });
  check('P2. a much larger neighbour is opportunistic, not threatened',
    st?.key === 'opportunistic', `${st?.label}: ${st?.evidence.join('; ')}`);
}
{
  const p = realm({ id: 1, countiesInSphere: 11 });
  const o = realm({ id: 2, countiesInSphere: 10 });
  const st = stanceToward({ state: snapshot(p, [o]), observer: o, player: p });
  check('P3. a peer next door is merely watchful',
    st?.key === 'watchful', `${st?.label}`);
}
{
  // A large co-religionist with no tide behind them is still just a large
  // neighbour. Faith alone emboldens nobody - the first version of this fired
  // on size and shared faith and made every small duchy beside a big empire
  // cheerful about it.
  const p = realm({ id: 1, countiesInSphere: 20, faith: 'Catholic' });
  const o = realm({ id: 2, countiesInSphere: 10, faith: 'Catholic' });
  const st = stanceToward({ state: snapshot(p, [o]), observer: o, player: p });
  check('P4. a big co-religionist with no tide behind them is not emboldening',
    st?.key === 'threatened', `${st?.label}: ${st?.evidence.join('; ')}`);
}
{
  // The mirror of Granada. Castile is the player, driving a tide that two
  // Muslim realms are on the wrong side of, and Leon takes heart from it.
  const p = realm({ id: 1, primaryTitle: 'Kingdom of Castile', faith: 'Catholic', countiesInSphere: 24 });
  const leon = realm({ id: 2, primaryTitle: 'Kingdom of Leon', faith: 'Catholic', countiesInSphere: 12 });
  const cordoba = realm({ id: 3, primaryTitle: 'Taifa of Qurtubah', faith: 'Ashari', countiesInSphere: 5 });
  const sevilla = realm({ id: 4, primaryTitle: 'Taifa of Ishbiliyah', faith: 'Ashari', countiesInSphere: 4 });
  const baseline = baselineWith({
    'Taifa of Qurtubah': 'down 7 of 12 counties',
    'Taifa of Ishbiliyah': 'down 5 of 9 counties',
    'Kingdom of Leon': '',
  });
  const st = stanceToward({
    state: snapshot(p, [leon, cordoba, sevilla]), observer: leon, player: p, baseline,
  });
  check('P5. a co-religionist IS emboldened when a tide is running their way',
    st?.key === 'emboldened' && /2 realms of other faiths have lost ground/.test(st.evidence.join(' ')),
    `${st?.label}: ${st?.evidence.slice(-1)[0]}`);
}

// --------------------------------------------------------------------------
console.log('\nWar outranks everything but the tide\n');

{
  const p = realm({ id: 1, countiesInSphere: 40 });
  const o = realm({ id: 2, countiesInSphere: 8 });
  const war = { id: 7, attacker: 1, defender: 2, name: 'The Conquest of Somewhere' };
  const st = stanceToward({
    state: snapshot(p, [o], { warBetween: () => war }),
    observer: o,
    player: p,
  });
  check('W1. a realm at war with you judges everything through that',
    st?.key === 'at_war' && /Conquest of Somewhere/.test(st.evidence.join(' ')),
    `${st?.label}: ${st?.evidence.join('; ')}`);
}
{
  // A mod too old to report wars leaves warBetween absent. That is "not
  // observed", not "at peace", and it must not throw.
  const p = realm({ id: 1, countiesInSphere: 40 });
  const o = realm({ id: 2, countiesInSphere: 8 });
  const s = { player: p, playerId: 1, realmsById: new Map([[1, p], [2, o]]) };
  const st = stanceToward({ state: s, observer: o, player: p });
  check('W2. a snapshot that reports no wars at all still yields a stance',
    st?.key === 'threatened', `${st?.label}`);
}

// --------------------------------------------------------------------------
console.log('\nThe tide - Granada reversing the Reconquista\n');

{
  // 1225 Iberia, the campaign this project was built inside. A Muslim taifa has
  // been winning for years and three Christian realms are smaller than they
  // were. No single proposal contains that sentence; the baseline does.
  const granada = realm({
    id: 1, ruler: 'Muhammad I', primaryTitle: 'Taifa of Ghirnatah',
    faith: 'Ashari', culture: 'Andalusian', countiesInSphere: 22,
  });
  const castile = realm({
    id: 2, ruler: 'Fernando III', primaryTitle: 'Kingdom of Castile',
    faith: 'Catholic', countiesInSphere: 14,
  });
  const leon = realm({ id: 3, ruler: 'Alfonso IX', primaryTitle: 'Kingdom of Leon', faith: 'Catholic', countiesInSphere: 9 });
  const portugal = realm({ id: 4, ruler: 'Sancho II', primaryTitle: 'Kingdom of Portugal', faith: 'Catholic', countiesInSphere: 8 });
  const aragon = realm({ id: 5, ruler: 'Jaime I', primaryTitle: 'Kingdom of Aragon', faith: 'Catholic', countiesInSphere: 12 });

  const baseline = baselineWith({
    'Kingdom of Castile': 'down 6 of 20 counties',
    'Kingdom of Leon': 'down 5 of 14 counties',
    'Kingdom of Portugal': 'down 3 of 11 counties',
    'Kingdom of Aragon': '',
  });

  const state = snapshot(granada, [castile, leon, portugal, aragon]);
  const st = stanceToward({ state, observer: castile, player: granada, baseline });

  check('G1. Castile is ALARMED, not merely threatened',
    st?.key === 'alarmed', `${st?.label}: ${st?.posture}`);

  check('G2. and the reason is the tide, not the border',
    /3 realms of their faith have lost ground/.test(st?.evidence.join(' ') ?? ''),
    st?.evidence.find((e) => /realms of their faith/.test(e)) ?? 'MISSING');

  check('G3. it names which realms, so the player can check it',
    /Kingdom of Castile/.test(st?.evidence.join(' ') ?? '')
      && /Kingdom of Leon/.test(st?.evidence.join(' ') ?? ''),
    'a stance the player cannot audit is one the model might as well have invented');

  // Aragon has lost nothing, but the tide is about its FAITH, not about itself.
  // That is the point: a realm can be alarmed by something that has not
  // happened to it yet.
  const aragonStance = stanceToward({ state, observer: aragon, player: granada, baseline });
  check('G4. Aragon is alarmed too, though it has lost nothing itself',
    aragonStance?.key === 'alarmed',
    'the tide is a fact about a faith, not about one realm\'s borders');

  const list = dispatches({ state, baseline });
  check('G5. the dispatch list leads with the strongest feeling',
    list.length >= 3 && list[0].stance.key === 'alarmed',
    list.map((d) => `${d.realm.primaryTitle}: ${d.stance.label}`).join(', '));

  console.log('\n--- what the prompt would carry ---\n');
  console.log(stanceBriefing({ state, baseline }));
  console.log('');
}

{
  // The same peninsula before anything has moved. Nobody is alarmed, because
  // nothing has happened yet - and an engine that cannot produce a quiet world
  // cannot produce a frightening one either.
  const granada = realm({ id: 1, primaryTitle: 'Taifa of Ghirnatah', faith: 'Ashari', countiesInSphere: 6 });
  const castile = realm({ id: 2, primaryTitle: 'Kingdom of Castile', faith: 'Catholic', countiesInSphere: 20 });
  const leon = realm({ id: 3, primaryTitle: 'Kingdom of Leon', faith: 'Catholic', countiesInSphere: 14 });
  const baseline = baselineWith({ 'Kingdom of Castile': '', 'Kingdom of Leon': '' });
  const state = snapshot(granada, [castile, leon]);

  const st = stanceToward({ state, observer: castile, player: granada, baseline });
  check('G6. a taifa that has taken nothing alarms nobody',
    st?.key !== 'alarmed', `Castile is ${st?.label}`);
}

// --------------------------------------------------------------------------
console.log('\nRobustness\n');

{
  check('R1. a snapshot with no player yields no dispatches',
    dispatches({ state: { realmsById: new Map() } }).length === 0);
  check('R2. and no briefing rather than an empty heading',
    stanceBriefing({ state: { realmsById: new Map() } }) === '');
}
{
  // A baseline that throws must not take the stance engine with it.
  const p = realm({ id: 1, countiesInSphere: 40, faith: 'Ashari' });
  const o = realm({ id: 2, countiesInSphere: 8, faith: 'Catholic' });
  const bad = { delta() { throw new Error('baseline is corrupt'); } };
  let st = null;
  let threw = false;
  try { st = stanceToward({ state: snapshot(p, [o]), observer: o, player: p, baseline: bad }); } catch { threw = true; }
  check('R3. a baseline that throws degrades to a stance without it',
    !threw && st !== null, threw ? 'it threw' : `${st?.label}`);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
