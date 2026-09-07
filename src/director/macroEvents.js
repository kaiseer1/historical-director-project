/**
 * The Macro Event Library.
 *
 * ## What a macro event is
 *
 * Every other action in the toolkit does one thing to one or two characters.
 * A macro event sets a *process* in motion across several realms at once: the
 * Director proposes that a historical pressure exist, the player approves that
 * it should, and the rulers inside it then decide for themselves what to do
 * about it through ordinary game mechanics.
 *
 * Nothing here transfers a title, and nothing here starts a war. That is the
 * whole distinction from a scripted outcome: the Iberian pressure event makes a
 * union *reachable* and a coalition *affordable*, and the AI still has to want
 * it. Director, not puppetmaster - the same line momentum draws.
 *
 * ## Why the model cannot reach the mechanics
 *
 * The model picks an intensity from a three-value enum and names characters by
 * snapshot tag. Everything else - every modifier name, every duration, every
 * effect - is a fixed constant below, reached by lookup rather than by
 * interpolation. A key that is not in the table yields no script at all rather
 * than a malformed line, which is the same property momentum.js relies on.
 *
 * ## The intensity band
 *
 * Intensity is not free choice. It is checked against a band computed from live
 * state, so a model that wants a crusade in a world that does not support one
 * is refused rather than obeyed. The band is deliberately legible: the more
 * Andalusian ground the player holds relative to the northern crowns, the
 * higher the pressure the situation can carry.
 *
 * ## What is deliberately not here
 *
 * A shared defensive casus belli, which the brief asked for. CK3 has no effect
 * that grants a casus belli - `casus_belli` appears only inside `start_war`,
 * and there is no `add_casus_belli` in the base game. momentum.js records the
 * same finding. The coordination package is an alliance plus paired truces
 * instead, which is what a defensive pact actually is mechanically.
 */

import { resolveTagged } from '../bridge/ck3Script.js';

/** CK3 event ids are numeric. Named suffixes do not load; see PROJECT.md. */
export const IBERIAN_PRESSURE_EVENT = 'hd_event.0200';

/** How many partners the event script has scopes for. */
export const MAX_PARTNERS = 4;

/**
 * The three intensities, and everything each one changes.
 *
 * `level` is what reaches the game, as a global variable the event branches on.
 * Nothing else in this object is interpolated into script; the event script
 * holds the effects and reads only the level.
 *
 * @typedef {object} Intensity
 * @property {number} level
 * @property {string} label
 * @property {string} fervor  modifier applied to the unifier
 * @property {number} truceYears
 * @property {boolean} alliance whether partners are allied, not merely truced
 * @property {boolean} hooks whether the unifier gains hooks over partners
 * @property {string[]} effects plain-language disclosure, shown before approval
 */

/** @type {Record<string, Intensity>} */
export const INTENSITY = {
  smoldering: {
    level: 1,
    label: 'smoldering',
    fervor: 'hd_iberian_pressure_smoldering',
    truceYears: 10,
    alliance: false,
    hooks: false,
    effects: [
      'a ten-year truce between the unifier and each partner',
      'a modest and temporary appetite for war in the peninsula, on the unifier only',
    ],
  },
  fervent: {
    level: 2,
    label: 'fervent',
    fervor: 'hd_iberian_pressure_fervent',
    truceYears: 15,
    alliance: true,
    hooks: false,
    effects: [
      'a fifteen-year truce between the unifier and each partner',
      'an alliance between the unifier and each partner',
      'a marked and temporary appetite for war in the peninsula, on the unifier only',
      'a decision unlocked for the unifier to press a dynastic union, which they may ignore',
    ],
  },
  crusade: {
    level: 3,
    label: 'crusade',
    fervor: 'hd_iberian_pressure_crusade',
    truceYears: 20,
    alliance: true,
    hooks: true,
    effects: [
      'a twenty-year truce between the unifier and each partner',
      'an alliance between the unifier and each partner',
      'a favour hook for the unifier over each partner, which is leverage and not obedience',
      'a strong and temporary appetite for war in the peninsula, on the unifier only',
      'a decision unlocked for the unifier to press a dynastic union, which they may ignore',
      'a follow-up event some years later offering an inheritance path, which the recipient may refuse',
    ],
  },
};

export const INTENSITY_KEYS = Object.keys(INTENSITY);

