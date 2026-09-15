/**
 * The generic dynamic event: what the Director can stage that nobody wrote in
 * advance.
 *
 * ## The constraint this module is built around
 *
 * Every other narrative event in this mod is a scene somebody wrote: the Zirid
 * invitation, the Almoravid crossing, the bridge of boats at Seville. That is
 * the right way to do the occasions the record names, and the wrong way to do
 * the ones it does not, because there is no finite list of things a
 * thirteenth-century Anatolia can be doing wrong.
 *
 * So this is one event standing in for all of them. What it cannot be is an
 * event whose words the model wrote, and the reason is worth stating plainly
 * rather than rediscovering:
 *
 *   CK3 event titles and descriptions are localization keys. A key can be
 *   *chosen* at runtime; its text cannot be *supplied* at runtime. Variables
 *   hold numbers, scopes and flags, a flag is an identifier rather than a
 *   sentence, and the shipped 1.19 binary has no localization reload to
 *   smuggle a written file in through. All three checked, 2026-09-15.
 *
 * The model's own words therefore go to the sidebar card, which is where the
 * argument has always lived and which the player reads *before* approving.
 * What the game shows is a skeleton chosen from the table below, with the
 * people in it interpolated live.
 *
 * ## Why the prose never reaches the run file
 *
 * `title` and `description` are validated, bounded, and then used only by the
 * preview. No path in this module puts them into script. That is a stronger
 * guarantee than sanitisation, because an injection has to reach the file to
 * matter and these do not go near it. The only model-supplied thing that
 * becomes script is `kind`, an enum reached by lookup - the same discipline
 * momentum.js uses, and for the same reason.
 */

/** The event the companion mod defines. Not model-supplied. */
export const EVENT_ID = 'hd_dynamic.0001';

/**
 * The global variable the event reads its occasion from.
 *
 * Left set after firing rather than cleared. `trigger_event` queues an event;
 * the description is evaluated when the window is actually shown, which may be
 * several ticks later if the player has something else open - so removing the
 * variable in the same batch would race the thing that reads it and lose,
 * quietly, by falling back to the general notice. It is overwritten by the
 * next dynamic event and costs one line in the save.
 */
export const KIND_VAR = 'hd_dyn_kind';

/**
 * The most any single effect may move, in either direction.
 *
 * Half of momentum's thousand, deliberately. Momentum pays for a war and says
 * so at length in its own preview; this is a scene, and a scene that hands
 * over a war chest is a war chest wearing a scene's clothes. The preview names
 * the figure either way, so the player is never guessing.
 */
export const EFFECT_CAP = 500;

/**
 * @typedef {object} DynamicKind
 * @property {string} label shown in the preview
 * @property {string} occasion what the in-game event actually shows, in one line
 * @property {string} use when the model should choose this one
 * @property {boolean} wantsOther whether naming a second party reads naturally
 */

/**
 * The occasions. Adding one here means adding its localization keys and its
 * branch in mod/events/hd_dynamic_events.txt; the three are a set, and
 * check-dynamic-events.mjs fails when they come apart.
 *
 * @type {Record<string, DynamicKind>}
 */
export const DYNAMIC = {
  historical_justice: {
    label: 'historical justice',
    occasion: 'clerks find an older title to ground that is held otherwise now',
    use: 'the record gives this ground to someone other than its present holder, and a claim has been or is being pressed',
    wantsOther: true,
  },
  foreign_holding: {
    label: 'a foreign holding',
    occasion: 'a banner nobody local reads flies over a castle, answering to a distant court',
    use: 'a ruler seated far outside this country holds land inside it, and the point is the strangeness of that rather than any claim',
    wantsOther: true,
  },
  succession: {
    label: 'a disputed succession',
    occasion: 'a court argues about an inheritance before anyone has died',
    use: 'the question is who inherits, and the answers on offer disagree with each other or with the law',
    wantsOther: true,
  },
  notice: {
    label: "a chronicler's notice",
    occasion: "the Director's chronicler leaves a page where it will be read",
    use: 'the divergence is worth telling the player about and none of the other three describes it',
    wantsOther: false,
  },
};

export const DYNAMIC_KEYS = Object.keys(DYNAMIC);

/** The currencies an occasion may move, and the effect each maps to. */
const CURRENCIES = { gold: 'add_gold', prestige: 'add_prestige', piety: 'add_piety' };
export const CURRENCY_KEYS = Object.keys(CURRENCIES);

