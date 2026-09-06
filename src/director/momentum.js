/**
 * Momentum: the pre-authored amplifications of `grant_claim`.
 *
 * ## What this is for
 *
 * A pressed claim is a *reason* to go to war and nothing else. The Director
 * could hand one to a ruler with no money, no levies and no appetite for a
 * campaign, and watch nothing happen for forty years. Momentum supplies the
 * *capacity*: the resources a war of this kind actually costs, and a timed
 * disposition to spend them.
 *
 * The distinction is the design. The Director does not start the war - there is
 * no `start_war` anywhere in this file, deliberately - it makes one affordable
 * and attractive, and the ruler still chooses through ordinary game mechanics.
 * Director, not puppetmaster.
 *
 * ## What a casus belli is, and why momentum does not grant one
 *
 * It cannot. CK3 has no effect that grants a casus belli: `casus_belli = X`
 * appears only inside a `start_war` block, and there is no `add_casus_belli` in
 * the entire base game. Casus belli are *derived* - each type carries its own
 * `is_valid` and `allowed_for_character` triggers, and a ruler either satisfies
 * them or does not.
 *
 * So the only way to give someone a CB is to make an existing one's triggers
 * true, which is exactly what `add_pressed_claim` does for `claim_cb` - and
 * that is the action momentum is attached to. The claim *is* the CB grant.
 * Everything here is the second half: paying for it.
 *
 * ## Why the model cannot reach any of this
 *
 * The model chooses one enum key and nothing else. Every fragment below is a
 * fixed constant, and `momentumScript` reaches them by lookup rather than by
 * interpolation, so a key that is not in this table yields no script at all
 * rather than a malformed line. No number, modifier name or effect here can be
 * influenced by model output.
 *
 * ## Magnitudes
 *
 * Deliberately large, at the project owner's direction: 1000 gold and a
 * thirty-year modifier at five times the strength of `guiscard_modifier`, the
 * one CK3 itself ships to make Robert Guiscard behave like a conqueror. Both
 * numbers sit inside vanilla's own range (`add_gold = 1000` is common, and
 * `ai_war_chance = 100` exists) but they are not a nudge, and the preview says
 * so in as many words before anyone approves one.
 *
 * Every number lives in the table below, so tuning this down later is an edit
 * to one object and to the matching modifier definitions in
 * `mod/common/modifiers/hd_modifiers.txt`.
 */

/** How long the disposition lasts. Timed, so a mistaken approval expires. */
const YEARS = 30;

/** Gold, and the second currency, per momentum. */
const GOLD = 1000;
const CURRENCY = 1000;

/**
 * @typedef {object} Momentum
 * @property {string} label shown in the preview
 * @property {string} summary what the extra effects do, in plain English
 * @property {string|null} modifier a character modifier defined by the companion mod
 * @property {'prestige'|'piety'|null} currency the resource this kind of war actually costs
 * @property {(actor: any, target: any) => string|null} requires validation against the snapshot; null when allowed
 */

/** No-op guard: this momentum makes no demand of the snapshot. */
const always = () => null;

/**
 * The table. Adding an entry here is the only way to add a momentum, and every
 * entry must have a matching modifier in the companion mod.
 *
 * @type {Record<string, Momentum>}
 */
export const MOMENTUM = {
  none: {
    label: 'none',
    summary: '',
    modifier: null,
    currency: null,
    requires: always,
  },

  reconquista: {
    label: 'reconquista',
    summary:
      'treats the claim as the recovery of lost ground: money and prestige to raise an army, and a marked appetite for using it',
    modifier: 'hd_reconquista_momentum',
    currency: 'prestige',
    // Deliberately ungated. A reconquest is not necessarily a war across a
    // religious border - the Christian kingdoms of Iberia spent the eleventh
    // century fighting each other over exactly this kind of claim - so
    // requiring a faith difference here would refuse the historically
    // commonest case.
    requires: always,
  },

  holy_war: {
    label: 'holy war',
    summary:
      'treats the claim as a war of religion: piety to declare one and gold to prosecute it, with a strong appetite for the fight',
    modifier: 'hd_holy_war_momentum',
    // Holy wars are paid for in piety in CK3, so that is the resource this one
    // supplies. Prestige would be the wrong currency for the war it describes.
    currency: 'piety',
    requires(actor, target) {
      const a = String(actor?.faith ?? '').trim();
      const t = String(target?.faith ?? '').trim();
      // Fail closed. A snapshot that lost its faith fields to log truncation
      // must not be read as "the faiths differ"; unknown is not permission.
      if (!a || !t) {
        return 'momentum "holy_war" needs both faiths and this snapshot does not carry them';
      }
      if (a.toLowerCase() === t.toLowerCase()) {
        return `momentum "holy_war" needs a faith difference; ${actor?.ruler ?? 'the actor'} and ${target?.ruler ?? 'the target'} are both ${a}`;
      }
      return null;
    },
  },

  succession_pressure: {
    label: 'succession pressure',
    summary:
      'treats the claim as a disputed inheritance: prestige and money to buy support, and a readiness to press the case by force',
    modifier: 'hd_succession_momentum',
    currency: 'prestige',
    requires: always,
  },
};

