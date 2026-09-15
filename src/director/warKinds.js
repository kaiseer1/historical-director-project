/**
 * DRAFT - the war grammar. Not wired into the toolkit yet.
 *
 * ## What this replaces
 *
 * `historicalWars.js` holds four wars, and what keeps that action safe is not
 * the locality rule sitting underneath it - it is that the table has four
 * entries. The model picks one of four things. Everything else about the war,
 * every title and modifier and date, is a constant it cannot reach.
 *
 * Generalising deletes that. If the Director may start a war anywhere in the
 * sphere, the constraint that remains is "at least one party is near the
 * player", over an unbounded space of possible wars - which is the shape of the
 * failure `requireLocality` was written for, one level up: bounded attention
 * quietly becoming unbounded agency.
 *
 * So something has to take the table's place as the binding constraint, and it
 * cannot be the model's argument. It is the map.
 *
 * ## The rule
 *
 * The model picks a KIND and a pair of realms. The kind is legal only if the
 * live snapshot independently supports it - a faith boundary, a shared house, a
 * war already running, a realm grown out of all proportion to its neighbours,
 * ground measurably lost since the campaign began. Every one of those is read
 * off data the snapshot already carries, and none of it is anything the model
 * says.
 *
 * That is the same property `momentum.js` and `moments.js` rely on, applied to
 * a larger surface: lookup rather than interpolation, and a gate the model
 * argues to rather than one it fills in.
 *
 * ## Why six casus belli is enough
 *
 * A war's name lives on its casus belli, which is why four wars cost 837 lines
 * of CB script. But Paradox builds war names dynamically from scopes -
 *
 *   CLAIM_WAR_NAME: "[ATTACKER.GetPrimaryTitle.GetAdjective] War for
 *                    [CLAIMANT.GetShortUINamePossessive] Claim on the
 *                    [TITLE.GetBaseName]"
 *   JAPAN_SORYO_CONQUEST_WAR_NAME:
 *                   "[ATTACKER.GetPrimaryTitle.GetAdjective] Conquest of
 *                    [TITLE.GetBaseNameNoTier]"
 *
 * - so one CB per kind yields "Castilian Conquest of Cordoba" and "Aragonese
 * Conquest of Mallorca" from the live map, with no table entry and no new
 * string per war. Verified in the game's own localisation on 2026-09-12;
 * ATTACKER, DEFENDER, CLAIMANT and TITLE are all addressable there.
 *
 * ## What is NOT settled
 *
 * Two things, and neither is this module's to decide:
 *
 *  - Whether the AI can actually prosecute a war it did not choose. Probe P1.
 *    CK3 has no negotiated peace and wars resolve on war score rather than on
 *    willingness, which is promising and is not the same as observed.
 *  - Whether a generalised war can cite anything. A curated war carries its own
 *    `sources`; a generated one would cite whatever the audit happened to
 *    fetch. Per-proposal retrieval is a prerequisite here, not a later polish.
 */

/**
 * Realms whose land touches the same region. The snapshot reports one
 * realm_in_region record per realm per region, so this is a question the map
 * has already answered rather than one anybody has to infer from culture.
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
  return String(v ?? '').trim().toLowerCase();
}

/**
 * Do these two differ in faith, with both faiths actually known?
 *
 * Fails closed, as `momentum.holy_war` does. A snapshot that lost its faith
 * fields to log truncation must not read as "the faiths differ": unknown is not
 * permission, and this gate is the justification for a war.
 *
 * @param {any} a
 * @param {any} b
 * @returns {boolean|null} null when it cannot be known
 */
function faithDiffers(a, b) {
  const x = text(a?.faith);
  const y = text(b?.faith);
  if (!x || !y) return null;
  return x !== y;
}

