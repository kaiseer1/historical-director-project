/**
 * DRAFT - consolidation, which is iberian_pressure with the peninsula taken out.
 *
 * ## Why this exists
 *
 * A 1225 campaign had France shattered into Valois, Troyes, Thouars, Auvergne
 * and Toulon, with Brittany and Cornwall loose beside them. The record has the
 * opposite: Philip Augustus broke the Angevins at Bouvines in 1214 and Louis
 * VIII was marching into Languedoc the year before that screenshot. It is one
 * of the clearest divergences this project has ever been shown.
 *
 * And the toolkit cannot touch it. `adjust_title_tier` only ever demotes, and
 * only where a realm has risen; what that map needs is a crown *absorbing* its
 * neighbours. The one action shaped like that is `iberian_pressure` - truces,
 * alliances, hooks, a union decision - and it is gated to
 * `world_europe_west_iberia`.
 *
 * So the thing that most offends the person who built this is the thing it
 * cannot address, and the fix is not new machinery. It is the same machinery
 * with the region made a parameter.
 *
 * ## What is general and what is not
 *
 * The effects were always general. `hd_event.0200` grants truces, alliances,
 * hooks and a decision, and none of that knows where it is. What is Iberian is
 * the prose ("The Peninsula Draws Together"), the modifier names, and - the
 * part that actually matters - the band.
 *
 * `intensityBand` measures Andalusian counties against Christian ones. That is
 * a real and specific claim about the Reconquista, and it is the right measure
 * for that process. It says nothing at all about Capetian France, where the
 * fragments and the unifier share a culture and a faith and the question is
 * whether a crown can gather its own.
 *
 * This module does NOT replace it. `iberian_pressure` is shipped, live-tested,
 * and encodes something true; a general band that flattened it would trade a
 * sharp instrument for a blunt one. This sits beside it.
 *
 * ## The measure
 *
 * Three things, all read off what the snapshot already carries:
 *
 *   fragments  how many independent realms hold land in the region
 *   dominance  how far the largest of them stands above the rest
 *   cohesion   what share of them the leader has a culture or faith in common with
 *
 * Cohesion raises the ceiling rather than gating entry, deliberately. A union
 * among strangers is a conquest wearing a union's clothes, but a hard same-faith
 * gate would refuse the Iberian case outright, and the record is full of crowns
 * that gathered realms they did not pray with. "A rise is permission to look,
 * not a reason to act" - the same shape bookmarkTiers uses.
 *
 * ## What the snapshot cannot tell us
 *
 * `countiesInSphere` is counted across the whole sphere and not per region, so
 * a realm straddling the region's edge reads larger here than its presence in
 * the region really is. Every threshold below is set well clear of 1 for that
 * reason, and the reasons quote the raw counts so a player can see the figure
 * they are being asked to trust.
 */

import { resolveTagged } from '../bridge/ck3Script.js';
import { inRegion, hasRegionData, MAX_PARTNERS } from './macroEvents.js';

/**
 * The general consolidation event. Mechanically a sibling of hd_event.0200 with
 * region-neutral prose; see the note in that file about deriving one from the
 * other by substitution so the two cannot drift.
 *
 * NOT YET IN THE MOD. Nothing here should be offered to the model until it is,
 * and until the support gate below is wired the way every other mod-content
 * action wires one - a mod without this event would execute the batch, report
 * `applied ... ok`, and silently do nothing.
 */
export const CONSOLIDATION_EVENT = 'hd_event.0210';

/** How many independent realms make a region fragmented rather than merely busy. */
const MIN_FRAGMENTS = 3;

/** How far above the rest the leader must stand for a gathering to be plausible. */
const DOMINANT = 1.5;
/** And for the strongest tier, where the leader is already most of the answer. */
const PARAMOUNT = 2.5;

/**
 * The floor below which nothing is drawing together.
 *
 * Cohesion raises the ceiling rather than gating the door - but there has to be
 * a door. Without this, a dominant realm surrounded by people it shares nothing
 * with reads as legal at the lowest tier, and what that grants is truces and an
 * appetite for war to the strongest power in a region full of strangers. That
 * is a conquest being staged, and offering it under the name "consolidation"
 * would be the preview describing one thing while the map contains another.
 *
 * Set so that at least one fragment must be kin. A quarter is not a principled
 * fraction; it is the smallest one that means "somebody" rather than "nobody"
 * across the region sizes this action actually sees.
 */