/** The enum offered to the model. */
export const MOMENTUM_KEYS = Object.keys(MOMENTUM);

/**
 * Whether the deployed companion mod can actually execute momentum.
 *
 * Held here rather than looked up, because `validate` runs deep inside the
 * toolkit with no access to config and no business reading the filesystem.
 * main.js resolves it once at startup and again after any deploy, and the
 * toolkit refuses momentum whenever it is not ok - so a preview can never
 * describe a modifier the mod has no definition for.
 *
 * The default permits. That is deliberate and it is the one place this module
 * does not fail closed: a unit test or a simulator run has no deployed mod to
 * inspect, and defaulting to "refuse" would make momentum untestable without a
 * CK3 install. Every path that can actually reach a game goes through main.js,
 * which sets this unconditionally - including when the mod is missing entirely.
 * `checked` records which of the two situations is in force so the sidebar can
 * say "unverified" rather than imply it has looked.
 */
let support = { ok: true, version: null, reason: '', checked: false };

/** @param {{ok: boolean, version: string|null, reason: string}} next */
export function setMomentumSupport(next) {
  support = { ...next, checked: true };
}

/** @returns {{ok: boolean, version: string|null, reason: string, checked: boolean}} */
export function momentumSupport() {
  return support;
}

/** @param {unknown} key */
export function isMomentum(key) {
  return typeof key === 'string' && Object.hasOwn(MOMENTUM, key);
}

/**
 * Normalise the model's argument. An absent momentum is "none", which is what
 * makes the parameter optional and the old behaviour the default.
 *
 * @param {unknown} key
 * @returns {string}
 */
export function momentumOf(key) {
  if (key === undefined || key === null || key === '') return 'none';
  // Anything else is returned as given, so `validate` can reject it by name
  // rather than silently substituting "none" for a value the model meant.
  return String(key);
}

/**
 * The script fragment, as literal lines to run inside a character scope that
 * the caller has already guarded.
 *
 * Returns nothing at all for "none" and for any key not in the table. That
 * second case should be unreachable - `validate` rejects it first - but the
 * cost of being wrong about that is executing an unvalidated action, so this
 * fails closed rather than trusting the caller.
 *
 * @param {unknown} key
 * @param {string} scope the already-resolved scope name, e.g. "scope:hd_actor"
 * @returns {string[]}
 */
export function momentumScript(key, scope) {
  if (!isMomentum(key) || key === 'none') return [];
  const m = MOMENTUM[key];

  /** @type {string[]} */
  const body = [`\tadd_gold = ${GOLD}`];
  if (m.currency === 'prestige') body.push(`\tadd_prestige = ${CURRENCY}`);
  if (m.currency === 'piety') body.push(`\tadd_piety = ${CURRENCY}`);

  if (m.modifier) {
    body.push(
      '\tadd_character_modifier = {',
      `\t\tmodifier = ${m.modifier}`,
      `\t\tyears = ${YEARS}`,
      '\t}',
    );
  }

  return [`${scope} = {`, ...body, '}'];
}

/**
 * The sentence appended to the proposal preview.
 *
 * Names the magnitude rather than only the flavour. The preview is the last
 * thing between a proposal and the map, and "gives them momentum" and "gives
 * them a thousand gold and thirty years of markedly increased belligerence"
 * are not the same disclosure.
 *
 * @param {unknown} key
 * @param {string} actorName
 * @returns {string}
 */
export function momentumPreview(key, actorName) {
  if (!isMomentum(key) || key === 'none') return '';
  const m = MOMENTUM[key];
  const currency = m.currency ? `, ${CURRENCY} ${m.currency}` : '';
  return ` Momentum: ${m.label} — ${m.summary}. In game terms this also gives ${actorName} ${GOLD} gold${currency}, and a ${YEARS}-year modifier that makes the AI far more willing to go to war. That is a large intervention: it does not start a war, but it makes one considerably more likely.`;
}