/**
 * Whether the deployed mod carries hd_dynamic.0001 at all.
 *
 * Same shape and same permissive default as momentum's gate, for the same
 * reason: a simulator run has no deployed mod to inspect, and every path that
 * can reach a real game goes through main.js, which sets this unconditionally.
 * `checked` is what lets the sidebar say "unverified" rather than imply it
 * looked.
 *
 * The failure this gate prevents is the quiet one. An older mod takes
 * `trigger_event = hd_dynamic.0001` as a reference to an event that does not
 * exist: one line in error.log, nothing in the game, and an `applied` record
 * saying ok, because the batch did run. The effects would land, the scene
 * would not, and the card promised both.
 */
let support = { ok: true, version: null, reason: '', checked: false };

/** @param {{ok: boolean, version: string|null, reason: string}} next */
export function setDynamicSupport(next) {
  support = { ...next, checked: true };
}

/** @returns {{ok: boolean, version: string|null, reason: string, checked: boolean}} */
export function dynamicSupport() {
  return support;
}

/** @param {unknown} key */
export function isDynamicKind(key) {
  return typeof key === 'string' && Object.hasOwn(DYNAMIC, key);
}

/**
 * Read the optional effects block.
 *
 * Returns an error string rather than repairing anything. A figure outside the
 * cap is refused by name, not clamped: the card the player approves states the
 * number, and silently halving it would make the card wrong in the one
 * direction nobody checks.
 *
 * @param {unknown} raw
 * @returns {{ok: true, effects: Record<string, number>} | {ok: false, error: string}}
 */
export function readEffects(raw) {
  if (raw === undefined || raw === null) return { ok: true, effects: {} };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'effects must be an object such as { "gold": 200 }' };
  }

  const unknown = Object.keys(raw).filter((k) => !Object.hasOwn(CURRENCIES, k));
  if (unknown.length) {
    return { ok: false, error: `effects may only name ${CURRENCY_KEYS.join(', ')}; got ${unknown.join(', ')}` };
  }

  /** @type {Record<string, number>} */
  const effects = {};
  for (const [k, v] of Object.entries(raw)) {
    const n = Math.trunc(Number(v));
    if (!Number.isFinite(n)) return { ok: false, error: `effects.${k} is not a number` };
    if (n === 0) continue;
    if (Math.abs(n) > EFFECT_CAP) {
      return {
        ok: false,
        error: `effects.${k} is ${n}, and a dynamic event may move at most ${EFFECT_CAP} in either direction.`
          + ' If the intervention is meant to be that large it is a claim with momentum, not a scene',
      };
    }
    effects[k] = n;
  }
  return { ok: true, effects };
}

/**
 * The script, as literal lines to run inside a guard the caller has written.
 *
 * Fails closed on an unknown kind, which `validate` has already refused - but
 * the cost of being wrong about that is firing an event with no occasion set,
 * so it returns nothing rather than trusting its caller.
 *
 * @param {unknown} kind
 * @param {string} actorScope already resolved, e.g. "scope:hd_dyn_actor"
 * @param {Record<string, number>} [effects] already read by readEffects
 * @returns {string[]}
 */
export function dynamicScript(kind, actorScope, effects = {}) {
  if (!isDynamicKind(kind)) return [];

  const body = Object.entries(effects)
    .filter(([k]) => Object.hasOwn(CURRENCIES, k))
    .map(([k, n]) => `\t${CURRENCIES[k]} = ${Math.trunc(n)}`);

  return [
    // Set before the event is fired rather than after: the event reads it to
    // choose which of its descriptions the player sees.
    `set_global_variable = { name = ${KIND_VAR} value = flag:${kind} }`,
    `${actorScope} = {`,
    ...body,
    `\ttrigger_event = ${EVENT_ID}`,
    '}',
  ];
}

/**
 * The sentence the proposal card carries beneath the model's own paragraph.
 *
 * Says what will happen in game, to the coin, and says where the words the
 * player just read will and will not appear. That second half matters: a
 * player who reads a title in the sidebar and then sees a different one in the
 * event window should have been told, rather than left to conclude the
 * Director lost their text somewhere between the two.
 *
 * @param {string} kind
 * @param {string} actorName
 * @param {string|null} otherName
 * @param {Record<string, number>} [effects]
 * @returns {string}
 */
export function dynamicPreview(kind, actorName, otherName, effects = {}) {
  const k = DYNAMIC[kind];
  if (!k) return '';

  const moved = Object.entries(effects).map(([c, n]) => `${n > 0 ? '+' : ''}${n} ${c}`);
  const purse = moved.length ? ` ${actorName} also gains ${moved.join(', ')}.` : '';
  const named = k.wantsOther && otherName ? `, about ${otherName}` : '';

  return `Stage the Director's own event at ${actorName}${named}: ${k.occasion}.${purse}`
    + ' It grants nothing else - no claim, no title, no war.'
    + ' The paragraph above is what you are reading now and what the ledger keeps;'
    + " the event window shows the game's own wording for this kind of occasion, because CK3 cannot be handed a sentence at runtime.";
}