/**
 * @typedef {object} Kind
 * @property {string} label for prose
 * @property {string} cb the casus belli this kind is fought under
 * @property {string} nameShape what the CB's localisation renders, for the preview
 * @property {string} premise one line: what the record calls this kind of war
 * @property {string} attackerModifier
 * @property {string} defenderModifier
 * @property {number} years how long both last
 * @property {(ctx: KindContext) => string|null} legal null when the map supports it
 */

/**
 * @typedef {object} KindContext
 * @property {any} state the live snapshot
 * @property {any} attacker realm record
 * @property {any} defender realm record
 * @property {any} baseline the campaign baseline, or null
 */

/**
 * How much larger than its neighbours a realm has to be before a war against it
 * counts as a coalition rather than an ordinary quarrel.
 *
 * This is the number the whole hegemon case turns on. CK3's AI evaluates each
 * war on its own merits and correctly declines the ones it would lose, so the
 * stronger a power grows the more inert the world around it becomes - which is
 * the inverse of the record, where hegemony is precisely what caused coalitions
 * to form. A coalition CB is the Director supplying the one judgement the AI
 * structurally cannot make.
 *
 * Measured in counties inside the sphere, which is the only footprint the
 * snapshot has. That is a known understatement for a realm straddling the
 * sphere's edge, so the threshold is deliberately not near 1.
 */
const HEGEMON_RATIO = 2.5;

