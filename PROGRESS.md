# Progress

Where the Historical Director actually stands, as distinct from what it is designed to do
([PROJECT.md](PROJECT.md)) or how to run it ([RUNNING.md](RUNNING.md)).

Kept honest: a thing is "working" here only if it has been watched working, and everything that has
not been is listed as such.

**Status:** v0.6.0 alpha · branch `feat/engine-resilience`, companion mod v0.6.0 (needs redeploy and a CK3 restart)
**Last live test:** 8 September 2026 — a 1193-1206 Kingdom of Castile campaign. Findings in sections
3c and 3g; the moment library and the duplicate guard both came out of it.
**Last harness test:** 8 September 2026 — 150 tier and gate cases, 27 engine-resilience cases,
8 region cases, 4 localisation cases, and the full loop end to end across all three smoke legs

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

## 3g. Wars, which nobody could see, v0.5.2

For five versions the snapshot carried a realm's rank, size, culture, faith, dynasty, government and
geography, and not the one fact that decides whether a claim means anything: who is already fighting.

The consequence was not subtle once it was named. County counts change only when a war is **won**, so
Castile at 16 counties and Leon at 14 from July 1205 to March 1206 read as a peninsula at rest, and
the Director had no way to tell that from a peninsula in the middle of a campaign. It licensed claims
on both readings alike. Worse, it could not observe whether a ruler had ever acted on what it granted
— which means every magnitude in `momentum.js` and `moments.js` was a dial nobody could read.

**What the mod now emits.** One record per war, per belligerent inside the sphere, from the same
per-realm loop that already writes the realm lines:

```
HD:/;/war/;/<war id>/;/<attacker id>/;/<defender id>/;/<war name>
```

**The first version of this did not work, and the way it failed is the point.** It reported from the
attacker's side only — `save_scope_as = hd_belligerent`, then a filtered `every_character_war`, then
`[scope:hd_belligerent.Char.GetID]` to read it back. Every name in it had been checked against the
game files first: `every_character_war` (88 uses), `primary_attacker` as a war-scope trigger (584),
`primary_defender` as a scope link in effect context (`00_prison_interactions.txt`,
`war_on_actions.txt`), the `.War.` cast from `core_l_english.yml:544`.

Thirty records came back on the first live snapshot, and every one of them read:

```
HD:/;/war/;/ERROR:[scope:hd_belligerent.Char.GetID]/;/16820178/;/ERROR:[scope:hd_war.War.GetName]
```

The defender resolved. Both `scope:` references did not. **A `scope:` reference resolves in script —
the toolkit's own actions depend on it and have always worked — but not inside the data-function
interpolation of a quoted `debug_log` run from a batch file, where there is no event to hold the
saved scope.** Only `THIS`, the current scope, is addressable there. Verifying that a *function*
exists says nothing about whether the *scope it is called on* will be reachable, and those are two
separate checks.

Two things followed. First, every field is now read off the war itself — `[THIS.War.GetID]`,
`[THIS.War.GetActiveCB.GetAttacker.GetID]`, `[THIS.War.GetActiveCB.GetDefender.GetID]`,
`[THIS.War.GetName]` — with no saved scope anywhere in the emit. `GetActiveCB.GetAttacker` and
`GetActiveCB.GetDefender` have 22 uses each; `War.GetID` is `window_ledger.gui:4864`.

Second, dropping the attacker-side filter means each war is emitted once per belligerent in the
sphere. That duplicate is collapsed on the war id in `WorldState`, and it is **strictly better than
what it replaced**: a war now reaches the Director if *either* side is inside the sphere, where the
filtered version made a whole war invisible whenever its attacker sat outside.

**And the failure was legible, which is the only reason this took ten minutes.** CK3 wrote
`ERROR:[...]` into the field rather than dropping the line or emitting silence. The parser now
requires all three ids to be finite before it keeps a record, so an `ERROR:` field yields no war
rather than a war between nobody — a war nobody can identify is worse than no war, because it would
read as a fact.

**The guard that follows from it.** `grant_claim` and `historical_moment` now refuse a pair already at
war with each other. A pressed claim cannot start a war against someone you are already fighting, so
the claim itself would sit idle — but the 1000 gold, 1000 prestige and multi-year war modifier beside
it land immediately, on a belligerent, mid-campaign. That is not setting a stage; it is reinforcing
one side of a fight already in progress, and nothing in the preview would have told the player so.

