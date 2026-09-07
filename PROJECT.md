# The Historical Director — Project Document

**A human-in-the-loop LLM framework for historically-grounded gameplay in Crusader Kings III.**

Basil Abdullah Alzahrani — Department of Artificial Intelligence, Al-Baha University
Independent Game-AI Research & Mod Development

Status: **v0.4.3 alpha**, working end to end against a live game.
(The companion mod is still 0.4.2: it has not changed since, and the two are versioned separately.)
Companion implementation to the paper *The Historical Director: A Human-in-the-Loop LLM Framework
for Historically-Grounded Gameplay in Crusader Kings III*.

---

## 1. What this is

Crusader Kings III simulates centuries of dynastic politics, and its AI plays them competently. What
it does not do is play them *historically*. Within a few decades a campaign drifts into
configurations that contradict the medieval record — empires that never existed, dynasties dominating
regions they never touched, polities standing at ranks they never held — and the game offers no
setting to counteract it.

The Historical Director treats historical fidelity as an **external service**. A companion mod
reports the live game state; an orchestrator retrieves what the historical record says about the same
place and date; a language model compares the two and proposes corrections drawn from a fixed
toolkit; and the player approves or declines every single one.

The AI directs. The player decides.

That constraint is not a safety afterthought — it is what makes the rest of the design work. The
hallucination problem gets a human arbiter. The latency problem gets a player who has consented to
wait. And the model is never trusted with anything it could get catastrophically wrong unsupervised.

---

## 2. The problem, stated precisely

The vanilla AI optimises for mechanical functionality, not historical plausibility. It does not know
that the Aghlabids should be carving up Sicily in 867, that the Abbasids should be pressing Anatolia
while the Bulgars threaten the Balkans behind them, or that the taifas of 1066 should remain
duchy-tier polities under northern and Almoravid pressure.

Three things follow:

1. **Late-game decay.** Year 300 of a campaign is far less coherent than year 1.
2. **Lost pedagogy.** A player learns nothing about why medieval borders looked as they did.
3. **No lever.** There is no "historical AI" option, and no mod can add one without an outside brain.

---

## 3. Design principles

**Grounded realism.** The framework generates political, dynastic and military drama — betrayals,
pleas for aid, tribute disputes, plausible what-if divergences. It is a historical simulator, not a
fantasy conversion. Every proposal must be realpolitik-plausible for the period.

**The map, not the cast.** What matters is the shape of the political geography: does a polity of
roughly this extent belong here at this date, and is it at the right rank? An empire sitting where
the record has fragmented duchies is a real divergence worth correcting. The same realm under a ruler
of the wrong name is not — names drift harmlessly, and a plausible dynasty in the right place at the
right tier is historically faithful even when the individual is invented.

**Bounded attention.** An ahistorical kingdom in Siberia is not the Byzantine player's problem. The
Director only looks at a sphere of influence around the player.

**Evidence or silence.** Where retrieval returns nothing, the Director is told it is working without
structured backing and instructed to say so in the proposal, rather than filling the gap with
confident invention.

**Refusal over invention.** A player outside supported coverage is told so plainly. Zero proposals is
a good answer when the world is on track.

---

## 4. Architecture

```
        ┌──────────────────────────────┐
        │  Knowledge Layer             │
        │  Wikipedia (narrative)       │
        │  Wikidata  (checkable dates) │
        └──────────────┬───────────────┘
                       │ retrieved evidence
                       ▼
   ┌───────────┐   ┌────────────────┐   ┌──────────────┐
   │   CK3     │   │  Orchestrator  │   │     LLM      │
   │ + mod     │◄─►│  (Node, local) │◄─►│  Director    │
   └───────────┘   └────────┬───────┘   └──────────────┘
     debug.log  ▲           │  proposals
     run/hd.txt │           ▼
                │   ┌────────────────┐
                └───┤  The player    │
                    │ Approve/Decline│
                    └────────────────┘
```

**Companion mod** — perception and execution. Reports filtered world state; executes approved script.

**Orchestrator** — a dependency-free Node process on localhost. Tails the game log, computes the
sphere, drives retrieval, calls the model, validates every proposal, serves the sidebar, stages
approved effects, and keeps the ledger.

**LLM Director** — compares observed state against retrieved evidence, identifies divergences, and
emits structured proposals plus an encyclopedic explanation. Any OpenAI-compatible endpoint; a local
model via Ollama works unchanged, which matters for the cost argument over a long campaign.

