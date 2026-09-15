/**
 * What the world thinks of the player.
 *
 * ## The direction this runs
 *
 * Everything else here runs one way. The Director looks at the map, proposes a
 * change to somebody else's realm, and the player approves it. The world is a
 * thing acted upon and it never has an opinion about the person acting.
 *
 * That is why a campaign can feel inert however well the corrections land. A
 * taifa reversing the Reconquista is the most interesting thing on the
 * peninsula, and Castile has nothing to say about it. Granada takes Cordoba and
 * the only entity in the world that notices is the sidebar.
 *
 * This module runs the other way: for each realm near the player, what does the
 * live map give them reason to feel, and what is the evidence for it.
 *
 * ## Why it needs no approval gate
 *
 * Because it changes nothing. Every function here is a pure reading of the
 * snapshot and the baseline - no script is composed, no effect is staged,
 * nothing reaches the run file. A stance is something the sidebar can say and
 * the prompt can carry, and that is all it is.
 *
 * That is the whole reason to build this half first. The mechanical expression
 * of a stance - an opinion modifier, a warning event, a coalition - does change
 * the game and does need consent, and it needs a consent model nobody has
 * designed yet. The *reading* needs none of that, costs nothing, and is most of
 * what makes a world feel awake.
 *
 * `opinion` is carried on each stance as a SUGGESTION for whatever eventually
 * applies one. Nothing in this module applies it. If that changes, it changes
 * through the toolkit and the approval gate like every other mechanical effect.
 *
 * ## Every stance names its evidence
 *
 * Same rule the refusals in warKinds.js follow, and for the same reason: a
 * stance the player cannot audit is indistinguishable from one the model
 * invented, and this project's whole claim is that those can be told apart.
 * The evidence lines are map-derived facts, and they are what the prompt is
 * given - the model writes what a realm *says*, never what it *feels*.
 */

/**
 * Realms whose land touches the same region. The snapshot reports one record
 * per realm per region, so this is a question the map has answered rather than
 * one anyone has to infer from culture.
 *
 * @param {any} a
 * @param {any} b
 */
function sharesGround(a, b) {
  const mine = new Set(a?.regions ?? []);
  return (b?.regions ?? []).some((r) => mine.has(r));
}

/** @param {unknown} v */
function text(v) {
  return String(v ?? '').trim();
}

/** @param {unknown} v */
function key(v) {
  return text(v).toLowerCase();
}

/**
 * How much bigger one realm is than another, in counties inside the sphere.
 *
 * Footprint is counted within the sphere and not globally, so a realm
 * straddling its edge reads smaller than it is. Every threshold below is set
 * well clear of 1 for that reason: this is for telling "looming" from "a peer",
 * not for ranking.
 *
 * @param {any} a
 * @param {any} b
 */
function ratio(a, b) {
  const mine = a?.countiesInSphere ?? 0;
  const theirs = b?.countiesInSphere ?? 0;
  if (theirs <= 0) return mine > 0 ? Infinity : 1;
  return mine / theirs;
}

/** Looming. Deliberately high, because footprint understates. */
const DOMINANT = 2.0;
/** Growing past comfortable, short of looming. */
const LARGER = 1.25;

/**
 * Which realms matching a test have measurably lost ground since this campaign
 * began.
 *
 * This is the tide, and it is measured only from losses. The baseline reports a
 * loss and never a gain, on purpose - a widened sphere can manufacture a gain
 * but cannot hide a loss - so counting losses is the one direction that can be
 * trusted without knowing how the window has moved.
 *
 * It is what lets Castile notice something no single proposal contains: not
 * that Granada took a county, but that three realms of its faith are smaller
 * than they were and the man doing it prays differently.
 *
 * @param {any} state
 * @param {any} baseline
 * @param {(realm: any) => boolean} matches
 * @returns {{count: number, names: string[]}}
 */
function losingGround(state, baseline, matches) {
  /** @type {string[]} */
  const names = [];
  if (typeof baseline?.delta !== 'function') return { count: 0, names };

  for (const realm of state?.realmsById?.values?.() ?? []) {
    if (!matches(realm)) continue;
    let d;
    try { d = baseline.delta(realm); } catch { continue; }
    // `known` matters as much as `lost`. A realm the baseline never saw has no
    // trajectory, and reading that as "has not lost" would let a world come
    // apart quietly.
    if (d?.known && d.lost) names.push(realm.primaryTitle || realm.ruler);
  }
  return { count: names.length, names };
}

