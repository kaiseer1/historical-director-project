/**
 * CK3 script the orchestrator composes for itself.
 *
 * These blocks used to be scripted effects in the mod, called with parameters:
 * hd_locate_player, hd_snapshot_begin = { TOKEN = 12 }, and so on. That does
 * not survive contact with the engine. CK3 mangles $PARAM$ substitution inside
 * a quoted debug_log string - "HD:/;/in_region/;/$REGION$" came back as
 * `HD:/;/in_region/;world_persia$`, one separator slash eaten and a stray
 * dollar left on the end - so every record carrying a parameter was
 * unparseable, which is why snapshots never arrived. Parameters used as script
 * *values* (region = $REGION$) substitute correctly; it is only interpolation
 * into a string literal that breaks.
 *
 * Writing the script here instead means the values are already literal by the
 * time CK3 sees them, so there is nothing left to substitute. It also means
 * the mod holds only param-free primitives, and changes to what we ask for no
 * longer need a mod reload or a game restart.
 */

/** Records emitted from a character scope; the wrapper is not optional. */
const PLAYER_SCOPE = 'every_player = {';

/**
 * Ask which regions the player sits in, and which their realm reaches into.
 *
 * Two questions, not one, and the difference decides how wide the sphere can
 * be. `capital_county` answers "where is the player" and is what the sphere is
 * seeded from. `any_realm_county` answers "where does the player rule", which
 * for an empire spanning Iberia, the Maghreb and Sicily is a much larger
 * answer - and the one that stops the Director watching Iberia while the
 * player's Sicilian provinces sit outside the window.
 *
 * capital_county needs a character scope, and the region test uses ?= so a
 * missing scope answers "no" rather than erroring. Hence every_player.
 *
 * The footprint probe runs only over regions the Director can actually reason
 * about, because its answers are only ever used to seed a sphere and an
 * unsupported region can never enter one. The capital probe still runs over
 * every region the game defines: an unrecognised home has to be a deliberate
 * "outside coverage" answer rather than an accident.
 *
 * @param {string[]} regions every region to test the capital against
 * @param {string[]} [footprintRegions] supported regions to test the realm against
 */
export function locateScript(regions, footprintRegions = []) {
  const header =
    'debug_log = "HD:/;/locate_begin/;/[THIS.Char.GetID]' +
    '/;/[THIS.Char.GetCapitalLocation.GetNameNoTooltip]' +
    '/;/[THIS.Char.GetCulture.GetName]/;/[THIS.Char.GetFaith.GetName]' +
    '/;/[THIS.Char.GetPrimaryTitle.GetNameNoTooltip]' +
    '/;/[THIS.Char.GetPrimaryTitle.GetRankConcept]/;/[GetCurrentDate.GetStringShort]"';

  const probes = regions.flatMap((r) => [
    '\tif = {',
    `\t\tlimit = { capital_county.title_province ?= { geographical_region = ${r} } }`,
    `\t\tdebug_log = "HD:/;/in_region/;/${r}"`,
    '\t}',
  ]);

  // Emitted as its own record kind rather than as more in_region lines, so a
  // mod build that predates this probe degrades to capital-only seeding
  // instead of reporting a footprint it never measured.
  const footprint = footprintRegions.flatMap((r) => [
    '\tif = {',
    `\t\tlimit = { any_realm_county = { title_province ?= { geographical_region = ${r} } } }`,
    `\t\tdebug_log = "HD:/;/realm_region/;/${r}"`,
    '\t}',
  ]);

  return [
    PLAYER_SCOPE,
    `\t${header}`,
    ...probes,
    ...footprint,
    '\tdebug_log = "HD:/;/locate_end/;/[THIS.Char.GetID]"',
    '}',
  ];
}

/**
 * Sweep the sphere and report every distinct top-level realm holding land in
 * it, with the count of counties each holds inside the sphere.
 *
 * ## Why counties are marked as they are counted
 *
 * The counter used to increment once per county per region. That is correct
 * only while no two regions in the sphere overlap, and the catalogue did not
 * guarantee it: `world_middle_east` contains the whole of `world_persia`, both
 * were Phase I, and a player in Rayy got a sphere holding both - so every
 * Persian county was counted twice and every Persian realm read as twice its
 * true size. `countiesInSphere` orders the prompt table and seeds the baseline,
 * so that error propagated into what the model was shown and what drift was
 * later measured against.
 *
 * regions.js is now a verified partition, which fixes it for vanilla. This
 * marks each county as it is counted and counts only unmarked ones, which
 * fixes it for everyone else: a total conversion may redefine these regions
 * however it likes, and a catalogue checked against the base game proves
 * nothing about the mod list the player is actually running. A second pass
 * clears the marks, because a variable left on a title outlives the batch and
 * would silently zero the next audit's count.
 *
 * ## Two rings, not one
 *
 * Realms are marked twice over, because two different questions are being
 * asked. `hd_home` means "holds land where the player does", and orders the
 * prompt table. `hd_near` means "within the player's neighbourhood", and is
 * what the locality rule in the toolkit acts on: at reach 4 a sphere runs from
 * Iberia to Bengal, and the Director was proposing wars between two realms on
 * opposite edges of it, neither of them the player. Home implies near.
 *
 * Sweeping in order - home, then near, then the rest - means a county lying in
 * two regions is attributed to the innermost ring that contains it.
 *
 * @param {string[]} regions the sphere
 * @param {number} token
 * @param {string[]} [homeRegions] where the player's own realm holds land
 * @param {string[]} [nearRegions] the neighbourhood; home is added to it
 */
