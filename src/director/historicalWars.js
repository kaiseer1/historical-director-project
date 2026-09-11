/**
 * The historical war library.
 *
 * ## What a historical war is
 *
 * Every other action in the toolkit sets a stage and leaves the ruler to act on
 * it - a claim, a coalition, an appetite - and says so: "It transfers no titles
 * and starts no wars." That is the right rule for what the record describes as
 * a process. It is the wrong rule for what the record describes as an event.
 * The Conquest of Majorca was not a pressure toward Aragon taking the
 * Balearics; it was a war, with a name, in 1229, preached as a crusade. A claim
 * handed to Aragon in 1217 is not that event. It is a licence the AI may use in
 * 1219, in 1260 or never - and a live 1217 campaign was offered exactly that
 * card, with thirty years of war appetite attached.
 *
 * So this library does start wars. On approval, and only then, the game is told
 * to begin the war the record names, under its own casus belli, carrying its
 * own name. CK3 fights it. Temporary modifiers tilt it toward the outcome the
 * record gives and then expire; they do not decide it, and the attacker can
 * still lose.
 *
 * ## Why it is safe to let the Director do that
 *
 * The model chooses *which* war and nothing else. Every title, casus belli,
 * modifier and duration is a constant in the table below, reached by lookup,
 * and the parties are whoever holds the table's titles on the live map rather
 * than characters the model named. A key not in the table yields no script.
 * And a war is offered only inside a window around the record's date, only when
 * its attacker is free to declare war, and only while the target land is not
 * already the attacker's - which is how Valencia, taken early in that same
 * campaign, is kept from being proposed as a war it had already fought.
 *
 * ## Why a claim is granted as well
 *
 * The casus belli fights over a claim, as vanilla's own script-only historical
 * war does (raiktor_claim_cb, started by bookmark_events.txt). So the claim is
 * both the war's justification in the game's own terms and its fallback: if
 * start_war is refused, the claim and the zeal to press it remain, the AI can
 * pursue it by ordinary means, and the applied record says which of the two
 * happened.
 *
 * ## Keyed on titles, never on people
 *
 * The record says James I took Majorca from the Almohad wali Abu Yahya. A
 * campaign has its own people: in the one that prompted this, Peter II was
 * alive in 1217 - he died at Muret in 1213 - and the Balearics were held by a
 * Sardinian king under a crown created in play, whose title key no file
 * defines. So an entry names its attacker by the title that makes it Aragon and
 * its target by the land, and the war is fought by whoever holds them.
 */

import { compareVersions } from '../setup/modVersion.js';

/**
 * Whether the deployed mod carries the casus belli, modifiers and events.
 *
 * Same shape and reasoning as the other feature gates: validate runs deep in
 * the toolkit with no access to config, main.js resolves it at startup and
 * after any deploy, and the default permits so the harness can exercise the
 * library without a CK3 install.
 */
let support = { ok: true, version: null, reason: '', checked: false };

/** @param {{ok: boolean, version: string|null, reason: string}} next */
export function setWarSupport(next) {
  support = { ...next, checked: true };
}

/** @returns {{ok: boolean, version: string|null, reason: string, checked: boolean}} */
export function warSupport() {
  return support;
}

/**
 * What each modifier does, for the preview. Must match
 * mod/common/modifiers/hd_modifiers.txt, which is the thing that actually
 * applies; the two are not read from one another.
 */
const MODIFIERS = {
  hd_crusade_zeal: {
    name: 'Crusading Zeal',
    text: '+5 advantage, +20% levies, +15% knight effectiveness, +1 piety a month, and a greater appetite for war should the claim be left to press',
  },
  hd_beleaguered_realm: {
    name: 'Beleaguered and Unsupported',
    text: '-20% levies, -25% garrisons, -2 advantage',
  },
  hd_reconquest_resolve: {
    name: 'Resolve of the Reconquest',
    text: '+4 advantage, +15% levies, +10% knight effectiveness, +1 prestige a month, and a greater appetite for war should the claim be left to press',
  },
};

