/**
 * The constrained action toolkit.
 *
 * The model does not write CK3 script. It picks an action from this table and
 * fills in parameters, and this module turns that into literal, guarded script.
 * Two consequences worth being explicit about: the model cannot invent
 * mechanics, and it cannot inject script, because nothing it produces reaches
 * the run file unquoted.
 *
 * Each action carries a `preview` used to render the proposal for approval,
 * separate from `toScript`, which is only ever called after the player says
 * yes. Proposing and executing are different operations, and keeping them
 * different functions is what makes the approval gate real rather than
 * decorative.
 */

import { resolveTagged } from '../bridge/ck3Script.js';
import { expectationFor } from './bookmarkTiers.js';
import { MOMENTUM, MOMENTUM_KEYS, isMomentum, momentumOf, momentumScript, momentumPreview, momentumSupport } from './momentum.js';
import { INTENSITY, INTENSITY_KEYS, MAX_PARTNERS, intensityBand, iberianPressureScript, inRegion, hasRegionData, IBERIA_REGION, macroSupport } from './macroEvents.js';
import { MOMENTS, MOMENT_KEYS, isMoment, inWindow, windowError, momentScript, momentPreview, momentSupport, targetTierError } from './moments.js';

/** Characters CK3 script treats structurally. Never let these through. */
const UNSAFE = /["'{}\[\]$\\=#\r\n\t]/g;

/**
 * @param {unknown} v
 * @param {number} [maxLen]
 */
function safeString(v, maxLen = 60) {
  return String(v ?? '').replace(UNSAFE, '').trim().slice(0, maxLen);
}

/** @param {unknown} v */
function safeInt(v) {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? n : null;
}

/** CK3 identifiers: event ids and the like. */
function safeIdent(v) {
  return String(v ?? '').replace(/[^A-Za-z0-9_.]/g, '').slice(0, 64);
}

/**
 * Wrap an action's effects in a precondition check that reports both outcomes.
 *
 * Two lessons are baked in. The script carries its values already literal
 * rather than being passed to a scripted effect as $PARAM$, because CK3 mangles
 * parameter substitution inside quoted debug_log strings and every record
 * carrying one came back unparseable.
 *
 * And the `else` branch matters as much as the success path. The first version
 * logged only on success, so a failed precondition was indistinguishable from
 * the effect never running at all: the game said nothing, the log showed
 * nothing, and the orchestrator announced that an approved change had taken
 * effect when it had not. An action that cannot apply has to say so.
 *
 * @param {string} limitBody trigger body, indented for depth 2
 * @param {string[]} effects
 * @param {string} action
 * @param {number} token
 * @returns {string[]}
 */
function guarded(limitBody, effects, action, token) {
  return [
    'if = {',
    '\tlimit = {',
    `\t\t${limitBody}`,
    '\t}',
    ...effects.map((line) => `\t${line}`),
    `\tdebug_log = "HD:/;/applied/;/${token}/;/${action}/;/ok"`,
    '}',
    'else = {',
    `\tdebug_log = "HD:/;/refused/;/${token}/;/${action}/;/precondition_failed"`,
    '}',
  ];
}

/**
 * Rank ordering, over the script-derived tier keys rather than the localised
 * names the game prints. Ordering only; the wire values are these keys.
 */
const RANK = { barony: 0, county: 1, duchy: 2, kingdom: 3, empire: 4 };

/**
 * Was an optional parameter supplied at all?
 *
 * Distinguishes "omitted" from "supplied and unresolvable". The first is a bare
 * spawn, which is legal; the second names something the snapshot does not
 * contain, which is refused rather than dropped.
 *
 * @param {unknown} v
 */
function given(v) {
  return v !== undefined && v !== null && v !== '';
}

/**
 * Resolve a character id from a proposal into the tag the game can find.
 * @param {any} state
 * @param {number|null} id
 * @returns {number|null}
 */
function tagOf(state, id) {
  const realm = state?.realmsById?.get(id);
  return realm && Number.isInteger(realm.tag) ? realm.tag : null;
}

/**
 * The locality rule: at least one party must be in the player's neighbourhood.
 *
 * Seeing a realm and being entitled to act on it stopped being the same thing
 * when the sphere became a dial. At reach 1 they coincided, because everything
 * in a six-region window was a neighbour. At reach 4 an Egyptian player's
 * sphere reaches Bengal, and the Director duly proposed granting the King of
 * France a claim on the Almoravids - two realms on opposite edges of the
 * window, neither of them the player, in a war the player has no stake in.
 * Bounded attention had quietly become unbounded agency.
 *
 * The rule applies to the actions that push two rulers into each other, and not
 * to `adjust_title_tier`. That one corrects the shape of the map rather than
 * anyone's relations, and an empire the record does not carry is worth naming
 * wherever it sits: the empire-tier check in bookmarkTiers is deliberately
 * global and stays that way.
 *
 * Degrades rather than fails closed. If no realm in the snapshot carries the
 * mark, the marking did not happen - a truncated log, or an orchestrator older
 * than the record - and refusing everything would be reading missing data as a
 * verdict. A snapshot where the marking *did* run always has at least one
 * marked realm, because the player is standing in their own home region.
 *
 * @param {any} state the live snapshot
 * @param {Array<number|null>} ids the parties, any one of which may satisfy it
 * @param {string} what phrasing for the refusal
 * @returns {string|null}
 */
function requireLocality(state, ids, what) {
  const realms = [...(state?.realmsById?.values?.() ?? [])];
  if (!realms.some((r) => r.inNeighbourhood)) return null;

  const parties = ids.map((id) => state.realmsById.get(id)).filter(Boolean);
  if (parties.some((r) => r.inNeighbourhood)) return null;

  const names = parties.map((r) => r.primaryTitle || r.ruler);
  const named = names.join(' and ');
  const verb = names.length > 1 ? 'lie' : 'lies';
  return `${what} needs at least one party inside the player's neighbourhood; ${named || 'neither party'} ${verb} out towards the edge of the sphere, where the Director watches but does not act`;
}

/**
 * Refuse a claim between two realms already at war with each other.
 *
 * A pressed claim cannot start a war against someone you are already fighting,
 * so the claim itself sits idle - but the gold, the prestige and the multi-year
 * war modifier beside it do not. Granting those mid-war is not setting a stage,
 * it is reinforcing one side of a fight already in progress, and the player
 * approving the card would have no way to know that from the preview.
 *
 * Fails open where wars are not reported at all: a mod too old to emit them
 * leaves `wars` undefined, and refusing every claim on that basis would break
 * the toolkit for anyone who has not redeployed. Silence here means "not
 * observed", which is the same thing the war section tells the model.
 *
 * @param {any} state
 * @param {number} a
 * @param {number} b
 * @param {string} what
 * @returns {string|null}
 */
function refuseIfAtWar(state, a, b, what) {
  if (typeof state?.warBetween !== 'function') return null;
  const war = state.warBetween(a, b);
  if (!war) return null;
  const attacker = state.realmsById?.get(war.attacker);
  const defender = state.realmsById?.get(war.defender);
  const who = `${attacker?.primaryTitle ?? `character ${war.attacker}`} is already at war with ${defender?.primaryTitle ?? `character ${war.defender}`}`;
  return `${what} is pointless here and its war chest is not: ${who}${war.name ? ` (${war.name})` : ''}, so the claim could not be pressed until that war ends, while the gold, prestige and war modifier would land immediately on a belligerent mid-campaign`;
}

/**
 * The clause a preview gains when one party is far away.
 *
 * The rule permits an action where *either* party is near, so a proposal can
 * legitimately reach a realm on the far side of the sphere as long as it is
 * your neighbour doing the reaching. That is a materially different thing from
 * a border quarrel and the preview should not read identically, so it says
 * which party is distant. Silent when the marking is absent or when everyone
 * involved is close by.
 *
 * @param {any} state
 * @param {Array<number|null>} ids
 * @returns {string}
 */
function distanceNote(state, ids) {
  const realms = [...(state?.realmsById?.values?.() ?? [])];
  if (!realms.some((r) => r.inNeighbourhood)) return '';

  const distant = ids
    .map((id) => state.realmsById.get(id))
    .filter((r) => r && !r.inNeighbourhood);
  if (distant.length === 0) return '';

  const names = distant.map((r) => r.primaryTitle || r.ruler);
  const verb = names.length > 1 ? 'lie' : 'lies';
  return ` ${names.join(' and ')} ${verb} outside your neighbourhood, so this reaches well beyond your own borders.`;
}

/**
 * Is this realm on the Iberian peninsula?
 *
 * Geography where the snapshot reports it, culture only where it does not.
 *
 * The first version of this was culture alone, on the reasoning that these
 * cultures "are Iberian wherever they are found". A live campaign disproved
 * that in one line: a Sheikhdom of Murzuk in Libya reads as Andalusian, and so
 * did a player ruling from Cairo. Culture records where a dynasty came from,
 * not where its land is, and after two centuries of conquest those are
 * different questions.
 *
 * The sweep now reports which regions each realm holds land in, so the check is
 * the real one. Culture remains as a fallback for a snapshot taken before that
 * record existed, because refusing everything on missing data would read as a
 * verdict rather than as a gap - the same reasoning requireLocality uses.
 *
 * @param {any} realm
 * @param {boolean} geographyAvailable
 * @returns {boolean}
 */
const IBERIAN_CULTURES = /andalus|castil|catalan|portug|basque|galician|asturleon|aragon|mozarab|visigoth|suebi|navarr/i;

function isIberian(realm, geographyAvailable) {
  if (geographyAvailable) return inRegion(realm, IBERIA_REGION) === true;
  return IBERIAN_CULTURES.test(realm?.culture ?? '');
}

/**
 * @typedef {object} Action
 * @property {string} signature
 * @property {string} description
 * @property {object} parameters JSON Schema for the model
 * @property {(args: any, state: any, baseline: any) => string|null} validate returns an error string, or null when valid. Most actions ignore the baseline; adjust_title_tier requires it.
 * @property {(args: any, state: any, baseline: any) => string} preview shown to the player before approval; most actions ignore the baseline
 * @property {(args: any, token: number, state: any) => string[]} toScript the guarded CK3 script
 */

/**
 * The actions themselves.
 *
 * Every one addresses characters by id, and every id comes from the snapshot.
 * That is deliberate. The first version let the model name CK3 title keys, and
 * it could not: it sees "Arabian Empire" in the snapshot and never sees
 * `e_arabia`, so it guessed from localised names. Vanilla keys it half
 * remembered came out right, modded ones never did, and a key that exists but
 * is unheld - k_anatolia in 1073 - failed just as quietly. Titles are now
 * reached through their holder, so an action can only refer to a title the
 * game has already told us about.
 *
 * @type {Record<string, Action>}
 */
export const TOOLKIT = {
  spawn_character: {
    signature: 'spawn_character',
    description:
      "Introduce a historical figure who ought to exist at this date but does not, placing them in the court of a ruler from the snapshot. On its own this creates a courtier and nothing else: no title, no claim, no path to power. The two optional parameters are what give the person somewhere to go. `house` makes them a real member of an existing dynasty rather than a stranger wearing its name, and `claim` gives them a pressed claim on a named ruler's primary title, which their host may press for them in a claimant war. It never starts a war and never transfers a title. Propose a bare spawn only where the figure matters as a person - a scholar, a hostage, a bride - and use `claim` wherever the point is a disputed succession.",
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Given name only, no titles' },
        sex: { type: 'string', enum: ['male', 'female'] },
        age: { type: 'integer', minimum: 0, maximum: 90 },
        host: { type: 'integer', description: 'Character id from the snapshot whose court they join' },
        house: {
          type: 'integer',
          description:
            'Optional. Character id from the snapshot whose dynastic house this figure is born into. Use it whenever the record names them as an heir or kinsman of an existing line. Without it they are given a freshly invented dynasty, and a Premyslid heir who is not a Premyslid is a name and nothing more.',
        },
        claim: {
          type: 'integer',
          description:
            'Optional. Character id from the snapshot whose primary title this figure holds a pressed claim on. This is the path to power: the host gains a claimant casus belli they may act on or ignore. Name the ruler who currently holds the disputed title, not the one who wants it.',
        },
      },
      required: ['name', 'sex', 'age', 'host'],
      additionalProperties: false,
    },
    validate(a, state) {
      if (!safeString(a.name)) return 'name is empty after sanitisation';
      if (!['male', 'female'].includes(a.sex)) return 'sex must be male or female';
      const age = safeInt(a.age);
      if (age === null || age < 0 || age > 90) return 'age must be between 0 and 90';
      const host = safeInt(a.host);
      if (host === null || !state.realmsById.has(host)) return `host ${a.host} is not a ruler in the snapshot`;

      // Both endowments are refused by name rather than quietly dropped. A
      // proposal whose whole point is a claimant, executed as a bare courtier
      // because the claim id did not resolve, is the sidebar describing one
      // intervention while the game receives another - the same class of error
      // as repairing a malformed proposal instead of rejecting it.
      if (given(a.house)) {
        const house = safeInt(a.house);
        if (house === null || !state.realmsById.has(house)) return `house ${a.house} is not a ruler in the snapshot`;
      }
      if (given(a.claim)) {
        const claim = safeInt(a.claim);
        if (claim === null || !state.realmsById.has(claim)) return `claim ${a.claim} is not a ruler in the snapshot`;
        // A pressed claim is an act against whoever holds the title, so it
        // takes the same locality rule grant_claim does. A bare spawn does not:
        // a courtier with no claim pushes nobody into anybody.
        return requireLocality(state, [host, claim], 'spawn_character');
      }
      return null;
    },
    preview(a, state) {
      const host = state.realmsById.get(safeInt(a.host));
      const kin = given(a.house) ? state.realmsById.get(safeInt(a.house)) : null;
      const claim = given(a.claim) ? state.realmsById.get(safeInt(a.claim)) : null;

      const of = kin?.house ? ` of ${kin.house}` : kin ? `, kin of ${kin.ruler ?? a.house}` : '';
      let out = `Create ${safeString(a.name)}${of}, ${safeString(a.sex)}, aged ${safeInt(a.age)}, in the court of ${host?.ruler ?? a.host}.`;

      // The sentence the old preview never wrote. A card that says only "create
      // a character" and leaves the reader to infer a restored kingdom from the
      // reasoning above it is promising something the script does not do.
      if (claim) {
        const tier = claim.tierKey ? `the ${claim.tierKey}-tier title ` : '';
        out += ` They carry a pressed claim on ${tier}${claim.primaryTitle ?? 'the target primary title'},`
          + ` held by ${claim.ruler ?? a.claim}, which ${host?.ruler ?? 'their host'} may press in a claimant war or leave alone.`
          + ' No war starts and no title changes hands.';
        out += distanceNote(state, [safeInt(a.host), safeInt(a.claim)]);
      } else {
        out += ' They hold no claim and no title: this puts a person in a court and nothing more.';
      }
      return out;
    },
    toScript: (a, token, state) => {
      const kinTag = given(a.house) ? tagOf(state, safeInt(a.house)) : null;
      const claimTag = given(a.claim) ? tagOf(state, safeInt(a.claim)) : null;

      // Each endowment adds its own precondition, so a claim whose holder has
      // no primary title refuses the whole batch rather than landing a courtier
      // the preview described as a claimant.
      const limits = ['exists = scope:hd_host'];
      if (kinTag !== null) limits.push('exists = scope:hd_kin.house');
      if (claimTag !== null) limits.push('exists = scope:hd_claim.primary_title');

      return [
        ...resolveTagged(tagOf(state, safeInt(a.host)), 'hd_host'),
        ...(kinTag === null ? [] : resolveTagged(kinTag, 'hd_kin')),
        ...(claimTag === null ? [] : resolveTagged(claimTag, 'hd_claim')),
        ...guarded(
          limits.join('\n\t\t'),
          [
            'scope:hd_host = {',
            '\tcreate_character = {',
            '\t\temployer = scope:hd_host',
            `\t\tname = "${safeString(a.name)}"`,
            // `gender`, not `sex`. CK3's create_character has no `sex` key, so
            // the line this replaces was silently ignored and every figure the
            // Director spawned came out at the engine's own default chance: a
            // proposal for a male claimant could produce a woman, and nothing
            // in the log would say so. The parameter keeps its name because
            // that is what the model fills in; only the emitted key was wrong.
            `\t\tgender = ${safeString(a.sex)}`,
            `\t\tage = ${safeInt(a.age)}`,
            '\t\tculture = scope:hd_host.culture',
            '\t\tfaith = scope:hd_host.faith',
            kinTag === null ? '\t\tdynasty = generate' : '\t\tdynasty_house = scope:hd_kin.house',
            // after_creation is the only place the claim can be attached. The
            // created character is not reachable from outside the block that
            // made it, and after_creation runs in its scope while the batch's
            // saved scopes are still in reach.
            ...(claimTag === null ? [] : [
              '\t\tafter_creation = {',
              '\t\t\tadd_pressed_claim = scope:hd_claim.primary_title',
              '\t\t}',
            ]),
            '\t}',
            '}',
          ],
          'spawn_character',
          token,
        ),
      ];
    },
  },

  set_relations: {
    signature: 'set_relations',
    description:
      'Enforce an attested political attitude between two rulers, where the game has drifted from the historical relationship.',
    parameters: {
      type: 'object',
      properties: {
        actor: { type: 'integer', description: 'Character id from the snapshot' },
        target: { type: 'integer', description: 'Character id from the snapshot' },
        value: { type: 'integer', minimum: -100, maximum: 100 },
      },
      required: ['actor', 'target', 'value'],
      additionalProperties: false,
    },
    validate(a, state) {
      const actor = safeInt(a.actor);
      const target = safeInt(a.target);
      const value = safeInt(a.value);
      if (actor === null || !state.realmsById.has(actor)) return `actor ${a.actor} is not a ruler in the snapshot`;
      if (target === null || !state.realmsById.has(target)) return `target ${a.target} is not a ruler in the snapshot`;
      if (actor === target) return 'actor and target are the same character';
      if (value === null || value < -100 || value > 100) return 'value must be between -100 and 100';
      return requireLocality(state, [actor, target], 'set_relations');
    },
    preview(a, state) {
      const actor = state.realmsById.get(safeInt(a.actor));
      const target = state.realmsById.get(safeInt(a.target));
      const dir = safeInt(a.value) < 0 ? 'hostility towards' : 'goodwill towards';
      const base = `Set ${actor?.ruler ?? a.actor}'s ${dir} ${target?.ruler ?? a.target} to ${safeInt(a.value)}.`;
      return base + distanceNote(state, [safeInt(a.actor), safeInt(a.target)]);
    },
    toScript: (a, token, state) => [
      ...resolveTagged(tagOf(state, safeInt(a.actor)), 'hd_actor'),
      ...resolveTagged(tagOf(state, safeInt(a.target)), 'hd_target'),
      ...guarded(
        'exists = scope:hd_actor\n\t\texists = scope:hd_target',
        [
          'scope:hd_actor = {',
          '\tadd_opinion = {',
          '\t\ttarget = scope:hd_target',
          '\t\tmodifier = hd_historical_opinion',
          `\t\topinion = ${safeInt(a.value)}`,
          '\t}',
          '}',
        ],
        'set_relations',
        token,
      )],
  },

  grant_claim: {
    signature: 'grant_claim',
    description:
      "Seed a historically-grounded expansion by giving one ruler a pressed claim on another ruler's primary title. The optional momentum parameter also gives that ruler the means and the appetite to press it - money, the resource the war itself costs, and a timed disposition towards war. It never starts a war: the ruler still decides through normal game mechanics.",
    parameters: {
      type: 'object',
      properties: {
        actor: { type: 'integer', description: 'Character id who gains the claim' },
        target: { type: 'integer', description: 'Character id whose primary title is claimed' },
        momentum: {
          type: 'string',
          enum: MOMENTUM_KEYS,
          description:
            'Optional, defaults to "none". The historical pattern this claim belongs to, which selects a fixed set of supporting effects. "reconquista" for the recovery of lost ground, "holy_war" for a war across a religious border (refused when both rulers share a faith), "succession_pressure" for a disputed inheritance. Use "none", or omit it, for a bare claim. Momentum is a large intervention: choose it only where the record supports not just the claim but the campaign that followed it.',
        },
      },
      required: ['actor', 'target'],
      additionalProperties: false,
    },
    validate(a, state) {
      const actor = safeInt(a.actor);
      const target = safeInt(a.target);
      if (actor === null || !state.realmsById.has(actor)) return `actor ${a.actor} is not a ruler in the snapshot`;
      if (target === null || !state.realmsById.has(target)) return `target ${a.target} is not a ruler in the snapshot`;
      if (actor === target) return 'a ruler cannot press a claim on their own title';

      // Momentum is validated in two stages, and both matter. The first is that
      // the key exists at all - an unrecognised one is refused by name rather
      // than quietly treated as "none", because substituting a weaker action
      // for the one that was proposed is the same class of error as repairing a
      // malformed proposal.
      const momentum = momentumOf(a.momentum);
      if (!isMomentum(momentum)) {
        return `momentum "${safeString(a.momentum, 40)}" is not one of ${MOMENTUM_KEYS.join(', ')}`;
      }

      // The second is whether the deployed mod can execute it. Refusing here
      // rather than in toScript is the point: the preview is what the player
      // approves, and a preview that describes a modifier the mod has no
      // definition for is the sidebar lying about what approval will do. The
      // batch would still report "ok", because the batch would still run.
      if (momentum !== 'none') {
        const mod = momentumSupport();
        if (!mod.ok) return `momentum "${momentum}" cannot be executed: ${mod.reason}`;
      }

      // The third is whether this momentum can be justified against these two
      // realms. A holy war between co-religionists is not a holy war, and the
      // snapshot already carries the faiths needed to say so.
      const justified = MOMENTUM[momentum].requires(state.realmsById.get(actor), state.realmsById.get(target));
      if (justified) return justified;

      // Whether the war this claim would justify is already being fought.
      const fighting = refuseIfAtWar(state, actor, target, 'grant_claim');
      if (fighting) return fighting;

      // And last, whether this is the Director's war to arrange at all.
      return requireLocality(state, [actor, target], 'grant_claim');
    },
    preview(a, state) {
      const actor = state.realmsById.get(safeInt(a.actor));
      const target = state.realmsById.get(safeInt(a.target));
      // Naming the tier matters. A pressed claim on an emperor's primary title
      // is a claim on the whole empire, and the old wording conveyed that no
      // differently from a claim on a duchy.
      const tier = target?.tierKey ? `the ${target.tierKey}-tier title ` : '';
      const claim = `Grant ${actor?.ruler ?? a.actor} a pressed claim on ${tier}${target?.primaryTitle ?? 'the target primary title'}, held by ${target?.ruler ?? a.target}.`;
      return claim
        + momentumPreview(momentumOf(a.momentum), actor?.ruler ?? String(a.actor))
        + distanceNote(state, [safeInt(a.actor), safeInt(a.target)]);
    },
    toScript: (a, token, state) => [
      ...resolveTagged(tagOf(state, safeInt(a.actor)), 'hd_actor'),
      ...resolveTagged(tagOf(state, safeInt(a.target)), 'hd_target'),
      ...guarded(
        'exists = scope:hd_actor\n\t\texists = scope:hd_target\n\t\texists = scope:hd_target.primary_title',
        [
          'scope:hd_actor = { add_pressed_claim = scope:hd_target.primary_title }',
          // Inside the same guard as the claim, so the two land together or not
          // at all. Momentum without the claim it was granted for would be the
          // Director handing a ruler an army and no reason to use it.
          ...momentumScript(momentumOf(a.momentum), 'scope:hd_actor'),
        ],
        'grant_claim',
        token,
      )],
  },

  adjust_title_tier: {
    signature: 'adjust_title_tier',
    destructive: true,
    description:
      "Normalise a polity that has risen above its historical rank, by destroying its ruler's primary title so the realm falls to the next rank down. Moves exactly one rank, and only downwards. Destroying an empire or kingdom releases the vassals below it, so this is a major intervention. Propose only where the realm has actually risen since the campaign began.",
    parameters: {
      type: 'object',
      properties: {
        actor: { type: 'integer', description: 'Character id whose primary title is destroyed' },
        target_tier: {
          type: 'string',
          enum: ['kingdom', 'duchy', 'county'],
          description: 'The rank the realm should end at. Must be exactly one rank below its current tier.',
        },
      },
      required: ['actor', 'target_tier'],
      additionalProperties: false,
    },
    validate(a, state, baseline) {
      const actor = safeInt(a.actor);
      if (actor === null || !state.realmsById.has(actor)) return `actor ${a.actor} is not a ruler in the snapshot`;

      const realm = state.realmsById.get(actor);
      const observed = realm?.tierKey;

      // Fail closed. Without a script-derived tier there is no trustworthy way
      // to know what rank this ruler holds. The localised GetRankConcept is not
      // a substitute - it is precisely what stops matching on a German install
      // or a total conversion with renamed ranks - so it is used only to phrase
      // the error, never to permit the action.
      if (!observed || !(observed in RANK)) {
        const hint = realm?.tier
          ? ` (the game calls it "${realm.tier}", but that is localised text and cannot be used as a guard)`
          : '';
        return `no script-derived tier for this ruler${hint}; this snapshot predates tier reporting, so the demotion cannot be checked`;
      }

      const target = String(a.target_tier ?? '');
      if (!(target in RANK)) return `target_tier "${a.target_tier}" is not a known rank`;

      if (RANK[target] >= RANK[observed]) {
        return `${realm.ruler ?? 'the ruler'} is already ${observed} tier, so "demoting" to ${target} would change nothing or raise them`;
      }
      if (RANK[observed] - RANK[target] > 1) {
        // destroy_title = primary_title drops the ruler onto whatever they hold
        // underneath, which is one rank down and cannot be aimed further. Were a
        // multi-step demotion allowed, the stated intent and the actual effect
        // would silently disagree. A later audit can propose the next step.
        return `${observed} down to ${target} is more than one rank; this action moves a realm one rank at a time`;
      }

      // The baseline gate. Every check above establishes that the demotion is
      // mechanically coherent; this one establishes that there is anything to
      // correct. Without it, demoting the Holy Roman Empire in 1066 passes
      // cleanly - one rank down, tier known, target below observed - and the
      // only thing standing in the way is a sentence in the system prompt. An
      // instruction stops most bad proposals before they cost tokens; a guard
      // is what makes them impossible.
      if (!baseline || !baseline.captured) {
        return 'no baseline for this campaign yet, so there is no way to tell a risen realm from the map as it started; demotions are refused until one is captured';
      }

      const d = baseline.delta(realm);
      const name = realm.primaryTitle ?? 'this realm';
      if (d.risen) return null;

      // What the baseline's silence proves depends entirely on when it was
      // taken, and for a long time this code did not ask.
      if (!baseline.midCampaign) {
        // Captured at a bookmark, so for the ground it was actually watching it
        // is the map as shipped and its silence is informative both ways.
        if (d.known) {
          return `${name} has stood at ${observed} tier since the campaign began (${d.label}); that is the map as it started, not drift`;
        }
        // Absent from it. That means "did not exist then" only if the window has
        // not grown since; a sphere widened from twelve regions to twenty
        // reveals realms that stood there all along, and calling those new would
        // be inventing a history for each of them.
        if (baseline.absenceMeansNew) {
          return `${name} was not present when the baseline was captured, so the Director has no reference for its rank and cannot say it has risen`;
        }
        // Otherwise the baseline cannot speak about this realm at all, for the
        // same reason a mid-campaign one cannot: no evidence either way. Fall
        // through to the tables, which have their own guards and refuse unless
        // there is a real claim to make.
      }

      // Mid-campaign, where the baseline is not a claim about the world at all.
      // Absence from it is not a second, separate refusal: the baseline is
      // scoped to the sphere it was captured from, so a player who moves their
      // capital or widens the reach acquires realms it never saw - not because
      // they are new, but because nobody was looking. A 1218 baseline taken in
      // Iberia knows nothing about Egypt, and treating that as "no reference"
      // silenced the Director across a whole campaign's worth of map.
      //
      // The bookmark tables are a separate reference and do not depend on
      // having seen the realm before, so both cases consult them below. They
      // still refuse unless there is a curated expectation or an empire the
      // roster does not carry.

      const expectation = expectationFor(realm, state.year);

      if (expectation.kind === 'named') {
        if (RANK[observed] > RANK[expectation.tier]) return null;
        return `the record puts ${name} at ${expectation.tier} tier at the ${expectation.bookmark} bookmark, and the campaign has it at ${observed}; there is nothing to bring down`;
      }

      // At empire tier the historical roster is closed enough that absence from
      // it is itself evidence. At every other rank it is not, and silence is
      // the honest answer.
      if (expectation.kind === 'unlisted-empire') return null;

      // Two ways to arrive here, and the reason has to say which: the baseline
      // saw this realm and it has not moved, or the baseline never saw it at
      // all. Neither is evidence, but reporting the second as the first would
      // be the same class of error the mid-campaign work exists to correct.
      // Three ways to arrive here, and the reason has to say which. Reporting a
      // widened window as a mid-campaign capture, or an unseen realm as an
      // unchanged one, would be the same class of error this whole path was
      // written to correct.
      const silence = d.known
        ? `${name} is unchanged since a baseline taken at ${baseline.capturedYear}, mid-campaign, so it cannot tell drift from the map as loaded`
        : baseline.midCampaign
          ? `the baseline never saw ${name}, because it was captured at ${baseline.capturedYear} from a different part of the map`
          : `the baseline does not carry ${name}, but the sphere has widened since it was captured, so that may mean the Director was not watching this ground rather than that the realm is new`;
      return `${silence}. The ${expectation.bookmark} tables carry no expectation for this realm either. No reference, so no claim`;
    },
    preview(a, state) {
      const actor = state.realmsById.get(safeInt(a.actor));
      const observed = actor?.tierKey ?? 'unknown';
      const target = String(a.target_tier ?? 'unknown');
      const base = `Destroy ${actor?.primaryTitle ?? 'the primary title'} held by ${actor?.ruler ?? a.actor}, taking the realm from ${observed} tier down to ${target} tier.`;
      // Understating what an action is about to do fails the same way as
      // misreporting what it did, one step earlier.
      const released = observed === 'empire' ? 'kingdom' : observed === 'kingdom' ? 'duchy' : null;
      const consequence = released
        ? ` Vassals holding ${released}-tier titles under it will likely become independent.`
        : '';

      // The realm that has most obviously outgrown the record is often the
      // player's own, and on a mid-campaign save it is the likeliest target of
      // all. Approving this is a legitimate thing to want; approving it without
      // noticing whose realm it is, is not.
      const mine = safeInt(a.actor) === state?.playerId
        ? ' This is your own realm: approving it will break up the empire you are playing.'
        : '';

      return `${base}${consequence}${mine}`;
    },
    toScript: (a, token, state) => {
      const observed = state?.realmsById?.get(safeInt(a.actor))?.tierKey;
      return [
        ...resolveTagged(tagOf(state, safeInt(a.actor)), 'hd_actor'),
        ...guarded(
          [
            'exists = scope:hd_actor',
            'exists = scope:hd_actor.primary_title',
            // The snapshot was taken before the player ruled on this, and the
            // game kept running meanwhile. Assert the rank actually observed,
            // so a realm that changed tier in between is refused rather than
            // demoted on the strength of a stale reading.
            `scope:hd_actor.primary_title.tier = tier_${safeIdent(observed)}`,
            'NOT = { scope:hd_actor.primary_title.tier = tier_county }',
            'NOT = { scope:hd_actor.primary_title.tier = tier_barony }',
          ].join('\n\t\t'),
          ['scope:hd_actor = { destroy_title = primary_title }'],
          'adjust_title_tier',
          token,
        )];
    },
  },

  // This was a stub for a while: the enum held only hd_event.0002, the
  // notification, while the description promised "a plea for aid, a tribute
  // dispute, a warning from a neighbour" - events that had never been written.
  // The events now exist, and the description names what each one does.
  //
  // They grant opportunity rather than forcing outcomes, which is why this is
  // three events rather than a new toolkit verb: a CK3 event carries its own
  // options, so the Director proposes that a situation arise, the player
  // approves that, and the recipient still chooses what to do about it.
  //
  // An event whose trigger fails does nothing, and the applied line comes from
  // the batch rather than the event, so each event logs HD:/;/event_fired when
  // it actually fires and the orchestrator reports the difference.
  // The first macro action: one proposal that sets a process running across
  // several realms instead of doing one thing to one character. Nothing here
  // transfers a title and nothing starts a war - it makes a union reachable and
  // a coalition affordable, and the rulers inside it still decide.
  iberian_pressure: {
    signature: 'iberian_pressure',
    description:
      'Set the Reconquista-era pressure toward Iberian consolidation in motion around one ruler. '
      + 'Grants truces and, at higher intensity, alliances and hooks between the unifier and their partners, '
      + 'plus a temporary appetite for war in the peninsula and a decision they may use to press a dynastic union. '
      + 'It transfers no titles and starts no wars: every recipient still chooses. '
      + 'The intensity you may ask for is bounded by the live balance of the peninsula, and an out-of-band choice is refused.',
    parameters: {
      type: 'object',
      properties: {
        unifier: { type: 'integer', description: 'Character id of the realm the pressure gathers around' },
        partners: {
          type: 'array',
          items: { type: 'integer' },
          maxItems: MAX_PARTNERS,
          description: `Up to ${MAX_PARTNERS} character ids drawn into the coalition. May be empty.`,
        },
        intensity: {
          type: 'string',
          enum: INTENSITY_KEYS,
          description:
            'How strong the pressure is. smoldering: truces only. fervent: truces, alliances and a union decision. '
            + 'crusade: all of that plus hooks and a later inheritance event. The live state decides which of these is available.',
        },
      },
      required: ['unifier', 'partners', 'intensity'],
      additionalProperties: false,
    },

    validate(a, state, baseline) {
      // First, because it dominates every other reason. Unlike momentum, which
      // is an optional amplification of an otherwise-executable claim, this
      // whole action lives in mod content: three modifiers, an event chain and
      // a decision. A mod that predates them runs the batch, reports
      // `applied ... ok`, and does none of it.
      const mod = macroSupport();
      if (!mod.ok) return `iberian_pressure cannot be executed: ${mod.reason}`;

      const unifier = safeInt(a.unifier);
      if (unifier === null || !state.realmsById.has(unifier)) {
        return `unifier ${a.unifier} is not a ruler in the snapshot`;
      }

      if (!Array.isArray(a.partners)) return 'partners must be an array of character ids, possibly empty';
      if (a.partners.length > MAX_PARTNERS) {
        return `at most ${MAX_PARTNERS} partners; ${a.partners.length} were named`;
      }

      const partners = a.partners.map(safeInt);
      for (const p of partners) {
        if (p === null || !state.realmsById.has(p)) return `partner ${p} is not a ruler in the snapshot`;
        if (p === unifier) return 'the unifier cannot also be one of their own partners';
      }
      if (new Set(partners).size !== partners.length) return 'the same partner is named twice';

      // Every named realm has to belong to the peninsula. See IBERIAN_CULTURES
      // for why this is culture rather than geography.
      const named = [unifier, ...partners];
      const geography = hasRegionData(state);
      const outsiders = named
        .map((id) => state.realmsById.get(id))
        .filter((r) => !isIberian(r, geography));
      if (outsiders.length) {
        const names = outsiders.map((r) => (geography
          ? `${r.primaryTitle || r.ruler} (holds no land in Iberia)`
          : `${r.primaryTitle || r.ruler} (${r.culture || 'unknown culture'})`));
        return `this is an Iberian event and ${names.join(', ')} ${outsiders.length > 1 ? 'are' : 'is'} not of the peninsula`;
      }

      const locality = requireLocality(state, named, 'iberian_pressure');
      if (locality) return locality;

      // The band. Asking for a crusade in a peninsula that has almost nothing
      // left to press against is refused rather than honoured, and the refusal
      // reports the figures it measured.
      const key = String(a.intensity ?? '');
      if (!INTENSITY_KEYS.includes(key)) {
        return `intensity "${a.intensity}" is not one of ${INTENSITY_KEYS.join(', ')}`;
      }
      const band = intensityBand(state, baseline);
      if (band.allowed.length === 0) {
        return `no Iberian pressure of any intensity fits this world: ${band.reason}`;
      }
      if (!band.allowed.includes(key)) {
        return `"${key}" is out of band here - ${band.reason}; the intensities this world supports are ${band.allowed.join(', ')}`;
      }
      return null;
    },

    preview(a, state, baseline) {
      const unifier = state.realmsById.get(safeInt(a.unifier));
      const partners = (a.partners ?? [])
        .map(safeInt)
        .map((id) => state.realmsById.get(id))
        .filter(Boolean);
      const tier = INTENSITY[String(a.intensity ?? '')] ?? null;
      const band = intensityBand(state, baseline);

      const who = partners.length
        ? `${unifier?.ruler ?? a.unifier}, drawing in ${partners.map((r) => r.ruler || r.primaryTitle).join(', ')}`
        : `${unifier?.ruler ?? a.unifier}, with no partners named`;

      // Every mechanical effect, itemised. A macro action touches several realms
      // at once, so a one-line summary would be the least honest preview in the
      // toolkit rather than the most convenient.
      const effects = tier ? tier.effects.map((e) => `  - ${e}`).join('\n') : '  - (unknown intensity)';

      return `Set an Iberian pressure of ${tier?.label ?? 'unknown'} intensity around ${who}.\n`
        + `This grants:\n${effects}\n`
        + 'No title changes hands and no war begins; every recipient may decline what this offers.\n'
        + `Intensity band for this world: ${band.allowed.join(', ') || 'none'} - ${band.reason}.`
        + distanceNote(state, [safeInt(a.unifier), ...(a.partners ?? []).map(safeInt)]);
    },

    toScript: (a, token, state) => iberianPressureScript({
      unifierTag: tagOf(state, safeInt(a.unifier)),
      partnerTags: (a.partners ?? []).map((p) => tagOf(state, safeInt(p))).filter((t) => t !== null),
      intensity: String(a.intensity ?? ''),
    }, token),
  },

  /**
   * A named turning point from the record, staged around two realms.
   *
   * The generic half of the macro-event library: everything specific to a given
   * moment lives in moments.js, so adding the next one is a table entry, an
   * event and three localisation lines rather than another action here.
   *
   * It licenses and equips; it does not transfer titles and does not start wars.
   * The actor gains a pressed claim on the target's primary title - which at
   * kingdom tier carries the de jure vassals with it, and which claim_cb lets
   * them press even inside a struggle - together with the money and the appetite
   * to fight for it. Whether they do is the AI's decision.
   */
  historical_moment: {
    signature: 'historical_moment',
    destructive: true,
    description:
      'Stage a named turning point the historical record carries, around two realms in it. '
      + 'The actor gains a pressed claim on the target\'s primary title, money, and a lasting appetite for pressing it; '
      + 'at kingdom tier that claim carries the de jure vassals with it, so winning the resulting war is a union. '
      + 'It transfers no titles and starts no war: the actor still has to fight, and may not. '
      + 'Propose one only where the record plainly supports this moment between these two realms at this date.',
    parameters: {
      type: 'object',
      properties: {
        moment: {
          type: 'string',
          enum: MOMENT_KEYS,
          description: MOMENT_KEYS.map((k) => `${k}: ${MOMENTS[k].summary} (${MOMENTS[k].shape})`).join(' | '),
        },
        actor: { type: 'integer', description: 'Character id the moment gathers around' },
        target: { type: 'integer', description: 'Character id the moment is directed against' },
      },
      required: ['moment', 'actor', 'target'],
      additionalProperties: false,
    },

    validate(a, state) {
      // First, for the same reason iberian_pressure checks it first: the event,
      // the modifiers and the whole action live in mod content, so a mod that
      // predates them runs the batch, reports ok, and does none of it.
      const mod = momentSupport();
      if (!mod.ok) return `historical_moment cannot be executed: ${mod.reason}`;

      const key = String(a.moment ?? '');
      if (!isMoment(key)) {
        return `"${safeString(a.moment, 40)}" is not an offered moment; the ones that are offered are ${MOMENT_KEYS.join(', ')}`;
      }

      const actor = safeInt(a.actor);
      const target = safeInt(a.target);
      if (actor === null || !state.realmsById.has(actor)) return `actor ${a.actor} is not a ruler in the snapshot`;
      if (target === null || !state.realmsById.has(target)) return `target ${a.target} is not a ruler in the snapshot`;
      if (actor === target) return 'a realm cannot be the subject and the object of the same moment';

      // The date. A moment outside its window is a different historical process
      // wearing this one's name.
      const window = windowError(key, state.year);
      if (window) return window;

      // The place. Both realms must hold land in the moment's own region, on the
      // same reasoning iberian_pressure uses: geography where the snapshot
      // reports it, and refused outright where it does not, because a moment is
      // a claim about a specific part of the world.
      if (!hasRegionData(state)) {
        return 'this snapshot carries no per-realm geography, so the Director cannot confirm either realm belongs to this moment';
      }
      const region = MOMENTS[key].region;
      const outsiders = [actor, target]
        .map((id) => state.realmsById.get(id))
        .filter((r) => !inRegion(r, region));
      if (outsiders.length) {
        const names = outsiders.map((r) => r.primaryTitle || r.ruler);
        return `${names.join(' and ')} ${names.length > 1 ? 'do' : 'does'} not hold land where ${MOMENTS[key].label} took place`;
      }

      // What claiming this target's primary title would actually take. A
      // moment aimed above its declared rank is a different event wearing its
      // name.
      const tier = targetTierError(key, state.realmsById.get(target)?.tierKey);
      if (tier) return tier;

      const fightingAlready = refuseIfAtWar(state, actor, target, `${key}`);
      if (fightingAlready) return fightingAlready;

      return requireLocality(state, [actor, target], 'historical_moment');
    },

    preview(a, state) {
      const key = String(a.moment ?? '');
      const actor = state.realmsById.get(safeInt(a.actor));
      const target = state.realmsById.get(safeInt(a.target));
      const actorName = actor?.ruler ?? String(a.actor);
      const targetName = target?.ruler ?? String(a.target);
      const tier = target?.tierKey ? `the ${target.tierKey}-tier title ` : '';

      return `Stage ${MOMENTS[key]?.label ?? key} around ${actorName}, directed at ${targetName} and ${tier}${target?.primaryTitle ?? 'their primary title'}.`
        + momentPreview(key, actorName, targetName, target?.tierKey ?? null)
        + distanceNote(state, [safeInt(a.actor), safeInt(a.target)]);
    },

    toScript: (a, token, state) => [
      ...resolveTagged(tagOf(state, safeInt(a.actor)), 'hd_actor'),
      ...resolveTagged(tagOf(state, safeInt(a.target)), 'hd_target'),
      ...guarded(
        'exists = scope:hd_actor\n\t\texists = scope:hd_target\n\t\texists = scope:hd_target.primary_title',
        momentScript(String(a.moment ?? ''), 'scope:hd_actor', 'scope:hd_target'),
        'historical_moment',
        token,
      )],
  },

  trigger_event: {
    signature: 'trigger_event',
    description:
      "Fire one of the Director's own events at a ruler. hd_event.0002 only notifies the player. The rest put a historically-patterned choice in front of the recipient - an invitation to intervene across water, an invited crossing, a plea for protection - and grant a pressed claim only if they accept. None of them starts a war, and none forces an outcome: the recipient still decides.",
    parameters: {
      type: 'object',
      properties: {
        actor: { type: 'integer', description: 'Character id who receives the event' },
        event: {
          type: 'string',
          enum: ['hd_event.0002', 'hd_event.0100', 'hd_event.0101', 'hd_event.0102'],
          description:
            'Which event. hd_event.0002 only notifies the player and changes nothing. '
            + 'hd_event.0100 offers a ruler the chance to intervene across water in a quarrel not yet theirs. '
            + 'hd_event.0101 is the invited crossing: a same-faith neighbour who cannot hold their land asks for help. '
            + 'hd_event.0102 is a weakened neighbour asking for protection. '
            + 'The last three offer the recipient a choice and never force an outcome; each can quietly do nothing if the ruler has no suitable neighbour.',
        },
      },
      required: ['actor', 'event'],
      additionalProperties: false,
    },
    validate(a, state) {
      const actor = safeInt(a.actor);
      if (actor === null || !state.realmsById.has(actor)) return `actor ${a.actor} is not a ruler in the snapshot`;
      // Membership, not shape. A regex on the id accepted hd_event.9999, which
      // would have passed validation, fired nothing, and been reported to the
      // player as a change that happened - the enum is the list of events that
      // actually exist, so it is the list to check against.
      const known = TOOLKIT.trigger_event.parameters.properties.event.enum;
      const id = safeIdent(a.event);
      if (!known.includes(id)) {
        return `no such Director event "${a.event}"; the events that exist are ${known.join(', ')}`;
      }
      // Only one party here, so "at least one" means the recipient themselves.
      // These events offer a claim on acceptance, which is grant_claim by
      // another route and belongs under the same rule.
      return requireLocality(state, [actor], 'trigger_event');
    },
    preview(a, state) {
      const actor = state.realmsById.get(safeInt(a.actor));
      return `Send a Director narrative event to ${actor?.ruler ?? a.actor}.`
        + distanceNote(state, [safeInt(a.actor)]);
    },
    toScript: (a, token, state) => [
      ...resolveTagged(tagOf(state, safeInt(a.actor)), 'hd_actor'),
      ...guarded(
        'exists = scope:hd_actor',
        [`scope:hd_actor = { trigger_event = ${safeIdent(a.event)} }`],
        'trigger_event',
        token,
      )],
  },
};