**Knowledge layer** — Wikipedia for narrative context and the sidebar's prose; Wikidata for
machine-readable facts that can actually be checked against a date.

---

## 5. The bridge

This is the technically novel part, and it is entirely dictated by what CK3 exposes. There is no
state-export API. Three mechanisms exist, and all three are used.

### Perception — `debug_log`

The mod writes delimited records into `logs/debug.log`:

```
HD:/;/realm/;/1002/;/Alfonso VI/;/Kingdom of Leon/;/Kingdom/;/14/;/Castilian/;/Catholic/;/…
```

Everything is prefixed `HD:` so it stays disjoint from Voices of the Court's `VOTC:` traffic and both
mods can be installed together. The orchestrator tails the file, surviving the truncation CK3
performs on each launch.

### Execution — a self-recreating widget

The orchestrator stages CK3 script into `run/hd.txt`. A 1×1 GUI widget recreates itself every two
seconds and calls `[ExecuteConsoleCommand('run hd.txt')]`.

The indirection is forced: `run` is a console command, and `ExecuteConsoleCommand` is a GUI function.
A self-recreating widget is therefore the only way a mod can execute script that an external program
decided on. This is also why the game must be launched with `-debug_mode` — the same requirement VOTC
carries.

### Idempotence — token guards

The pump cannot know whether it has already run what it finds. Every batch is wrapped in a guard that
compares a global variable against the batch token and does nothing if they match, so a batch
executes exactly once however many times it is picked up.

### Liveness — the pump reports for duty

GUI widgets do not survive loading a save. Every staged batch therefore ends with a liveness mark
(deliberately *outside* the token guard, so it refreshes on every pass rather than once per batch). A
yearly watchdog in the mod checks whether that mark has been set since it last looked, and rebuilds
the pump if not. The orchestrator separately notices its own requests going unanswered and tells the
player, naming both the recall decision and the console command.

---

## 6. The constrained toolkit

The model never writes CK3 script. It names an action and fills in parameters; the orchestrator turns
that into literal, guarded script.

| Action | Effect |
|---|---|
| `adjust_title_tier` | Destroy a ruler's primary title, dropping the realm exactly one rank. Names its target tier; releases the vassals below an empire or kingdom |
| `grant_claim` | Give one ruler a pressed claim on another's primary title |
| `set_relations` | Enforce an attested political attitude between two rulers |
| `spawn_character` | Place a figure in an existing ruler's court. Optionally born into a named ruler's dynastic house, and optionally carrying a pressed claim on a named ruler's primary title, which the host may press in a claimant war or leave alone |
| `trigger_event` | Put a historically-patterned choice in front of a ruler: intervene across water, an invited crossing, a plea for protection. Grants a claim only if they accept |
| `iberian_pressure` | **Macro event.** Sets the Reconquista-era pressure toward consolidation running around one ruler and up to four partners: truces, and at higher intensity alliances, hooks and a union decision. Transfers no title and starts no war |

### Why this is safe

**Vocabulary comes from observed state.** Actions address characters through tags the mod assigns
during the snapshot — never by name, never by id, never by title key. The model cannot name a title
that does not exist because it does not name titles at all. It can only point at rulers the game has
already reported.

**Validation is layered.** Every proposal is re-checked against the JSON schema and against the live
snapshot before it is even displayed. Unknown actions, unknown characters, out-of-range values and
unexpected parameters are rejected. Strings are stripped of every character CK3 script treats
structurally, so nothing the model emits can escape into the run file as script.

**Rank is script-derived, never localised text.** Tier travels as one of five fixed keys taken from
`primary_title.tier`, not the printed rank name, which is localised and can be renamed outright by a
total conversion. A guard on a localised string stops guarding the moment someone plays in another
language. Where the key is missing the action is refused, never permitted on the printed name.

**The baseline measures three axes, and only one of them gates anything.** Rank is the axis that
`adjust_title_tier` turns on. The other two are evidence: a realm still holding its title on a
fraction of its land reports `= Kingdom, down 10 of 15 counties` in the same column, and realms the
baseline recorded that are absent from the world now are listed in a prompt section of their own -
which they have to be, because a table of what exists has no row for what does not. A live campaign
was reported "on track" thirty-seven times while Iberia came apart around a Leon whose rank had not
moved, and the footprint that would have caught it was already being captured and never read.