/**
 * @typedef {object} War
 * @property {string} label lower-case, for prose
 * @property {string} warName what the game will call it; must match the casus belli's localisation
 * @property {boolean} offered
 * @property {number} year the date the record gives
 * @property {number} before years ahead of it the war is offered
 * @property {number} after years past it the war is still offered
 * @property {'crusade'|'reconquest'} kind
 * @property {string} attackerTitle the title that makes a ruler the attacker
 * @property {string} attackerName
 * @property {string} targetTitle what the claim and the war are over
 * @property {string} targetName
 * @property {string} anchorCounty the land that decides who the defender is, and whether it is already taken
 * @property {string} cb
 * @property {string} attackerModifier
 * @property {string} defenderModifier
 * @property {number} years how long both modifiers last
 * @property {string} attackerEvent
 * @property {string} defenderEvent
 * @property {string} summary
 * @property {string[]} sources the war's own, so its card cites the war
 * @property {string} minMod the first companion mod version carrying this war's casus belli
 */

/** @type {Record<string, War>} */
export const WARS = {
  /**
   * James I landed at Santa Ponsa in September 1229 and Madina Mayurqa fell on
   * the last day of the year; Menorca submitted as a tributary in 1231 and
   * Ibiza fell in 1235. The expedition was preached with crusade indulgences,
   * which is why this is a crusade and not a claim war.
   *
   * The window opens five years early and stays open ten years late: a
   * campaign is not obliged to run to schedule, but a war offered in 1217 is a
   * different war wearing this one's name.
   */
  conquest_of_majorca: {
    label: 'the Conquest of Majorca',
    warName: 'The Conquest of Majorca',
    offered: true,
    minMod: '0.8.0',
    year: 1229,
    before: 5,
    after: 10,
    kind: 'crusade',
    attackerTitle: 'k_aragon',
    attackerName: 'Aragon',
    targetTitle: 'd_mallorca',
    targetName: 'the Duchy of Mallorca',
    anchorCounty: 'c_mallorca',
    cb: 'hd_conquest_of_majorca_cb',
    attackerModifier: 'hd_crusade_zeal',
    defenderModifier: 'hd_beleaguered_realm',
    years: 5,
    attackerEvent: 'hd_event.0230',
    defenderEvent: 'hd_event.0231',
    summary:
      "the crowning act of Aragon's thirteenth-century turn to the sea: James I landed on Majorca in September 1229 with crusade indulgences behind him, and Madina Mayurqa fell on the last day of the year",
    sources: [
      'https://en.wikipedia.org/wiki/Conquest_of_Majorca',
      'https://en.wikipedia.org/wiki/James_I_of_Aragon',
      'https://en.wikipedia.org/wiki/Crown_of_Aragon',
    ],
  },

  /**
   * In January 1236 Castilian frontiersmen took the Axarquia, Cordoba's eastern
   * suburb, by surprise and without orders; Ferdinand III came south and the
   * city surrendered that June. By then it was held not by the Almohads but by
   * Ibn Hud, who had risen against them in 1228 - which is exactly why the
   * defender is whoever holds the land, not whoever the textbook names.
   *
   * Over d_cordoba rather than the kingdom above it: see the casus belli file.
   */
  conquest_of_cordoba: {
    label: 'the Conquest of Córdoba',
    warName: 'The Conquest of Córdoba',
    offered: true,
    minMod: '0.9.0',
    year: 1236,
    before: 5,
    after: 10,
    kind: 'reconquest',
    attackerTitle: 'k_castille',
    attackerName: 'Castile',
    targetTitle: 'd_cordoba',
    targetName: 'the Duchy of Córdoba',
    anchorCounty: 'c_cordoba',
    cb: 'hd_conquest_of_cordoba_cb',
    attackerModifier: 'hd_reconquest_resolve',
    defenderModifier: 'hd_beleaguered_realm',
    years: 5,
    attackerEvent: 'hd_event.0232',
    defenderEvent: 'hd_event.0233',
    summary:
      'the fall of the old Umayyad capital: frontier knights seized its eastern suburb by surprise in January 1236, Ferdinand III came south to finish it, and the city surrendered that June',
    sources: [
      'https://en.wikipedia.org/wiki/Siege_of_C%C3%B3rdoba_(1236)',
      'https://en.wikipedia.org/wiki/Ferdinand_III_of_Castile',
      'https://en.wikipedia.org/wiki/Reconquista',
    ],
  },

  /**
   * Ferdinand III laid siege in the summer of 1247. The city was fed across the
   * bridge of boats to Triana until a Castilian fleet broke it in May 1248, and
   * Seville surrendered that November: the largest city in al-Andalus, and the
   * end of the peninsula's Almohad succession outside Granada.
   */
  conquest_of_seville: {
    label: 'the Conquest of Seville',
    warName: 'The Conquest of Seville',
    offered: true,
    minMod: '0.9.0',
    year: 1248,
    before: 5,
    after: 10,
    kind: 'reconquest',
    attackerTitle: 'k_castille',
    attackerName: 'Castile',
    targetTitle: 'd_sevilla',
    targetName: 'the Duchy of Seville',
    anchorCounty: 'c_sevilla',
    cb: 'hd_conquest_of_seville_cb',
    attackerModifier: 'hd_reconquest_resolve',
    defenderModifier: 'hd_beleaguered_realm',
    years: 5,
    attackerEvent: 'hd_event.0234',
    defenderEvent: 'hd_event.0235',
    summary:
      'the largest city in al-Andalus: Ferdinand III besieged it from 1247, a Castilian fleet broke the bridge of boats to Triana in May 1248, and the city surrendered that November',
    sources: [
      'https://en.wikipedia.org/wiki/Siege_of_Seville',
      'https://en.wikipedia.org/wiki/Ferdinand_III_of_Castile',
      'https://en.wikipedia.org/wiki/Reconquista',
    ],
  },

  /**
   * The first curated war outside Iberia, and the proof that nothing here was
   * ever Iberian. Proclaimed against the Cathars in 1209, the crusade won
   * battles for seventeen years without winning the country - Simon de
   * Montfort died under the walls of Toulouse in 1218 - until Louis VIII took
   * the cross himself in 1226 and the towns of the Midi opened to him. The
   * Treaty of Paris in 1229 bound Toulouse to the Capetians.
   *
   * Dated to the royal crusade rather than the first, because that is the war
   * that brought the land under the crown; a campaign at 1209 sees it as
   * scheduled rather than current. Over d_toulouse rather than k_aquitaine
   * above it, as the Castilian wars are over their duchies.
   */
  albigensian_crusade: {
    label: 'the Albigensian Crusade',
    warName: 'The Albigensian Crusade',
    offered: true,
    minMod: '0.10.0',
    year: 1226,
    before: 5,
    after: 10,
    kind: 'crusade',
    attackerTitle: 'k_france',
    attackerName: 'France',
    targetTitle: 'd_toulouse',
    targetName: 'the Duchy of Toulouse',
    anchorCounty: 'c_toulouse',
    cb: 'hd_albigensian_crusade_cb',
    attackerModifier: 'hd_crusade_zeal',
    defenderModifier: 'hd_beleaguered_realm',
    years: 5,
    attackerEvent: 'hd_event.0236',
    defenderEvent: 'hd_event.0237',
    summary:
      'the war that brought Languedoc under the French crown: proclaimed against the Cathars in 1209, it ended when Louis VIII led the royal army south in 1226, and the Treaty of Paris in 1229 bound Toulouse to the Capetians',
    sources: [
      'https://en.wikipedia.org/wiki/Albigensian_Crusade',
      'https://en.wikipedia.org/wiki/Louis_VIII_of_France',
      'https://en.wikipedia.org/wiki/Treaty_of_Paris_(1229)',
    ],
  },
};

