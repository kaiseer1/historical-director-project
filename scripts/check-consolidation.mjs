/**
 * The consolidation band, exercised against synthetic regions.
 *
 * The case that matters is F1: the 1225 France from the screenshot that
 * prompted this - Valois, Troyes, Thouars, Auvergne and Toulon, all French,
 * all Catholic, with the crown the largest of them. If the band cannot say
 * "yes, and here is the arithmetic", the module has not earned its place.
 *
 * The case that matters nearly as much is F4, because a band that says yes to
 * everything is not a band.
 *
 *   node scripts/check-consolidation.mjs
 */
import {
  TIERS, TIER_KEYS, consolidationBand, fragmentsIn, sharedRegion, consolidationScript,
} from '../src/director/consolidation.js';

let passed = 0;
let failed = 0;

/** @param {string} name @param {boolean} ok @param {string} [detail] */
function check(name, ok, detail = '') {
  if (ok) { passed += 1; console.log(`PASS  ${name}`); } else { failed += 1; console.log(`FAIL  ${name}`); }
  if (detail) console.log(`      ${detail}`);
}

const FRANCIA = 'world_europe_west_francia';
const IBERIA = 'world_europe_west_iberia';

let nextId = 1;
function realm(over = {}) {
  return {
    id: nextId++,
    tag: 0,
    ruler: 'Someone',
    primaryTitle: 'Duchy of Somewhere',
    tierKey: 'duchy',
    countiesInSphere: 4,
    culture: 'French',
    faith: 'Catholic',
    independent: true,
    regions: [FRANCIA],
    ...over,
  };
}

function snapshot(realms) {
  return { realmsById: new Map(realms.map((r) => [r.id, r])) };
}

// --------------------------------------------------------------------------
console.log('\n1225 France - the map that prompted this\n');

{
  nextId = 1;
  const valois = realm({ primaryTitle: 'Kingdom of France', ruler: 'Louis VIII', tierKey: 'kingdom', countiesInSphere: 18 });
  const troyes = realm({ primaryTitle: 'Duchy of Troyes', countiesInSphere: 5 });
  const thouars = realm({ primaryTitle: 'Duchy of Thouars', countiesInSphere: 4 });
  const auvergne = realm({ primaryTitle: 'Duchy of Auvergne', countiesInSphere: 4 });
  const toulon = realm({ primaryTitle: 'Duchy of Toulon', countiesInSphere: 3 });
  const state = snapshot([valois, troyes, thouars, auvergne, toulon]);
  const band = consolidationBand(state, FRANCIA);

  check('F1. a shattered France supports consolidation',
    band.allowed.length > 0 && band.leader.primaryTitle === 'Kingdom of France',
    band.reason);
  check('F2. and at the strongest tier, being French and Catholic throughout',
    band.allowed.includes('paramount'),
    `allowed: ${band.allowed.join(', ')} — cohesion ${Math.round(band.cohesion * 100)}%, dominance ${band.dominance.toFixed(1)}x`);
  check('F3. the reason quotes the counts, so the player can check the arithmetic',
    /18 counties/.test(band.reason) && /median/.test(band.reason));
}

// --------------------------------------------------------------------------
console.log('\nWhere it must say no\n');

{
  // Two realms is a border, not a fragmented region.
  nextId = 1;
  const a = realm({ countiesInSphere: 20 });
  const b = realm({ countiesInSphere: 4 });
  const band = consolidationBand(snapshot([a, b]), FRANCIA);
  check('F4. two realms is a border, not a fragmentation',
    band.allowed.length === 0 && /reads as fragmentation rather than as a border/.test(band.reason),
    band.reason);
}
{
  // Five equal duchies with nobody to gather behind.
  nextId = 1;
  const peers = [5, 5, 4, 5, 4].map((n) => realm({ countiesInSphere: n }));
  const band = consolidationBand(snapshot(peers), FRANCIA);
  check('F5. five equals have no leader, however fragmented they are',
    band.allowed.length === 0 && /short of the 1.5x/.test(band.reason),
    band.reason);
}
{
  // A region of strangers. A union among these is a conquest in union's clothes.
  nextId = 1;
  const big = realm({ primaryTitle: 'Empire of Somewhere', countiesInSphere: 30, culture: 'Greek', faith: 'Orthodox' });
  const rest = [
    realm({ countiesInSphere: 5, culture: 'Norse', faith: 'Asatru' }),
    realm({ countiesInSphere: 4, culture: 'Magyar', faith: 'Tengri' }),
    realm({ countiesInSphere: 4, culture: 'Arabic', faith: 'Sunni' }),
  ];
  const band = consolidationBand(snapshot([big, ...rest]), FRANCIA);
  check('F6. a dominant realm among strangers is refused outright',
    band.allowed.length === 0 && /conquest being staged/.test(band.reason),
    band.reason);
}
{
  // But one kinsman in four is enough to open the door at the lowest tier. The
  // floor exists to exclude "nobody", not to require a majority - that is what
  // the ceiling is for.
  nextId = 1;
  const leader = realm({ primaryTitle: 'Kingdom of Leon', countiesInSphere: 20, culture: 'Castilian', faith: 'Catholic' });
  const rest = [
    realm({ countiesInSphere: 5, culture: 'Castilian', faith: 'Catholic' }),
    realm({ countiesInSphere: 5, culture: 'Andalusian', faith: 'Sunni' }),
    realm({ countiesInSphere: 4, culture: 'Basque', faith: 'Zoroastrian' }),
  ];
  const band = consolidationBand(snapshot([leader, ...rest]), FRANCIA);
  check('F6b. but one kinsman in three opens the door at the lowest tier',
    band.allowed.length === 1 && band.allowed[0] === 'stirring',
    `cohesion ${Math.round(band.cohesion * 100)}% — ${band.allowed.join(', ')}`);
}
{
  // Vassals are not fragments. A kingdom with ten dukes inside it looks
  // shattered on a political map and is not a region to be gathered.
  nextId = 1;
  const crown = realm({ primaryTitle: 'Kingdom of France', countiesInSphere: 18 });
  const vassals = [4, 4, 5, 3].map((n) => realm({ countiesInSphere: n, independent: false }));
  const state = snapshot([crown, ...vassals]);
  check('F7. vassals are not fragments - only independent realms count',
    fragmentsIn(state, FRANCIA).length === 1
      && consolidationBand(state, FRANCIA).allowed.length === 0,
    'a crown with ten dukes looks shattered and is not a region to be gathered');
}
{
  // No geography at all: refuse rather than guess. Same rule the Iberian band
  // has, except that one can fall back to culture and this one cannot - a
  // region IS geography.
  nextId = 1;
  const bare = [realm({ regions: undefined }), realm({ regions: undefined }), realm({ regions: undefined })];
  const band = consolidationBand(snapshot(bare), FRANCIA);
  check('F8. a snapshot with no geography refuses rather than guessing',
    band.allowed.length === 0 && /no geography/.test(band.reason), band.reason);
}