Because county counts are taken inside the sphere, the sphere is stored with the baseline and both
derived signals are reported only when the captured sphere is a subset of the current one: widening
can only add counties and reveal realms, so under a wider window a loss is certainly real and an
absence is certainly real. A narrowed window suppresses both, and a baseline older than the sphere
record marks them rather than asserting them. Gains are never reported at all, since a wider window
can manufacture a gain but cannot hide a loss.

**Rank changes are measured against the campaign's own opening map.** A baseline captured from the
first snapshot tells drift apart from the bookmark as shipped, so a realm that has stood at its
historical rank since 1066 is not mistaken for one that climbed there. `adjust_title_tier` is
**refused unless that realm has risen since capture** — the check runs in `validate`, alongside the
schema and snapshot checks, not as advice in the prompt. A realm the baseline never saw, or a
campaign with no baseline yet, is refused too. The delta is a gate rather than a trigger: a rise
establishes that there is something for the evidence to justify, nothing more.

**A macro event proposes a process, not an outcome.** `iberian_pressure` reaches several realms at
once, which is a larger claim on the campaign than any other action makes, so it is bounded twice
over. The intensity is checked against a band computed from the live balance of the peninsula rather
than chosen freely, and every named realm must belong to it. What the event then grants is capacity
and leverage - truces, alliances, hooks, a decision - and never an outcome: no title changes hands,
no war begins, and every recipient can decline what it offers.

**How a macro event reaches the game at all.** A CK3 event takes no parameters, so there is no way
to call one with arguments. Everything a macro event needs is therefore staged *before* it fires: the
unifier and each partner are resolved into numbered saved scopes (`scope:hd_unifier`,
`scope:hd_partner_1` through `hd_partner_4`), and the intensity travels as a global variable the
event branches on. `hd_event.0200` reads both and holds every effect itself. The orchestrator side
composes no effect text at all — `macroEvents.js` picks an intensity out of a fixed table by key, and
a key that is not in the table yields no script rather than a malformed line. That is the same
lookup-not-interpolation property `momentum.js` relies on, and it is what keeps a multi-realm action
inside the same safety argument as a two-character one.

**The narrative on a card cannot become a mechanic.** Each proposal carries three to five sentences
of in-world prose, written from the retrieved lore and the live state together. It reaches the
sidebar and the Lore Book and nothing else. `toScript` is built from the action and its declared
parameters alone, and prose offered as a parameter is refused by the same unexpected-parameter check
that catches any other invention - so the card can argue for a change but has no path to altering one.

**Failures are reported, not repaired.** A proposal that fails validation is dropped and logged.
Silently fixing up a malformed proposal would mean executing something the model did not ask for.

**Proposing and executing are different functions.** `preview` renders the argument for the player;
`toScript` is only ever reached after approval. The preview names the observed rank, the target rank
and what will be released, because a gate that understates what it is about to do fails the same way
as one that misreports what it did.

**The game gets the last word.** Each action carries both an applied and a refused branch, so when a
precondition is false the sidebar says nothing changed rather than reporting success.

---

## 7. Sphere of influence

Feeding the model the whole world is unaffordable and wrong. The sphere is seeded from where the
player actually is and grown outward through an adjacency graph. The model may narrow it but never
widen it: a bounded attention window that the model could expand would not be bounded.

**The seed is the realm, not the capital.** It was the capital until v0.3, and for a compact duchy the
two are the same thing. For an empire spanning Iberia, the Maghreb and Sicily they are not: the
capital sits in one region, so the Director watched Iberia and whatever adjoined it while the player's
own Sicilian and Maghrebi provinces lay outside the window. The mod now asks two questions in the same
batch — `capital_county` for where the player *is*, `any_realm_county` for where they *rule* — and both
seed the sphere.

**Reach and ceiling are the player's.** Growth was hardcoded to one step and six regions. Both are now
settings, because how wide the window should be is a judgement about the campaign and about what the
player wants to spend per audit, not a constant. Reach 0 watches only ground you hold; 8 is the
graph's diameter and puts the whole supported map in view from anywhere. The ceiling is the real limit
on cost, since every region is another county sweep in game and more realms in the prompt.

