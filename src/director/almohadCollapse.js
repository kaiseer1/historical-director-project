/**
 * The Almohad collapse.
 *
 * ## What this models, and why it is its own action
 *
 * `iberian_pressure` describes a peninsula pulling *together* around a unifier.
 * This describes the other half of the same century: a power coming apart from
 * the inside while everyone around it decides what to do about the pieces. The
 * two are not intensities of one thing. They act on opposite parties, they are
 * supported by opposite evidence - one by Andalusian ground held, the other by
 * Andalusian ground lost - and a campaign in 1222 can plausibly carry both at
 * once, which a single enum could not express.
 *
 * ## The history in one paragraph
 *
 * Las Navas de Tolosa in 1212 did not destroy the Almohad state; it destroyed
 * its authority in al-Andalus. What followed was disintegration rather than
 * conquest. Ibn Hud rose in Murcia in 1228, Ibn al-Ahmar founded the Nasrid
 * emirate at Granada in 1238, and the third taifas emerged from provinces whose
 * governors stopped answering. Only then did the Christian crowns take the
 * pieces: Cordoba in 1236, Valencia in 1238, Seville in 1248. The order matters
 * for the modelling. The Almohads were not beaten in the field and then divided
 * up; they were divided up and then beaten in detail.
 *
 * ## Where it crosses the Director's usual line, and how far
 *
 * Every other action in the toolkit licenses and equips, then leaves the ruler
 * to decide. This one does something the others do not: it rolls, per vassal,
 * for a defection that the vassal did not choose. That is a real departure and
 * it is worth naming rather than burying.
 *
 * Three things keep it inside the project's rules. The roll is gated on the
 * engine's own `can_create_faction`, so a vassal the game says may not leave
 * does not leave. What it creates is a *faction*, which is a demand and a war
 * that may still be lost - not a title transfer and not an independent realm.
 * And it reaches the game only through an approval the player gave in front of
 * a preview that states the percentage in words.
 *
 * The larger half of the effect is not the roll at all. It is `vassal_opinion`
 * and a timed opinion modifier, which feed vanilla's own independence scoring -
 * `common/factions/00_factions.txt` weights liege opinion at -0.4 per point
 * against a base reluctance of -150 - and go on working for twenty-five years
 * after the event is forgotten. There is no CK3 modifier key that raises faction
 * chance directly; the modifier localisation defines none, and the scoring lives
 * in `common/scripted_modifiers/00_faction_modifiers.txt`, which a mod can only
 * reach by replacing wholesale. Opinion is the attested lever, so opinion is
 * what this uses.
 */

import { resolveTagged } from '../bridge/ck3Script.js';
import { IBERIA_REGION, inRegion, hasRegionData } from './macroEvents.js';

/** CK3 event ids are numeric. Named suffixes do not load; see PROJECT.md. */
export const COLLAPSE_EVENT = 'hd_event.0220';
export const CLAIMANT_EVENT = 'hd_event.0221';

/** How many claimants the event script has scopes for. */
export const MAX_CLAIMANTS = 4;

/**
 * The year the record puts the collapse at, and how far either side it is still
 * recognisably the same process.
 *
 * 1212 is Las Navas, and the span reaches 1257 - past Seville in 1248, which is
 * where the peninsula's Almohad succession effectively ends. Before 1167 there
 * is no Almohad power in Iberia to lose.
 */
export const COLLAPSE_YEAR = 1212;
export const COLLAPSE_SPAN = 45;

/**
 * Whether the deployed companion mod can execute this.
 *
 * Same shape and same reasoning as momentum's, macro events' and moments': the
 * whole action names mod content - five modifiers, an opinion modifier and
 * three events - and a mod that predates them runs the batch, reports
 * `applied ... ok`, and does none of it. main.js resolves this at startup and
 * after any deploy; the default permits so the harness can exercise the library
 * without a CK3 install.
 */
let support = { ok: true, version: null, reason: '', checked: false };

/** @param {{ok: boolean, version: string|null, reason: string}} next */
export function setCollapseSupport(next) {
  support = { ...next, checked: true };
}

/** @returns {{ok: boolean, version: string|null, reason: string, checked: boolean}} */
export function collapseSupport() {
  return support;
}

