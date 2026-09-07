# Progress

Where the Historical Director actually stands, as distinct from what it is designed to do
([PROJECT.md](PROJECT.md)) or how to run it ([RUNNING.md](RUNNING.md)).

Kept honest: a thing is "working" here only if it has been watched working, and everything that has
not been is listed as such.

**Status:** v0.4.3 alpha · working branch `fix/wikidata-throttling`, unmerged and unpushed
**Last live test:** 7 September 2026 — a 1178-1197 Emirate of Ghirnatah campaign, two hours
unattended, roughly forty audits. Findings in section 3c.
**Last harness test:** 8 September 2026 — 81 tier and gate cases, 8 region cases, 4 localisation
cases, and the full loop end to end

> **New to this project, or a fresh session?** Read **section 3c** first. It is the current state of
> play: what the last live campaign proved, what was fixed because of it, and the one thing that was
> deliberately left undone. Section 3e says which branch everything is on.

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

- **The footprint and disappearance signals** (section 3d). The arithmetic and the subset guard are
  covered by ten cases, but no live campaign has yet produced a card that cites either one. The thing
  to watch for is a false positive after a sphere change: the guard should mark an unverifiable
  comparison with `?` rather than assert it, and a narrowed window should suppress it entirely.
- **The Wikidata cooldown** (section 3c). Reproduced against a real 429 and fixed, but the fix is
  about what happens over a two-hour session, and only a two-hour session will show whether the
  cooldown is long enough to stop provoking the endpoint in the first place.
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

## 3c. The 1197 Ghirnatah session, v0.4.3 — read this first if you are new here

A two-hour unattended session on 7 September 2026: an Emirate of Ghirnatah campaign, 1178 to 1197,
roughly forty audits at a one-in-game-year cadence with the sphere at reach 8. Nothing crashed. The
pump died twice and the watchdog rebuilt it unaided (about twenty-eight minutes the first time), CK3
rotated `debug.log` mid-session and the tailer rewound, settings were changed live from twelve
regions to twenty with no restart, and one `grant_claim` with `reconquista` momentum was approved and
confirmed applied.

Three findings came out of it, and two are fixed.

**1. A rate-limited Wikidata lookup was reading as "no evidence". Fixed.**

Every one of the forty audits logged `0 realms with structured backing` — a flat zero with no
variance, which is not what uneven coverage looks like. Wikidata was returning HTTP 429 with a
`Retry-After` header, and `resolveEntity` caught every failure identically and wrote `null` into a
cache that lives as long as the process. The first throttled burst therefore poisoned every dynasty
for the rest of the session; nothing was ever retried, and the Director spent two hours being told
that no structured evidence exists anywhere in the world.

Transport failure and "no such entity" are now different things. A 429 sets a module-wide cooldown
and is never cached; a genuine empty result still is, because most CK3 dynasties are invented and
re-asking every audit is what provokes the throttling. `evidenceFor` stops early while throttled and
carries a `throttled` flag, so the log says "Wikidata is rate-limiting us" instead of reporting an
empty pass as though the world has no history in it.

A second, smaller cause was real too: `dynastyFacts` only searched `"<name> dynasty"`, which resolves
`Zirid` and misses every European house, because CK3 prints `de Barcelona` and `d'Ivrea` where
Wikidata stores *House of Barcelona* and *Anscarids*. It now tries `House of <core>` on a genuine
miss, guarded by the hit's own description so "Barcelona" resolves to the family and not the city.
**Measured on the eight realms from the live snapshot: 0 of 8 before, 5 of 8 after.**

**2. The Director could not see Iberia coming apart. Half fixed.**

The 1197 map had a Kingdom of Calatayud that never existed, an Anointed Kingdom of Aragon under a
King-Bishop, a Kingdom of Ipuskoa under an Angevin queen, and no Castile at all. The Director
reported "this world is on track" thirty-seven times. Three distinct blind spots:

- *New realms are structurally unactionable.* Calatayud and Aragon were not present at capture, so
  `delta` returns "no baseline" and `adjust_title_tier` is refused. The log shows exactly this. The
  gate fails closed by design, but it means any kingdom formed after the baseline is beyond rank
  correction for the rest of the campaign. **Partly addressed — see section 3f.**
- *Territorial collapse was invisible.* `offer()` was already storing `countiesInSphere` and `delta()`
  only ever compared `tierKey`. **Fixed** — see section 3d.
- *Disappearance was invisible.* Nothing iterated the baseline looking for realms absent from the
  snapshot. **Fixed** — see section 3d.

**3. The prompt is tuned too quiet. Not fixed, and deliberately so.**

After the Seljuk over-eagerness in v0.2 the system prompt accumulated four separate instructions that
all push toward proposing nothing: "divergence is expected and often fine", "what matters is the
shape of the map, not the identity of the people on it", "prefer building over breaking", and
"returning zero proposals is a good answer". Together they tell the model that an Angevin queen
ruling a Basque kingdom is unremarkable. This is an over-correction and it wants pulling back, but
that is the change most likely to swing the Director into demoting things again, so it belongs in its
own reversible commit, tested against a live campaign, and it has not been made.

**Also worth knowing.** A one-in-game-year cadence produced forty audits and one proposal. Each audit
is a retrieval pass and one paid completion, and at that cadence the world barely moves between them,
so "nothing proposed" is usually the *correct* answer being bought forty times over. The five-year
default exists for this reason.

**And a correction, recorded so nobody re-investigates it.** A localisation-markup bug was reported
during this session and does not exist. `stripMarkup` in `src/bridge/protocol.js` already handles
CK3's `ONCLICK:`/`TOOLTIP:`/`L;` wrappers and `parseLine` already applies it to every field; the raw
log lines look alarming and the parsed records are clean. The diagnosis came from reading the log
without checking the parse step.

