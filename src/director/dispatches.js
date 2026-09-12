/**
 * DRAFT - dispatches the player can answer.
 *
 * ## What changes here
 *
 * stances.js gave the world a view. This gives it a voice the player has to
 * answer, and answering costs something.
 *
 * A dispatch that can only be read is atmosphere. A dispatch that can be
 * answered is a mechanic, and the difference is the whole point: Castile
 * sending word that your gains do not go unnoticed is flavour, but Castile
 * sending word *and remembering what you said back* is a relationship.
 *
 * ## Where consent lives now
 *
 * The approval gate exists because the Director proposes and the player
 * decides. A dispatch reply inverts that: the player is not approving somebody
 * else's idea, they are choosing their own. The reply IS the consent, which is
 * why nothing here goes through `approve`.
 *
 * The invariant is unchanged and worth stating plainly, because this is the
 * first thing in the project that reaches the game without a proposal behind
 * it: nothing reaches the run file that the player did not personally pick, and
 * every effect a reply can have is a constant in the table below. The model
 * never chooses a reply, never sees the effects, and cannot add one. It writes
 * the words the dispatch is delivered in and nothing else.
 *
 * That is the generated-prose-over-fixed-skeleton rule, and this is its first
 * real use. A limitless variety of moments, from a finite set of mechanics.
 *
 * ## Why ignoring is a choice and not the absence of one
 *
 * This is the part that matters most, and it is what makes a coalition
 * possible later without asking anyone to approve being attacked.
 *
 * Pressure rises when a dispatch is defied or ignored, and falls when it is
 * answered. It is recorded per realm and it persists. So the path from "Castile
 * is alarmed" to "Castile, Leon and Portugal are at your gates" is not the
 * Director deciding to punish a strong player - it is three warnings the player
 * received, read, and chose to say nothing to, each time being told what
 * silence would cost.
 *
 * A player attacked at pressure 3 consented at pressure 1. That is a consent
 * model that survives being looked at, and it is the one thing the coalition
 * design was missing.
 */

import { resolveTagged } from '../bridge/ck3Script.js';

