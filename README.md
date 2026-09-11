# The Historical Director

A human-in-the-loop LLM framework for historically-grounded gameplay in **Crusader Kings III**.

It watches your live campaign, compares the map against the historical record, and proposes
corrections — and since v0.8 it can start the wars the record names. In a live 1219 campaign it began
**The Conquest of Majorca** under that name, and then **The Albigensian Crusade**, France against the
overlord of Toulouse. Nothing reaches the game until you press Approve.

> Companion to the paper *The Historical Director: A Human-in-the-Loop LLM Framework for
> Historically-Grounded Gameplay in Crusader Kings III* (Basil Abdullah Alzahrani, Al-Baha University).

---

## Alpha software — read this before you run it

**This is an experimental alpha that stages script into a running game.** It has been exercised
across a handful of campaigns on one machine, not a hundred. Treat it accordingly, and please report
what you find: [issues](https://github.com/kaiseer1/historical-director-project/issues).

- **Back up your saves first.** Approved actions change the world permanently and the game has no
  undo for them. `adjust_title_tier` destroys a ruler's primary title and releases the vassals under
  it; `historical_war` starts a real war. Copy your CK3 `save games` folder somewhere safe, and prefer
  a throwaway campaign for your first session.
- **CK3 must be launched with `-debug_mode`.** The bridge is built on the `debug_log` effect and the
  console `run` command, and neither exists without that flag. Without it nothing happens at all — no
  error, no snapshot, no proposals. `-debug_mode` also **disables achievements** for that session; that
  is a CK3 restriction and cannot be worked around.
- **Nothing reaches the game until you press Approve.** That is the design, and it is also a limit: the
  Director cannot act while you are not looking, and it cannot undo a mistake you approved.
- **It costs a little money per audit** — one model call and a handful of web requests, a fraction of
  a cent on DeepSeek. Point it at a local Ollama model for zero cost.
- **It will sometimes be wrong.** During testing it once invented a conquest of Granada that never
  happened. That is exactly why every proposal carries its argument and waits for you.

The [known issues](#known-issues) section lists everything we know is rough.

---

## What it is

CK3's AI advances the world competently but without historical direction. Within decades a campaign
drifts into configurations that contradict the medieval record, and the game offers no setting to
counteract it. The Historical Director treats historical fidelity as an external service: it watches
the live game, compares what it sees against retrieved historical evidence, and proposes corrections
drawn from a fixed toolkit — which run only if you approve them.

**The AI directs. You decide.** That single constraint is what makes the rest of it safe: the
hallucination problem has a human arbiter, and the latency problem has a player who consented to wait.

## Status: v0.10.0 — a testing alpha

### Watched working in a live game

Seen happening in a real campaign, not inferred from a test script.

| | Evidence |
|---|---|
| Perception | Up to 71 realms read out of a live campaign; 62 out of a 1066 one |
| Player location and sphere | Rayy, Cairo, Kath, Tunis and Granada located correctly; the sphere seeded from each and grown outward |
| Proposal → approval → effect | A Zirid demotion from empire tier, pressed claims, a spawned character and a historical moment, all applied |
| Refusal reporting | Approved actions the game declined were reported as refused, not as success |
| Guards | Start-rank demotions refused with the reason named; a repeat of an already-approved claim refused; empire-tier claims and moments refused |
| **Historical wars** | *The Conquest of Majorca* and *The Albigensian Crusade* started live under their own names, with their flavour events and no errors |
| Title lookups | Correctly read that Castile already held Córdoba and Seville in 1219, so those wars are reported as already fought |
| Log keeping | Dozens of in-game log clears in a session, with the execution pump surviving every one |
| Pump recovery | The *Recall the Historical Director* decision rebuilds the execution pump on a loaded save |

### Built and tested, but not yet watched in a game

These pass the automated checks and an end-to-end run against a simulated game, but nobody has seen
them happen in CK3 yet.

- `almohad_collapse` — in particular, whether its independence factions actually form
- `set_relations`, and a spawned character's house and claim
- The narrative events `hd_event.0100`–`0102`
- Whether momentum's modifiers visibly change how the AI behaves
- Cards that cite lost ground or a vanished realm
- The quarterly watchdog rebuilding the pump on its own

### What it can do

| | |
|---|---|
| Perception | Regional world-state snapshots: rulers, titles, tiers, footprint, culture, faith, government, wars, and the holders of the titles the historical wars are fought over |
| Sphere of influence | Seeded from where the player rules — capital *and* realm footprint — then grown as far outward as you set it |
| Knowledge layer | Wikipedia lead extracts, era-filtered, plus Wikidata reign intervals and dynasty spans |
| Toolkit | `spawn_character` (optionally born into a named house and carrying a pressed claim), `set_relations`, `grant_claim`, `adjust_title_tier`, `trigger_event`, `iberian_pressure`, `almohad_collapse`, `historical_moment`, `historical_war` |
| **Historical wars** | `historical_war` — the one action that starts a war. A curated war the record names, near its date, under its own casus belli and historical name: *The Conquest of Majorca* (1229), *The Conquest of Córdoba* (1236), *The Conquest of Seville* (1248) and *The Albigensian Crusade* (1226). CK3 fights it; five-year modifiers tilt it toward the record's outcome without deciding it; a pressed claim is its justification and its fallback. Refused outside its window, when the land is already the attacker's, or when the attacker is not free to declare |
| Historical moments | Curated turning points — the Iberian crowns drawing together, the Almohads coming apart — each with its own event, claim, means and date window |
| Macro events | `iberian_pressure` sets a regional process running across a unifier and up to four partners; `almohad_collapse` takes a power apart from the inside, with vassals raising independence factions. Both are bounded by the live map, so a world that will not support them refuses them |
| Momentum | `grant_claim` can also supply the means to press a claim — money, prestige or piety, and a timed appetite for war — from three pre-authored patterns. It never starts the war |
| Caps | At most one `adjust_title_tier` per audit. No claim on an empire-tier title: a claim on an emperor is a claim on the whole empire |
| Narrative cards | Every proposal carries in-world prose written from the lore and the live campaign together. The prose can argue for a change but can never alter one |
| Governance | Encyclopedic sidebar, auto-pause, Approve / Decline, every verdict logged in the Lore Book and fed back into later audits |
| Settings | Audit cadence, sphere reach and ceiling, and the model — changed from the sidebar, no restart |
| Coverage | 25 regions, Ireland to Bengal — Europe, the Mediterranean, Africa, the Near East, India |
| Packaging | A single `.exe` that needs no Node and deploys the companion mod itself |

Not yet built: per-proposal retrieval (see known issues), local Wikipedia dumps with a vector store,
the steppe and East Asia, and event-driven auditing.

---

## Requirements

- **Crusader Kings III**, launched with **`-debug_mode`** (Steam: right-click the game → Properties →
  Launch Options → add `-debug_mode`). Voices of the Court needs the same flag, so if you run VOTC you
  are already set up.
- **An LLM endpoint** — any OpenAI-compatible provider (DeepSeek is the default), or a local model via
  Ollama.
- **Node 20+**, only if you run from source. The `.exe` has Node inside it.

Tested on CK3 1.19.0.5 (Windows).

## Getting started — the executable

Download `HistoricalDirector.exe` from the
[latest release](https://github.com/kaiseer1/historical-director-project/releases/latest), or build it
yourself from a clone with `npm run build:exe`.

Double-click it. On first run it writes a `config.json` beside itself, copies the companion mod into
your CK3 user folder, checks its own environment, and opens the sidebar. It is **unsigned**, so Windows
SmartScreen will warn: "More info", then "Run anyway". It is about 70 MB, nearly all of which is Node.

Two things it cannot do for you:

1. **Enable Historical Director** in the CK3 launcher's playset.
2. **Give itself an API key.** Set it in the environment, or paste one into the sidebar's Settings tab
   (a pasted key is kept for that session only and never written to disk):

   ```bash
   setx HD_API_KEY "sk-..."
   ```

`--no-browser` starts it without opening the sidebar. `--selftest` prints what is embedded and exits.

## Getting started — from source

```bash
git clone https://github.com/kaiseer1/historical-director-project.git
cd historical-director-project
node scripts/deploy-mod.mjs
```

Copy `config.example.json` to `config.json`, and set `ck3UserFolder` if your CK3 user folder is not in
the default place. Put your API key in the environment, as above. Enable **Historical Director** in the
CK3 launcher playset, then check everything is wired up:

```bash
npm run doctor
```

## Every session

1. **Start the orchestrator** — double-click the `.exe`, or `npm start`. Leave it running. The sidebar
   is at **http://127.0.0.1:7842**.
2. **Start CK3 with `-debug_mode`** and load your save.
3. **Start the execution pump.** On a new game this happens by itself: a one-off event says the
   Director is watching. **On a loaded save it does not** — take the decision *Recall the Historical
   Director*, or type this in the console (the backtick key):

   ```
   gui.createwidget gui/custom_gui/hd_runner.gui hd_runner
   ```

Then unpause and play. Within a few seconds the orchestrator should report:

```
the game is talking to us
the execution pump is running
the running game reports companion mod v0.10.0
player located: Taifa of Ghirnatah at Ghirnatah. Seeded from Iberia, extended 2 steps to …
snapshot received: 71 realms in 3 Mar 1219; 6 wars under way: …
auditing 1219 across …
the Director has 1 proposal(s) for your judgement
```

Read the proposal in the sidebar, then **Approve** or **Decline**. An approved action is confirmed by
the game (`the game confirmed … took effect`, or for a war `the game confirmed the war has begun`). If
it says **`the game REFUSED …`**, the change did not happen because its precondition was false in your
campaign — that message is the system being honest, not broken.

An audit that finds nothing to propose is normal. It says so: `the Director finds this world on track`.

## The sidebar

| Tab | What it shows |
|---|---|
| **Proposals** | Awaiting your judgement: the divergence, historical context, consequences, the exact change, sources, and Approve / Decline. Also **Audit now**. |
| **World** | Where you are, the sphere, how many realms were seen, the model, the cadence. **Warnings appear here.** |
| **Lore Book** | Every verdict you have given. Declines are kept so the Director stops re-proposing them. |
| **Log** | The live trace, the same as the terminal. |
| **Settings** | How closely it watches, and what it reasons with. |

The dot beside the title: **green** connected, **amber** thinking, **red** the pump is not running. If
the page ever looks frozen, refresh it — it keeps its last state rather than blanking.

## Settings

*How closely it watches* (sidebar, applied to the next audit). **Audit every** *n* in-game years sets
the cadence — every audit is a retrieval pass and one paid completion, so halving it doubles the cost.
**Sphere reach** is how far past your own regions the window grows: 0 watches only your own ground, 2
your neighbourhood, 4 most of the Old World from Iberia, 8 the whole supported map. **Sphere ceiling**
caps the total and is the real limit on cost. **Realms in prompt** is how many the Director is shown;
your neighbours come first.

*What it reasons with* (sidebar). Provider and model, with presets for DeepSeek, a local Ollama and any
other OpenAI-compatible endpoint.

*How fast the bridge ticks* (`config.json`). **`pumpIntervalSeconds`** (default 2) sets how often the
mod's execution pump runs the staged file. It lives in the mod rather than the orchestrator, so
changing it needs `npm run deploy:mod` and a CK3 restart. On a heavily modded install consider 5 or 10:
every `run` makes CK3 re-validate its script database and re-report every unset variable in every
loaded mod — about 315 `error.log` lines a tick on a 56-mod playset — and the Director acts on a
timescale of in-game years, so a few seconds of latency costs nothing. **`logClearThresholdMB`**
(default 4) sets how much log the orchestrator lets build up before asking the game to clear it.

## Troubleshooting

Start with `npm run doctor` (or run the `.exe`, which does the same check). It names whichever of Node,
the CK3 folder, `debug.log`, the run folder, the deployed mod and the API key is wrong.

| Symptom | Cause and fix |
|---|---|
| Nothing happens at all | Almost always the pump. Take the *Recall the Historical Director* decision, or use the console command above. The World tab says outright when requests are going unanswered. Also check CK3 was launched with `-debug_mode`. |
| Nothing works after updating | CK3 only reads mod files at startup. Redeploy (`npm run deploy:mod`, or rerun the `.exe`) and fully restart the game. The log line `the running game reports companion mod v…` says which version the game actually loaded. |
| `Effect is empty. Check error log` | Not an error: the batch guard refusing to run a batch it has already executed. |
| `retrieved 0 articles` | Wikipedia or Wikidata throttled the request. It recovers on its own. |
| "The player could not be located in any known region" | Your capital is outside supported coverage (the steppe, Tibet, East Asia). The Director refuses rather than invents. |
| It proposes nothing on a loaded save | Often correct: the world may be on track. On a mid-campaign save it measures rank changes against a curated table of the record, and a realm the table does not name yields nothing. |
| `the game REFUSED …` | The action's precondition was false, so nothing changed. Decline it and move on. |
| `EADDRINUSE` on port 7842 | An orchestrator is already running. Use it, or close the other one. |
| The sidebar shows old numbers | Refresh the page. |

**Where the logs are.** The orchestrator: its terminal and the Log tab. CK3: `Documents\Paradox
Interactive\Crusader Kings III\logs\debug.log` (search for `HD:`) and `…\logs\error.log`. What is
currently staged for the game: `…\run\hd.txt`. `baseline.json` beside the orchestrator holds the map as
your campaign began; deleting it is safe, and the next snapshot becomes the new baseline.

## Known issues

- **Sources on ordinary proposals are often irrelevant.** Retrieval runs once per audit, not once per
  proposal, so every card lists everything the audit fetched. Curated historical wars carry their own
  sources. Per-proposal retrieval is the next fix.
- **Historical wars have heavy stakes.** A lost war costs the attacker 2,500 gold in reparations and a
  thousand in fame — too much for a two-county duchy. Tuning is pending.
- **Vanilla can race the record.** CK3's own mechanics sometimes fight a historical war early — in
  testing, Aragon took Majorca in 1220 under Fate of Iberia's *Iberian Reclamation*. The Director then
  correctly treats that war as already fought; it cannot yet hold a war back to its date.
- **One harmless error per log-clear slot when a save loads**, because the slots are briefly evaluated
  while there is no player.
- **The model sometimes reaches for a whole empire** — for example aiming the Almohad moment at the
  Mu'minid Empire itself. The caps refuse it; nothing reaches the game.
- **Heavy modlists flood `error.log`.** The orchestrator clears the game's logs as they fill, and
  raising `pumpIntervalSeconds` reduces how much of that is the Director's doing.
- **The pump does not survive loading a save.** Take the Recall decision after each load.
- **A realm formed after the campaign's baseline cannot be rank-corrected** — it fails closed.
- **The bookmark tables hold three dates** (867, 1066, 1178). A campaign at 1300 is measured against
  1178.
- **Realm footprint is counted within the sphere**, not globally, so a realm straddling the sphere's
  edge reads smaller than it is.
- **Wikidata coverage is uneven.** CK3's realm names mostly do not resolve, so lookups fall back to the
  dynasty. Where nothing resolves, the Director is told it has no structured backing and must say so.
- **The steppe and East Asia are refused, not guessed at.**
- **Tested on one machine**, CK3 1.19.0.5, with one 56-mod playset.

---

## Trying it without the game

The whole loop runs against a fake CK3 and a fake model in about twenty seconds:

```bash
npm run smoke
```

That starts all three, plays a 1218 Andalusian scenario, and checks the lines that prove each stage
worked — locate, sphere, snapshot, baseline, audit, validation. It runs in a scratch folder, so it
cannot touch a real campaign. `npm run smoke:exe` does the same against the built executable.

To watch it by hand, start the three separately:

```bash
node scripts/stub-llm.mjs
```
```bash
node scripts/simulate-game.mjs --iberia
```
```bash
npm start
```

`--byzantium` gives the 867 scenario and `--andalus` the mid-campaign 1218 one;
`node scripts/stub-llm.mjs --bad` returns deliberately malformed proposals, to watch validation reject
them. `npm run check` runs the four verification suites — the toolkit, tier and gate cases, the region
catalogue, the localisation, and the engine-resilience cases.

---

## How it works

CK3 has no state-export API, so the bridge is built from mechanisms the engine does expose.

**Perception.** The companion mod writes delimited records into `logs/debug.log` through the
`debug_log` effect. Everything is prefixed `HD:` so it stays disjoint from VOTC's `VOTC:` traffic and
both mods can run together.

```
HD:/;/realm/;/1002/;/Alfonso VI/;/Kingdom of Leon/;/Kingdom/;/14/;/Castilian/;/Catholic/;/...
```

**Execution.** The orchestrator stages CK3 script into `run/hd.txt`. A 1×1 GUI widget recreates itself
every couple of seconds and calls `[ExecuteConsoleCommand('run hd.txt')]`. `run` is a console command
and `ExecuteConsoleCommand` is a GUI function, so a self-recreating widget is the only way a mod can
execute script an external program decided on. The file's name never changes, because CK3's console
only sees run files that existed when the game launched.

**Idempotence.** The pump cannot know it has already run what it finds, so every batch is wrapped in a
token guard: the script compares a global variable against the batch token and does nothing if they
match. A batch executes exactly once however many times it is picked up.

```
Orchestrator  --- run/hd.txt ------>  pump  --->  CK3
Orchestrator  <-- debug.log --------  debug_log effects
```

**Historical wars.** CK3 has no effect that grants a casus belli, but `start_war` accepts any casus
belli from script — Paradox's own bookmark events do exactly this. Each curated war has its own casus
belli, modelled on vanilla's script-only `raiktor_claim_cb`: nobody can declare it by hand, and it
fights over a claim the batch grants a line earlier. The war's name is that casus belli's localisation.
Wars target a duchy and one anchor county rather than a crown, because crowns created during play have
keys no file can know; the snapshot looks up who holds those titles, and a war whose land is already the
attacker's is reported as already fought. `start_war` reports nothing, so the batch checks afterwards
for a war under that casus belli and reports `war_started` or `claim_only`.

**Keeping a long campaign alive.** Three engine behaviours, found and measured by the Voices of the
Court project (see [attribution](#attribution)), are handled explicitly:

- *The log fills up.* CK3's log subsystem stops writing after heavy use, and truncating the file from
  outside does not help — only the in-game `log.clearAll` does. No effect can run a console command, so
  the orchestrator sets a global variable that a widget in the mod watches through a scripted GUI, and
  the widget runs `log.clearAll`. The orchestrator counts what the engine has written — including
  `error.log`, which it never reads — and never clears while a batch is waiting to be acknowledged,
  because clearing would erase that batch's answer.
- *Fullscreen event windows kill the pump.* Every window this mod opens re-arms it, and a quarterly
  watchdog rebuilds it if it has gone.
- *A dead pump and a dead log look identical.* The orchestrator tells them apart by whether the log is
  growing at all, and says which one to fix.

### The safety argument

The model never writes CK3 script. It returns a JSON proposal naming an action from the toolkit, and
that proposal is re-validated here — against the schema and the live snapshot — before it is even
displayed. Every character it names must be one the snapshot reported, values must be in range, and
every string is stripped of the characters CK3 script treats structurally.

Actions address characters through tags the mod assigns during the snapshot, never by name or id. The
model never names a title: a historical war's titles, casus belli, modifiers and dates are constants
in a curated table, and the model only chooses which war.

A proposal that fails validation is **dropped and reported**, never repaired. If the game refuses an
approved action, the sidebar says so rather than reporting success. Proposing and executing are
separate functions: `preview` renders the argument, and `toScript` is only reached after you approve.

---

## Layout

```
mod/                          the CK3 companion mod
  common/casus_belli_types/     one casus belli per historical war
  common/decisions/             Recall the Historical Director; the union decision
  common/modifiers/             momentum, macro-event, moment and war modifiers
  common/on_action/             bootstrap and the pump watchdog
  common/scripted_effects/      the heartbeat and the pump's liveness mark
  common/scripted_guis/         the log-clear request slots
  events/                       startup, proposal notification, and every Director event
  gui/custom_gui/hd_runner.gui  the execution pump and the log-clear executor
  gui/event_window_widgets/     the bootstrap and re-arm widgets
  localization/english/

src/
  bridge/                 protocol, log tailer, log budget, run-file handshake, script composer
  model/                  snapshot assembly, the campaign baseline, the audit clock
  director/               the Director, the toolkit, regions and the sphere
  director/historicalWars.js   the curated war table
  director/moments.js     the curated historical moments
  director/macroEvents.js, almohadCollapse.js   the macro events
  director/momentum.js    the pre-authored amplifications of grant_claim
  director/bookmarkTiers.js    what the record says at 867, 1066 and 1178
  knowledge/              Wikipedia and Wikidata retrieval
  lore/LoreBook.js        the ledger of verdicts
  setup/                  mod deployment, version gates and preflight
  renderer/               the sidebar

scripts/
  smoke.mjs, simulate-game.mjs, stub-llm.mjs   the loop against a fake game and a fake model
  check-*.mjs             the verification suites
  deploy-mod.mjs, doctor.mjs, build-exe.mjs, bundle.mjs
```

For the design and the engineering story, see [PROJECT.md](PROJECT.md).

## Quick reference

```bash
npm start              # run the orchestrator
npm run doctor         # diagnose the setup
npm run deploy:mod     # after changing anything in mod/, then restart CK3
npm run check          # the verification suites
npm run smoke          # the whole loop against a fake game, about 20 seconds
npm run build:exe      # produce dist/HistoricalDirector.exe
npm run smoke:exe      # the same loop against that executable
```

In the CK3 console: `gui.createwidget gui/custom_gui/hd_runner.gui hd_runner`.
Sidebar: **http://127.0.0.1:7842**.

---

## Attribution

**The debug-log bridge is not an original idea.** CK3 exposes no state-export API, and the technique
this project depends on — reading `logs/debug.log` for perception, and driving the game from outside
through a self-recreating GUI widget that calls `ExecuteConsoleCommand` — was worked out by the wider
CK3 modding community before this project existed.

The clearest precedent, and the direct architectural influence here, is **Voices of the Court**
(Durond, and the 2.0 reimplementation by MrAndroPC), which solved the same perception-and-execution
problem first, for conversational play. This project read how VOTC does it and applied the same
mechanisms to a different problem: auditing the shape of the map rather than voicing the people on it.

**Three engine limits handled here are VOTC's findings.** They were contributed as
[issue #1](https://github.com/kaiseer1/historical-director-project/issues/1), a postmortem of an
afternoon spent discovering them the hard way: that CK3's log subsystem stops writing after heavy
cumulative use and that only the in-game `log.clearAll` resets it — truncating the file from outside
does not, as they established by controlled experiment; that fullscreen event windows silently kill
console-created widgets, so an execution pump needs a network of re-arm points; and that sibling states
under one GUI widget are mutually exclusive, so an extra one can starve the others. The exact point at
which logging stops did not reproduce the same way on this project's test machine, which is discussed
in the issue thread; the defences are the same either way.

Every record this mod writes is prefixed `HD:` and its run file is separate, so the two mods can be
installed and run side by side.

The Historical Director is an independent project. It is not affiliated with or endorsed by Voices of
the Court and contains none of its code. Crusader Kings III is a trademark of Paradox Interactive, who
are likewise unaffiliated with this project.

## Licence

**MIT.** Copyright (c) 2026 Basil Abdullah Al Zahrani. The full text is in [LICENSE](LICENSE).
