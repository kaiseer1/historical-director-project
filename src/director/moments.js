/**
 * The historical moment library.
 *
 * A moment is a turning point the record actually carries - the Iberian crowns
 * drawing together, the Almohads coming apart after Las Navas - expressed as
 * three things a campaign can be given at once: an event that says what is
 * happening, a licence to act on it, and the means to act.
 *
 * ## Why this is a library and not a feature
 *
 * `iberian_pressure` was the first of these and it is hard-coded to Iberia
 * throughout: its own region constant, its own intensity tiers, its own script
 * builder. That is the right shape for one moment and the wrong shape for
 * twelve. Everything specific to a moment lives in the table below, and the
 * machinery around it does not know Iberia from Khorasan. Adding the Abbasid
 * twilight is an entry here, three localisation lines and one event - not a new
 * action, a new validator and a new script builder.
 *
 * ## What a moment may and may not do
 *
 * It licenses and it equips. It does not transfer titles, and it does not start
 * wars: the actor gains a pressed claim on the target's primary title, money
 * and levies to fight for it, and a temporary appetite for doing so. Whether
 * anything happens is the AI's decision, made through ordinary game mechanics.
 * Every document in this project says the Director sets the stage and the ruler
 * decides, and a moment is the largest stage it can set.
 *
 * ## Why a pressed claim rather than a bespoke casus belli
 *
 * Because the claim already does the job, which was not obvious. In CK3 a
 * pressed claim on a *kingdom-tier* title transfers that kingdom and its de jure
 * vassals on victory - that is a union, mechanically. And `claim_cb` is one of
 * the CBs that does *not* call `struggle_blocks_invasion_conquest_cb_trigger`,
 * so unlike conquest and invasion it is unaffected by the Iberian struggle in
 * any phase. Only four vanilla CB files call that trigger:
 *
 *   00_conquest  00_invasion_war  00_nomadic_conquest  07_ep3_wars
 *
 * A bespoke CB would add exactly one thing the claim cannot: `ai_will_do`, which
 * would let the AI be told to prefer *this* war over its other options. That is
 * worth several hundred lines of CK3 script only if a live campaign shows the AI
 * sitting on a licensed claim rather than pressing it, and that has not been
 * tested. Until it is, this uses the mechanism that already exists.
 *
 * ## Curation, and the cost of getting it wrong
 *
 * Each moment asserts that something in the record belongs here. That is the
 * same kind of claim bookmarkTiers makes and it carries the same burden: an
 * entry is a proposal the Director will put in front of a player with sources
 * attached, so the bar is "the record plainly supports this", not "this would be
 * interesting". Moments that cannot meet it are declared and not offered, the
 * way Phase II regions are.
 */

/**
 * Whether the deployed mod carries this library's events and modifiers.
 *
 * Same shape and same reasoning as momentum's and macro events': validate runs
 * deep in the toolkit with no access to config, main.js resolves it at startup
 * and after any deploy, and the default permits so the harness can exercise the
 * library without a CK3 install.
 */
let support = { ok: true, version: null, reason: '', checked: false };

/** @param {{ok: boolean, version: string|null, reason: string}} next */
export function setMomentSupport(next) {
  support = { ...next, checked: true };
}

/** @returns {{ok: boolean, version: string|null, reason: string, checked: boolean}} */
export function momentSupport() {
  return support;
}

/** The window either side of a moment's date where it is still plausible. */
const DEFAULT_SPAN = 40;

/**
 * @typedef {object} Moment
 * @property {string} label shown in the preview
 * @property {boolean} offered false for a moment declared but not yet curated
 * @property {number} year the date the record puts it at
 * @property {number} [span] years either side it remains plausible
 * @property {string} region the geographical region it belongs to
 * @property {string} event the CK3 event fired at the actor
 * @property {string} modifier the character modifier applied to the actor
 * @property {number} years how long that modifier lasts
 * @property {number} gold
 * @property {'prestige'|'piety'} currency
 * @property {number} currencyAmount
 * @property {string} summary one sentence on what the moment is
 * @property {string} shape what the actor and target mean for this moment
 * @property {string} targetTier the highest rank this moment can sensibly be aimed at
 * @property {string[]} sources
 */

