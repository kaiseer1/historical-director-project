# Progress

Where the Historical Director actually stands, as distinct from what it is designed to do
([PROJECT.md](PROJECT.md)) or how to run it ([RUNNING.md](RUNNING.md)).

Kept honest: a thing is "working" here only if it has been watched working, and everything that has
not been is listed as such.

**Status:** v0.4.2 alpha · branch `feat/public-release-prep`
**Last live test:** 4 September 2026, a 1217 Banu Zahir campaign
**Last harness test:** 4 September 2026 — 26 tier and gate cases, 8 region cases, and the full loop
end to end against the built executable

---

## 1. What has been observed working, in a live game

These have been watched happening in a real campaign, not inferred from a test script.

| | Evidence |
|---|---|
| Perception | 62 realms read out of a 1066 Fatimid campaign; 22 out of a 1217 one |
| Player location | Correctly placed Rayy, Cairo, Kath and Tunis, and the sphere seeded from each |
| Sphere of influence | Cairo → Egypt and Ifriqiya, extended to the Maghreb, the Levant, Italy and Sicily |
| Knowledge layer | 6 era-filtered articles per audit; dynasty spans for Zirid (972-1148) and Fatimid (909-1171) |
| Proposal → approval → effect | The Zirids demoted from empire tier, and a pressed claim on Cyrenaica granted, both applied |
| Refusal reporting | Approved actions that the game declined reported as refused rather than as success |
| Baseline gate | Start-rank demotions rejected in a live campaign with the reason named |

The Zirid result is the one worth keeping. In 1066 the Zirids were emirs under nominal Fatimid
suzerainty rather than an empire-tier power; the Director identified the drift, chose the map-level
correction over inventing a person, cited its sources, and the map changed on approval.

## 2. Built and tested, but not yet watched in a game

Everything in this section passes end to end against the simulator and the built executable, and
none of it has been in front of CK3 yet. The simulator is a good proxy for the wire protocol and no
proxy at all for the engine, which is the distinction section 4 was written to record.

- **The widened sphere.** Seeding from the realm's footprint rather than the capital alone rests on an
  `any_realm_county` probe the engine has never actually answered. The trigger and the
  `title_province` form are both lifted from vanilla usage, and the record is additive — an audit that
  gets no `realm_region` records back falls to capital-only seeding rather than breaking — but
  "degrades correctly" is also untested.

  Worth noting for what it says about the design: this needed no mod change and no game restart. v0.3
  altered nothing under `mod/` but the descriptor's version string, because the probe is composed
  orchestrator-side and executed through the existing pump. That is exactly what moving the script out
  of the mod and into `ck3Script.js` was for, and it is the first time the benefit has been collected.
- **County-level de-duplication in the sweep.** `set_variable` on a county title is vanilla practice
  (`capital_county = { set_variable = unlocked_grain_dole }`), and the marks are cleared in a second
  pass, but a variable left on a title outlives the batch and the cleanup has not been watched running.
- **The mid-campaign gate.** Verified over eight cases in `check-tier-fixes.mjs`, including the exact
  1218 realm that produced the old refusal. What it has not done is put a proposal in front of a
  player in a real 1217 save.
- **Momentum on `grant_claim`** (§3a). The script is guarded and the fragments are fixed, but three
  things about it are untested against the engine: whether `add_character_modifier` finds the new
  modifiers at all (a missing definition is a script-log error CK3 skips, and no trigger can guard
  against it), whether the AI visibly acts on `ai_war_chance = 50` inside a reasonable span, and
  whether thirty years at that strength is far too much. The last of those is a tuning question that
  only a live campaign can answer.
- **`set_relations`.** `spawn_character` has now been seen to land in a live 1257 campaign, leaving
  this as the one action nobody has watched take effect. `scripts/verify-toolkit.mjs` stages it
  directly; it needs someone with a throwaway save.
- **The endowed spawn.** The house and the pressed claim are composed and guarded, and both use
  vanilla syntax, but nobody has yet opened a court and seen the claimant standing in it.
- **The three narrative events** (`hd_event.0100`–`0102`). Each logs when it fires so a blocked one is
  distinguishable from a working one, but none has been seen reaching a ruler.
- **The startup event firing unassisted.** Every live session so far has armed the pump by hand with
  `gui.createwidget`. Whether `hd_event.0001` fires on its own is still unknown.