/** @type {Record<string, Kind>} */
export const KINDS = {
  /**
   * A war across a faith boundary over ground the two already contest. The
   * Iberian case, and the commonest shape in the record this project cares
   * about.
   */
  reconquest: {
    label: 'reconquest',
    cb: 'hd_reconquest_cb',
    nameShape: '[ATTACKER adjective] Reconquest of [TITLE]',
    premise: 'recovering ground held by another faith, along a border both realms already stand on',
    attackerModifier: 'hd_reconquest_resolve',
    defenderModifier: 'hd_beleaguered_realm',
    years: 5,
    legal({ attacker, defender }) {
      const differs = faithDiffers(attacker, defender);
      if (differs === null) return 'reconquest needs both faiths and this snapshot does not carry them';
      if (!differs) return `reconquest needs a faith boundary; both realms are ${attacker.faith}`;
      if (!sharesGround(attacker, defender)) {
        return 'reconquest is a war over a shared frontier, and these two hold land in no common region';
      }
      return null;
    },
  },

  /**
   * A war of religion, framed as a crown's expedition rather than a border
   * quarrel.
   *
   * THE OPEN QUESTION IN THIS GRAMMAR. As written, this does not exclude the
   * shared frontier that reconquest requires, so a Catholic/Muslim pair
   * standing in the same region is legal for both kinds - check-war-kinds.mjs
   * case G1 prints exactly that. The intent was to split them on geography,
   * which is the only axis the snapshot can judge, but geography is a weaker
   * distinction than the record makes: the Reconquista and the crusades were
   * not told apart by whether the armies had to cross water.
   *
   * Left permissive on purpose rather than decided here. Three ways out, and
   * none is obviously right: exclude shared ground and accept the weak split;
   * merge the two kinds and let the war name carry the flavour; or gate holy
   * war on something the snapshot does not yet report, such as whether the
   * faiths are actually hostile to one another rather than merely different.
   */
  holy_war: {
    label: 'holy war',
    cb: 'hd_holy_war_cb',
    nameShape: '[ATTACKER adjective] Holy War for [TITLE]',
    premise: 'a war of religion carried to a realm the attacker does not border',
    attackerModifier: 'hd_crusade_zeal',
    defenderModifier: 'hd_beleaguered_realm',
    years: 5,
    legal({ attacker, defender }) {
      const differs = faithDiffers(attacker, defender);
      if (differs === null) return 'holy war needs both faiths and this snapshot does not carry them';
      if (!differs) return `holy war needs a faith difference; both realms are ${attacker.faith}`;
      if (!attacker.independent) return 'a holy war is a crown\'s war, and this attacker is somebody\'s vassal';
      return null;
    },
  },

  /**
   * A disputed inheritance. The one kind with a genuinely hard gate: the two
   * realms must share a dynasty or a house, which the snapshot reports directly
   * and which no argument can talk its way around.
   */
  succession: {
    label: 'succession',
    cb: 'hd_succession_cb',
    nameShape: '[ATTACKER adjective] War for the Succession of [TITLE]',
    premise: 'a claim within one line, pressed by force',
    attackerModifier: 'hd_succession_momentum',
    defenderModifier: 'hd_beleaguered_realm',
    years: 5,
    legal({ attacker, defender }) {
      const house = text(attacker?.house);
      const dynasty = text(attacker?.dynasty);
      if (!house && !dynasty) return 'succession needs the attacker\'s line and this snapshot does not carry it';
      const shared = (house && house === text(defender?.house))
        || (dynasty && dynasty === text(defender?.dynasty));
      if (!shared) {
        return `succession needs a shared line; ${attacker.ruler} is ${attacker.house || attacker.dynasty}`
          + ` and ${defender.ruler} is ${defender.house || defender.dynasty || 'of no reported line'}`;
      }
      return null;
    },
  },

  /**
   * Joining a war already under way. This is the `add_attacker` case, and it is
   * the only kind that does not begin a war at all - it changes the shape of
   * one the campaign started for itself.
   *
   * Gated on the snapshot's own war records, which arrive once per belligerent
   * inside the sphere. A mod too old to emit wars leaves them undefined, and
   * this refuses rather than guessing, because "not observed" and "no war" are
   * the same silence and only one of them is permission.
   */
  intervention: {
    label: 'intervention',
    cb: 'hd_intervention_cb',
    nameShape: 'joins an existing war; no new war is declared',
    premise: 'a third power entering a war already being fought',
    attackerModifier: 'hd_reconquest_resolve',
    defenderModifier: '',
    years: 5,
    legal({ state, attacker, defender }) {
      if (!Array.isArray(state?.wars)) {
        return 'intervention needs the wars the game is fighting, and this snapshot does not report them';
      }
      const involved = state.wars.some((w) => w.attacker === defender.id || w.defender === defender.id);
      if (!involved) return `intervention needs a war already under way; ${defender.primaryTitle} is at peace`;
      if (attacker.id === defender.id) return 'a realm cannot intervene against itself';
      return null;
    },
  },

  /**
   * The hegemon case, and the reason this grammar exists.
   *
   * Legal only where the defender is disproportionate to the realms around it -
   * measured, not argued. This is the one kind that will regularly point at the
   * player, because in a long campaign the player is usually who it describes.
   *
   * That makes it the kind whose consent model cannot be a per-war card:
   * nobody approves their own beating, and an action that only fires when the
   * player volunteers for it will never fire. It belongs behind an up-front
   * stance the player sets once, knowingly, the way -debug_mode is agreed to.
   * Until that exists, this kind should stay `offered: false`.
   */
  coalition: {
    label: 'coalition',
    cb: 'hd_coalition_cb',
    nameShape: 'the Coalition against [DEFENDER]',
    premise: 'the neighbours of an overgrown power combining against it',
    attackerModifier: 'hd_reconquest_resolve',
    defenderModifier: '',
    years: 5,
    legal({ state, attacker, defender }) {
      const realms = [...(state?.realmsById?.values?.() ?? [])];
      const neighbours = realms.filter((r) => r.id !== defender.id && sharesGround(r, defender));
      if (neighbours.length < 2) {
        return `a coalition needs neighbours to form it, and ${defender.primaryTitle} has fewer than two in this sphere`;
      }
      const sizes = neighbours.map((r) => r.countiesInSphere ?? 0).sort((x, y) => x - y);
      const median = sizes[Math.floor(sizes.length / 2)] || 1;
      const ratio = (defender.countiesInSphere ?? 0) / median;
      if (ratio < HEGEMON_RATIO) {
        return `a coalition answers a power out of all proportion to its neighbours;`
          + ` ${defender.primaryTitle} is ${ratio.toFixed(1)}x the median around it, and the bar is ${HEGEMON_RATIO}x`;
      }
      if (!sharesGround(attacker, defender)) {
        return 'a coalition is raised by those who border the power it fears';
      }
      return null;
    },
  },

  /**
   * A realm recovering ground it measurably held when the campaign began.
   *
   * Gated on the baseline's footprint signal - the one that spent thirty-seven
   * audits being captured and never read while Iberia came apart around a Leon
   * whose rank had not moved. This kind is that signal finally being actionable
   * rather than only reportable.
   */
  restoration: {
    label: 'restoration',
    cb: 'hd_restoration_cb',
    nameShape: '[ATTACKER adjective] Restoration of [TITLE]',
    premise: 'a realm recovering what it has demonstrably lost since the campaign began',
    attackerModifier: 'hd_reconquest_resolve',
    defenderModifier: '',
    years: 5,
    legal({ attacker, defender, baseline }) {
      if (typeof baseline?.delta !== 'function') {
        return 'restoration is measured against the campaign baseline, and there is none yet';
      }
      const d = baseline.delta(attacker);
      if (!d.known) return `restoration needs a baseline for ${attacker.primaryTitle}, and the campaign has none`;
      if (!d.lost) return `restoration needs ground actually lost; ${attacker.primaryTitle} reads "${d.label}"`;
      if (!sharesGround(attacker, defender)) {
        return 'restoration recovers ground, so the realm holding it has to be standing on the same map';
      }
      return null;
    },
  },
};