const MIN_COHESION = 0.25;

/**
 * The tiers, named for no particular geography.
 *
 * `level` is what reaches the game, as the same global variable
 * `iberian_pressure` sets, because the event branches on it and nothing else
 * about the effects differs. Everything else here is disclosure.
 *
 * @typedef {object} Tier
 * @property {number} level
 * @property {string} label
 * @property {string} modifier
 * @property {string[]} effects plain-language, shown before approval
 */

/** @type {Record<string, Tier>} */
export const TIERS = {
  stirring: {
    level: 1,
    label: 'stirring',
    modifier: 'hd_consolidation_stirring',
    effects: [
      'a ten-year truce between the leading realm and each partner',
      'a modest and temporary appetite for war, on the leading realm only',
    ],
  },
  gathering: {
    level: 2,
    label: 'gathering',
    modifier: 'hd_consolidation_gathering',
    effects: [
      'a fifteen-year truce between the leading realm and each partner',
      'an alliance between the leading realm and each partner',
      'a marked and temporary appetite for war, on the leading realm only',
      'a decision unlocked for the leading realm to press a dynastic union, which it may ignore',
    ],
  },
  paramount: {
    level: 3,
    label: 'paramount',
    modifier: 'hd_consolidation_paramount',
    effects: [
      'a twenty-year truce between the leading realm and each partner',
      'an alliance between the leading realm and each partner',
      'a favour hook for the leading realm over each partner, which is leverage and not obedience',
      'a strong and temporary appetite for war, on the leading realm only',
      'a decision unlocked for the leading realm to press a dynastic union, which it may ignore',
      'a follow-up event some years later offering an inheritance path, which the recipient may refuse',
    ],
  },
};

export const TIER_KEYS = Object.keys(TIERS);

/** @param {unknown} k */
export function isTier(k) {
  return typeof k === 'string' && Object.hasOwn(TIERS, k);
}

/** @param {unknown} v */
function key(v) {
  return String(v ?? '').trim().toLowerCase();
}

/**
 * The realms that hold land in this region and answer to nobody.
 *
 * Independence is the point rather than a detail: a duchy already inside the
 * leader's realm is not a fragment to be gathered, it is a vassal. A map that
 * looks shattered because one crown has ten independent neighbours is a
 * different world from one that looks shattered because a single kingdom has
 * ten dukes, and only the first is what this action describes.
 *
 * @param {any} state
 * @param {string} regionId
 * @returns {any[]}
 */
export function fragmentsIn(state, regionId) {
  const realms = [...(state?.realmsById?.values?.() ?? [])];
  if (!hasRegionData(state)) return [];
  return realms.filter((r) => inRegion(r, regionId) === true && r.independent !== false);
}

/**
 * The region these realms have most in common, or null.
 *
 * The model never names a region. It names a leader and partners, and the
 * region is whichever one the most of them stand in - so a region string can
 * never be something the model composed, only something the map reported.
 *
 * @param {any[]} realms
 * @returns {string|null}
 */
export function sharedRegion(realms) {
  /** @type {Map<string, number>} */
  const tally = new Map();
  for (const r of realms) {
    for (const region of r?.regions ?? []) tally.set(region, (tally.get(region) ?? 0) + 1);
  }
  let best = null;
  let bestN = 0;
  for (const [region, n] of tally) {
    if (n > bestN) { best = region; bestN = n; }
  }
  // One realm standing alone in a region is not a shared region.
  return bestN >= 2 ? best : null;
}

/**
 * What intensity of consolidation this region will actually support.
 *
 * @param {any} state the live snapshot
 * @param {string} regionId
 * @param {any} [baseline]
 * @returns {{allowed: string[], leader: any, fragments: any[], dominance: number,
 *            cohesion: number, reason: string}}
 */