/** How many realms have to be shrinking before it reads as a tide. */
const TIDE = 2;

/**
 * @typedef {object} Stance
 * @property {string} key
 * @property {string} label how the sidebar names it
 * @property {string} posture one line the prompt can build prose from
 * @property {string[]} evidence map-derived facts, each independently checkable
 * @property {number} opinion a SUGGESTED opinion delta; nothing here applies it
 */

/**
 * @typedef {object} StanceContext
 * @property {any} state the live snapshot
 * @property {any} observer the realm doing the looking
 * @property {any} [player] defaults to state.player
 * @property {any} [baseline]
 */

/**
 * What this realm has reason to feel about the player, and why.
 *
 * Ordered most specific first. The first stance whose conditions hold is the
 * one returned, because a realm that is both alarmed and merely wary is
 * alarmed, and reporting both would be the sidebar hedging.
 *
 * Returns null - not a neutral stance - when the observer is the player, when
 * either side is unreadable, or when nothing on the map gives them a view.
 * Silence is the honest answer there, and a world where every realm has a
 * feeling about you is as unconvincing as one where none does.
 *
 * @param {StanceContext} ctx
 * @returns {Stance|null}
 */
export function stanceToward(ctx) {
  const state = ctx?.state;
  const observer = ctx?.observer;
  const player = ctx?.player ?? state?.player;
  const baseline = ctx?.baseline ?? null;

  if (!observer || !player) return null;
  if (observer.id === player.id) return null;

  const near = sharesGround(observer, player) || observer.inNeighbourhood;
  const size = ratio(player, observer);

  // Faith is read, never assumed. A snapshot that lost its faith fields to log
  // truncation must not produce a stance built on a difference nobody observed.
  const pf = key(player.faith);
  const of = key(observer.faith);
  const faithsKnown = Boolean(pf && of);
  const differentFaith = faithsKnown && pf !== of;
  const sameFaith = faithsKnown && pf === of;

  // Two tides, and they are mirrors of each other. One is realms of the
  // observer's own faith shrinking while a stranger's faith advances; the other
  // is everyone else shrinking while the observer's faith advances. The first
  // is what alarms Castile. The second is what emboldens it.
  //
  // Both are only asked for when they could mean something - a co-religionist's
  // losses say nothing about a faith boundary that does not exist - so an
  // unknown faith produces neither, which is the same fail-closed rule the rest
  // of this file follows.
  const tideAgainst = differentFaith && of
    ? losingGround(state, baseline, (r) => key(r.faith) === of)
    : { count: 0, names: [] };

  const tideFor = sameFaith && of
    ? losingGround(state, baseline, (r) => key(r.faith) && key(r.faith) !== of)
    : { count: 0, names: [] };

  /** @type {string[]} */
  const ev = [];
  if (near) ev.push('holds land where you do');
  if (size >= DOMINANT) {
    ev.push(`you hold ${player.countiesInSphere} counties here to their ${observer.countiesInSphere}`);
  } else if (size >= LARGER) {
    ev.push(`you have grown larger than them: ${player.countiesInSphere} counties to ${observer.countiesInSphere}`);
  }
  if (differentFaith) ev.push(`you are ${player.faith}, they are ${observer.faith}`);
  if (sameFaith) ev.push(`they share your faith`);

  const atWar = typeof state?.warBetween === 'function' ? state.warBetween(player.id, observer.id) : null;
  if (atWar) ev.push(`they are at war with you${atWar.name ? ` (${atWar.name})` : ''}`);

  let ownLoss = null;
  if (typeof baseline?.delta === 'function') {
    try {
      const d = baseline.delta(observer);
      if (d?.known && d.lost) {
        ownLoss = d.lost;
        ev.push(`they have lost ground since the campaign began: ${d.lost}`);
      }
    } catch { /* a baseline that cannot judge them says nothing about them */ }
  }

  // --- the tide, and it outranks everything else -------------------------
  //
  // Not "you are bigger than me" but "the world is moving against my faith and
  // you are why". That is the sentence a Reconquista running backwards
  // actually produces, and no single proposal contains it.
  if (differentFaith && tideAgainst.count >= TIDE && near) {
    return {
      key: 'alarmed',
      label: 'alarmed',
      posture: 'watching a tide run the wrong way, and naming you as the cause',
      evidence: [
        ...ev,
        `${tideAgainst.count} realms of their faith have lost ground since the campaign began: ${tideAgainst.names.slice(0, 4).join(', ')}`,
      ],
      opinion: -40,
    };
  }

  // The mirror, and it is checked before `threatened` on purpose. A large
  // co-religionist neighbour is frightening by default and should read that way
  // - but not while they are the reason your faith is winning. What emboldens a
  // realm is a tide running its way, not a neighbour that happens to pray the
  // same. The first version of this fired on size and faith alone, which made
  // every small Catholic duchy beside a large Catholic empire "emboldened" by
  // nothing at all.
  if (sameFaith && tideFor.count >= TIDE && near && size >= LARGER) {
    return {
      key: 'emboldened',
      label: 'emboldened',
      posture: 'taking heart from a tide running their way, and you are driving it',
      evidence: [
        ...ev,
        `${tideFor.count} realms of other faiths have lost ground since the campaign began: ${tideFor.names.slice(0, 4).join(', ')}`,
      ],
      opinion: 25,
    };
  }

  if (atWar) {
    return {
      key: 'at_war',
      label: 'at war with you',
      posture: 'already fighting you, and judging everything through that',
      evidence: ev,
      opinion: -30,
    };
  }

  if (near && size >= DOMINANT) {
    return {
      key: 'threatened',
      label: 'threatened',
      posture: 'a neighbour too large to fight and too close to ignore',
      evidence: ev,
      opinion: -25,
    };
  }

  // A weakened neighbour is an invitation, and the record is full of powers
  // that moved the moment one appeared. This is the stance that should make a
  // bad decade frightening rather than merely inconvenient.
  if (near && ownLoss === null && size <= 1 / DOMINANT) {
    return {
      key: 'opportunistic',
      label: 'opportunistic',
      posture: 'larger than you, close to you, and aware of both',
      evidence: [...ev, `they are the larger power here: ${observer.countiesInSphere} counties to your ${player.countiesInSphere}`],
      opinion: -10,
    };
  }

  if (near && differentFaith && size >= LARGER) {
    return {
      key: 'wary',
      label: 'wary',
      posture: 'uneasy about a neighbour of another faith who keeps growing',
      evidence: ev,
      opinion: -15,
    };
  }

  if (near) {
    return {
      key: 'watchful',
      label: 'watchful',
      posture: 'a neighbour with no strong view, paying attention anyway',
      evidence: ev,
      opinion: 0,
    };
  }

  // Distant and unremarkable. The honest answer is nothing at all.
  return null;
}