| Player | Sphere at reach 1 |
|---|---|
| Constantinople, 867 | The Balkans → Eastern Europe, Italy and Sicily, Anatolia |
| Toledo, 1066 | Iberia → Francia, the Maghreb |
| Cairo, 1066 | Egypt and Libya → the Maghreb, the Levant, Arabia, Italy and Sicily, the Sahara, Nubia |
| Córdoba, 1218, ruling to Sicily | Iberia, the Maghreb, Italy → Francia, Egypt, the Sahara, Germania, the Balkans |
| The Kazakh steppe | *refused — Phase II coverage, no grounded basis to act* |

**Phase I** (supported): 25 regions from Ireland to Bengal — Europe, the Mediterranean, the Near East,
North and West Africa, the Horn, and the Indian subcontinent. India, West Africa, the Sahara and
Nubia joined in v0.3 for the reason Khorasan and Transoxiana did before them: the Ghurids, the Cholas,
Kanem and the Zagwe are as well attested and as well indexed as anything already in the catalogue, so
their absence was an oversight rather than a considered deferral.

**Phase II** (declared, deliberately not offered): the steppe, Tibet, East Asia. Steppe succession and
the Chinese dynastic cycle are intricate and comparatively sparse in machine-readable form; they need
curated structured data before the Director can say anything grounded about them. That was always the
real reason, and it never applied to India.

### The partition rule

Phase I regions must not contain one another, and until v0.3 two of them did: `world_europe_south` is
exactly Italy plus the Balkans, and `world_middle_east` contains the whole of Persia, Khorasan,
Transoxiana and Mesopotamia. All of those were Phase I together. The snapshot counts the counties each
realm holds in each swept region, so a player in Rayy — a case the notes record as tested — got a
sphere holding both `world_middle_east` and `world_persia`, and every Persian county was counted
twice. `countiesInSphere` orders the prompt table and seeds the baseline, so the error propagated into
what the model was shown and into what drift was later measured against.

The catalogue is now a verified partition, checked against the game files by
`scripts/check-regions.mjs`. That fixes vanilla. The sweep additionally marks each county as it counts
it and counts only unmarked ones, which fixes everyone else: a total conversion may redefine these
regions however it likes, and a catalogue checked against the base game proves nothing about the mod
list the player is actually running.

---

## 8. Governance and the Lore Book

When the Director has something to propose, the game pauses and an encyclopedic sidebar presents:

- **The divergence** — what the game shows versus what the record says
- **Historical context** — neutral, encyclopedia-style prose
- **If approved** — what changes in the campaign
- **The change itself** — the exact effect in plain language
- **Sources** — every retrieved document, with links
- **Approve / Decline**

Every verdict is written to the **Lore Book**, a persistent ledger re-injected into later audits. This
is the answer to context amnesia across a three-century campaign: what carries forward is not the
world, which is far too large, but the decision record.

Declines are kept as carefully as approvals. A Director that only remembered what was accepted would
re-propose the same rejected correction every year, and the player would stop reading.

**At most one demotion is offered per audit.** `adjust_title_tier` is the bluntest verb in the
toolkit and the one that reads as most decisive, and two dissolutions approved in a single sitting
can take a region apart faster than any historical process did. So the Director accepts one per
audit and rejects the rest with a stated reason. This is deliberately cruder than better judgement,
and deliberately not a line in the prompt: a prompt rule depends on the model having judgement on the
audit where it matters, and a counter does not. It also changes what an audit costs the model —
spending its one demotion is now a choice about what it is *not* proposing.

---

## 9. Knowledge layer

**Wikipedia** supplies narrative context and the sidebar's prose. Queries carry the century rather
than a bare year, and results whose leads are entirely post-medieval are discarded — a 1066 audit of
North Africa was otherwise reading *Insurgency in the Maghreb (2002–present)*.

**Wikidata** supplies what can actually be checked: reign intervals and dynasty spans. Realm names
are CK3's own constructions — "Zirid Grand Emirate" is not a name any encyclopedia carries — so
lookups fall back to the **dynasty**, which resolves readily and is already in the snapshot.

Both are sequential, capped, paced and cached. Both endpoints throttle anonymous traffic by returning
*empty results rather than errors*, which is indistinguishable from "no such record" unless you are
careful.

The paper's design calls for chunked local dumps in a vector store. That remains the right
destination; the live APIs are the near path to the same place, and when the store lands only these
two modules change.

---

## 10. What works today

Verified end to end against a live, heavily-modded 1066 campaign:

```
heartbeat → audit due → locate player → sphere → snapshot (62 realms)
→ Wikipedia + Wikidata → DeepSeek → proposal → Approve → the map changes
```