/** @type {Record<string, Moment>} */
export const MOMENTS = {
  /**
   * The Iberian crowns drawing together.
   *
   * Historically this is the long arc from the partition of 1157 through the
   * dynastic unions that ended with Castile and Leon permanently joined in
   * 1230. The record supports a Castilian-Leonese union firmly; it is the one
   * consolidation of the period that actually happened and stuck.
   */
  iberian_union: {
    label: 'the Iberian crowns drawing together',
    offered: true,
    year: 1230,
    span: 70,
    region: 'world_europe_west_iberia',
    event: 'hd_event.0210',
    modifier: 'hd_moment_union',
    years: 25,
    gold: 600,
    currency: 'prestige',
    currencyAmount: 600,
    summary:
      'the Christian crowns of the peninsula consolidating, which the record has ending in a permanent Castilian-Leonese union in 1230',
    shape: 'the actor is the crown that consolidates; the target is the crown absorbed',
    // A union absorbs a crown. Aimed at an empire it would be one realm
    // swallowing another whole, which is conquest wearing a union's name.
    targetTier: 'kingdom',
    sources: [
      'https://en.wikipedia.org/wiki/Kingdom_of_Castile',
      'https://en.wikipedia.org/wiki/Kingdom_of_Le%C3%B3n',
      'https://en.wikipedia.org/wiki/Crown_of_Castile',
    ],
  },

  /**
   * The Almohads coming apart.
   *
   * Las Navas de Tolosa in 1212 broke Almohad power in the peninsula, and the
   * caliphate fragmented over the following three decades into the third taifas
   * while the Christian kingdoms took al-Andalus piece by piece. The actor here
   * is whoever is taking the ground, which the record allows to be either a
   * Christian crown or a local emirate breaking away.
   */
  almohad_decline: {
    label: 'the Almohads coming apart',
    offered: true,
    year: 1212,
    span: 60,
    region: 'world_europe_west_iberia',
    event: 'hd_event.0211',
    modifier: 'hd_moment_decline',
    years: 25,
    gold: 600,
    currency: 'piety',
    currencyAmount: 600,
    summary:
      'Almohad power in the peninsula breaking after Las Navas de Tolosa in 1212, and al-Andalus passing piece by piece to whoever could hold it',
    shape: 'the actor is whoever takes the ground; the target is the power losing it, once it has begun coming apart',
    // The mechanism is a pressed claim on the target's primary title, and that
    // is only "al-Andalus passing piece by piece" while the pieces are
    // kingdom-sized. Aimed at the intact caliphate it claims the whole empire,
    // Morocco included, in a single war - which is not this moment, it is
    // Castile becoming the Almohad emperor.
    //
    // So the Director can back whoever is taking ground once the collapse has
    // produced kingdom-tier successors. It cannot start the collapse with a
    // claim, and pretending otherwise would be the puppetmastering every
    // document here rules out.
    targetTier: 'kingdom',
    sources: [
      'https://en.wikipedia.org/wiki/Almohad_Caliphate',
      'https://en.wikipedia.org/wiki/Battle_of_Las_Navas_de_Tolosa',
      'https://en.wikipedia.org/wiki/Taifa',
    ],
  },

  /**
   * Declared, deliberately not offered.
   *
   * The Abbasid twilight is as well attested as anything above, but it is not
   * curated: the actor is genuinely ambiguous - Buyid, Seljuk, Khwarazmian or
   * Mongol depending on the century - and a moment whose actor cannot be stated
   * is a moment that would license almost anyone against Baghdad. It needs the
   * same treatment the two above got before it can be offered, and until then
   * naming it here is a promise to do that rather than a claim to have done it.
   */
  abbasid_twilight: {
    label: 'the Abbasid twilight',
    offered: false,
    year: 1258,
    span: 200,
    region: 'world_middle_east_arabia',
    event: '',
    modifier: '',
    years: 0,
    gold: 0,
    currency: 'prestige',
    currencyAmount: 0,
    summary: 'the long erosion of Abbasid temporal power, ending at Baghdad in 1258',
    shape: 'not yet curated: the actor varies by century and the record does not name one',
    targetTier: 'kingdom',
    sources: ['https://en.wikipedia.org/wiki/Abbasid_Caliphate'],
  },
};

