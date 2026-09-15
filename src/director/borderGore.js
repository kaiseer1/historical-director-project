/**
 * Ahistorical holdings: who is holding ground on the player's own soil while
 * being ruled from somewhere else entirely.
 *
 * ## What this is, and the thing it is careful not to be
 *
 * "Border gore" is the symptom that started this project and it is not the
 * goal. A map is not wrong because it is ugly, and a realm is not ahistorical
 * because a war went differently than it did in the record: divergence is the
 * point of playing. What this module looks for is narrower and more defensible
 * - a holding whose *shape of authority* nobody in the period would recognise.
 * A duchy in Anatolia answering to a court in Paris is not a different outcome
 * of the eleventh century. It is a different eleventh century.
 *
 * So this module nominates candidates and says why. It does not judge them.
 * The judging is the model's, against retrieved evidence, and the deciding is
 * the player's - the same division of labour as everywhere else here.
 *
 * ## The three facts the detector needs, and which are actually observed
 *
 *   1. Where a realm HOLDS land. Observed since the region sweep: `regions`.
 *   2. Where a realm is RULED FROM. Observed as of v0.11.0: `capitalRegions`,
 *      from the seat probe in ck3Script.js.
 *   3. WHICH major title is being held there. Observed as of v0.11.0:
 *      `majorTitles`, duchy and kingdom tier, personally held.
 *
 * Culture used to stand in for all three and was a poor substitute for any of
 * them: it records where a dynasty came from, not where its land is, so an
 * Andalusian sheikh in Libya and a player ruling from Cairo both read as
 * Iberian. None of that reasoning is used here.
 *
 * ## Why an unseated realm is not automatically a foreigner
 *
 * A realm reporting no seat has its capital outside the swept sphere - or the
 * probe did not run, or the log was truncated before its records. Those are
 * different situations with opposite meanings, and `seatsObserved` on the
 * snapshot is what tells them apart. Where the probe did not run this module
 * returns nothing at all and says so, because a missing field must never read
 * as a difference.
 *
 * ## Frontiers are not gore
 *
 * The first version of the test flagged everyone whose capital was not in the
 * player's own region, which on any real map means every neighbour with a
 * county over the line. A Serbian duke seated in the Balkans holding ground in
 * Anatolia is a frontier realm and frontier realms are how borders have always
 * worked. So an adjacent seat is reported as ordinary and only a distant or
 * outside one is put to the model.
 */

import { REGIONS, labelList } from './regions.js';

/** How many candidates the briefing will carry. */
const MAX_FLAGGED = 6;

/** Tiers worth raising at all. A stray county is not an ahistorical holding. */
const MAJOR = new Set(['duchy', 'kingdom', 'empire']);

/**
 * Is `seat` next door to any of `held`, or one of them?
 *
 * Adjacency comes from the same graph the sphere is grown through, so "next
 * door" here means exactly what it means when the sphere is seeded.
 *
 * @param {string} seat
 * @param {string[]} held
 */
function adjacentTo(seat, held) {
  if (held.includes(seat)) return true;
  const neighbours = REGIONS[seat]?.neighbours ?? [];
  return held.some((h) => neighbours.includes(h));
}

/**
 * The cultures actually seated in a region, largest first.
 *
 * Seated, not present: a realm holding two counties here from a court in
 * Toledo says nothing about what this country is, which is the whole point of
 * the exercise. Used only to give the model context for judging whether a
 * holder is alien to the place, never to decide anything here.
 *
 * @param {any} state
 * @param {string} region
 * @returns {string[]}
 */
function culturesSeatedIn(state, region) {
  /** @type {Map<string, number>} */
  const tally = new Map();
  for (const r of state.realmsById?.values?.() ?? []) {
    if (!(r.capitalRegions ?? []).includes(region)) continue;
    const key = r.culture || 'unknown';
    tally.set(key, (tally.get(key) ?? 0) + (r.countiesInSphere || 1));
  }
  return [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([c]) => c);
}

/**
 * Find the realms holding ground on the player's own soil from a seat
 * elsewhere.
 *
 * @param {{state: any, home?: string[]}} args `home` is the player's own
 *   regions - where they hold land - not the whole sphere. The sphere is what
 *   the Director watches; this is the ground the question is about.
 * @returns {{observed: boolean, reason: string, flagged: any[], frontier: any[]}}
 */