/** The tool list handed to the model, in JSON-schema form. */
export function toolSchemas() {
  return Object.values(TOOLKIT).map((a) => ({
    name: a.signature,
    description: a.description,
    parameters: a.parameters,
  }));
}

/**
 * Validate a model-proposed action against the toolkit and the live snapshot.
 *
 * @param {{action: string, args: object}} proposed
 * @param {any} state the live snapshot
 * @param {any} [baseline] the campaign's opening map. Optional in the signature
 *   only: an action that needs it must refuse when it is absent, never proceed.
 * @returns {{ok: true, action: Action, preview: string} | {ok: false, error: string}}
 */
export function validateProposal(proposed, state, baseline) {
  const action = TOOLKIT[proposed?.action];
  if (!action) return { ok: false, error: `unknown action "${proposed?.action}"` };

  const args = proposed.args ?? {};
  const declared = Object.keys(action.parameters.properties);
  const unknown = Object.keys(args).filter((k) => !declared.includes(k));
  if (unknown.length) return { ok: false, error: `unexpected parameters: ${unknown.join(', ')}` };

  for (const req of action.parameters.required) {
    if (args[req] === undefined) return { ok: false, error: `missing required parameter "${req}"` };
  }

  const err = action.validate(args, state, baseline);
  if (err) return { ok: false, error: err };

  // The baseline reaches preview as well as validate: a macro action's preview
  // reports the band it was checked against, and that band is computed from it.
  return { ok: true, action, preview: action.preview(args, state, baseline) };
}