Two real corrections landed in that session. The Director identified that the **Zirids** were sitting
at empire tier when in 1066 they were emirs under nominal Fatimid suzerainty, demoted them, and
granted them a claim on Cyrenaica. Both applied to the running game.

It also declined to act when the world was on track, and refused to invent a sphere for a player in
Khwarezm before that region was supported.

---

## 11. Engineering log

Eight engine behaviours stood between a plausible design and a working one. They are documented here
because they are properties of CK3 rather than of this project, and anyone building a similar bridge
will meet them. Two further lessons follow, kept separate because they are about system design and
would be true of this project in any engine.

**1. `on_action` effect blocks do not merge.** An `on_action` may carry only one `effect` block across
the entire load order. Writing `effect = { }` directly onto a vanilla hook does not append to it — it
fights every other mod for it, and one side silently loses. The engine documents the fix: hang a
privately-named on_action off the mergeable `on_actions = { }` list.

**2. `on_game_start_after_lobby` does not fire on save loads.** It fires when the player leaves the
lobby, and loading a save from the main menu never passes through it.

**3. A gated recreation state kills a self-recreating widget.** Gating recreation does not pause a
pump; it lets the widget expire with no successor. The pump died permanently on the first VOTC
conversation of a session.

**4. `capital_county` needs a character scope, and `?=` hides its absence.** Run-file script executes
at a scope where the check silently answers "no". A campaign sitting in the middle of Persia reported
itself as being nowhere at all.

**5. CK3 mangles `$PARAM$` inside quoted `debug_log` strings.** `"HD:/;/in_region/;/$REGION$"` came
back as `HD:/;/in_region/;world_persia$` — one separator eaten, a stray dollar appended. Parameters
used as script *values* substitute correctly; only interpolation into a string literal breaks. Every
record carrying a parameter was unparseable.

**6. Logging only on success makes failure invisible.** A failed precondition was indistinguishable
from an effect that never ran: no error, no record, no change — and an orchestrator that announced
success because the batch had executed. **An approval gate that lies about what it did with the
approval defeats the entire design.**

**7. The model cannot know title keys.** It sees "Arabian Empire" and never sees `e_arabia`, so it
reconstructs keys from localised names. Vanilla keys it half-remembers come out right often enough to
look like it works; modded ones never do; and a key that exists but is unheld fails just as quietly.

**8. `character:<id>` does not resolve for runtime-generated characters.** CK3 resolves it only for
characters defined in history files. The game reports a ruler's id as 34497 and
`exists = character:34497` is false. This is why VOTC addresses characters through saved scopes, and
why this project now addresses them through snapshot-assigned tags.

**9. `create_character` silently ignores keys it does not recognise.** The spawn action wrote
`sex = male`. CK3's key is `gender`; `sex` is not a `create_character` field at all, so the line was
dropped without a script-log entry and every figure the Director created took the engine's own
default chance instead. A card proposing a male claimant could produce a woman, and nothing anywhere
said so. This is behaviour 6 one layer up: the batch reported `applied`, because the batch *had*
applied — it simply had not applied what the card described.

### Two lessons that are not about CK3

**An action whose intent lives only in prose is not constrained.** `adjust_title_tier` took a
single parameter — who to demote — and nothing else. The rank it was aiming at existed only in the
model's free-text explanation, where nothing validated it, while the effect was decided separately by
the script. The two were never connected, so the Director proposed reducing a duke "to duke tier" and
the validator had no basis to object. Anything the model asserts that the system will act on has to
be a parameter, checked against observed state; if it is only in the prose, it is decoration.

A related trap sat beside it: the model was being asked to judge rank with no reference for what the
map looked like when the campaign began, so the 1066 start screen — France a kingdom, the Holy Roman
Empire an empire — read as drift to be corrected. Sources describing Capetian royal authority as
barely reaching past the Île-de-France pushed it further, because de jure rank and de facto power are
separate axes and prose about weakness speaks only to the second.

**An instruction is not a guard.** The fix for that trap was a baseline column in the prompt table
plus a rule telling the model to propose a demotion only where the column showed a rise. It worked:
proposals stopped arriving. But `validate` never saw the baseline, so demoting the Holy Roman Empire
from its starting rank still passed every mechanical check, and the only thing refusing it was a
sentence the model was free to disregard. A rule that holds because the model is currently obeying it
is a rule that holds until the prompt is edited, the model is swapped, or the temperature is raised —
and this project offers all three from a settings panel. Where a constraint matters, the instruction
is a cost optimisation that stops bad proposals before they are generated, and the check in code is
what makes them impossible. Write both, and be honest about which one is load-bearing.