export function outsiders({ state, home = [] }) {
  if (!state?.realmsById) return { observed: false, reason: 'no snapshot', flagged: [], frontier: [] };
  if (!state.seatsObserved) {
    return {
      observed: false,
      reason: 'no realm in this snapshot reported where it is ruled from, so nothing can be said about who is a foreigner here. The seat probe arrived in v0.11.0; an older orchestrator, or a log truncated before those records, produces exactly this silence',
      flagged: [],
      frontier: [],
    };
  }

  const homeSet = new Set(home);
  if (homeSet.size === 0) return { observed: false, reason: 'the player could not be placed in any region', flagged: [], frontier: [] };

  const playerId = state.player?.id;
  /** @type {any[]} */
  const flagged = [];
  /** @type {any[]} */
  const frontier = [];

  for (const r of state.realmsById.values()) {
    // The player's own far-flung holdings are the player's business. The
    // Director exists to put history in front of them, not to tidy up after
    // them, and a Director that proposed correcting its own player's borders
    // would be playing the game.
    if (playerId !== undefined && r.id === playerId) continue;

    const held = (r.regions ?? []).filter((x) => homeSet.has(x));
    if (held.length === 0) continue;

    const seats = r.capitalRegions ?? [];
    if (seats.some((s) => homeSet.has(s))) continue; // seated on the same ground: a local

    // Named titles first, because a named duchy is evidence and a county count
    // is an inference. A realm with neither a major tier nor a major title
    // inside this ground is a stray county and not worth an audit's attention.
    const titles = (r.majorTitles ?? []).filter((t) => homeSet.has(t.region));
    if (!MAJOR.has(r.tierKey ?? '') && titles.length === 0) continue;

    const entry = {
      id: r.id,
      ruler: r.ruler,
      primaryTitle: r.primaryTitle,
      tierKey: r.tierKey ?? null,
      culture: r.culture,
      faith: r.faith,
      counties: r.countiesInSphere,
      held,
      seats,
      titles,
      locals: [...new Set(held.flatMap((h) => culturesSeatedIn(state, h)))].slice(0, 3),
    };

    if (seats.length === 0) {
      entry.seatNote = 'ruled from outside the observed sphere entirely';
      flagged.push(entry);
    } else if (seats.some((s) => adjacentTo(s, held))) {
      entry.seatNote = `ruled from ${labelList(seats)}, next door`;
      frontier.push(entry);
    } else {
      entry.seatNote = `ruled from ${labelList(seats)}, which does not border the ground they hold here`;
      flagged.push(entry);
    }
  }

  // Largest first. A king holding nine counties from across the world is a
  // different proposition from a duke holding one, and the model should meet
  // them in that order.
  flagged.sort((a, b) => b.counties - a.counties);
  frontier.sort((a, b) => b.counties - a.counties);

  return { observed: true, reason: '', flagged, frontier };
}

/**
 * The prompt section.
 *
 * Written as evidence rather than as an accusation. Every line is something the
 * game reported; the words "ahistorical" and "border gore" appear once, in the
 * instruction, and never in a row - because a row that has already reached a
 * verdict invites the model to agree with it rather than judge it.
 *
 * Returns '' when there is nothing to say, so the caller can omit the heading
 * entirely rather than print a section that says "none".
 *
 * @param {{state: any, home?: string[]}} args
 * @returns {string}
 */
export function borderGoreBriefing({ state, home = [] }) {
  const { observed, reason, flagged, frontier } = outsiders({ state, home });

  if (!observed) {
    // Said out loud rather than omitted. The model is being asked elsewhere to
    // judge the shape of the map, and it should know when one of the facts it
    // would need was not measured this time.
    return `Not measured this audit: ${reason}. Do not infer from this section's silence that every holding here is local.`;
  }
  if (flagged.length === 0 && frontier.length === 0) return '';

  /** @type {string[]} */
  const out = [];

  if (flagged.length) {
    out.push(
      `Holdings on the player's own ground (${labelList(home)}) whose holder is seated elsewhere:`,
    );
    for (const f of flagged.slice(0, MAX_FLAGGED)) {
      const titles = f.titles.length
        ? `Holds ${f.titles.map((t) => `${t.name} (${t.tierKey})`).join(' and ')} here`
        : `Holds ${f.counties} counties here`;
      const locals = f.locals.length
        ? ` The cultures actually seated in ${labelList(f.held)} are ${f.locals.join(', ')}.`
        : '';
      out.push(
        `- id ${f.id}: ${f.ruler} of ${f.primaryTitle}${f.tierKey ? ` (${f.tierKey})` : ''}, ${f.culture}/${f.faith}.`
        + ` ${titles}, and is ${f.seatNote}.${locals}`,
      );
    }
    if (flagged.length > MAX_FLAGGED) out.push(`- ... and ${flagged.length - MAX_FLAGGED} further such holders, not listed`);
  }

  if (frontier.length) {
    out.push(
      '',
      `Ordinary frontier holders, listed so you know they were considered and set aside: ${frontier
        .slice(0, 4)
        .map((f) => `${f.primaryTitle} (${f.seatNote})`)
        .join('; ')}. A neighbour holding land over the line is how borders have always worked and is not a divergence.`,
    );
  }

  return out.join('\n');
}