## 3. The blocker of v0.2, and what was done about it

**On a mid-campaign save the Director was correct and almost entirely silent.**

Observed on 4 September over twenty minutes of play at 1217–1222: every audit ran, the model found
things to propose, and every proposal was refused:

```
dropped: adjust_title_tier: the banu zahir Empire has stood at empire tier
         since the campaign began (= Empire); that is the map as it started, not drift
```

The refusal was sound and the sentence was not. The baseline is captured from the first snapshot the
Director ever sees, so on a save loaded at 1217 "since the campaign began" means "since twenty minutes
ago" — and that realm had not stood anywhere since the campaign began, because the campaign began at a
bookmark the Director never saw.

**What `src/director/bookmarkTiers.js` does.** When the baseline was captured within five years of a
bookmark it is the map as shipped and nothing changes: the gate behaves exactly as it did, and the
Holy Roman Empire is as undemotable as it was. When it was captured well after one, the gate stops
claiming the baseline is evidence and consults a curated table instead:

- a realm the table names, held **above** its expected rank → permitted
- a realm the table names, held **at** its expected rank → refused, by name
- a realm at **empire tier that the table's roster does not carry** → permitted
- anything else → refused, saying it has no reference rather than pretending to one

The third rule is the one that unblocks the 1218 save, and it is offered at empire tier only. The
historical roster of empires at a given date is genuinely short and closed enough that a realm's
absence from it says something checkable; no other rank's is, so the same negative is not offered
there. **Absence from the table is never licence to demote** — it yields a refusal.

The "since campaign start" column now reads `= Empire since load` rather than `= Empire` when the
baseline is mid-campaign, because those are different claims and the model was acting on the first
while only the second was true.

Two further effects of the original cause, and where they stand:

- A realm whose primary title string changes between snapshots still reads as `no baseline` and is
  still refused. The baseline keys on title rather than character id. **Unfixed.**
- Wikidata still returns `0 realms with structured backing` on heavily-modded saves: "banu zahir" and
  "Empire of Italia" are alt-history names no encyclopedia carries. Those audits run on Wikipedia
  prose alone, and now on the bookmark table. **Unfixed, and probably unfixable from this direction.**

## 3a. Amplified `grant_claim`, v0.4

The first action to do more than one thing, and the first test of whether the
toolkit's constraints survive being asked to.

A pressed claim is a *reason* to go to war and nothing else. The Director could
hand one to a ruler with no money, no levies and no appetite for a campaign and
watch nothing happen for forty years — which, on a slow save, is indistinguishable
from the action having failed. `grant_claim` now takes an optional `momentum`
enum: `none` (the default, and byte-identical to the old behaviour),
`reconquista`, `holy_war`, `succession_pressure`. Non-none momentum grants the
claim *and* the means to press it.

**What it does not do is grant a casus belli, because CK3 cannot.** There is no
`add_casus_belli` effect in the base game; `casus_belli = X` appears only inside
a `start_war` block. Casus belli are derived — each type carries its own
`is_valid` and `allowed_for_character` triggers, and a ruler either satisfies
them or does not. The only way to hand someone a CB is to make an existing one's
triggers true, which is exactly what `add_pressed_claim` already does for
`claim_cb`. The claim *is* the CB grant; momentum is the half that pays for it:
gold, the resource the war itself costs (piety for a holy war, prestige
otherwise), and a timed character modifier raising `ai_war_chance` and removing
`ai_war_cooldown`.

There is deliberately no `start_war` anywhere in `momentum.js`. Setting the stage
is the design; deciding is still the ruler's.

**Precedent.** The modifiers are modelled on `guiscard_modifier`, which the base
game ships in `00_bookmark_modifiers.txt` to make Robert Guiscard behave like a
conqueror. It is the same idea — a historically aggressive ruler given a nudge —
so the approach is idiomatic rather than invented. Only four modifier keys are
used, each checked against real vanilla definitions: `ai_war_chance`,
`ai_war_cooldown`, `advantage`, `levy_size`. `ai_boldness` and `ai_zeal` were
considered and dropped because neither appears in any vanilla modifier
definition, so their behaviour would have been a guess.