Each of these presented as the previous one's fault. The general lesson is that a silent failure in a
bridge like this is far more expensive than a loud one, and that the debugging investment belongs in
making the system say what it did, what it is about to do, and — when it refuses — why.

---

## 12. Limitations

- **`-debug_mode` is required**, so achievements are disabled and this can never ship as a plain
  Workshop mod. VOTC lives with the same constraint.
- **The pump does not survive a save load.** The watchdog rebuilds it within an in-game year; the
  recall decision is instant.
- **Realm footprint is counted within the sphere**, not globally, so a realm straddling the edge reads
  smaller than it is.
- **Wikidata coverage is uneven**, especially against total conversions.
- **Retrieval is best-effort.** A tangential article still gets through sometimes, which is exactly
  why every source is shown with its link.
- **The sphere bounds the toolkit as well as the attention.** The Director cannot act on a ruler it
  cannot see. This is the correct trade, but it is a real constraint — and since v0.3 it is one the
  player can trade away deliberately, by raising the reach and paying for it.
- **A wide sphere is not free.** Every region added is a county sweep in game and more realms in the
  prompt. The prompt table is capped, and with a wide sphere that cap starts to bite: the fix is to
  lead with realms holding land in the player's own regions and continue by size, so what falls off
  the end is distant rather than adjacent. It still falls off.
- **The bookmark tables are three dates and a short roster.** They can only permit a demotion the
  baseline could not reach, never widen one it already guards, and absence from them yields nothing.
  But a campaign at 1300 is measured against 1178, and they say nothing at all about the steppe.
- **Realm geography is reported; per-county detail is not.** The sweep says which regions each realm
  holds land in, which is what a regional action needs. It still does not report individual counties,
  so county-level work waits on the richer perception in section 13.
- **The toolkit is bounded by perception, not by ambition.** The snapshot reports top-liege rulers,
  addressed by tag. It does not report counties, and it does not report titles as objects. So
  county-level work — faith or culture conversion, granting a specific county — cannot be added to
  the toolkit before the richer perception in §13, however straightforward the CK3 effect would be.
- **Approved actions have second-order effects through other mods, and this is measurable.** After a
  demotion of the Zirids in a live campaign, a `RICE_sicily_intervention_cb` war appeared against
  Robert Guiscard. The Director cannot create casus belli and the Lore Book confirms it did not: that
  CB is declared `allowed_for_character = { always = no }`, so it is unreachable except through
  RICE's own character interaction. But that interaction carries
  `ai_frequency_by_tier = { county = 80  duchy = 80  kingdom = 60  empire = 40 }`, so the AI's
  propensity to use it rises as rank falls. Demoting a realm from empire to kingdom raises its rate
  by half; to duchy, it doubles. Authorship no, consequence yes — and the mechanism is a numeric
  weight in another mod's file, not a trigger the demotion newly satisfied. Any mod keying behaviour
  off tier will shift when the Director changes one.
- **The narrative events have not been observed firing.** `hd_event.0100`-`0102` are written against
  vanilla and RICE syntax rather than invented, and each logs when it fires so a blocked one is
  distinguishable from a working one, but nobody has watched one reach a ruler.
- **`set_relations` has not yet been confirmed in-game.** `spawn_character` has now been watched
  landing a courtier in a live 1257 campaign, which leaves `set_relations` as the one action nobody
  has seen take effect. `scripts/verify-toolkit.mjs` stages it directly so this can be closed; it
  needs someone with a live campaign to run it.
- **The endowed spawn is composed but unwatched.** `dynasty_house = scope:<x>.house` and
  `add_pressed_claim` inside `after_creation` are both vanilla usage, and the guards refuse the whole
  batch rather than degrade when either scope is missing — but nobody has yet opened a court and seen
  a claimant standing in it with the claim attached. Until someone does, the strongest thing that can
  be said is that the script is well-formed.
- **`adjust_title_tier` moves one rank at a time.** `destroy_title` drops a ruler onto whatever they
  hold underneath and cannot be aimed further, so a two-rank correction takes two audits. Allowing a
  single multi-step proposal would let the stated intent and the actual effect disagree.