/** Every war the model may choose. */
export const WAR_KEYS = Object.keys(WARS).filter((k) => WARS[k].offered);

/** @param {unknown} key */
export function isWar(key) {
  return typeof key === 'string' && Object.hasOwn(WARS, key) && WARS[key].offered;
}

/**
 * The titles the snapshot must look up for this library to judge anything.
 * Few by design: an attacker's title, a target title and one anchor county per
 * war.
 *
 * @returns {string[]}
 */
export function warTitles() {
  return [...new Set(WAR_KEYS.flatMap((k) => [WARS[k].attackerTitle, WARS[k].targetTitle, WARS[k].anchorCounty]))];
}

/** @param {string} key */
export function warWindow(key) {
  const w = WARS[key];
  return { from: w.year - w.before, to: w.year + w.after };
}

/**
 * Why this war does not fit the date, or null when it does.
 *
 * @param {string} key
 * @param {number} year
 * @returns {string|null}
 */
export function warWindowError(key, year) {
  const w = WARS[key];
  if (!w) return null;
  const { from, to } = warWindow(key);
  if (year < from) {
    return `${w.label} is on the record for ${w.year} and is offered from ${from}; the campaign is at ${year}, which is too early for it`;
  }
  if (year > to) {
    return `${w.label} is on the record for ${w.year} and its window closed in ${to}; by ${year} it would be a different war wearing its name`;
  }
  return null;
}