// --------------------------------------------------------------------------
console.log('\nCohesion raises the ceiling, it does not gate the door\n');

{
  // The Iberian shape: a dominant realm whose neighbours share its faith but
  // not its culture. A hard same-culture gate would have refused this.
  nextId = 1;
  const leader = realm({ primaryTitle: 'Kingdom of Castile', countiesInSphere: 22, culture: 'Castilian', faith: 'Catholic', regions: [IBERIA] });
  const kin = [
    realm({ countiesInSphere: 8, culture: 'Portuguese', faith: 'Catholic', regions: [IBERIA] }),
    realm({ countiesInSphere: 7, culture: 'Catalan', faith: 'Catholic', regions: [IBERIA] }),
    realm({ countiesInSphere: 6, culture: 'Basque', faith: 'Catholic', regions: [IBERIA] }),
  ];
  const band = consolidationBand(snapshot([leader, ...kin]), IBERIA);
  check('F9. shared FAITH across four cultures is cohesion enough',
    band.cohesion === 1 && band.allowed.includes('paramount'),
    `cohesion ${Math.round(band.cohesion * 100)}% on faith alone — ${band.allowed.join(', ')}`);
}
{
  // And the reverse: one culture, several faiths.
  nextId = 1;
  const leader = realm({ countiesInSphere: 20, culture: 'French', faith: 'Catholic' });
  const kin = [
    realm({ countiesInSphere: 5, culture: 'French', faith: 'Cathar' }),
    realm({ countiesInSphere: 5, culture: 'French', faith: 'Waldensian' }),
    realm({ countiesInSphere: 4, culture: 'French', faith: 'Cathar' }),
  ];
  const band = consolidationBand(snapshot([leader, ...kin]), FRANCIA);
  check('F10. and shared CULTURE across several faiths is too',
    band.cohesion === 1 && band.allowed.includes('paramount'),
    'the Capetians gathered French speakers; the Iberian crowns gathered co-religionists');
}

// --------------------------------------------------------------------------
console.log('\nThe region is derived, never named by the model\n');

{
  nextId = 1;
  const a = realm({ regions: [FRANCIA, 'world_europe_west'] });
  const b = realm({ regions: [FRANCIA] });
  const c = realm({ regions: [IBERIA] });
  check('F11. the shared region is the one most of them stand in',
    sharedRegion([a, b, c]) === FRANCIA);
  check('F12. one realm alone in a region shares no region',
    sharedRegion([c]) === null,
    'a region string can never be something the model composed');
}

// --------------------------------------------------------------------------
console.log('\nWhat reaches the game\n');

{
  const script = consolidationScript({ leaderTag: 0, partnerTags: [1, 2, 3], tier: 'gathering' }, 77).join('\n');
  check('F13. the tier travels as a level, and the event holds the effects',
    /hd_pressure_level value = 2/.test(script) && /trigger_event = hd_event\.0210/.test(script));
  check('F14. and it reports both outcomes',
    /applied\/;\/77\/;\/consolidation/.test(script) && /refused\/;\/77\/;\/consolidation/.test(script));
}
{
  check('F15. a tier not in the table composes nothing rather than a bad line',
    consolidationScript({ leaderTag: 0, partnerTags: [], tier: 'crusade' }, 1).length === 0
      && consolidationScript({ leaderTag: 0, partnerTags: [], tier: '' }, 1).length === 0,
    'lookup, never interpolation - the property momentum.js relies on');
}
{
  const script = consolidationScript({ leaderTag: 0, partnerTags: [1, 2, 3, 4, 5, 6], tier: 'stirring' }, 1).join('\n');
  check('F16. partners past the event\'s scopes are dropped, not emitted',
    !/hd_partner_5/.test(script) && /hd_partner_4/.test(script),
    'the event has four partner scopes and cannot read a fifth');
}
{
  check('F17. every tier names a modifier the mod will have to define',
    TIER_KEYS.every((k) => TIERS[k].modifier && TIERS[k].effects.length),
    TIER_KEYS.map((k) => TIERS[k].modifier).join(', '));
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