- **The baseline is keyed on primary title.** Character ids change at every succession, so titles are
  the only stable handle. A title renamed by the player will not match, and yields no baseline —
  which suppresses rank proposals against that realm rather than licensing them.
- **A baseline captured mid-campaign measures drift from that point**, not from the bookmark. Drift
  that had already happened before the Director was first run is invisible to it.

---

## 13. Roadmap

**Near term**
- Sidebar should detect a dropped connection instead of showing stale state
- Confirm the startup event fires unassisted
- Run `scripts/verify-toolkit.mjs` against a live campaign to confirm `set_relations`, and to
  watch an endowed `spawn_character` put a claimant in a court — the harness exists, the observation
  does not

**Medium term**
- Local Wikipedia dumps with a vector store, replacing the live API path
- Event-driven auditing — react to wars, deaths and successions rather than a fixed interval
- Richer perception: de jure structure and borders as first-class data (title tier now is)

**Longer term**
- Phase II coverage with curated structured data for the steppe and East Asia
- Generalisation to other Paradox titles; the architecture is not CK3-specific
- Bookmark tables beyond three dates, so a campaign at 1300 is measured against something nearer than
  1178

**Done in v0.3**
- ~~Packaging for people who are not comfortable with a console command~~ — `npm run build:exe`
  produces one 68 MB file using Node's own single-executable support, so the zero-dependency claim
  survives: `scripts/bundle.mjs` folds `src/` into one CommonJS file rather than reaching for a
  bundler, and the only build-time tool fetched from npm is `postject`, which does the injection Node
  does not provide. The executable carries the sidebar and the companion mod as embedded assets and
  deploys the mod itself on first run.

---

## 14. Layout

```
mod/                        the CK3 companion mod
  common/scripted_effects/    param-free primitives
  common/on_action/           bootstrap + pump watchdog
  common/decisions/           the recall decision, the Iberian union decision
  common/modifiers/           momentum and Iberian-pressure modifiers
  common/opinion_modifiers/   the opinion set_relations applies
  gui/custom_gui/             the execution pump
  events/                     bootstrap, notification, narrative events, hd_event.0200
  localization/english/       every key the mod's script references

src/
  bridge/                     protocol, log tailer, run-file handshake, script composer
  model/WorldState.js         a stream of records becomes a snapshot
  model/Baseline.js           the map as the campaign began
  model/AuditClock.js         the cadence, persisted across restarts
  director/regions.js         the region catalogue and its adjacency graph
  director/sphere.js          what the Director is allowed to see
  director/toolkit.js         the actions, their validation and their script
  director/macroEvents.js     the Macro Event Library: intensity band, staged scopes
  director/momentum.js        the pre-authored amplifications of grant_claim
  director/bookmarkTiers.js   what the record says, at 867 / 1066 / 1178
  director/Director.js        the audit loop, the prompt, the destructive cap
  knowledge/                  Wikipedia + Wikidata retrieval
  lore/LoreBook.js            the ledger
  llm/client.js               OpenAI-compatible client, no SDK
  setup/                      mod deployment and preflight
  runtime.js                  source checkout, executable, or test harness
  renderer/                   the sidebar

scripts/
  deploy-mod.mjs              copy the mod into CK3 and write its descriptor
  doctor.mjs                  preflight; names the environmental failure
  simulate-game.mjs           a fake CK3, for testing without launching the game
  stub-llm.mjs                a fake model, including deliberately malformed output
  make-probe.mjs              validate perception against a running campaign
  smoke.mjs                   the whole loop against a fake game and a fake model
  check-tier-fixes.mjs        the toolkit, baseline-gate, macro-event and locality cases
  check-regions.mjs           the region catalogue's invariants
  check-localization.mjs      every key the mod references is defined
  verify-toolkit.mjs          stage one action into a live game, bypassing approval
```

Zero runtime dependencies. Node 20+. Runs with `npm start`.

---

## 15. Credits

Design and research: Basil Abdullah Alzahrani, Al-Baha University.
Implementation built collaboratively with Claude (Anthropic).

The bridge technique — `debug_log` for perception, a self-recreating widget running console commands
for execution — was learned by reading **Voices of the Court** (Durond, and the 2.0 reimplementation
by MrAndroPC), which solved the same problem first for conversational play. This project is
independent of it and the two can run side by side.

Licence: **MIT**. See [LICENSE](LICENSE).