export function snapshotScript(regions, token, homeRegions = [], nearRegions = []) {
  const home = new Set(homeRegions);
  const near = new Set([...homeRegions, ...nearRegions]);

  // Innermost ring first, whatever order the sphere arrived in.
  const ring = (r) => (home.has(r) ? 2 : near.has(r) ? 1 : 0);
  const ordered = [...regions].sort((a, b) => ring(b) - ring(a));

  // Where each realm actually is.
  //
  // The sweep walks one region at a time and already knows which region it is
  // in, and until now it threw that away - so the only thing downstream could
  // ask about a realm's location was its culture. That is a poor proxy, and a
  // live campaign proved it: a Sheikhdom of Murzuk sitting in Libya reads as
  // Andalusian, and a player ruling from Cairo reads as Iberian, because
  // culture travels with conquest and geography does not.
  //
  // So each region's sweep is followed immediately by a pass over the realms it
  // marked, emitting one record per realm per region. Deduplicated by the
  // marker variable, so a realm holding forty counties in a region yields one
  // record, and cleared before the next region so marks cannot bleed across.
  const regionPass = (r) => [
    'every_in_global_list = {',
    '\tvariable = hd_realm_set',
    '\tlimit = { has_variable = hd_in_region }',
    `\tdebug_log = "HD:/;/realm_in_region/;/[THIS.Char.GetID]/;/${r}"`,
    '\tremove_variable = hd_in_region',
    '}',
  ];

  const sweeps = ordered.flatMap((r) => [
    'every_county_in_region = {',
    `\tregion = ${r}`,
    '\tlimit = {',
    '\t\texists = holder',
    '\t\tNOT = { has_variable = hd_seen }',
    '\t}',
    '\tset_variable = hd_seen',
    '\tholder = {',
    '\t\ttop_liege = {',
    '\t\t\tif = {',
    '\t\t\t\tlimit = {',
    '\t\t\t\t\tNOT = { is_target_in_global_variable_list = { name = hd_realm_set target = this } }',
    '\t\t\t\t}',
    '\t\t\t\tadd_to_global_variable_list = { name = hd_realm_set target = this }',
    '\t\t\t\tset_variable = { name = hd_counties value = 0 }',
    '\t\t\t}',
    '\t\t\tchange_variable = { name = hd_counties add = 1 }',
    // Marks the realm as one of the player's own neighbours, so the prompt
    // table can lead with them instead of with whatever is largest.
    ...(home.has(r) ? ['\t\t\tset_variable = { name = hd_home value = 1 }'] : []),
    // And the wider ring the locality rule acts on.
    ...(near.has(r) ? ['\t\t\tset_variable = { name = hd_near value = 1 }'] : []),
    // Which region this realm was found in. Cleared by the pass below.
    '\t\t\tset_variable = { name = hd_in_region value = 1 }',
    '\t\t}',
    '\t}',
    '}',
    ...regionPass(r),
  ]);

  const unmark = ordered.flatMap((r) => [
    'every_county_in_region = {',
    `\tregion = ${r}`,
    '\tlimit = { has_variable = hd_seen }',
    '\tremove_variable = hd_seen',
    '}',
  ]);

  // Each realm is tagged with its position in the sweep, and the tag is what
  // actions use to find the character again later. character:<id> is not an
  // option: CK3 only resolves that for characters defined in history files, so
  // for a ruler generated at runtime - which by 1071 is nearly all of them -
  // `exists = character:34497` is false even though the game itself just
  // reported 34497 as that character's id. The list therefore has to stay
  // alive after the snapshot, because it is the only handle we have on them.
  const emit =
    'debug_log = "HD:/;/realm/;/[THIS.Char.GetID]' +
    '/;/[THIS.Char.GetTitledFirstNameNicknamedNoTooltipRegnal]' +
    '/;/[THIS.Char.GetPrimaryTitle.GetNameNoTooltip]' +
    '/;/[THIS.Char.GetPrimaryTitle.GetRankConcept]' +
    "/;/[THIS.Var('hd_counties').GetValue]" +
    '/;/[THIS.Char.GetCulture.GetName]/;/[THIS.Char.GetFaith.GetName]' +
    '/;/[THIS.Char.GetCapitalLocation.GetNameNoTooltip]' +
    '/;/[THIS.Char.GetDynasty.GetName]/;/[THIS.Char.GetHouse.GetName]' +
    '/;/[THIS.Char.IsIndependentRuler]/;/[THIS.Char.GetGovernment.GetNameNoTooltip]"';

  // Rank, as a value the script decides rather than a word the game prints.
  //
  // The realm line already carries GetRankConcept, but that is localised: on a
  // German install it says "Herzogtum", and a total conversion can rename ranks
  // outright. Anything that guards a destructive action on a localised string
  // stops guarding the moment someone plays in another language. So the tier
  // travels separately, as one of five fixed keys, derived from primary_title.tier.
  //
  // It is a separate record rather than a new field on the realm line because
  // toRealm parses positionally; appending to that line would break every
  // existing parser for it. Additive, per the wire-protocol rule.
  //
  // The test is written `primary_title ?= { ... }` rather than
  // `primary_title.tier = ...` because the second form assumes the scope has a
  // primary title at all. Every realm in this sweep is a top liege holding
  // land, so it should always hold - but that is precisely the shape of
  // assumption that produced a campaign reporting itself as being nowhere,
  // and the cost of being wrong here is a log full of script errors rather
  // than a quiet miss.
  const TIERS = ['empire', 'kingdom', 'duchy', 'county', 'barony'];
  const tierEmit = TIERS.flatMap((t) => [
    '\tif = {',
    `\t\tlimit = { primary_title ?= { tier = tier_${t} } }`,
    `\t\tdebug_log = "HD:/;/realm_tier/;/[THIS.Char.GetID]/;/${t}"`,
    '\t}',
  ]);

  return [
    'clear_global_variable_list = hd_realm_set',
    `debug_log = "HD:/;/snapshot_begin/;/${token}/;/[GetCurrentDate.GetStringShort]/;/[GetCurrentDate.GetDateAsTotalDays]/;/[GetPlayer.GetID]"`,
    ...sweeps,
    ...unmark,
    'set_global_variable = { name = hd_idx value = 0 }',
    'every_in_global_list = {',
    '\tvariable = hd_realm_set',
    '\tset_variable = { name = hd_tag value = global_var:hd_idx }',
    `\t${emit}`,
    ...tierEmit,
    '\tif = {',
    '\t\tlimit = { has_variable = hd_home }',
    '\t\tdebug_log = "HD:/;/realm_home/;/[THIS.Char.GetID]"',
    '\t\tremove_variable = hd_home',
    '\t}',
    '\tif = {',
    '\t\tlimit = { has_variable = hd_near }',
    '\t\tdebug_log = "HD:/;/realm_near/;/[THIS.Char.GetID]"',
    '\t\tremove_variable = hd_near',
    '\t}',
    // Wars this realm has started.
    //
    // The Director could see every realm's rank, size, culture, faith and
    // geography, and not that two of them were already fighting. So it could
    // licence a claim for a war under way, and - with no way to see whether a
    // ruler ever acted on what it granted - every number in momentum.js and
    // moments.js was a dial nobody could read. County counts only reveal a war
    // once it has been won.
    //
    // Reported from the attacker's side alone, so each war appears once instead
    // of twice. A war whose attacker sits outside the sphere therefore goes
    // unseen even when its defender is inside it: the sphere already bounds
    // perception everywhere else, and de-duplicating in script would cost a
    // second pass for nothing.
    '\tsave_scope_as = hd_belligerent',
    '\tevery_character_war = {',
    '\t\tlimit = { primary_attacker = scope:hd_belligerent }',
    '\t\tsave_scope_as = hd_war',
    '\t\tprimary_defender = {',
    '\t\t\tdebug_log = "HD:/;/war/;/[scope:hd_belligerent.Char.GetID]/;/[THIS.Char.GetID]/;/[scope:hd_war.War.GetName]"',
    '\t\t}',
    '\t}',
    '\tremove_variable = hd_counties',
    '\tchange_global_variable = { name = hd_idx add = 1 }',
    '}',
    `debug_log = "HD:/;/snapshot_end/;/${token}"`,
  ];
}

/**
 * Find a tagged realm and save it under a scope name.
 *
 * Tags are assigned in sweep order, and realm records reach the orchestrator in
 * that same order, so the Nth record carries tag N. No index needs to travel
 * over the wire for the two sides to agree.
 *
 * @param {number} tag
 * @param {string} scopeName
 */
export function resolveTagged(tag, scopeName) {
  return [
    'every_in_global_list = {',
    '\tvariable = hd_realm_set',
    `\tlimit = { var:hd_tag = ${tag} }`,
    `\tsave_scope_as = ${scopeName}`,
    '}',
  ];
}

/**
 * A toolkit action. The action itself now emits both an applied and a refused
 * record, so the orchestrator no longer has to assume the effect landed just
 * because the batch executed.
 *
 * @param {string[]} scriptLines from the action's toScript
 * @returns {string[]}
 */
export function actionScript(scriptLines) {
  return scriptLines;
}