---

## 3d. Three axes instead of one, v0.4.3

The baseline measured rank and nothing else. It now measures three things, of which only the first
gates anything:

| Signal | What it means | Gates |
|---|---|---|
| rank rose | `Kingdom -> Empire` since capture | `adjust_title_tier`, unchanged |
| footprint fell | `= Kingdom, down 10 of 15 counties` | nothing — evidence only |
| vanished | a realm in the baseline absent from the world now | nothing — evidence only |

Disappearance is a prompt section rather than a table column, because a table of what exists has no
row for what does not — which is precisely why the most important fact about Iberia had nowhere to
appear.

**The correctness problem this had to solve first.** `countiesInSphere` is counted inside the sphere,
and the live session widened its sphere from twelve regions to twenty mid-campaign. A naive
comparison across that would have invented losses and absences wholesale. So the sphere is stored
with the baseline, and both derived signals are reported only when the captured sphere is a *subset*
of the current one. Widening can only add counties and reveal realms, so under a wider window a loss
is certainly a real loss and an absence is certainly a real absence. A narrowed window suppresses
both. A `baseline.json` written before the sphere was recorded reports them marked `?` rather than
silently or as though certain — the same choice as `= Empire since load`.

Gains are never reported at all: a wider window can manufacture a gain but cannot hide a loss, so
only the direction that stays sound is used. Losses under two counties or 25% are dropped, because a
kingdom shedding one county of fifteen is ordinary churn.

`Baseline.observing(regions)` must be called once per audit before anything reads a delta.
`Director.audit` does this; any new caller must too, or the signals report themselves unverified.

---

## 3f. Absence, and whether anyone was looking, v0.4.3

A 1199 session refused a Grand Emirate of Sahara as *"not present when the baseline was captured"*.
The refusal was right and its stated reason was a guess: that baseline was taken across a narrower
sphere and recorded no sphere at all, so the realm may have stood there for the whole campaign with
nobody watching.

`Baseline.absenceMeansNew` is the converse of `comparability` and the two are not interchangeable.
`comparability` asks whether a realm the baseline *held* can be missed now, and is safe when the
window only grew. This asks whether a realm the baseline *lacks* was genuinely absent, and is safe
only when the window has **not** grown — a sphere widened from twelve regions to twenty reveals
realms that were there all along, and reading those as newly formed would invent a history for each
of them.

The gate now splits three ways rather than two:

| Baseline | Realm | Verdict |
|---|---|---|
| any | present in it | unchanged — the rank rules as before |
| bookmark-start, window not grown | absent | refused firmly: it really was not there |
| window grown, or no sphere recorded | absent | the baseline is silent; the bookmark tables decide |

That third row is the change, and it is narrow. The tables refuse unless there is a real claim, so a
kingdom-tier realm still yields nothing; what it opens is an empire the bookmark roster does not
carry, which is exactly the divergence worth raising. The shipped map is untouched, because those
realms are *in* the baseline and take the first row — the Holy Roman Empire is still refused by name.

Every `baseline.json` written before the sphere was recorded takes the third row, which includes the
one in this campaign. That is the honest reading, not a degradation: those files never knew what they
were looking at.

Two existing cases changed with it, and both were asserting more than their data supported. One
tested the wording of a refusal rather than the refusal; the other opened with "it saw the whole
opening map of *its sphere*" over a baseline that had recorded no sphere at all. The premise is now
stated in the test.

---

## 3e. Branch state, as of 8 September 2026

| Branch | Contains | Pushed | Merged |
|---|---|---|---|
| `main` | everything through the public-release pass | yes | — |
| `feat/public-release-prep` | README v0.4.2, alpha warning, attribution, privacy sweep | yes | yes, into `main` |
| `fix/wikidata-throttling` | findings 1 and 2 above — the Wikidata fix and the two new baseline signals | **no** | **no** |

`fix/wikidata-throttling` is two commits ahead of `main` and has not been reviewed, merged or pushed.
Everything in it is orchestrator-side: **no mod change, no redeploy, no CK3 restart** — restarting
`npm start` is enough to pick it up.

Checks at the head of that branch: 81 tier and gate cases, 8 region cases, 4 localisation cases, and
the full loop end to end. All green.

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
- Review and merge `fix/wikidata-throttling` (section 3e), then run a live campaign and watch for a
  card that cites lost ground or a vanished realm — that is what the last two commits were for
- Tune the prompt back from silence (section 3c, finding 3). Its own commit, and the one most likely
  to reintroduce the demotion-happy behaviour of v0.2, so it wants a live campaign either side of it
- Run `verify-toolkit.mjs` against a throwaway save to close `set_relations`, the last toolkit action
  nobody has watched take effect
- Check Alfonso VIII's character view in the 1197 save for the reconquista modifier. The approved
  `grant_claim` logged `applied`, which proves the batch ran and not that
  `add_character_modifier` found its definition — those fail silently

**Known and unfixed**
- The sidebar shows stale state when the orchestrator restarts rather than saying "disconnected"
- The execution pump does not survive a save load; the yearly watchdog rebuilds it, but the console
  command is faster
- The baseline keys on primary title, so a renamed realm reads as `no baseline`
- A realm formed after the baseline was captured can never be rank-corrected: `delta` returns
  `no baseline` and `adjust_title_tier` refuses. The 1197 campaign had two such kingdoms. Failing
  closed is right; whether the bookmark tables should be allowed to speak for them is open
- A one-in-game-year audit cadence buys forty completions to hear "nothing proposed" forty times.
  The default of five exists for that reason and the sidebar does not say so
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