/** Every moment the model may choose from. */
export const MOMENT_KEYS = Object.keys(MOMENTS).filter((k) => MOMENTS[k].offered);

/** Every moment, offered or not, for documentation and tests. */
export const ALL_MOMENT_KEYS = Object.keys(MOMENTS);

/** @param {unknown} key */
export function isMoment(key) {
  return typeof key === 'string' && Object.hasOwn(MOMENTS, key) && MOMENTS[key].offered;
}

/**
 * Whether the audited year is close enough to the moment for it to be plausible.
 *
 * A window rather than a date, because a campaign is not obliged to run to
 * schedule: an Iberia that consolidates in 1190 or 1270 is still recognisably
 * the same historical process. Outside the window it is not that process any
 * more, it is a different one wearing its name.
 *
 * @param {string} key
 * @param {number} year
 */
export function inWindow(key, year) {
  const m = MOMENTS[key];
  if (!m) return false;
  const span = m.span ?? DEFAULT_SPAN;
  return Math.abs(year - m.year) <= span;
}

/**
 * Why this moment does not fit, or null when it does.
 *
 * @param {string} key
 * @param {number} year
 * @returns {string|null}
 */
export function windowError(key, year) {
  const m = MOMENTS[key];
  if (!m) return null;
  if (inWindow(key, year)) return null;
  const span = m.span ?? DEFAULT_SPAN;
  return `${m.label} belongs to ${m.year} give or take ${span} years, and the campaign is at ${year}`;
}

/**
 * The script a moment stages, as literal lines.
 *
 * Composed from the table rather than written per moment, so a new entry needs
 * no new script. Returns nothing for an unknown or unoffered key, which should
 * be unreachable - validate rejects those first - but the cost of being wrong
 * about that is staging an unvalidated action.
 *
 * @param {string} key
 * @param {string} actorScope already-resolved, e.g. "scope:hd_actor"
 * @param {string} targetScope
 * @returns {string[]}
 */
export function momentScript(key, actorScope, targetScope) {
  if (!isMoment(key)) return [];
  const m = MOMENTS[key];

  const body = [
    // The licence. A pressed claim on a kingdom-tier primary title transfers the
    // kingdom and its de jure vassals on victory, which is the union; claim_cb
    // is unaffected by the struggle.
    `\tadd_pressed_claim = ${targetScope}.primary_title`,
    `\tadd_gold = ${m.gold}`,
  ];
  if (m.currency === 'prestige') body.push(`\tadd_prestige = ${m.currencyAmount}`);
  if (m.currency === 'piety') body.push(`\tadd_piety = ${m.currencyAmount}`);

  body.push(
    '\tadd_character_modifier = {',
    `\t\tmodifier = ${m.modifier}`,
    `\t\tyears = ${m.years}`,
    '\t}',
    // The event is fired last, so a ruler reading it already holds everything it
    // describes. It carries no effects of its own beyond acknowledgement.
    `\ttrigger_event = ${m.event}`,
  );

  return [`${actorScope} = {`, ...body, '}'];
}

/**
 * Which curated moments fit this world right now.
 *
 * Computed rather than described, for the same reason the bookmark briefing is:
 * a rule the model has to remember competes with everything else in the prompt,
 * and a fact placed in front of it does not. A live audit made the difference
 * concrete - the Castile-Leon union at 1205 is exactly `iberian_union`, the
 * library was loaded and applicable, and the model reached for the general
 * `grant_claim` because nothing told it a curated moment was sitting there.
 *
 * A moment qualifies when the date is inside its window and the snapshot holds
 * at least two realms in its region, because a moment needs someone to act and
 * someone to act upon.
 *
 * @param {any} snapshot
 * @param {number} year
 * @returns {Array<{key: string, label: string, summary: string, shape: string, candidates: any[]}>}
 */
