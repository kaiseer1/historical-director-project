import { REGIONS, isSupported, label, labelList } from './regions.js';

/**
 * The sphere of influence: the bounded set of regions the Director is allowed
 * to look at for a given player.
 *
 * Feeding the model the whole world is both unaffordable and bad design; an
 * ahistorical kingdom in Siberia is not the Byzantine player's problem. The
 * sphere is seeded deterministically from where the player actually sits and
 * grown outward through the adjacency graph. The model may then narrow it, but
 * never widen it past what we seeded - a bounded attention window is the
 * point, and a model that could expand its own scope would not be bounded at
 * all.
 *
 * Two things changed here after a 1217 campaign whose realm ran from the Tagus
 * to Sicily and whose sphere was four regions wide.
 *
 * **The seed is the realm, not the capital.** It used to be the regions the
 * player's *capital county* falls inside. For a compact duchy those are the
 * same thing. For an empire spanning Iberia, the Maghreb and Sicily they are
 * not: the capital sits in one region, so the Director watched Iberia and
 * whatever adjoined it while the player's own Sicilian and Maghrebi provinces
 * lay outside the window. The mod now also reports every supported region the
 * player's realm holds land in, and all of them seed the sphere. Ground you
 * rule is ground the Director can see.
 *
 * **Reach is a dial.** Growth was hard-coded to one step and six regions. It is
 * now `reach` steps and `max` regions, both configurable, because how wide the
 * window should be is a judgement about the campaign - and about how much the
 * player wants to spend on each audit - not a constant.
 *
 * Cost scales with the sphere, and the player is the one paying it: each region
 * adds a county sweep in game and more realms in the prompt. Hence `max`, which
 * is a ceiling rather than a target.
 *
 * @param {string[]} homeRegions region ids the player's capital falls inside
 * @param {{reach?: number, max?: number, footprint?: string[]}} [opts]
 * @returns {{regions: string[], home: string[], footprint: string[], unsupported: string[], note: string}}
 */
export function seedSphere(homeRegions, opts = {}) {
  const reach = Math.max(0, Math.trunc(opts.reach ?? 1));
  const max = Math.max(1, Math.trunc(opts.max ?? 6));

  const home = dedupe(homeRegions.filter(isSupported));
  const unsupported = dedupe(homeRegions.filter((r) => !isSupported(r)));

  // Regions the player's realm reaches into but is not capitaled in. Seeded at
  // distance 0 alongside home: they are equally "where the player is".
  const footprint = dedupe((opts.footprint ?? []).filter(isSupported))
    .filter((r) => !home.includes(r));

  const seeds = [...home, ...footprint];

  // Breadth-first, so a region two steps out never displaces one at a single
  // step. Insertion order within a layer follows the catalogue, which makes
  // the sphere reproducible for a given player rather than dependent on the
  // order the game happened to report regions in.
  /** @type {string[]} */
  const ordered = [...seeds];
  const seen = new Set(seeds);
  let frontier = seeds;

  for (let step = 0; step < reach && ordered.length < max; step++) {
    /** @type {string[]} */
    const next = [];
    for (const id of frontier) {
      for (const n of REGIONS[id]?.neighbours ?? []) {
        if (!isSupported(n) || seen.has(n)) continue;
        seen.add(n);
        next.push(n);
        ordered.push(n);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }

  // Truncation drops the periphery rather than the ground the player stands on,
  // because `ordered` is already home-first then outward.
  const regions = ordered.slice(0, max);

  return { regions, home, footprint, unsupported, note: describe({ regions, home, footprint, unsupported, max, reach }) };
}

/**
 * The sentence the sidebar and the log show. It has to be honest about three
 * separate things: where the seed came from, how far it grew, and whether the
 * ceiling cut it short - that last one especially, because a player who raises
 * `reach` and sees no change deserves to be told the cap is what stopped it
 * rather than left to guess.
 */
function describe({ regions, home, footprint, unsupported, max, reach }) {
  if (home.length === 0 && footprint.length === 0) {
    return unsupported.length > 0
      ? `The player's capital lies in ${labelList(unsupported)}, which is Phase II coverage. The Director has no grounded basis to act here.`
      : 'The player could not be located in any known region.';
  }

  const seeds = [...home, ...footprint];
  const grown = regions.filter((r) => !seeds.includes(r));

  const seededFrom = footprint.length
    ? `Seeded from ${labelList(home)}, where the capital sits, plus ${labelList(footprint)}, where the realm holds land`
    : `Seeded from ${labelList(home)}`;

  const extended = grown.length
    ? `, extended ${reach} step${reach === 1 ? '' : 's'} to ${labelList(grown)}`
    : reach > 0 ? ', with no further supported region within reach' : '';

  const capped = regions.length >= max
    ? ` Held at the ${max}-region ceiling; raise it in Settings to widen further.`
    : '';

  return `${seededFrom}${extended}.${capped}`;
}

/** @param {string[]} xs */
function dedupe(xs) {
  return [...new Set(xs)];
}

/**
 * Apply the model's narrowing of a seeded sphere. Anything it names that we
 * did not seed is dropped rather than honoured.
 *
 * @param {string[]} seeded
 * @param {string[]} requested
 */
export function narrowSphere(seeded, requested) {
  const allowed = new Set(seeded);
  const kept = requested.filter((r) => allowed.has(r));
  const rejected = requested.filter((r) => !allowed.has(r));
  return { regions: kept.length > 0 ? kept : seeded, rejected };
}