**Magnitudes are large, by decision rather than by drift.** 1000 gold and a
thirty-year modifier at roughly five times guiscard's war appetite. Both sit
inside vanilla's own range (`add_gold = 1000` is common, `ai_war_chance = 100`
exists), but this is not a nudge, and the mitigation is disclosure: the preview
states the gold, the currency, the duration and the sentence "it does not start a
war, but it makes one considerably more likely" before anyone approves. Every
number lives in one table in `momentum.js` and its matching definitions in
`mod/common/modifiers/hd_modifiers.txt`.

**What the constraints bought.** The model picks one enum key and nothing else;
every fragment is a fixed constant reached by lookup, so an unrecognised key
yields no script rather than a malformed line. `validate` refuses an unknown
momentum *by name* rather than downgrading it to `none`, because substituting a
weaker action for the one proposed is the same class of error as repairing a
malformed proposal. And `holy_war` is refused between co-religionists, and
refused again when the snapshot carries no faiths at all — unknown is not
permission.

**This one needs a redeploy.** v0.3 changed no mod script; this adds
`mod/common/modifiers/hd_modifiers.txt`, so the mod must be redeployed and CK3
restarted, and the descriptor is at 0.4.0.

## 3b. What a live campaign found, v0.4.1 and v0.4.2

The first real session with v0.4 was worth more than the harness. Four things
came out of reading `error.log` and `debug.log` from a 1250 Caliphate of Arabia
save that the tests could not have found.

**Three localization entries had been unreadable for versions.** CK3 wants one
entry per line; three event descriptions wrapped, so the reader treated the
continuation as a new entry and dropped it. `hd_event.0100`–`0102` had no
description at all. Nothing in the harness had ever rendered a string - the
smoke test speaks the wire protocol end to end and never looks at a `.yml` -
so `scripts/check-localization.mjs` now does, and it is verified against both
real bugs by reintroducing them and watching it fail.

**The deployed mod was a version behind the orchestrator.** Momentum applies a
character modifier the mod has to define; a stale mod means the sidebar promises
a thousand gold, a thousand piety and thirty years of belligerence, the player
approves, and half of it happens while the applied record still says `ok`. The
toolkit now reads the deployed descriptor and refuses momentum outright rather
than describing effects that cannot land.

**The sphere had outgrown the rules that assumed it was small.** At reach 4 from
Cairo the sphere ran to Bengal across 124 realms, and the Director proposed
granting the King of France a claim on the Almoravids - two realms on opposite
edges of the window, neither of them the player. Bounded attention had become
unbounded agency. `grant_claim`, `set_relations` and `trigger_event` now need at
least one party within two steps of the player. `adjust_title_tier` stays global.

**The cadence was being reset by its own restarts.** 29 audits across six
in-game years against a five-year cadence, because `lastAuditYear` lived only in
memory. It is now persisted, and a restart takes one free snapshot instead of a
paid audit.

**And a fifth, which is a lesson rather than a bug.** `hd_toolkit_effects.txt`
and most of `hd_perception_effects.txt` had been dead since the orchestrator
started composing its own script, and they were not harmless: they produced an
error on every load, documented a wire format that had stopped being true, and
made the mod read as though it implemented a toolkit it had not implemented for
months. Deleted. The mod is down to `hd_heartbeat` and `hd_mark_alive`, which is
the property that let v0.3 widen the sphere with no mod change at all.

## 4. How it got here

Ordered, because each fix was only visible once the one before it was out of the way.

**Bridge, v0.1.** CK3 has no state-export API, so perception goes through `debug_log`, execution
through a self-recreating GUI widget running `run hd.txt`, and every batch carries a token guard so
the pump cannot execute it twice.

**Eight engine behaviours**, each of which presented as the previous one's fault:

1. `on_action` effect blocks do not merge — writing one onto a vanilla hook fights every other mod
2. `on_game_start_after_lobby` does not fire when loading a save
3. A gated recreation state kills a self-recreating widget rather than pausing it
4. `capital_county` needs a character scope, and `?=` hides its absence
5. CK3 mangles `$PARAM$` inside quoted `debug_log` strings
6. Logging only on success makes failure invisible
7. The model cannot know title keys, so it invents plausible ones
8. `character:<id>` does not resolve for runtime-generated characters

**Reasoning corrections, v0.2.** The Director proposed demoting a duke "to duke tier", and separately
proposed dissolving 1066 France and the Holy Roman Empire — both the bookmark as shipped. Four causes:
no baseline to diverge from, an action whose target rank lived only in prose, a prompt that
recommended the destructive verb, and a preview that understated what it would do.