/**
 * Why the running mod cannot fight this particular war, or null.
 *
 * The library-wide gate says whether the mod has historical wars at all; this
 * says whether it has *this* one. A 0.8.0 mod carries Majorca's casus belli and
 * not Castile's, and offered Cordoba it would refuse start_war and quietly leave
 * a claim - the silent failure the gate exists to prevent, one war over. Silent
 * where the version is unknown, as in the test harness.
 *
 * @param {string} key
 * @returns {string|null}
 */
export function warModError(key) {
  const w = WARS[key];
  const version = support.version;
  if (!w || !version || compareVersions(version, w.minMod) >= 0) return null;
  return `${w.label} needs companion mod v${w.minMod} or newer, where its casus belli is defined, and the game has v${version}. Run: npm run deploy:mod, then restart CK3`;
}

/**
 * Who would fight this war on the live map, or why nobody can.
 *
 * The attacker is the holder of the attacker's title, and must be independent:
 * a vassal cannot declare a war of its own. The defender is the top liege over
 * the anchor county, so a Balearic count sworn to someone else brings that
 * someone into it. If the anchor county's top liege is the attacker, the land
 * is already theirs and the war has in effect already happened.
 *
 * @param {any} state the live snapshot
 * @param {string} key
 * @returns {{attacker: number, defender: number, error?: undefined} | {error: string}}
 */
export function warParties(state, key) {
  const w = WARS[key];
  const holders = state?.titleHolders;
  if (!(holders instanceof Map) || holders.size === 0) {
    return { error: 'this snapshot does not report who holds any title - an orchestrator older than the historical war library does not ask - so no war can be judged against it' };
  }

  const att = holders.get(w.attackerTitle);
  if (!att || att.holder === null) {
    return { error: `nobody holds ${w.attackerTitle} in this campaign, or its mods do not define it, so there is no ${w.attackerName} to fight ${w.label}` };
  }
  if (att.top !== null && att.top !== att.holder) {
    return { error: `the holder of ${w.attackerTitle} is sworn to character ${att.top}, and a vassal cannot declare a war of its own` };
  }

  const anchor = holders.get(w.anchorCounty);
  if (!anchor || anchor.holder === null) {
    return { error: `nobody holds ${w.anchorCounty}, so there is no one to take ${w.targetName} from` };
  }
  const defender = anchor.top ?? anchor.holder;
  if (defender === att.holder) {
    return { error: `${w.attackerName} already holds ${w.targetName}: ${w.label} has in effect already happened in this campaign` };
  }

  return { attacker: att.holder, defender };
}