/**
 * The three severities, and everything each one changes.
 *
 * `level` is what reaches the game, as a global variable the event branches on.
 * Nothing else here is interpolated into script: the event holds the effects and
 * reads only the level, which is the property that keeps a model's choice from
 * ever becoming a line of CK3.
 *
 * `defection` is stated in the preview verbatim, because it is the number a
 * player is actually approving and rounding it in the prose would be the one
 * dishonest sentence in the sidebar.
 *
 * @typedef {object} Severity
 * @property {number} level
 * @property {string} label
 * @property {string} modifier applied to the collapsing ruler
 * @property {number} years how long that modifier lasts
 * @property {number} defection per-vassal chance of an independence faction, as a percentage
 * @property {number} vassalOpinion the standing penalty, for disclosure
 * @property {string[]} effects plain-language disclosure, shown before approval
 */

/** @type {Record<string, Severity>} */
export const SEVERITY = {
  fraying: {
    level: 1,
    label: 'fraying',
    modifier: 'hd_almohad_fraying',
    years: 20,
    defection: 15,
    vassalOpinion: -15,
    effects: [
      'twenty years of thinner levies and thinner revenue for the collapsing ruler',
      'a standing -15 to how their vassals regard them, and a -30 shock that decays over twenty-five years',
      'a one-in-seven chance, rolled separately for each landed vassal, that they raise an independence faction now',
      'a temporary appetite in each named neighbour for acting on it, which they may refuse',
    ],
  },
  breaking: {
    level: 2,
    label: 'breaking',
    modifier: 'hd_almohad_breaking',
    years: 25,
    defection: 40,
    vassalOpinion: -30,
    effects: [
      'twenty-five years of thinner levies, thinner revenue and a costlier army for the collapsing ruler',
      'a standing -30 to how their vassals regard them, and a -30 shock that decays over twenty-five years',
      'a two-in-five chance, rolled separately for each landed vassal, that they raise an independence faction now',
      'a temporary appetite in each named neighbour for acting on it, which they may refuse',
    ],
  },
  shattered: {
    level: 3,
    label: 'shattered',
    modifier: 'hd_almohad_shattered',
    years: 30,
    defection: 60,
    vassalOpinion: -45,
    effects: [
      'thirty years of thinner levies, thinner revenue, a costlier army and weaker garrisons for the collapsing ruler',
      'a standing -45 to how their vassals regard them, and a -30 shock that decays over twenty-five years',
      'a three-in-five chance, rolled separately for each landed vassal, that they raise an independence faction now',
      'a temporary appetite in each named neighbour for acting on it, which they may refuse',
    ],
  },
};

export const SEVERITY_KEYS = Object.keys(SEVERITY);

/**
 * Is the audited year close enough for this to be the collapse rather than
 * something else wearing its name?
 *
 * @param {number} year
 */
export function inWindow(year) {
  return Math.abs(year - COLLAPSE_YEAR) <= COLLAPSE_SPAN;
}

/**
 * The band of severities the live world will support.
 *
 * The mirror of `intensityBand`, measured over the same ground and the same way
 * - Iberian counties only, membership by geography where the snapshot carries
 * it - but read in the opposite direction. Pressure toward unification is
 * supported by how much al-Andalus still holds. Collapse is supported by how
 * little.
 *
 * The refusal at the top of the range is the point of the whole function. An
 * intact Almohad state in 1222 is a campaign that diverged from the record, and
 * the honest response to that is to decline to narrate a collapse that is not
 * happening - not to cause one and call it history.
 *
 * @param {any} state the live snapshot
 * @param {any} [baseline]
 * @returns {{allowed: string[], andalusiCounties: number, christianCounties: number, ratio: number, reason: string, byGeography: boolean}}
 */
