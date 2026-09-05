# Progress

Where the Historical Director actually stands, as distinct from what it is designed to do
([PROJECT.md](PROJECT.md)) or how to run it ([RUNNING.md](RUNNING.md)).

Kept honest: a thing is "working" here only if it has been watched working, and everything that has
not been is listed as such.

**Status:** v0.3 alpha · branch `fix/baseline-gate-v0.2`
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
- **`spawn_character` and `set_relations`.** Only the two map-shaping actions have been seen to land.
  `scripts/verify-toolkit.mjs` stages either one directly; it needs someone with a throwaway save.
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