/**
 * Refuse a claim that would pre-empt a curated war.
 *
 * The card that started this library was a grant_claim from Aragon on the
 * Balearics in 1217, with momentum: a licence to fight the Conquest of Majorca
 * twelve years early, under the wrong casus belli. A claim between exactly the
 * parties of a war the record schedules - before or during its window - is
 * redirected to the war. After the window closes, the record has moved on and
 * the claim is an ordinary claim again.
 *
 * Fails open where the snapshot carries no title lookups, as the other
 * snapshot-dependent guards do: silence means "not observed".
 *
 * @param {any} state
 * @param {number|null} actor
 * @param {number|null} target
 * @param {number} year
 * @returns {string|null}
 */
export function curatedWarConflict(state, actor, target, year) {
  if (actor === null || target === null || !Number.isFinite(year)) return null;
  for (const key of WAR_KEYS) {
    const w = WARS[key];
    const { from, to } = warWindow(key);
    if (year > to) continue;
    const p = warParties(state, key);
    if (p.error || p.attacker !== actor || p.defender !== target) continue;
    return year < from
      ? `${w.warName} is on the record for ${w.year}, and it is a war rather than a claim: it will be offered as historical_war from ${from}. A claim between these two now would license the AI to fight it ${w.year - year} years early, which is exactly what the record does not say`
      : `${w.warName} is on the record for ${w.year} and is available now as historical_war ${key}, which starts the war itself under its historical name; a claim between the same two realms is the wrong tool for it`;
  }
  return null;
}

/** @param {any} state @param {number} id */
function nameOf(state, id) {
  const r = state?.realmsById?.get(id);
  return r ? `${r.ruler} of ${r.primaryTitle}` : `character ${id}`;
}

/**
 * What approving this does, itemised. The only preview in the toolkit that has
 * to say "this starts a war", so it says it first.
 *
 * @param {string} key
 * @param {any} state
 * @returns {string}
 */
export function warPreview(key, state) {
  const w = WARS[key];
  if (!w) return `Unknown war "${key}".`;
  const p = warParties(state, key);
  const att = p.error ? w.attackerName : nameOf(state, p.attacker);
  const def = p.error ? `the holder of ${w.targetName}` : nameOf(state, p.defender);
  const { from, to } = warWindow(key);
  const zeal = MODIFIERS[w.attackerModifier];
  const siege = MODIFIERS[w.defenderModifier];

  return [
    `Start ${w.warName}: ${att} against ${def}, over ${w.targetName}.`,
    'Approving this starts a real war, which the game then fights:',
    `  - a pressed claim on ${w.targetName} for ${att}: the war's justification, and the fallback if the game refuses to start it`,
    `  - the war itself, under its own casus belli, named "${w.warName}" in game (a ${w.kind}, ${w.year} in the record)`,
    `  - ${zeal.name} on ${att} for ${w.years} years: ${zeal.text}`,
    `  - ${siege.name} on ${def} for ${w.years} years: ${siege.text}`,
    `  - on victory, ${w.targetName} and every county under it held by ${def}'s realm pass to ${att}`,
    `The modifiers tilt the war; they do not decide it. ${att} can still lose, and ${w.kind === 'crusade' ? 'a lost crusade' : 'a lost war'} loses the claim and pays reparations.`,
    `On the record for ${w.year}; offered ${from}-${to}; the campaign is at ${state?.year ?? 'an unknown year'}.`,
  ].join('\n');
}

/**
 * The one guarded batch.
 *
 * Built from the table alone: the parties are resolved in script from the
 * table's titles at the moment it runs, so a war judged against a snapshot
 * that has since gone stale is re-judged by the game itself. Order matters
 * twice. The claim comes before start_war because the casus belli fights over
 * a claim. And whether the war actually began is checked afterwards, by
 * looking for a war under this casus belli, because start_war reports nothing
 * and an applied record that assumed success would be the one lie this design
 * exists to avoid.
 *
 * @param {string} key
 * @param {number} token
 * @returns {string[]}
 */