export function collapseBand(state, baseline) {
  const realms = [...(state?.realmsById?.values() ?? [])];
  const byGeography = hasRegionData(state);

  const onPeninsula = (r) => (byGeography
    ? inRegion(r, IBERIA_REGION) === true
    : /andalus|castil|catalan|portug|basque|galician|asturleon|aragon|mozarab|navarr/i.test(r.culture ?? ''));

  const iberian = realms.filter(onPeninsula);
  const isAndalusi = (r) => /andalus/i.test(r.culture ?? '');

  const andalusiCounties = iberian.filter(isAndalusi).reduce((n, r) => n + (r.countiesInSphere ?? 0), 0);
  const christianCounties = iberian.filter((r) => !isAndalusi(r)).reduce((n, r) => n + (r.countiesInSphere ?? 0), 0);

  const total = andalusiCounties + christianCounties;
  const ratio = total > 0 ? andalusiCounties / total : 0;
  const how = byGeography ? 'in Iberia' : 'of Iberian culture (this snapshot carries no geography)';

  let allowed;
  let reason;
  if (iberian.length === 0) {
    allowed = [];
    reason = byGeography
      ? 'no realm in view holds land in Iberia, so there is no peninsula for a power to come apart in'
      : 'no realm in view is of an Iberian culture, and this snapshot carries no geography to check against';
  } else if (total === 0) {
    allowed = [];
    reason = `realms ${how} hold no counties in the sphere, so there is nothing to measure`;
  } else if (ratio >= 0.6) {
    allowed = [];
    reason = `Andalusian realms still hold ${andalusiCounties} of ${total} counties ${how}, which is a power in possession of the peninsula rather than one coming apart in it`;
  } else if (ratio >= 0.4) {
    allowed = ['fraying'];
    reason = `Andalusian realms hold ${andalusiCounties} of ${total} counties ${how}, enough of a decline to describe as fraying and no more`;
  } else if (ratio >= 0.2) {
    allowed = ['fraying', 'breaking'];
    reason = `Andalusian realms hold ${andalusiCounties} of ${total} counties ${how}, which supports a breaking but not a shattering`;
  } else {
    allowed = ['fraying', 'breaking', 'shattered'];
    reason = `Andalusian realms hold only ${andalusiCounties} of ${total} counties ${how}, which supports a collapse of any severity`;
  }

  // The baseline sharpens this the way it sharpens the pressure band, and for
  // the same reason: a peninsula where an Andalusian realm has actually been
  // demoted or lost ground since the campaign began is a live process rather
  // than a static arrangement, and that is what the strongest tier describes.
  if (baseline?.captured && allowed.length && ratio < 0.4) {
    const declining = iberian.filter(isAndalusi).some((r) => {
      const d = baseline.delta(r);
      return d?.known && (d.lost || (!d.risen && /->/.test(d.label ?? '')));
    });
    if (declining && !allowed.includes('shattered')) {
      allowed = [...allowed, 'shattered'];
      reason += '; an Andalusian realm there has lost rank or ground since the baseline, which admits the strongest tier';
    }
  }

  return { allowed, andalusiCounties, christianCounties, ratio, reason, byGeography };
}

/**
 * The one guarded batch.
 *
 * Claimants are resolved into numbered scopes and fired at individually rather
 * than being handed to the collapse event, because they are not participants in
 * it: the collapsing ruler's event does the damage, and each neighbour gets
 * their own window with their own choice in it. A neighbour who declines simply
 * takes no modifier, and the collapse happens anyway - which is the historically
 * correct relationship between the two.
 *
 * @param {{caliphTag: number, claimantTags: number[], severity: string}} a
 * @param {number} token
 * @returns {string[]}
 */
export function almohadCollapseScript({ caliphTag, claimantTags, severity }, token) {
  const tier = SEVERITY[severity];
  if (!tier) return []; // lookup, never interpolation

  const claimants = claimantTags.slice(0, MAX_CLAIMANTS);

  return [
    ...resolveTagged(caliphTag, 'hd_caliph'),
    ...claimants.flatMap((t, i) => resolveTagged(t, `hd_claimant_${i + 1}`)),
    `set_global_variable = { name = hd_collapse_level value = ${tier.level} }`,
    'if = {',
    '\tlimit = { exists = scope:hd_caliph }',
    `\tscope:hd_caliph = { trigger_event = ${COLLAPSE_EVENT} }`,
    ...claimants.flatMap((_, i) => [
      '\tif = {',
      `\t\tlimit = { exists = scope:hd_claimant_${i + 1} }`,
      `\t\tscope:hd_claimant_${i + 1} = { trigger_event = ${CLAIMANT_EVENT} }`,
      '\t}',
    ]),
    `\tdebug_log = "HD:/;/applied/;/${token}/;/almohad_collapse/;/ok"`,
    '}',
    'else = {',
    `\tdebug_log = "HD:/;/refused/;/${token}/;/almohad_collapse/;/precondition_failed"`,
    '}',
  ];
}