It fails **open** where wars are not reported at all. A mod too old to emit them leaves no war list,
and refusing every claim on that basis would break the toolkit for anyone who has not redeployed.
Silence means "not observed", which is also what the prompt section says in as many words rather than
leaving the model to read an empty list as peace.

**Also visible now in the activity log**, named rather than counted, because the reason this was built
is that the player could not see what the Director was reacting to and a bare count leaves them with
the same question one step later:

```
snapshot received: 5 realms in 1218.4.2; 1 war under way: the banu zahir Empire -> Kingdom of Navarra
```

That line is also the check. A snapshot of 193 realms across twenty regions that reports no wars is
not a quiet world; it is a broken emit, and the first version said exactly that by saying nothing.

**Orchestrator-side only.** `snapshotScript` is generated into `run/hd.txt` and executed by the mod's
existing pump, so this is **no mod change, no redeploy, no CK3 restart** — restarting `npm start` is
enough.

## 3h. Three engine limits, borrowed rather than discovered, v0.6.0

The VOTC project filed [issue #1](https://github.com/kaiseer1/historical-director-project/issues/1)
on this repository: a postmortem of an afternoon spent finding three CK3 behaviours the hard way. All
three apply here, two of them worse than they did there, and none of them was visible from inside
this codebase. Recording that plainly because it is the most useful thing in this document: **the
findings are theirs, measured under controlled experiment, and this section is what it cost to act on
them rather than to discover them.**

### The 17MB wall

CK3's log subsystem stops writing after roughly **17MB of cumulative writes in a session**, and
`debug.log` and `error.log` die together. The limit counts what the engine has written, not what is
on disk, which makes the obvious fix useless:

| Cleanup | Peak file | Cumulative | Result |
|---|---:|---:|---|
| None | 17.3MB | 17.3MB | dead |
| External truncation every 4MB | 13.4MB | 17.6MB | **dead** |
| In-game `log.clearAll` | 7.2MB | 59.6MB+ | alive |

The middle row is the one worth staring at. Truncating the file from outside is the fix anyone would
reach for first, and it does nothing at all.

**Worse here than in VOTC.** The Director is a bulk writer where VOTC is a conversational one. One
snapshot of a twenty-region sphere is several thousand lines, and the live campaign that prompted the
war-reporting work was running a one-year audit cadence over 193 realms. That is an afternoon to the
wall, after which the Director goes blind and nothing says so.

**What it took.** `log.clearAll` is a console command. No effect in the game runs a console command -
checked, not assumed - and the run file the orchestrator stages contains effects, so the orchestrator
cannot clear the log. It can only ask.

The bridge from script state to a GUI condition was not obvious either. `HasGlobalVariable` and
`GetGlobalVariable` **do not exist as GUI functions**; they appear nowhere in the game's own `gui/`
files. A scripted GUI is the attested route: `is_shown` is a script trigger, GUI reads it through
`GetScriptedGui('name').IsShown(...)`, and `effect` is the return path that retires the request. So:

```
orchestrator                      mod
------------                      ---
bytes read > 4MB
  set_global_variable  ------->   hd_log_clear_a
                                  scripted GUI is_shown = has_global_variable
  widget                <-------  GetScriptedGui('hd_log_clear_a').IsShown
                                  ExecuteConsoleCommand('log.clearAll')
                                  .Execute -> remove_global_variable
tailer sees the file shrink  <--  (the only acknowledgment there is)
```

Four slots rotate, because a GUI state fires on a false-to-true edge and consecutive requests need
distinct edges. Each request also retires the *previous* slot, which is not tidiness: a slot left set
by a widget that was dead when the request arrived would never present a fresh edge again, and the
fifth clear of a session would silently do nothing.

**The rule that costs the most to get wrong.** A clear is never requested while a staged batch is
waiting to be acknowledged. Two reasons, and the second is the bad one: there is only one run file,
so a clear request would overwrite a pending batch; and `log.clearAll` destroys the echo that batch
is about to write, so the orchestrator would time out and report a dead pump for a batch that ran
perfectly. Waiting costs bytes. Clearing costs the truth.

### Fullscreen event windows kill the pump

Any fullscreen event window can silently destroy a console-created widget, and the pump is one. VOTC
reproduced it three times in an evening and established that it is not specific to any event.

The defence is not prevention - the engine behaviour cannot be prevented - but resurrection points
wherever it may just have happened. Every window this mod opens is now one: the proposal
notification, the macro event, and both moment acknowledgements. Each clears the pump before
recreating it, so a pump that was still alive converges back to one instance rather than doubling.

**The watchdog moved to `quarterly_playable_pulse`, not monthly.** The brief said monthly; there is
no monthly global pulse in CK3. `yearly_global_pulse` is the only global one the engine offers -
`common/on_action/_on_actions.info` lists them - and `quarterly_playable_pulse` is the fastest
attested hook that reaches a player. It carries a character root and fires for every playable
character on the map, so the effect is gated to the player; a watchdog that fired for four hundred
counts would ask four hundred times whether one widget exists.

It also stays *conditional*. Rebuilding unconditionally would mean firing `hd_event.0001` at the
player every quarter, and 0001 is a visible popup. A fix that interrupts the campaign four times a
year to solve a problem the player does not have is not a fix.

### A dead pump and a dead log are the same silence

Both look like this from the orchestrator's chair: a staged batch is never acknowledged and nothing
arrives. They need opposite responses - Recall the pump, or restart the game - so guessing is worse
than saying nothing.

The discriminator is the log file rather than the records in it. If the engine is still writing
anything at all, the subsystem is alive and the silence is the pump's. If the file has stopped
growing altogether, the subsystem is the suspect.

**Log exhaustion is checked first, and that ordering is the whole point.** When the log is dead every
dead-pump symptom is present too, because the echo cannot reach us either - so the pump diagnosis
would send the player to fix a working thing with a tool that cannot work.

This needs no knowledge of whether the game is paused, which the orchestrator has no way to ask. The
pump is a GUI widget on a two-second timer and GUI timers keep running through a pause, so a paused
game with a live pump still writes its liveness mark - which is why `RunFileManager.clear` leaves
`hd_mark_alive` outside the token guard.

### What is verified and what is not

Everything orchestrator-side is covered by `scripts/check-resilience.mjs`: 27 cases over the budget
rules, the tailer's rewind, the two banners and their ordering, and the mod files themselves - every
slot the orchestrator can ask for has a scripted GUI and a widget watching it, no slot stacks a
second state, and the watchdog names a hook the engine actually calls.

**The GUI mounting is not verified in a live game.** It cannot be from here: it needs a redeploy and
a CK3 restart. Two specific things want watching, and both are named in the code:

1. `GUI.ClearWidgets hd_runner` - the *named* form. Vanilla only ever uses the bare
   `GUI.ClearWidgets`, which would clear every console-created widget including VOTC's. The named
   form is VOTC's, validated live in their game but not attested in the game files. If it is ignored,
   the failure is duplicate pumps rather than none.
2. The re-arm nested inside `hd_pause_widget`. VOTC saw a container starve a sibling state machine in
   their tree. If the game ever stops pausing on a proposal, that nesting is the first suspect.

Neither is guessed at silently; both are marked in the files that contain them.

---


## 3i. The log budget was measuring the wrong session, v0.6.1

The accounting added in 3h was wrong in the unsafe direction, and a live session on this machine is
what showed it. At 20:21 on 2026-09-08, CK3 had been running since 17:26 and had written **34.6MB**
to `debug.log`. A tailer attached at that moment would have reported **0MB spent**.

Two causes, both fixed:

- **`bytesSinceClear` started at zero.** Reading starts at the end of the file, which is right —
  replaying old records would fire stale snapshots at the Director. But the *budget* is a claim about
  what the engine has written, and starting it at zero measured the orchestrator's own uptime
  instead. This document recommends restarting `npm start` to pick up changes; every one of those
  restarts silently forgave the whole bill. It is now seeded from what is already on disk, which in a
  running session is a lower bound on what the engine has written since the last clear.
- **`error.log` was not counted at all.** The limit is shared between the two files. In that same
  session `error.log` took **24.8MB in three and a half minutes** — another mod's repeating script
  error — and was never on the books. It is now counted and still never read.

### The 17MB figure did not reproduce here

Recorded because the number is load-bearing and this is evidence against it:

| | VOTC's measurement | This machine, 2026-09-08 |
|---|---|---|
| debug.log | dead at ~17.3MB | **34.6MB and still writing** |
| error.log | died with debug.log | stopped at 24.8MB, mid-line, while debug.log carried on |
| `log.clearAll` calls | required to survive | **zero, all session** |

That is one install disagreeing with another rather than a refutation — three controlled runs are
better evidence about their machine than one observation is about every machine, and the difference
may be CK3 version or write *rate* rather than cumulative total, since their probe emitted 6–13MB in
bursts where this writes steadily. **So the threshold has not been raised.** Being early costs a
cleared log, which costs nothing. Being late costs the campaign's remaining visibility.

### And the fix from 3h had never actually run

The running game reported `HD:/;/mod_version/;/0.5.1`. The deployed mod had no `hd_log_clear` slots
and no re-arm widget — the whole of 3h existed in the repository and in no campaign. The version gate
was correctly refusing to request a clear, which is why the log-clear chain shows zero activity in a
34MB session: the machinery worked, and had nothing to work on.

Worth noting *how* that was caught. The mod reports its own version through the wire on every batch,
so the running game contradicted the descriptor on disk. That is the technique VOTC recommends in
§5 of issue #1 after `copy2` mtimes misled them for an afternoon, and it was already built here.

## 3j. The Almohad collapse, v0.7.0

The second macro action, and the counterpart to `iberian_pressure` rather than a variant of it.

**Why a second action and not a fourth intensity.** `iberian_pressure` describes a peninsula
gathering around a unifier and is supported by how much ground the Andalusian realms still hold.
This describes a power coming apart from the inside and is supported by how little. They act on
opposite parties and are licensed by opposite evidence, and a 13th-century peninsula can carry both
at once — Castile consolidating while the Almohads disintegrate is the historical case, not a
contradiction. `collapseBand` is deliberately the mirror image of `intensityBand`, and a test asserts
that a world supporting the strongest pressure supports no collapse at all.

**The history it is modelling.** Las Navas de Tolosa in 1212 did not destroy the Almohad state; it
destroyed its authority in al-Andalus. What followed was disintegration rather than conquest — Ibn
Hud in Murcia in 1228, Ibn al-Ahmar founding the Nasrid emirate at Granada in 1238, the third taifas
emerging from provinces whose governors stopped answering. Only then did the Christian crowns take
the pieces: Cordoba 1236, Valencia 1238, Seville 1248. The order is the whole design. The Almohads
were not beaten and then divided; they were divided and then beaten in detail.

So the weight is on vassals leaving, not on armies losing. `vassal_opinion` is the lever, because
vanilla's independence faction reads liege opinion directly: `common/factions/00_factions.txt` scores
joining at `OPINION_MULTIPLIER = -0.4` against a base reluctance of `-150`.

**There is no CK3 modifier that raises faction chance.** Checked rather than assumed: no `faction_*`
key exists anywhere in the game's modifier localisation, and the scoring lives in
`common/scripted_modifiers/00_faction_modifiers.txt`, which a mod can only reach by replacing a
150-line vanilla block wholesale — a fight with every other faction-touching mod and with every
patch. So the requested 40% is a per-vassal `random = { chance = 40 }` in the event, gated on the
engine's own `can_create_faction`.

**Where this crosses the Director's line, stated rather than buried.** Every other action licenses
and equips and then leaves the ruler to decide. This one moves a vassal who did not choose to move.
Three things keep it inside the rules: the engine keeps its veto through `can_create_faction`; what
is created is a *faction*, which is a demand and a war that can still be lost, not a title transfer;
and the preview states the odds in words — "a two-in-five chance, rolled separately for each landed
vassal" — before anyone approves anything. A test asserts that sentence is in the preview, and
another asserts that the number in the preview equals the number the event rolls, because those two
live in different files and drift is how a sidebar starts lying.

The larger half of the effect is not the roll at all. It is the standing `vassal_opinion` penalty and
a timed opinion modifier, which go on feeding vanilla's own scoring for twenty-five years after the
event is forgotten.

**Severity band.** Andalusian counties as a share of Iberian counties: ≥ 0.6 refuses outright
("a power in possession of the peninsula rather than one coming apart in it"), ≥ 0.4 admits
`fraying`, ≥ 0.2 admits `breaking`, below that admits `shattered`. The baseline sharpens it where an
Andalusian realm has actually lost rank or ground since the campaign began.

**Gated at mod v0.7.0.** Five character modifiers, an opinion modifier and three events all live in
the mod, so a v0.6.0 mod would run the batch, report `applied ... ok`, and do none of it. A fifth
threshold rather than a bump of an existing one, for the reason `MOMENT_MIN_MOD` gives: the features
are independent.

**Not yet watched in a live game.** The band, the refusals, the script and the preview are covered by
13 cases in `check-tier-fixes.mjs`. What no test can confirm is the CK3 side: that
`can_create_faction` and `create_faction` behave inside an `every_vassal` loop the way the vanilla
vassal interaction uses them, and that the defection actually appears in the faction list. That needs
a campaign.


## 3k. What the pump itself costs, and the interval as a setting

**Every `run` re-validates the world.** Watched live on 2026-09-08: each time the pump executed
`run hd.txt`, CK3 re-walked its entire script database and re-reported every unset variable and flag
in every loaded mod — about 315 `error.log` lines per tick, 3,110 notices in a sample, **30 of them
ours and 3,080 other mods'**. At a two-second cadence that was roughly 158 lines a second, and the
single largest driver of log volume in the session. The Director's snapshots were not close.

**The encoding warning was a marker, not the cause.** Each of those ticks also logged
`File 'run/hd.txt' should be in utf8-bom encoding` — 13 ticks, 13 warnings. The run file is now
written with a BOM, which is what CK3 asks for and what VOTC specifies for its own run file in issue #1
§2.2. After the change: 10 ticks, **0 warnings — and still 315 lines per tick.** The BOM is correct and
removed one line per tick; the revalidation is inherent to `run` and did not move.

**The control.** On 2026-09-11 the same modlist ran with this mod disabled in the playset. Quiet-stretch
baseline: about 8 `error.log` lines a second. With the pump at two seconds it had been about 158. The
pump raises the steady error rate roughly twentyfold on a heavy modlist, and the cost is linear in
both the pump rate and the number of mods loaded. On a clean install it would be a handful of lines.

**So the interval is now a setting: `director.pumpIntervalSeconds`**, default 2, clamped to 1–30. It is
the only setting that lives in the mod rather than the orchestrator — it is a `duration` inside a GUI
state, and nothing can read a global variable from one — so `deployMod` rewrites it into
`hd_runner.gui` on the way to disk, at a line marked `# HD_PUMP_INTERVAL`. Changing it needs
`npm run deploy:mod` and a CK3 restart.

The timings that depended on two seconds now scale off it instead, and one of them was a latent bug:

| | was | now |
|---|---|---|
| pump-dead timeout | 25s | max(25s, 5 × interval) |
| ack window | 15s | max(configured, 4 × interval) |
| clear-request retire | **3s** | max(3s, 2 × interval) |

The last one would have broken silently. A clear request was staged and the run file retired three
seconds later — fine at a two-second pump, but at five or ten seconds the request would be written and
wiped between two ticks, so the log would never clear and the budget would ask again forever. Four
cases in `check-resilience.mjs` cover the substitution: the marker ships, a configured value reaches
the widget, nothing else in the file is touched, and a file without the marker deploys at its default
rather than failing.

### error.log dies; debug.log does not

Two sessions, the same shape:

| | error.log stopped | debug.log |
|---|---|---|
| 2026-09-08, HD enabled | 24.8MB, mid-burst at 17:29:41 | carried on to 34.6MB |
| 2026-09-11, HD disabled | 27.9MB, mid-burst at 00:16:13 | carried on to 35.8MB |

Both times the last line was a trigger that fires on every evaluation, so the file stopped rather than
the errors. That is not the single shared ~17MB counter issue #1 describes, and it is recorded in
`LogBudget.js` as a disagreement between installs rather than a refutation. The code comments that
asserted the limit was shared have been corrected.

It still argues for counting `error.log` in the budget, for a sharper reason than before: `error.log` is
the only place a broken mod effect reports itself. On 2026-09-11 it was dead ten minutes in. A
collapse approved after that point could have failed inside `create_faction` and nothing would ever
have said so.


## 3l. Historical wars: the record's events, not only its pressures, v0.8.0

A Director card in a live 1217 campaign proposed a `grant_claim` from Aragon on the Balearics, with
reconquista momentum. The history in its prose was right — James I took Majorca in 1229 — and the tool
was wrong twice over: a claim is a licence the AI may use in 1219 or in 1260, and the record gives a
war and a date. It was approved, so that campaign now carries the licence.

**What changed in the project's rules.** Every action until now said "it transfers no titles and
starts no wars". `historical_war` starts one: on approval, the war the record names begins under its
own casus belli and carries its own name, and CK3 fights it. The approval gate is untouched — nothing
reaches the game until the player presses Approve — so the human-in-the-loop design survives. What
changed is how much the Director may do once it is pressed.

**Paradox's own pattern.** `bookmark_events.txt` starts a historical war from script:
`start_war = { cb = raiktor_claim_cb ... }`, then finds it with `random_character_war ... using_cb`
and tilts it with `spawn_army`. `hd_conquest_of_majorca_cb` follows `raiktor_claim_cb` line for line:
`group = event` and `valid_to_start = { always = no }`, so nobody can declare it by hand, and
`target_titles = claim`, so it fights over the claim the batch grants first. A war's name comes from
its casus belli's localisation, so the game calls it *The Conquest of Majorca*.

**Tilted, not decided.** Five-year modifiers — `hd_crusade_zeal` on the attacker, `hd_beleaguered_realm`
on the defender — make the record's outcome likely without guaranteeing it; the attacker can still
lose. A timed modifier is among the cheapest things CK3 has, and lighter than Paradox's own
`spawn_army`.

**The claim is justification and fallback.** If `start_war` is refused, the claim and the zeal remain
for the AI to press. The batch looks for a war under the casus belli afterwards and reports
`war_started` or `claim_only`, so the sidebar says which happened rather than assuming.

**Curated, dated, and keyed on land.** The model picks a war from a table and nothing else. The
Balearics in that campaign sat under a crown created in play, whose key no file defines, so the war is
over `d_mallorca` — identical in vanilla and in all three installed mods that touch the islands — and
the parties are whoever holds `k_aragon` and the top liege over `c_mallorca`. Offered 1224–1239;
refused if the attacker already holds the land (the Valencia case), is not independent, or is already
at war with the defender.

**The guard for the card that started it.** A `grant_claim` between the exact parties of a curated war
that has not yet passed is refused, with a pointer to the war and the year it opens.

**Asked of the running game, not assumed.** A read-only probe on 2026-09-11:

| question | answer |
|---|---|
| who holds the Balearics and Aragon | Baldu II holds `c_mallorca`, `c_menorca` and `d_mallorca`, independent; Pero II holds `k_aragon`, independent |
| a run file naming a title that does not exist | one "Failed to fetch a valid landed title" line; that block is skipped; the rest runs |
| a run file created after launch | unknown to `run` until CK3 restarts; files that existed at launch run normally |

The second is what made it safe to add title lookups to every snapshot. The third is why this
project's single fixed `hd.txt` was the right design from the start.

**Not yet watched in a live game.** Eleven cases in `check-tier-fixes.mjs` cover the window, the
parties, the refusals, the batch and the guard. Whether `start_war` accepts this casus belli from
script, and whether the war appears under its name, needs a campaign.


## 3m. Castile's wars, and a cap on claims, v0.9.0

**The card that made the cap necessary.** The first audit on v0.8.0, in the same live 1217 campaign,
proposed a `grant_claim` from Castile, with reconquista momentum, on the Mu'minid Empire's own title.
The model's reasoning was that Castile should take the Almohads' last three holdings in Iberia. What it
proposed would have done something else entirely: a pressed claim is on the target's primary title,
so a claim on an emperor is a claim on the empire, and winning it hands over the empire and everything
under it - Morocco included. It would have made Castile Almohad emperor.

The moment library already refused this: `targetTier: 'kingdom'` on the Almohad moment, with a comment
naming exactly this outcome. `grant_claim`'s preview named the tier too. Neither stopped it, because the
model reached past the curated tool for the general one. **Now no claim - from `grant_claim` or from
`spawn_character`'s optional claim - may be on an empire-tier title**, checked ahead of each action's own
validation, with an instruction in the prompt beside it.

**Castile's wars.** *The Conquest of Córdoba* (1236, offered 1231-1246) and *The Conquest of Seville*
(1248, offered 1243-1258), built exactly as Majorca was: a curated entry, a casus belli, two flavour
events, the claim as justification and fallback, five-year modifiers - `hd_reconquest_resolve`, a
little milder than the crusade's and paid in prestige rather than piety, and `hd_beleaguered_realm` on
the defender. Named after the Spanish *Conquista de Córdoba* and *de Sevilla*, to match *the Conquest
of Majorca*.

**Over the duchies, not the kingdom.** `d_cordoba` and `d_sevilla` both sit de jure under
`k_andalusia`, and a war over the kingdom would hand Castile all of al-Andalus in one peace - the
Mu'minid mistake one tier down. The record took Andalusia a city at a time. All four keys are
identical in vanilla and in the three installed mods that touch Iberian titles.

**Derived, not rewritten.** The two new casus belli are generated from Majorca's by substitution, with
an assertion that nothing Balearic survives the copy, so the three cannot drift apart mechanically.

**Per-war mod versions.** Majorca needs v0.8.0, Castile's wars v0.9.0. A mod that carries one casus
belli and not the next would otherwise refuse `start_war` for the missing one and leave a claim,
silently - the failure the feature gate exists to prevent, one war over. Each entry now carries its
own `minMod`, and a war the running mod cannot fight is neither offered nor briefed.

Seven more cases in `check-tier-fixes.mjs`: the live card refused verbatim, the same claim refused
through `spawn_character`, a kingdom claim untouched, Córdoba offered in 1236, the per-war version
gate, every batch naming only its own war, and the 1217 briefing telling the model both Castilian
wars are scheduled and when.


### Keeping up with a campaign played at speed

The first session on v0.9.0 was played fast, and the thirty-second minimum between clear requests
could not keep up: **46.8MB went through the logs in the thirty seconds around 1 Jan 1220** - the
yearly pulse evaluating everything at once - and `error.log`, which has died at 24.8MB and 27.9MB in
earlier sessions, stood at 24MB when the next clear landed. Logging survived; the tailer read all
46.8MB. About 1% of it was this mod's; the largest sources were Muslim Enhancements'
`me_hafidh_scheme.txt` and `me_triggers_override.txt`, and vanilla's wedding events tripped by a mod.

The gap is now three pump ticks, floored at eight seconds (`clearGapMs`). It has to outlast the run
file's retirement of the previous request, two ticks after staging, or a new request could be wiped
before the pump reads it; a test checks that for every allowed pump interval.


## 3n. Watched working: a historical war, started live, v0.10.0

**The Conquest of Majorca began in a live 1219 campaign.** Staged by the exact batch the Director
builds on approval (`hd_wartest.txt`, generated from `warScript`), in the same second:

```
run hd_wartest.txt
event_fired hd_event.0230      Aragon: "The Conquest of Majorca"
event_fired hd_event.0231      Mallorca: "Sails off the Island"
applied/;/999001/;/historical_war/;/war_started
```

The game's own war window called it **"The Conquest of Majorca"**, fought over the "Archonate of
Mallorca" - which is what the installed mods call `d_mallorca` under Sardinian naming, so the war went
over the land's own title rather than the crown its holder created in play. Zero errors from the batch
or the casus belli. `start_war` accepts a script-only casus belli from a run file, and the batch's own
check - a war under that casus belli exists afterwards - is what reported it.

**What the war window showed that the tests could not.** The stakes are heavy for a two-county duchy:
a lost war costs the attacker 2,500 gold in reparations and a thousand in fame, because the casus belli
pays fame on vanilla's fixed `major_prestige_value` rather than on the claim war's own size-scaled
factor. Worth scaling down.

**Vanilla can race the record.** In the same campaign, played on without the test, Aragon took Mallorca
in 1220 - nine years early - under Fate of Iberia's *Iberian Reclamation*, the expel-interloper casus
belli, because the islands' king was Sardinian. It needed neither the Director's claim nor its momentum,
both of which had been revoked. The historical war then correctly read as already fought. Holding a war
to its date against vanilla's own mechanisms would need a restraining tool; that is a design question,
not a bug.

**Beyond Iberia: the Albigensian Crusade.** France against whoever holds Toulouse, over `d_toulouse`,
dated to Louis VIII's royal crusade of 1226 and offered 1221-1236. The first curated war outside the
peninsula, added to show the machinery was never Iberian: no code changed to add it, only a table
entry, a casus belli derived from Majorca's, two events and their localisation. `k_france`,
`d_toulouse` and `c_toulouse` are identical in vanilla and in both installed mods that define them.

**Also seen live, and queued rather than fixed.** The four log-clear slots evaluate their scripted GUI
with `GetPlayer` as root, and while a save is loading there is briefly no player, so each slot logs one
"Scoped object of type 'character' is not valid" per load. Harmless - the slots work before and after -
but it is the Director's own error, and `GetPlayer.IsValid` is the guard vanilla uses 47 times.

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