/**
 * Every realm with something to say, strongest feeling first.
 *
 * Capped, because this goes into a prompt and into a sidebar and neither is
 * improved by sixty realms being mildly watchful. The cap takes the strongest
 * stances rather than the nearest, so a distant power that has genuinely
 * noticed you outranks a neighbour who has not.
 *
 * @param {{state: any, baseline?: any, max?: number}} args
 * @returns {Array<{realm: any, stance: Stance}>}
 */
export function dispatches({ state, baseline = null, max = 6 }) {
  const player = state?.player;
  if (!player) return [];

  /** @type {Array<{realm: any, stance: Stance}>} */
  const out = [];
  for (const realm of state?.realmsById?.values?.() ?? []) {
    const stance = stanceToward({ state, observer: realm, player, baseline });
    if (stance && stance.key !== 'watchful') out.push({ realm, stance });
  }

  const weight = (s) => Math.abs(s.opinion);
  out.sort((a, b) => weight(b.stance) - weight(a.stance));
  return out.slice(0, max);
}

/**
 * The prompt section: what the neighbours have reason to think, and why.
 *
 * The model is given the evidence and asked for the *words* - what this realm
 * would say - and never for the judgement. The stance is already decided by the
 * map before the model sees it, which is the same division the narrative card
 * runs on: prose that can argue for a reading but cannot produce one.
 *
 * @param {{state: any, baseline?: any, max?: number}} args
 * @returns {string} empty when nobody has a view
 */
export function stanceBriefing({ state, baseline = null, max = 6 }) {
  const list = dispatches({ state, baseline, max });
  if (list.length === 0) return '';

  const lines = list.map(({ realm, stance }) => {
    const who = realm.primaryTitle || realm.ruler || `character ${realm.id}`;
    return `- ${who} (${realm.ruler}) is ${stance.label}: ${stance.posture}.\n`
      + `  Because: ${stance.evidence.join('; ')}.`;
  });

  return `How the neighbours see you. Each stance below was derived from the map, not chosen by you:\n${lines.join('\n')}`;
}