**The gate made real.** The baseline reached the prompt but not `validate`, so the rule against
demoting a start-rank realm held only because the model was obeying an instruction. It is now checked
in code.

**Scope and packaging, v0.3.** The sphere seeded from the capital rather than the realm, grew a fixed
one step, and stopped at six regions; the cadence was a config file and a restart. All four are now
the player's, and the region catalogue grew from 17 entries to 25 — Ireland to Bengal.

**A counting bug found while widening it.** The Phase I catalogue was not a partition:
`world_europe_south` is exactly Italy plus the Balkans, and `world_middle_east` contains the whole of
Persia, Khorasan, Transoxiana and Mesopotamia — and all of those were Phase I together. The snapshot
counts counties per swept region, so a player in Rayy, a case section 1 records as tested, had every
Persian county counted twice and every Persian realm reading at twice its true size. That number
orders the prompt table and seeds the baseline, so the error had been propagating into what the model
saw and into what drift was measured against. The catalogue is now a verified partition, and the sweep
de-duplicates at county level so that a total conversion redefining regions cannot reintroduce it.

**Three lessons that are not about CK3**, the first two recorded in PROJECT.md §11: an action whose
intent lives only in prose is not constrained, and an instruction is not a guard. The third is from
this pass: a refusal can be correct and its stated reason still false, and the reason is the part the
player and the model both read.

## 5. Open items

**Next**
- Run v0.3 against the live 1217 save: the widened sphere and the mid-campaign gate are the two things
  it was built for and neither has faced the engine
- Run `verify-toolkit.mjs` against a throwaway save to close the two unobserved toolkit actions

**Known and unfixed**
- The sidebar shows stale state when the orchestrator restarts rather than saying "disconnected"
- The execution pump does not survive a save load; the yearly watchdog rebuilds it, but the console
  command is faster
- The baseline keys on primary title, so a renamed realm reads as `no baseline`
- The bookmark tables hold three dates. A campaign at 1300 is measured against 1178
- `d_kermanshah` is in both `world_middle_east_arabia` and `world_persia` in the base game. One duchy
  in 530; the county-level guard absorbs it, and `check-regions.mjs` allows it by name rather than by
  loosening the check

**Deliberately not started**
- New toolkit verbs. County-level work is blocked on richer perception: the snapshot reports
  top-liege rulers by tag, not counties and not titles as objects
- Anything borrowed from Voices of the Court's interface. Its licence has not been checked, and
  crediting a technique is not the same as copying code

**Done in v0.3**
- Executable packaging, using Node's single-executable support as PROJECT.md said it would. The
  zero-dependency claim survives: `scripts/bundle.mjs` folds `src/` into one CommonJS file rather than
  reaching for a bundler, and the only tool fetched from npm is `postject`, at build time, for the
  injection step Node does not provide

## 6. Second-order effects

Worth recording because it will happen again. After a Zirid demotion, a `RICE_sicily_intervention_cb`
war appeared against Robert Guiscard. The Director cannot create casus belli and the Lore Book
confirms it did not — that CB is `allowed_for_character = { always = no }`, unreachable except through
RICE's own character interaction.

But that interaction carries `ai_frequency_by_tier = { county = 80  duchy = 80  kingdom = 60
empire = 40 }`. Demoting a realm from empire to kingdom raises the AI's propensity to use it by half;
to duchy, it doubles. Authorship no, consequence yes — through a numeric weight in another mod's file,
not a trigger the demotion newly satisfied.

Any mod keying behaviour off tier will shift when the Director changes one.

## 7. What an alpha tester should be told

Because this is now something that can be handed to someone else.

- It needs CK3 in `-debug_mode`, which disables achievements. There is no way around that.
- The .exe is unsigned. SmartScreen will warn on first run.
- It costs money per audit, against whichever provider they configure. The default cadence is one
  audit per five in-game years.
- **Approve is the only safeguard.** Read the argument and the sources. A proposal against the
  player's own realm now says so in the preview, because on a mid-campaign save that is a likely
  target and breaking up your own empire by reflex is a bad way to find out.
- Declines are as useful as approvals; the Director is told not to raise them again.
- It will sometimes be wrong. During testing it invented a conquest of Granada that never happened.