export function applicableMoments(snapshot, year) {
  const realms = snapshot?.byRelevance ?? snapshot?.byFootprint ?? [];
  const out = [];

  for (const key of MOMENT_KEYS) {
    const m = MOMENTS[key];
    if (!inWindow(key, year)) continue;
    const inside = realms.filter((r) => Array.isArray(r.regions) && r.regions.includes(m.region));
    if (inside.length < 2) continue;
    out.push({ key, label: m.label, summary: m.summary, shape: m.shape, candidates: inside.slice(0, 8) });
  }

  return out;
}

/**
 * That list as the prompt section. Empty string when nothing fits, so the
 * section disappears rather than announcing its own absence.
 *
 * @param {any} snapshot
 * @param {number} year
 * @returns {string}
 */
export function momentBriefing(snapshot, year) {
  const fitting = applicableMoments(snapshot, year);
  if (fitting.length === 0) return '';

  const blocks = fitting.map((f) => {
    const who = f.candidates
      .map((r) => `${r.id} ${r.primaryTitle} (${r.tierKey ?? 'unknown tier'}, ${r.countiesInSphere} counties)`)
      .join('; ');
    return [
      `- ${f.key}: ${f.label} - ${f.summary}`,
      `  ${f.shape}`,
      `  Realms in that region right now: ${who}`,
    ].join('\n');
  });

  return [
    'These curated moments fit this world at this date. Each carries the record\'s own framing, an event the ruler actually sees, and effects tuned to it.',
    ...blocks,
    '',
    'If what you are about to propose IS one of these, propose it as historical_moment rather than as a bare grant_claim. A union the record names is not the same proposal as an opportunistic claim, and should not arrive looking like one.',
  ].join('\n');
}

/** Rank ordering, over the script-derived tier keys. */
const TIER_RANK = { barony: 0, county: 1, duchy: 2, kingdom: 3, empire: 4 };

/**
 * Whether this moment can sensibly be aimed at a target of this rank.
 *
 * @param {string} key
 * @param {string|null|undefined} tierKey
 * @returns {string|null} the refusal, or null when it fits
 */
export function targetTierError(key, tierKey) {
  const m = MOMENTS[key];
  if (!m) return null;
  if (!tierKey || !(tierKey in TIER_RANK)) {
    return `no script-derived tier for the target, so the Director cannot tell what claiming their primary title would take`;
  }
  const cap = m.targetTier ?? 'kingdom';
  if (TIER_RANK[tierKey] <= TIER_RANK[cap]) return null;
  return `${m.label} is aimed at a ${cap}-tier realm at most, and this target is ${tierKey} tier - a pressed claim on an emperor's primary title is a claim on the whole empire in one war, which is not this moment`;
}

/**
 * What claiming this target's primary title actually takes.
 *
 * The preview used to say "which at kingdom tier carries its de jure vassals
 * with it" whatever the target was, so a live proposal against a 97-county
 * empire described itself in one sentence as both "the empire-tier title the
 * Mu'minid Empire" and as a kingdom claim. Understating what approval does is
 * the one failure the whole approval gate exists to prevent.
 *
 * @param {string|null|undefined} tierKey
 */
function whatItTakes(tierKey) {
  switch (tierKey) {
    case 'empire': return 'which is the entire empire and every realm beneath it';
    case 'kingdom': return 'which at kingdom tier carries its de jure vassals with it';
    case 'duchy': return 'a single duchy and the counties under it';
    case 'county': return 'a single county';
    default: return 'of unknown rank, so what it carries cannot be stated';
  }
}

/**
 * The sentence appended to the proposal preview.
 *
 * Itemised rather than summarised. A moment touches two realms and grants four
 * things at once, so "sets the Iberian union in motion" would be the least
 * honest preview in the toolkit.
 *
 * @param {string} key
 * @param {string} actorName
 * @param {string} targetName
 * @param {string|null} [targetTier] the target's script-derived tier
 */
export function momentPreview(key, actorName, targetName, targetTier) {
  if (!isMoment(key)) return '';
  const m = MOMENTS[key];
  return ` This is ${m.label}: ${m.summary}. ${actorName} gains a pressed claim on ${targetName}'s primary title - ${whatItTakes(targetTier)} - along with ${m.gold} gold, ${m.currencyAmount} ${m.currency}, and a ${m.years}-year appetite for pressing it. No war is started and no title changes hands: ${actorName} still has to fight for it, and may not.`;
}