/**
 * The band of intensities the live world will support.
 *
 * The reasoning, in plain terms: pressure toward Iberian unification came from
 * the northern crowns having somewhere to push and the strength to push there.
 * So the band widens as Andalusian holdings in the sphere grow relative to the
 * Christian realms around them, and narrows when there is little left to press
 * against.
 *
 * Returns the permitted keys plus the figures behind them, because a refusal
 * that does not say what it measured is not much of an explanation.
 *
 * @param {any} state the live snapshot
 * @param {any} [baseline]
 * @returns {{allowed: string[], andalusiCounties: number, northernCounties: number, ratio: number, reason: string}}
 */
export function intensityBand(state, baseline) {
  const realms = [...(state?.realmsById?.values() ?? [])];

  // Culture is what the snapshot actually carries, and "Andalusian" is the
  // culture CK3 names for the peninsula's Muslim polities. Faith is a poorer
  // proxy: a Sunni realm in the Maghreb is not Iberian pressure.
  const isAndalusi = (r) => /andalus/i.test(r.culture ?? '');
  const andalusiCounties = realms.filter(isAndalusi).reduce((n, r) => n + (r.countiesInSphere ?? 0), 0);
  const northernCounties = realms.filter((r) => !isAndalusi(r)).reduce((n, r) => n + (r.countiesInSphere ?? 0), 0);

  const total = andalusiCounties + northernCounties;
  const ratio = total > 0 ? andalusiCounties / total : 0;

  // Bands. A world with almost nothing Andalusian left has no unification
  // pressure worth the name; a world where the peninsula is largely Andalusian
  // will carry the strongest form.
  let allowed;
  let reason;
  if (total === 0) {
    allowed = [];
    reason = 'no counties were reported in the sphere, so there is nothing to measure';
  } else if (ratio < 0.15) {
    allowed = [];
    reason = `Andalusian realms hold ${andalusiCounties} of ${total} counties in the sphere, too little to describe as a pressure toward unification`;
  } else if (ratio < 0.35) {
    allowed = ['smoldering'];
    reason = `Andalusian realms hold ${andalusiCounties} of ${total} counties, enough for a smoldering pressure and no more`;
  } else if (ratio < 0.6) {
    allowed = ['smoldering', 'fervent'];
    reason = `Andalusian realms hold ${andalusiCounties} of ${total} counties, which supports a fervent pressure but not a crusade`;
  } else {
    allowed = ['smoldering', 'fervent', 'crusade'];
    reason = `Andalusian realms hold ${andalusiCounties} of ${total} counties, which supports pressure of any intensity`;
  }

  // The baseline sharpens this where it can: a peninsula that has grown more
  // Andalusian since the campaign began is under a live process, not a static
  // arrangement, and that is what the strongest tier is meant to describe.
  if (baseline?.captured && allowed.length && ratio >= 0.35) {
    const grown = realms.some((r) => isAndalusi(r) && baseline.delta(r)?.risen);
    if (grown && !allowed.includes('crusade')) {
      allowed = [...allowed, 'crusade'];
      reason += '; an Andalusian realm has risen in rank since the baseline, which admits the strongest tier';
    }
  }

  return { allowed, andalusiCounties, northernCounties, ratio, reason };
}

/**
 * The one guarded batch.
 *
 * Partners are resolved into numbered scopes before the event fires, because a
 * CK3 event takes no parameters and saved scopes are how anything reaches one.
 * Intensity travels as a global variable for the same reason. The event script
 * in `mod/events/hd_events.txt` reads both and holds every effect.
 *
 * @param {{unifierTag: number, partnerTags: number[], intensity: string}} a
 * @param {number} token
 * @returns {string[]}
 */
export function iberianPressureScript({ unifierTag, partnerTags, intensity }, token) {
  const tier = INTENSITY[intensity];
  if (!tier) return []; // lookup, never interpolation

  const resolves = [
    ...resolveTagged(unifierTag, 'hd_unifier'),
    ...partnerTags.slice(0, MAX_PARTNERS).flatMap((t, i) => resolveTagged(t, `hd_partner_${i + 1}`)),
  ];

  return [
    ...resolves,
    `set_global_variable = { name = hd_pressure_level value = ${tier.level} }`,
    'if = {',
    '\tlimit = { exists = scope:hd_unifier }',
    `\tscope:hd_unifier = { trigger_event = ${IBERIAN_PRESSURE_EVENT} }`,
    `\tdebug_log = "HD:/;/applied/;/${token}/;/iberian_pressure/;/ok"`,
    '}',
    'else = {',
    `\tdebug_log = "HD:/;/refused/;/${token}/;/iberian_pressure/;/precondition_failed"`,
    '}',
  ];
}