/** Characters CK3 script treats structurally. Same guard the toolkit uses. */
const UNSAFE = /["'{}\[\]$\\=#\r\n\t]/g;

/** @param {unknown} v @param {number} [maxLen] */
function safeString(v, maxLen = 60) {
  return String(v ?? '').replace(UNSAFE, '').trim().slice(0, maxLen);
}

/** @param {unknown} v */
function safeInt(v) {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? n : null;
}

/** @param {unknown} v */
function key(v) {
  return String(v ?? '').trim().toLowerCase();
}

/**
 * Pressure at which a realm stops sending words.
 *
 * Three. Not because three is principled, but because it is the smallest number
 * that makes the sequence legible as a sequence: a warning, a harder warning,
 * and then the thing they warned about. Two reads as an accident and four as
 * nagging.
 */
export const PRESSURE_BREAK = 3;

/**
 * The reply shapes. Adding one here is the only way to add a reply, and every
 * effect below is a constant.
 *
 * `cost` and `opinion` are deliberately visible in the preview before anything
 * is clicked. A reply whose price the player learns afterwards is the same
 * class of failure as a proposal whose preview understates what it does.
 *
 * @typedef {object} Reply
 * @property {string} label the button
 * @property {string} summary what it does, in plain English, before clicking
 * @property {number} pressure how pressure moves; negative cools, positive heats
 * @property {(ctx: DispatchContext) => string|null} available null when offered
 * @property {(ctx: DispatchContext) => string[]} effects literal CK3 script, or none
 */

/**
 * @typedef {object} DispatchContext
 * @property {any} state the live snapshot
 * @property {any} player
 * @property {any} from the realm that sent it
 * @property {any} stance from stances.js
 * @property {number} pressure what this realm has already been made to feel
 */

/** Opinion the player's answer is worth, per reply. */
const CONCILIATE_OPINION = 25;
const TRIBUTE_OPINION = 45;
const APPEAL_OPINION = 30;
const DEFY_OPINION = -30;

/** What an answer costs the player. Real, and named before the click. */
const CONCILIATE_GOLD = 150;
const TRIBUTE_GOLD = 400;
const APPEAL_PIETY = 100;
const APPEAL_PRESTIGE = 100;
const DEFY_PRESTIGE = 150;

/**
 * The opinion effect, from the sender toward the player.
 *
 * Direction matters and is easy to get backwards. The dispatch came FROM the
 * neighbour, so it is the neighbour's opinion of the player that moves - the
 * player's opinion of them is their own business and no dispatch changes it.
 *
 * @param {number} value
 */
function opinionScript(value) {
  return [
    'scope:hd_sender = {',
    '\tadd_opinion = {',
    '\t\ttarget = scope:hd_player',
    '\t\tmodifier = hd_historical_opinion',
    `\t\topinion = ${safeInt(value)}`,
    '\t}',
    '}',
  ];
}

/** @type {Record<string, Reply>} */
export const REPLIES = {
  ignore: {
    label: 'Say nothing',
    summary:
      'No answer, and no cost today. They will remember that they were not answered, and the next word from them will be harder.',
    pressure: +1,
    available: () => null,
    // The only reply that stages nothing at all. Silence is not a message, and
    // writing an empty batch to the run file to represent it would be the
    // orchestrator inventing an event the world never saw.
    effects: () => [],
  },

  conciliate: {
    label: 'Send reassurances',
    summary: `An envoy, warm words and ${CONCILIATE_GOLD} gold. Cools them somewhat.`,
    pressure: -1,
    available: () => null,
    effects: () => [
      `scope:hd_player = { add_gold = -${CONCILIATE_GOLD} }`,
      ...opinionScript(CONCILIATE_OPINION),
    ],
  },

  tribute: {
    label: 'Send tribute',
    summary: `${TRIBUTE_GOLD} gold, openly. Cools them markedly, and everyone will know you paid.`,
    pressure: -2,
    available: () => null,
    effects: () => [
      `scope:hd_player = { add_gold = -${TRIBUTE_GOLD} }`,
      // Paying off a rival is a public act and the record treats it as one.
      `scope:hd_player = { add_prestige = -${TRIBUTE_GOLD / 4} }`,
      ...opinionScript(TRIBUTE_OPINION),
    ],
  },

  appeal_to_faith: {
    label: 'Appeal to shared faith',
    summary: `Invoke the faith you hold in common. Costs ${APPEAL_PIETY} piety and no gold.`,
    pressure: -1,
    // Map-gated, like a war kind. An appeal to a faith you do not share is not
    // a weaker argument, it is a different conversation, and offering it would
    // be the sidebar inventing a relationship the map does not contain.
    available({ player, from }) {
      const a = key(player?.faith);
      const b = key(from?.faith);
      if (!a || !b) return 'the snapshot does not carry both faiths';
      if (a !== b) return `you are ${player.faith} and they are ${from.faith}`;
      return null;
    },
    effects: () => [
      `scope:hd_player = { add_piety = -${APPEAL_PIETY} }`,
      ...opinionScript(APPEAL_OPINION),
    ],
  },

  appeal_to_kin: {
    label: 'Appeal to kinship',
    summary: `Invoke the line you share. Costs ${APPEAL_PRESTIGE} prestige and no gold.`,
    pressure: -1,
    available({ player, from }) {
      const house = key(player?.house);
      const dynasty = key(player?.dynasty);
      if (!house && !dynasty) return 'the snapshot does not carry your line';
      const shared = (house && house === key(from?.house))
        || (dynasty && dynasty === key(from?.dynasty));
      if (!shared) return `you share no line with ${from?.ruler ?? 'them'}`;
      return null;
    },
    effects: () => [
      `scope:hd_player = { add_prestige = -${APPEAL_PRESTIGE} }`,
      ...opinionScript(APPEAL_OPINION),
    ],
  },

  defy: {
    label: 'Answer with defiance',
    summary:
      `A public refusal. ${DEFY_PRESTIGE} prestige to you, and they will harden against you faster than silence would.`,
    pressure: +2,
    available: () => null,
    effects: () => [
      `scope:hd_player = { add_prestige = ${DEFY_PRESTIGE} }`,
      ...opinionScript(DEFY_OPINION),
    ],
  },
};

export const REPLY_KEYS = Object.keys(REPLIES);

/** @param {unknown} k */
export function isReply(k) {
  return typeof k === 'string' && Object.hasOwn(REPLIES, k);
}

/**
 * Build the dispatch a stance produces, with the replies this map allows.
 *
 * Returns null for a stance nobody would send a message about. `watchful` is
 * not a dispatch: a realm with no strong view writing to you every five years
 * is how a living world becomes spam.
 *
 * @param {DispatchContext} ctx
 * @returns {null | {
 *   id: string, fromId: number, from: string, ruler: string,
 *   stance: string, posture: string, evidence: string[],
 *   pressure: number, breaking: boolean,
 *   replies: Array<{key: string, label: string, summary: string, pressure: number}>,
 *   withheld: Record<string, string>,
 * }}
 */
export function dispatchFor(ctx) {
  const { from, stance, pressure = 0 } = ctx ?? {};
  if (!from || !stance) return null;
  if (stance.key === 'watchful') return null;

  /** @type {Array<{key: string, label: string, summary: string, pressure: number}>} */
  const replies = [];
  /** @type {Record<string, string>} */
  const withheld = {};

  for (const k of REPLY_KEYS) {
    const why = REPLIES[k].available(ctx);
    if (why) { withheld[k] = why; continue; }
    replies.push({
      key: k,
      label: REPLIES[k].label,
      summary: REPLIES[k].summary,
      pressure: REPLIES[k].pressure,
    });
  }

  return {
    id: `dispatch-${from.id}`,
    fromId: from.id,
    from: from.primaryTitle || from.ruler || `character ${from.id}`,
    ruler: from.ruler ?? '',
    stance: stance.key,
    // The readable form as well as the key. The sidebar was rendering "Kingdom
    // of Navarra is at_war", which is the internal name leaking into the one
    // place in this project that is supposed to read like a person wrote it.
    stanceLabel: stance.label ?? stance.key,
    posture: stance.posture,
    evidence: stance.evidence ?? [],
    pressure,
    // The last word before something else happens. The sidebar has to say so
    // outright: a warning the player did not know was the final one is not a
    // warning, and the coalition that follows would be a trap rather than a
    // consequence.
    breaking: pressure >= PRESSURE_BREAK - 1,
    replies,
    withheld,
  };
}

/**
 * What a reply does to the game.
 *
 * Reached by lookup, never by interpolation, so a key not in the table yields
 * no script rather than a malformed line - the same property momentum.js and
 * the war table rely on. The player's chosen key is the only input, and it is
 * checked against the table before anything is composed.
 *
 * @param {string} replyKey
 * @param {DispatchContext} ctx
 * @param {number} token
 * @returns {string[]}
 */
export function replyScript(replyKey, ctx, token) {
  if (!isReply(replyKey)) return [];

  const reply = REPLIES[replyKey];
  // Availability is re-checked here and not only when the buttons were drawn.
  // The snapshot can move between a dispatch being rendered and answered, and a
  // reply that was legal when it was offered is not necessarily legal when it
  // is taken.
  if (reply.available(ctx)) return [];

  const effects = reply.effects(ctx);
  if (effects.length === 0) return [];

  const playerTag = tagOf(ctx.state, ctx.player?.id);
  const senderTag = tagOf(ctx.state, ctx.from?.id);
  if (playerTag === null || senderTag === null) return [];

  return [
    ...resolveTagged(playerTag, 'hd_player'),
    ...resolveTagged(senderTag, 'hd_sender'),
    'if = {',
    '\tlimit = {',
    '\t\texists = scope:hd_player',
    '\t\texists = scope:hd_sender',
    '\t}',
    ...effects.map((l) => `\t${l}`),
    `\tdebug_log = "HD:/;/applied/;/${token}/;/dispatch_reply/;/ok"`,
    '}',
    'else = {',
    `\tdebug_log = "HD:/;/refused/;/${token}/;/dispatch_reply/;/precondition_failed"`,
    '}',
  ];
}

/**
 * Resolve a character id into the tag the game can find it by.
 * @param {any} state @param {number|null|undefined} id
 */
function tagOf(state, id) {
  const realm = state?.realmsById?.get(safeInt(id));
  return realm && Number.isInteger(realm.tag) ? realm.tag : null;
}

/**
 * Where pressure stands after a reply.
 *
 * Floored at zero and capped at the break point. Pressure is a countdown to a
 * consequence, not a score, and letting it run to nine would mean a realm that
 * was ignored for a century is nine times angrier than one ignored three times
 * - which is both untrue and unplayable.
 *
 * @param {number} current
 * @param {string} replyKey
 * @returns {number}
 */
export function pressureAfter(current, replyKey) {
  const now = Number.isFinite(current) ? current : 0;
  if (!isReply(replyKey)) return now;
  return Math.max(0, Math.min(PRESSURE_BREAK, now + REPLIES[replyKey].pressure));
}

/**
 * The line the sidebar shows above the reply buttons.
 *
 * Says what silence costs, every time, because that is the sentence the whole
 * consent argument rests on. A player who reaches a coalition should be able to
 * point at the three times they were told.
 *
 * @param {{pressure: number, breaking: boolean, from: string}} dispatch
 * @returns {string}
 */
export function pressureNote(dispatch) {
  const { pressure, breaking, from } = dispatch;
  if (breaking) {
    return `${from} has been left unanswered before, and this is the last word you will get from them.`
      + ' Say nothing again, or answer with defiance, and they will stop writing and start acting.';
  }
  if (pressure > 0) {
    return `${from} has written before and was not answered. Pressure ${pressure} of ${PRESSURE_BREAK}.`;
  }
  return `${from} has not written before. Pressure 0 of ${PRESSURE_BREAK}.`;
}
