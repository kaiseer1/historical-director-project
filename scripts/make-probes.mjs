/**
 * The coalition probe set: four questions that gate whether the Director can
 * start wars beyond the curated table.
 *
 * ## Why they are all written at once
 *
 * Issue #1 section 8: `run` only resolves filenames that existed when CK3
 * launched. A probe written mid-session is invisible, and that failure looks
 * exactly like a dead pump. So every file this set needs is written in one
 * pass, before one restart, rather than one file and one restart per question.
 *
 * The corollary is the useful half, and it is what hd.txt has always relied on:
 * the *name* must pre-exist, the *contents* need not. Slots A, B and C below
 * are files with fixed names that can be rewritten as often as you like without
 * ever restarting the game again. That is where the question whose answer
 * nobody knows yet goes.
 *
 * ## Why each probe is its own file
 *
 * Section 9 established that a run file naming a title that does not exist
 * costs one error line and skips that block. That is a scope that fails to
 * resolve. An unknown *effect key* is a different animal - it is a parse
 * failure, and this project has no measurement of how much of a file one takes
 * down with it. So no probe shares a file with a probe that might not parse. A
 * wrong guess should cost one answer, not four.
 *
 *   node scripts/make-probes.mjs
 *   restart CK3            <- required once, and only once
 *   in console:            run hd_probe_peace.txt
 *   node scripts/read-probes.mjs
 *
 * Rewriting a slot needs no restart:
 *   node scripts/make-probes.mjs --slot a --effect "scope:hd_c_third = { ... }"
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config.js';

const cfg = loadConfig();
const argv = process.argv.slice(2);

/** @param {string} flag @param {string} fallback */
function arg(flag, fallback) {
  const i = argv.indexOf(`--${flag}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
}

// Defaults are the keys historicalWars.js already verified against vanilla and
// against every installed mod that overrides landed titles. Override them for
// your own campaign: the point of P1 is a weak attacker against a strong
// defender, and only you know which pair that is on your map.
const ATTACKER = arg('attacker', 'k_aragon');
const TARGET = arg('target', 'd_toulouse');
const ANCHOR = arg('anchor', 'c_toulouse');

// An existing casus belli, so P1 and P3 test war *behaviour* without also
// testing a new CB. P4 is the one that introduces a CB, and it introduces
// exactly one.
const CB = arg('cb', 'hd_albigensian_crusade_cb');

const runDir = path.join(cfg.ck3UserFolder, 'run');
fs.mkdirSync(runDir, { recursive: true });

/** @param {string} name @param {string} body */
function write(name, body) {
  const out = path.join(runDir, name);
  // BOM, for the reason RunFileManager documents at length: without it every
  // single `run` writes a lexer warning and re-validates the whole script
  // database across every loaded mod.
  fs.writeFileSync(out, '﻿' + body, 'utf8');
  return out;
}

const T = '\t';

// --------------------------------------------------------------------------
// P1 - does the AI sue for peace out of a war it cannot win?
// --------------------------------------------------------------------------
//
// This is the probe that gates the others, and it is the only one that cannot
// be answered by a single console round trip. "Will the AI give up" is a
// question about months, not about syntax.
//
// So it is token-guarded the way a batch is: the first pass starts the war,
// every later pass reports whether it is still running. Run it, unpause, run it
// again a few in-game months later, and read the timeline off read-probes.mjs.
//
// It deliberately reads nothing exotic. There is no data function here that
// snapshotScript has not already proven in a live game - GetID, GetName,
// GetStringShort - because the answer is carried entirely by whether the
// "alive" line stops appearing. A probe that needs new syntax to work cannot
// distinguish "the AI made peace" from "I guessed the syntax wrong".
const peace = [
  `# Historical Director - probe P1: does the AI white-peace out of an unwinnable war?`,
  `#`,
  `# First run starts the war. Every later run reports whether it still exists.`,
  `# Run once, unpause a few months, run again. Repeat.`,
  `#`,
  `# ${ATTACKER} -> ${TARGET} (anchor ${ANCHOR}) under ${CB}`,
  ``,
  `if = {`,
  `${T}limit = { NOT = { has_global_variable = hd_probe_peace_on } }`,
  `${T}set_global_variable = hd_probe_peace_on`,
  ``,
  `${T}title:${ATTACKER} = {`,
  `${T}${T}if = {`,
  `${T}${T}${T}limit = { exists = holder }`,
  `${T}${T}${T}holder = { save_scope_as = hd_p_att }`,
  `${T}${T}}`,
  `${T}}`,
  `${T}title:${ANCHOR} = {`,
  `${T}${T}if = {`,
  `${T}${T}${T}limit = { exists = holder }`,
  `${T}${T}${T}holder = { top_liege = { save_scope_as = hd_p_def } }`,
  `${T}${T}}`,
  `${T}}`,
  ``,
  `${T}if = {`,
  `${T}${T}limit = {`,
  `${T}${T}${T}exists = scope:hd_p_att`,
  `${T}${T}${T}exists = scope:hd_p_def`,
  `${T}${T}${T}scope:hd_p_att != scope:hd_p_def`,
  `${T}${T}${T}scope:hd_p_att = { is_independent_ruler = yes }`,
  `${T}${T}${T}NOT = { scope:hd_p_att = { is_at_war_with = scope:hd_p_def } }`,
  `${T}${T}}`,
  `${T}${T}scope:hd_p_att = {`,
  `${T}${T}${T}add_pressed_claim = title:${TARGET}`,
  `${T}${T}${T}start_war = {`,
  `${T}${T}${T}${T}cb = ${CB}`,
  `${T}${T}${T}${T}target = scope:hd_p_def`,
  `${T}${T}${T}${T}claimant = scope:hd_p_att`,
  `${T}${T}${T}${T}target_title = title:${TARGET}`,
  `${T}${T}${T}}`,
  `${T}${T}}`,
  `${T}${T}debug_log = "HD:/;/probe_peace/;/start/;/[GetCurrentDate.GetStringShort]"`,
  `${T}}`,
  `${T}else = {`,
  `${T}${T}debug_log = "HD:/;/probe_peace/;/refused/;/[GetCurrentDate.GetStringShort]"`,
  `${T}}`,
  `}`,
  ``,
  `# The poll. Outside the guard on purpose, so it reports on every pass.`,
  `title:${ATTACKER} = {`,
  `${T}if = {`,
  `${T}${T}limit = { exists = holder }`,
  `${T}${T}holder = {`,
  `${T}${T}${T}if = {`,
  `${T}${T}${T}${T}limit = { any_character_war = { using_cb = ${CB} } }`,
  `${T}${T}${T}${T}every_character_war = {`,
  `${T}${T}${T}${T}${T}limit = { using_cb = ${CB} }`,
  `${T}${T}${T}${T}${T}debug_log = "HD:/;/probe_peace/;/alive/;/[GetCurrentDate.GetStringShort]/;/[THIS.War.GetID]/;/[THIS.War.GetName]"`,
  `${T}${T}${T}${T}}`,
  `${T}${T}${T}}`,
  `${T}${T}${T}else = {`,
  `${T}${T}${T}${T}debug_log = "HD:/;/probe_peace/;/gone/;/[GetCurrentDate.GetStringShort]"`,
  `${T}${T}${T}}`,
  `${T}${T}}`,
  `${T}}`,
  `}`,
  ``,
].join('\n');

// --------------------------------------------------------------------------
// P3 - does a script start_war ignore a truce?
// --------------------------------------------------------------------------
//
// Deterministic on purpose: it lays the truce itself rather than hunting the
// map for one. A probe whose precondition depends on the campaign answers a
// question about your save, not about the engine.
//
// Note it confirms the truce landed BEFORE declaring. Without that line, "the
// war started" is ambiguous between "start_war ignores truces" and "the truce
// was never there" - the same class of mistake as an applied record that
// assumes success.
const truce = [
  `# Historical Director - probe P3: does start_war from script ignore a truce?`,
  `#`,
  `# Lays a truce, confirms it landed, then tries to declare through it.`,
  ``,
  `title:${ATTACKER} = {`,
  `${T}if = {`,
  `${T}${T}limit = { exists = holder }`,
  `${T}${T}holder = { save_scope_as = hd_t_att }`,
  `${T}}`,
  `}`,
  `title:${ANCHOR} = {`,
  `${T}if = {`,
  `${T}${T}limit = { exists = holder }`,
  `${T}${T}holder = { top_liege = { save_scope_as = hd_t_def } }`,
  `${T}}`,
  `}`,
  ``,
  `if = {`,
  `${T}limit = {`,
  `${T}${T}exists = scope:hd_t_att`,
  `${T}${T}exists = scope:hd_t_def`,
  `${T}${T}scope:hd_t_att != scope:hd_t_def`,
  `${T}${T}NOT = { scope:hd_t_att = { is_at_war_with = scope:hd_t_def } }`,
  `${T}}`,
  ``,
  `${T}scope:hd_t_att = {`,
  `${T}${T}add_truce_both_ways = { character = scope:hd_t_def years = 10 }`,
  `${T}}`,
  ``,
  `${T}# Did the truce land? Everything after this is unreadable without it.`,
  `${T}if = {`,
  `${T}${T}limit = { scope:hd_t_att = { has_truce_with = scope:hd_t_def } }`,
  `${T}${T}debug_log = "HD:/;/probe_truce/;/truce_confirmed"`,
  `${T}}`,
  `${T}else = {`,
  `${T}${T}debug_log = "HD:/;/probe_truce/;/truce_absent"`,
  `${T}}`,
  ``,
  `${T}scope:hd_t_att = {`,
  `${T}${T}add_pressed_claim = title:${TARGET}`,
  `${T}${T}start_war = {`,
  `${T}${T}${T}cb = ${CB}`,
  `${T}${T}${T}target = scope:hd_t_def`,
  `${T}${T}${T}claimant = scope:hd_t_att`,
  `${T}${T}${T}target_title = title:${TARGET}`,
  `${T}${T}}`,
  `${T}}`,
  ``,
  `${T}if = {`,
  `${T}${T}limit = { scope:hd_t_att = { any_character_war = { using_cb = ${CB} } } }`,
  `${T}${T}debug_log = "HD:/;/probe_truce/;/war_started_through_truce"`,
  `${T}}`,
  `${T}else = {`,
  `${T}${T}debug_log = "HD:/;/probe_truce/;/blocked_by_truce"`,
  `${T}}`,
  `}`,
  `else = {`,
  `${T}debug_log = "HD:/;/probe_truce/;/preconditions_unmet"`,
  `}`,
  ``,
].join('\n');

// --------------------------------------------------------------------------
// P4 - can a war name carry the title it is fought over?
// --------------------------------------------------------------------------
//
// This is the probe that decides whether generalising the war library costs six
// casus belli or sixty. It cannot be answered from a run file alone: a war's
// name is a localisation key on its CB, resolved by the game when it renders
// the war.
//
// But it can be READ from a run file, because [THIS.War.GetName] is already
// proven - snapshotScript emits it for every war in the sphere. So the probe is
// a CB with a dynamic name, a war started under it, and GetName read back. If
// the name comes back carrying the title, one CB per KIND of war is enough. If
// it comes back as a literal, every war needs its own CB and its own string.
const warname = [
  `# Historical Director - probe P4: does a dynamic war name resolve?`,
  `#`,
  `# Needs the probe CB deployed and CK3 restarted. Reads the rendered name back`,
  `# through [THIS.War.GetName], which snapshotScript already proves works.`,
  ``,
  `title:${ATTACKER} = {`,
  `${T}if = {`,
  `${T}${T}limit = { exists = holder }`,
  `${T}${T}holder = { save_scope_as = hd_n_att }`,
  `${T}}`,
  `}`,
  `title:${ANCHOR} = {`,
  `${T}if = {`,
  `${T}${T}limit = { exists = holder }`,
  `${T}${T}holder = { top_liege = { save_scope_as = hd_n_def } }`,
  `${T}}`,
  `}`,
  ``,
  `if = {`,
  `${T}limit = {`,
  `${T}${T}exists = scope:hd_n_att`,
  `${T}${T}exists = scope:hd_n_def`,
  `${T}${T}scope:hd_n_att != scope:hd_n_def`,
  `${T}${T}NOT = { scope:hd_n_att = { is_at_war_with = scope:hd_n_def } }`,
  `${T}}`,
  `${T}scope:hd_n_att = {`,
  `${T}${T}add_pressed_claim = title:${TARGET}`,
  `${T}${T}start_war = {`,
  `${T}${T}${T}cb = hd_probe_dynamic_cb`,
  `${T}${T}${T}target = scope:hd_n_def`,
  `${T}${T}${T}claimant = scope:hd_n_att`,
  `${T}${T}${T}target_title = title:${TARGET}`,
  `${T}${T}}`,
  `${T}}`,
  `}`,
  ``,
  `# Read whatever the game decided to call it.`,
  `title:${ATTACKER} = {`,
  `${T}if = {`,
  `${T}${T}limit = { exists = holder }`,
  `${T}${T}holder = {`,
  `${T}${T}${T}every_character_war = {`,
  `${T}${T}${T}${T}limit = { using_cb = hd_probe_dynamic_cb }`,
  `${T}${T}${T}${T}debug_log = "HD:/;/probe_name/;/[THIS.War.GetID]/;/[THIS.War.GetName]"`,
  `${T}${T}${T}}`,
  `${T}${T}}`,
  `${T}}`,
  `}`,
  ``,
].join('\n');

// --------------------------------------------------------------------------
// P2 - the slots
// --------------------------------------------------------------------------
//
// The coalition question. Its effect name is unknown until find-effects.mjs has
// read it off the game's own script, so the file cannot be written yet - and by
// section 8 it cannot be created after launch either.
//
// So three named files are created now, and rewritten later with --slot. Three
// rather than one because an unknown effect key may be a parse failure, and
// three candidates in one file would make one bad guess look like three dead
// ends.
//
// The scaffold around the effect is the part worth keeping fixed: it resolves
// three realms, runs whatever you put in the middle, and then asks the game the
// only question that matters - is the third realm now at war with the defender.
// An effect that parses and does nothing is the failure mode a probe without
// that check reports as success.

/** @param {string} slot @param {string} effect */
function slotBody(slot, effect) {
  return [
    `# Historical Director - probe P2 slot ${slot.toUpperCase()}: can a third realm join a running war?`,
    `#`,
    `# Rewrite this file freely; the name already existed at launch, which is all`,
    `# that run requires.`,
    `#`,
    `#   node scripts/make-probes.mjs --slot ${slot} --effect "<one effect>"`,
    ``,
    `title:${ATTACKER} = {`,
    `${T}if = {`,
    `${T}${T}limit = { exists = holder }`,
    `${T}${T}holder = { save_scope_as = hd_c_att }`,
    `${T}}`,
    `}`,
    `title:${ANCHOR} = {`,
    `${T}if = {`,
    `${T}${T}limit = { exists = holder }`,
    `${T}${T}holder = { top_liege = { save_scope_as = hd_c_def } }`,
    `${T}}`,
    `}`,
    ``,
    `# The running war, saved so the candidate effect has something to point at.`,
    `if = {`,
    `${T}limit = { exists = scope:hd_c_att }`,
    `${T}scope:hd_c_att = {`,
    `${T}${T}every_character_war = {`,
    `${T}${T}${T}limit = { using_cb = ${CB} }`,
    `${T}${T}${T}save_scope_as = hd_c_war`,
    `${T}${T}}`,
    `${T}}`,
    `}`,
    ``,
    `# A third realm: the player, who is guaranteed to exist and whose war window`,
    `# you can look at directly to confirm the log is telling the truth.`,
    `every_player = {`,
    `${T}save_scope_as = hd_c_third`,
    `}`,
    ``,
    `if = {`,
    `${T}limit = {`,
    `${T}${T}exists = scope:hd_c_war`,
    `${T}${T}exists = scope:hd_c_third`,
    `${T}${T}exists = scope:hd_c_def`,
    `${T}${T}scope:hd_c_third != scope:hd_c_def`,
    `${T}${T}scope:hd_c_third != scope:hd_c_att`,
    `${T}}`,
    `${T}debug_log = "HD:/;/probe_slot_${slot}/;/preconditions_ok"`,
    ``,
    ...effect.split('\n').map((l) => `${T}${l}`),
    ``,
    `${T}# The only question. An effect that parses and changes nothing is not a yes.`,
    `${T}if = {`,
    `${T}${T}limit = { scope:hd_c_third = { is_at_war_with = scope:hd_c_def } }`,
    `${T}${T}debug_log = "HD:/;/probe_slot_${slot}/;/JOINED"`,
    `${T}}`,
    `${T}else = {`,
    `${T}${T}debug_log = "HD:/;/probe_slot_${slot}/;/not_joined"`,
    `${T}}`,
    `}`,
    `else = {`,
    `${T}debug_log = "HD:/;/probe_slot_${slot}/;/preconditions_unmet"`,
    `}`,
    ``,
  ].join('\n');
}

const PLACEHOLDER = '# nothing yet - rewrite with --slot and --effect';

// --------------------------------------------------------------------------
// P5 - does a dispatch reply land?
// --------------------------------------------------------------------------
//
// The reply effects in director/dispatches.js have run against the simulated
// game and never against the engine. Three separate questions hide in that,
// and they fail in different ways:
//
//  - add_opinion with a mod-defined modifier, from one saved scope toward
//    another. hd_historical_opinion is already used by set_relations, so this
//    is the most likely of the three to work.
//  - add_gold with a NEGATIVE value. Paying 150 gold is the first effect in
//    this project that takes something away from the player rather than giving
//    it, and an engine that floors at zero or refuses the line outright would
//    make a cost that is named in the sidebar and never actually charged.
//  - add_piety and add_prestige, same question.
//
// A reply whose price is displayed and not charged is worse than one that
// cannot run: it is the sidebar lying about what the player just paid, which
// is the failure this project spends most of its guards avoiding.
//
// So each effect reports what it did AND the balance either side of it. The
// before-and-after is the whole probe: "the line executed" and "the player is
// 150 poorer" are different claims and only the second one matters.
const dispatchProbe = [
  `# Historical Director - probe P5: do the dispatch reply effects actually land?`,
  `#`,
  `# NET ZERO. Takes the cost, reads the balance, then gives it straight back,`,
  `# so this is safe on a campaign you care about.`,
  `#`,
  `# Three readings, and the middle one is the whole probe. "The line executed"`,
  `# and "the player is 150 poorer" are different claims and only the second`,
  `# answers the question - so the cost has to actually land before it is undone,`,
  `# and the restored reading is what proves it was undone.`,
  `#`,
  `# The one thing left behind is +25 opinion from a neighbour, which is a gift`,
  `# and not a cost. Reversing it would need a second modifier stacked on the`,
  `# first rather than a cancellation, which would leave more behind than it`,
  `# removed.`,
  `#`,
  `# If add_gold turns out not to work, before == after == restored and nothing`,
  `# moved either way. If it works and the restore somehow does not, you are down`,
  `# 150 gold and 100 piety, which is the whole exposure.`,
  ``,
  `title:${ANCHOR} = {`,
  `${T}if = {`,
  `${T}${T}limit = { exists = holder }`,
  `${T}${T}holder = { top_liege = { save_scope_as = hd_probe_sender } }`,
  `${T}}`,
  `}`,
  ``,
  `every_player = {`,
  `${T}save_scope_as = hd_probe_player`,
  `${T}debug_log = "HD:/;/probe_reply/;/before/;/[THIS.Char.GetGold]/;/[THIS.Char.GetPiety]/;/[THIS.Char.GetPrestige]"`,
  `}`,
  ``,
  `if = {`,
  `${T}limit = {`,
  `${T}${T}exists = scope:hd_probe_player`,
  `${T}${T}exists = scope:hd_probe_sender`,
  `${T}${T}scope:hd_probe_player != scope:hd_probe_sender`,
  `${T}}`,
  ``,
  `${T}# 1. the cost. Negative, which is the half that has never been tried.`,
  `${T}scope:hd_probe_player = {`,
  `${T}${T}add_gold = -150`,
  `${T}${T}add_piety = -100`,
  `${T}}`,
  ``,
  `${T}# 2. the opinion, from the sender toward the player - that direction and`,
  `${T}#    not the other, which is easy to get backwards and impossible to see.`,
  `${T}scope:hd_probe_sender = {`,
  `${T}${T}add_opinion = {`,
  `${T}${T}${T}target = scope:hd_probe_player`,
  `${T}${T}${T}modifier = hd_historical_opinion`,
  `${T}${T}${T}opinion = 25`,
  `${T}${T}}`,
  `${T}}`,
  ``,
  `${T}every_player = {`,
  `${T}${T}debug_log = "HD:/;/probe_reply/;/after/;/[THIS.Char.GetGold]/;/[THIS.Char.GetPiety]/;/[THIS.Char.GetPrestige]"`,
  `${T}}`,
  ``,
  `${T}# 3. give it back. Ordered after the reading on purpose: the cost has to`,
  `${T}#    have actually landed for the middle reading to mean anything, and`,
  `${T}#    this is what makes taking it safe.`,
  `${T}scope:hd_probe_player = {`,
  `${T}${T}add_gold = 150`,
  `${T}${T}add_piety = 100`,
  `${T}}`,
  ``,
  `${T}every_player = {`,
  `${T}${T}debug_log = "HD:/;/probe_reply/;/restored/;/[THIS.Char.GetGold]/;/[THIS.Char.GetPiety]/;/[THIS.Char.GetPrestige]"`,
  `${T}}`,
  `${T}debug_log = "HD:/;/probe_reply/;/ran/;/[scope:hd_probe_sender.Char.GetID]"`,
  `}`,
  `else = {`,
  `${T}debug_log = "HD:/;/probe_reply/;/preconditions_unmet"`,
  `}`,
  ``,
].join('\n');

// --------------------------------------------------------------------------
// The P4 casus belli, written into the mod rather than the run folder.
// --------------------------------------------------------------------------
//
// Two candidate localisation forms, exactly as probe2 emitted three variable
// syntaxes on one line rather than burning a round trip on each. Whichever one
// comes back through GetName carrying the title is the answer.
//
// This is a PROBE artifact. Delete both files before release: a CB in a shipped
// mod that no action can ever start is the kind of orphan the static analyser
// complains about forever.
const probeCb = [
  `# Historical Director - PROBE ONLY. Delete before release.`,
  `#`,
  `# Modelled on hd_conquest_of_majorca_cb, which is itself modelled on vanilla's`,
  `# raiktor_claim_cb. The only thing being tested is whether war_name can be`,
  `# built from the title the war is fought over rather than being a literal.`,
  ``,
  `hd_probe_dynamic_cb = {`,
  `${T}icon = claim`,
  `${T}group = event`,
  ``,
  `${T}should_show_war_goal_subview = yes`,
  `${T}mutually_exclusive_titles = { always = yes }`,
  `${T}allow_hostages = no`,
  ``,
  `${T}allowed_for_character = {}`,
  `${T}allowed_for_character_display_regardless = {}`,
  `${T}allowed_against_character = {}`,
  `${T}target_titles = claim`,
  `${T}target_title_tier = all`,
  `${T}target_de_jure_regions_above = yes`,
  `${T}ignore_effect = change_title_holder`,
  ``,
  `${T}valid_to_start = { always = no }`,
  ``,
  `${T}should_invalidate = {}`,
  `${T}on_invalidated_desc = msg_invasion_war_invalidated_message`,
  ``,
  `${T}cost = {}`,
  ``,
  `${T}on_declaration = { on_declared_war = yes }`,
  ``,
  `${T}war_name = "HD_PROBE_WAR_NAME"`,
  `${T}my_war_name = "HD_PROBE_WAR_NAME"`,
  `${T}war_name_base = "HD_PROBE_WAR_NAME"`,
  `${T}cb_name = "HD_PROBE_CB_NAME"`,
  `}`,
  ``,
].join('\n');

const probeLoc = [
  `l_english:`,
  ` # Historical Director - PROBE ONLY. Delete before release.`,
  ` #`,
  ` # Two candidate forms for a dynamically built war name, on one line, so one`,
  ` # console round trip settles which resolves. Read the result off GetName:`,
  ` #`,
  ` #   A= carries the target title  -> scope interpolation works, six CBs suffice`,
  ` #   B= carries the target title  -> the other form works`,
  ` #   both literal                 -> dynamic naming does not work here, and`,
  ` #                                   every war needs its own CB and string`,
  ` HD_PROBE_WAR_NAME:0 "A=[GetTitle('$TARGET_TITLE$')|E] B=[war.GetCasusBelli.GetTargetTitle.GetName]"`,
  ` HD_PROBE_CB_NAME:0 "Probe Claim"`,
  ``,
].join('\n');

// --------------------------------------------------------------------------

const slot = arg('slot', '');
if (slot) {
  const effect = arg('effect', '');
  if (!effect) {
    console.log('\n--slot needs --effect. For example:\n');
    console.log('  node scripts/make-probes.mjs --slot a \\');
    console.log('    --effect "scope:hd_c_third = { join_war = { war = scope:hd_c_war attacker = yes } }"\n');
    process.exit(1);
  }
  const name = `hd_probe_slot_${slot}.txt`;
  const out = write(name, slotBody(slot, effect));
  console.log(`\nRewrote ${out}\n`);
  console.log(`In CK3 console:   run ${name}`);
  console.log('Then:             node scripts/read-probes.mjs\n');
  console.log('No restart needed. The filename already existed at launch, which is the');
  console.log('only thing run checks.\n');
  process.exit(0);
}

const written = [
  write('hd_probe_peace.txt', peace),
  write('hd_probe_truce.txt', truce),
  write('hd_probe_name.txt', warname),
  write('hd_probe_reply.txt', dispatchProbe),
  write('hd_probe_slot_a.txt', slotBody('a', PLACEHOLDER)),
  write('hd_probe_slot_b.txt', slotBody('b', PLACEHOLDER)),
  write('hd_probe_slot_c.txt', slotBody('c', PLACEHOLDER)),
];

// The P4 artifacts go into the repo's mod folder, so deploy-mod carries them
// like anything else and version control shows they are there to be removed.
// fileURLToPath, not the URL's own pathname: this project's own folder has a
// space in it, and pathname hands back "historical%20director%20project".
const modRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const cbPath = path.join(modRoot, 'mod', 'common', 'casus_belli_types', 'hd_probe_cb.txt');
const locPath = path.join(modRoot, 'mod', 'localization', 'english', 'hd_probe_l_english.yml');
fs.writeFileSync(cbPath, '﻿' + probeCb, 'utf8');
fs.writeFileSync(locPath, '﻿' + probeLoc, 'utf8');

console.log('\nRun files:');
for (const w of written) console.log(`  ${w}`);
console.log('\nProbe mod files (DELETE BEFORE RELEASE):');
console.log(`  ${cbPath}`);
console.log(`  ${locPath}`);
console.log(`\nAttacker ${ATTACKER}, target ${TARGET}, anchor ${ANCHOR}, under ${CB}.`);
console.log('Override with --attacker / --target / --anchor / --cb.\n');
console.log('Order of operations:');
console.log('');
console.log('  1.  node scripts/find-effects.mjs      read the answers off the game itself');
console.log('  2.  npm run deploy:mod                 carries the P4 probe CB in');
console.log('  3.  RESTART CK3                        required once; issue #1 section 8');
console.log('  4.  console: run hd_probe_peace.txt    then unpause, then run it again');
console.log('      console: run hd_probe_reply.txt    net zero - safe on a real save');
console.log('  5.  node scripts/read-probes.mjs       after each run');
console.log('');
console.log('P1 answers first. If the AI abandons an unwinnable war within a few');
console.log('months, the coalition design does not work, and the other three probes');
console.log('are answering questions that no longer matter.\n');