export function warScript(key, token) {
  const w = isWar(key) ? WARS[key] : null;
  if (!w) return []; // lookup, never interpolation

  return [
    `title:${w.attackerTitle} = {`,
    '\tif = {',
    '\t\tlimit = { exists = holder }',
    '\t\tholder = { save_scope_as = hd_war_attacker }',
    '\t}',
    '}',
    `title:${w.anchorCounty} = {`,
    '\tif = {',
    '\t\tlimit = { exists = holder }',
    '\t\tholder = { top_liege = { save_scope_as = hd_war_defender } }',
    '\t}',
    '}',
    'if = {',
    '\tlimit = {',
    '\t\texists = scope:hd_war_attacker',
    '\t\texists = scope:hd_war_defender',
    '\t\tscope:hd_war_attacker != scope:hd_war_defender',
    '\t\tscope:hd_war_attacker = { is_independent_ruler = yes }',
    '\t\tNOT = { scope:hd_war_attacker = { is_at_war_with = scope:hd_war_defender } }',
    '\t}',
    '\tscope:hd_war_attacker = {',
    `\t\tadd_pressed_claim = title:${w.targetTitle}`,
    '\t\tstart_war = {',
    `\t\t\tcb = ${w.cb}`,
    '\t\t\ttarget = scope:hd_war_defender',
    '\t\t\tclaimant = scope:hd_war_attacker',
    `\t\t\ttarget_title = title:${w.targetTitle}`,
    '\t\t}',
    `\t\tadd_character_modifier = { modifier = ${w.attackerModifier} years = ${w.years} }`,
    '\t}',
    '\tscope:hd_war_defender = {',
    `\t\tadd_character_modifier = { modifier = ${w.defenderModifier} years = ${w.years} }`,
    '\t}',
    '\tif = {',
    `\t\tlimit = { scope:hd_war_attacker = { any_character_war = { using_cb = ${w.cb} } } }`,
    `\t\tscope:hd_war_attacker = { trigger_event = ${w.attackerEvent} }`,
    `\t\tscope:hd_war_defender = { trigger_event = ${w.defenderEvent} }`,
    `\t\tdebug_log = "HD:/;/applied/;/${token}/;/historical_war/;/war_started"`,
    '\t}',
    '\telse = {',
    `\t\tdebug_log = "HD:/;/applied/;/${token}/;/historical_war/;/claim_only"`,
    '\t}',
    '}',
    'else = {',
    `\tdebug_log = "HD:/;/refused/;/${token}/;/historical_war/;/precondition_failed"`,
    '}',
  ];
}

/**
 * The prompt section: what is on the record now, and what is scheduled later.
 *
 * The second half is the one that matters most. The 1217 card was a model
 * that knew Aragon took Majorca and reached for the only tool it had; telling
 * it the war exists, and when, is the instruction half of the fix - and
 * curatedWarConflict is the guard half, because in this project an
 * instruction is never trusted alone.
 *
 * @param {any} snapshot
 * @param {number} year
 * @returns {string} empty when nothing is current or upcoming
 */
export function warBriefing(snapshot, year) {
  const now = [];
  const later = [];

  for (const key of WAR_KEYS) {
    const w = WARS[key];
    const { from, to } = warWindow(key);
    if (year > to) continue;
    // Not briefed as available if the running mod cannot fight it: the model
    // would propose it and the toolkit would refuse it, which helps nobody.
    if (warModError(key)) continue;
    const p = warParties(snapshot, key);
    if (p.error) continue;
    const line = `${nameOf(snapshot, p.attacker)} (${p.attacker}) against ${nameOf(snapshot, p.defender)} (${p.defender}), over ${w.targetName}`;
    if (year >= from) now.push(`- ${key}: ${w.warName} (${w.year}, a ${w.kind}) - ${line}. ${w.summary}`);
    else if (from - year <= 30) later.push(`- ${w.warName}: ${line}, on the record for ${w.year} and offered from ${from}`);
  }

  if (now.length === 0 && later.length === 0) return '';
  return [
    ...(now.length ? [
      'These wars are on the record for this date. historical_war starts one outright, under its own name, and is the right tool for it rather than grant_claim:',
      ...now,
    ] : []),
    ...(later.length ? [
      'The record schedules these later. Do not pre-empt them with a claim now: a claim is a licence the AI may use a decade early, and the war itself will be offered when its window opens.',
      ...later,
    ] : []),
  ].join('\n');
}