export function consolidationBand(state, regionId, baseline) {
  const none = (reason) => ({
    allowed: [], leader: null, fragments: [], dominance: 0, cohesion: 0, reason,
  });

  if (!hasRegionData(state)) {
    return none('this snapshot carries no geography, so no region can be judged for consolidation');
  }

  const fragments = fragmentsIn(state, regionId);
  if (fragments.length < MIN_FRAGMENTS) {
    return none(`consolidation gathers a fragmented region, and only ${fragments.length} independent realm(s)`
      + ` hold land here; ${MIN_FRAGMENTS} is the fewest that reads as fragmentation rather than as a border`);
  }

  const sized = [...fragments].sort((a, b) => (b.countiesInSphere ?? 0) - (a.countiesInSphere ?? 0));
  const leader = sized[0];
  const rest = sized.slice(1);
  const sizes = rest.map((r) => r.countiesInSphere ?? 0).sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)] || 1;
  const dominance = (leader.countiesInSphere ?? 0) / median;

  // What share of the fragments the leader could plausibly draw in. Culture OR
  // faith, not both: the Capetians gathered French-speaking Catholics, and the
  // Iberian crowns gathered co-religionists who did not share a tongue.
  const lc = key(leader.culture);
  const lf = key(leader.faith);
  const kin = rest.filter((r) => (lc && key(r.culture) === lc) || (lf && key(r.faith) === lf));
  const cohesion = rest.length ? kin.length / rest.length : 0;

  const counts = `${leader.primaryTitle} holds ${leader.countiesInSphere} counties to a median of ${median}`
    + ` across ${rest.length} other independent realms here`;

  if (dominance < DOMINANT) {
    return none(`consolidation needs a realm the others could actually gather behind; ${counts},`
      + ` which is ${dominance.toFixed(1)}x and short of the ${DOMINANT}x that reads as a leader`);
  }

  if (cohesion < MIN_COHESION) {
    return none(`nothing here is drawing together: ${leader.primaryTitle} is ${leader.culture}/${leader.faith}`
      + ` and ${Math.round(cohesion * 100)}% of the ${rest.length} realms around it share either.`
      + ' A dominant realm among strangers is a conquest being staged, not a region consolidating,'
      + ' and offering it under this name would describe one thing while the map holds another');
  }

  /** @type {string[]} */
  let allowed = ['stirring'];
  let reason = `${counts} — ${dominance.toFixed(1)}x the median, with ${Math.round(cohesion * 100)}%`
    + ` of them sharing its culture or faith. Enough for a stirring and no more`;

  if (cohesion >= 0.5) {
    allowed = ['stirring', 'gathering'];
    reason = `${counts} — ${dominance.toFixed(1)}x the median, and ${Math.round(cohesion * 100)}% share its`
      + ` culture or faith, which supports a gathering`;
  }

  if (cohesion >= 0.5 && dominance >= PARAMOUNT) {
    allowed = ['stirring', 'gathering', 'paramount'];
    reason = `${counts} — ${dominance.toFixed(1)}x the median and ${Math.round(cohesion * 100)}% of them kin`
      + ` in culture or faith, which supports consolidation of any intensity`;
  }

  // The baseline sharpens it the same way the Iberian band does: a region whose
  // leader has been growing is under a live process rather than a standing
  // arrangement, and that is what the strongest tier describes.
  if (baseline?.captured && cohesion >= 0.5 && !allowed.includes('paramount')) {
    let risen = false;
    try { risen = Boolean(baseline.delta(leader)?.risen); } catch { risen = false; }
    if (risen) {
      allowed = [...allowed, 'paramount'];
      reason += '; and it has risen in rank since the baseline, which admits the strongest tier';
    }
  }

  return { allowed, leader, fragments, dominance, cohesion, reason };
}

/**
 * The one guarded batch. Identical in shape to iberianPressureScript, because
 * it drives the same machinery with a different event on the end.
 *
 * @param {{leaderTag: number, partnerTags: number[], tier: string}} a
 * @param {number} token
 * @returns {string[]}
 */
export function consolidationScript({ leaderTag, partnerTags, tier }, token) {
  const t = TIERS[tier];
  if (!t) return []; // lookup, never interpolation

  return [
    ...resolveTagged(leaderTag, 'hd_unifier'),
    ...partnerTags.slice(0, MAX_PARTNERS).flatMap((tag, i) => resolveTagged(tag, `hd_partner_${i + 1}`)),
    `set_global_variable = { name = hd_pressure_level value = ${t.level} }`,
    'if = {',
    '\tlimit = { exists = scope:hd_unifier }',
    `\tscope:hd_unifier = { trigger_event = ${CONSOLIDATION_EVENT} }`,
    `\tdebug_log = "HD:/;/applied/;/${token}/;/consolidation/;/ok"`,
    '}',
    'else = {',
    `\tdebug_log = "HD:/;/refused/;/${token}/;/consolidation/;/precondition_failed"`,
    '}',
  ];
}