/** Every kind, whether or not it is currently offered to the model. */
export const KIND_KEYS = Object.keys(KINDS);

/** @param {unknown} key */
export function isKind(key) {
  return typeof key === 'string' && Object.hasOwn(KINDS, key);
}

/**
 * Which kinds this pair of realms actually supports, and why the rest do not.
 *
 * Both halves are returned on purpose. The legal list is what the prompt shows
 * the model - showing it what fits rather than telling it what exists is the
 * lesson from the moment library - and the refusals are what the sidebar and
 * the log can quote when a proposal is rejected, so a refusal names its reason
 * rather than being a shrug.
 *
 * @param {KindContext} ctx
 * @returns {{legal: string[], refused: Record<string, string>}}
 */
export function legalKinds(ctx) {
  /** @type {string[]} */
  const legal = [];
  /** @type {Record<string, string>} */
  const refused = {};

  for (const key of KIND_KEYS) {
    let reason;
    try {
      reason = KINDS[key].legal(ctx);
    } catch (err) {
      // A grammar that throws on a malformed snapshot must not read as a
      // grammar that permits. Anything unexpected is a refusal with its cause
      // named, which is the same rule validate follows for a proposal it
      // cannot parse.
      reason = `could not be judged against this snapshot: ${err?.message ?? err}`;
    }
    if (reason) refused[key] = reason;
    else legal.push(key);
  }

  return { legal, refused };
}

/**
 * The prompt section: which kinds of war this pair could support.
 *
 * Deliberately not a list of every legal pair in the sphere - that is O(n^2)
 * over sixty realms and would be most of the prompt. The Director asks about a
 * pair it is already considering.
 *
 * @param {KindContext} ctx
 * @returns {string}
 */
export function kindBriefing(ctx) {
  const { legal, refused } = legalKinds(ctx);
  const a = ctx.attacker?.primaryTitle ?? 'the attacker';
  const d = ctx.defender?.primaryTitle ?? 'the defender';

  if (legal.length === 0) {
    return `No kind of war between ${a} and ${d} is supported by the live map.`
      + ` ${Object.values(refused)[0]}`;
  }

  const lines = legal.map((k) => `- ${KINDS[k].label}: ${KINDS[k].premise}`);
  return `Kinds of war the map supports between ${a} and ${d}:\n${lines.join('\n')}`;
}
