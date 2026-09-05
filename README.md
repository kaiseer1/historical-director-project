# The Historical Director

A human-in-the-loop LLM framework for historically-grounded gameplay in **Crusader Kings III**.

CK3's AI advances the world competently but without historical direction. Within decades a campaign
drifts into configurations that contradict the medieval record, and the game offers no setting to
counteract it. The Historical Director treats historical fidelity as an external service: it watches
the live game, compares what it sees against retrieved historical evidence, and proposes corrections
drawn from a fixed toolkit — which run only if you approve them.

The AI directs. You decide. That single constraint is what makes the rest of it safe: the
hallucination problem has a human arbiter, and the latency problem has a player who consented to wait.

> Companion to the paper *The Historical Director: A Human-in-the-Loop LLM Framework for
> Historically-Grounded Gameplay in Crusader Kings III* (Basil Abdullah Alzahrani, Al-Baha University).

---

## What works today

This is v0.3 — a testing alpha. A complete vertical slice, not a finished mod.

| | |
|---|---|
| Perception | Regional world-state snapshots: rulers, titles, tiers, footprint, culture, faith, government |
| Sphere of influence | Seeded from where the player rules — capital *and* realm footprint — then grown as far outward as you set it |
| Knowledge layer | Wikipedia lead extracts, era-filtered + Wikidata reign intervals and dynasty spans |
| Toolkit | `spawn_character`, `set_relations`, `grant_claim`, `adjust_title_tier`, `trigger_event` |
| Momentum | `grant_claim` can also supply the means to press a claim — money, the resource the war costs, and a timed appetite for it. It never starts the war |
| Governance | Encyclopedic sidebar, auto-pause, Approve / Decline, every verdict logged |
| Settings | Audit cadence, sphere reach and ceiling, and the model — all changed from the sidebar, no restart |
| Lore Book | Persistent ledger of approvals *and* declines, re-injected into later audits |
| Coverage | Phase I: 25 regions, Ireland to Bengal — Europe, the Mediterranean, Africa, the Near East, India |
| Packaging | A single `.exe` that needs no Node, no clone, and deploys the companion mod itself |

Not yet built: local Wikipedia dumps with a vector store (the live APIs stand in), the steppe and East
Asia, and event-driven auditing (the cadence is a number of in-game years, now yours to set).

---

> **Just want to run it?** See [RUNNING.md](RUNNING.md) — the full operating guide, including every
> failure that has actually occurred and how to fix it. For the design and the engineering story, see
> [PROJECT.md](PROJECT.md). For where the project actually stands — what has been watched working,
> what has not, and what is currently blocking it — see [PROGRESS.md](PROGRESS.md).

## Requirements

- **CK3 launched with `-debug_mode`** — the bridge depends on it, exactly as VOTC does
- An LLM endpoint: any OpenAI-compatible provider, or a local model via Ollama
- **Node 20+**, if you are running from source. The `.exe` has Node inside it and needs nothing.

## Setup — the executable

`dist/HistoricalDirector.exe` is the whole thing in one file. On first run it writes a `config.json`
beside itself, copies the companion mod into your CK3 user folder, checks its own environment, and
opens the sidebar.

```bash
npm run build:exe
```

Then double-click it. Windows will warn that it is unsigned — "More info", then "Run anyway"; that is
what any unsigned binary looks like, and it is worth telling testers to expect it.

Two things it cannot do for you: enable **Historical Director** in the CK3 launcher playset, and give
itself an API key. Set the key in the environment, or paste one into the sidebar's Settings tab.

```bash
setx HD_API_KEY "sk-..."
```

## Setup — from source

```bash
node scripts/deploy-mod.mjs
```

Copy `config.example.json` to `config.json` and set `ck3UserFolder` if it is not in the default place.
Put your key in the environment rather than the config file, as above.

The sidebar's **Settings** tab holds two groups, both applied to the next audit without a restart.

*How closely it watches.* **Audit every** *n* in-game years sets the cadence — every audit is a
retrieval pass and one paid completion, so halving it doubles what a campaign costs to run. **Sphere
reach** is how far past your own regions the window grows, in steps through the adjacency graph: 0
watches only the ground you hold, 2 your neighbourhood, 4 most of the Old World from Iberia, 8 the
whole supported map. **Sphere ceiling** caps the total, and is the real limit on cost. **Realms in
prompt** is how many the Director is shown; your own neighbours come first, so raising it adds distant
realms rather than nearer ones.

*What it reasons with.* Provider and model, with presets for DeepSeek, a local Ollama, and any other
OpenAI-compatible endpoint. A key pasted there is held in memory for that session only and is never
written to disk — the environment variable remains the way to set one that persists.

Enable **Historical Director** in the CK3 launcher playset, then check everything is wired up:

```bash
node scripts/doctor.mjs
```

Start the orchestrator and open the sidebar at `http://127.0.0.1:7842`:

```bash
npm start
```

Load your save. You will get a one-off event confirming the Director is watching — accepting it starts
the execution pump.

The pump is a GUI widget and does not survive loading a save, so it reports its own liveness: every
batch the orchestrator stages sets a flag, and once an in-game year the mod checks whether that flag
was set since it last looked. If not, the pump is gone and the startup event fires again to rebuild
it. A campaign therefore heals itself, though a year of game time is a long wait when paused — the
*Recall the Historical Director* decision re-arms it instantly, and the sidebar tells you when it
needs doing.

## Trying it without the game

The whole loop runs against a fake CK3 and a fake model in about twenty seconds, which is
considerably faster than a five-minute game load:

```bash
npm run smoke
```

That starts all three, plays the 1218 Andalusian scenario, and checks the lines that prove each stage
worked — locate, sphere, snapshot, baseline, audit, validation. It runs entirely in a scratch folder,
so it cannot touch a real campaign's `baseline.json`. `npm run smoke:exe` does the same against the
built executable, which is the run that matters before handing the exe to anyone.

To watch it by hand instead, start the three separately:

```bash
node scripts/stub-llm.mjs
```
```bash
node scripts/simulate-game.mjs --iberia
```
```bash
npm start
```

`--byzantium` gives the 867 scenario and `--andalus` the mid-campaign 1218 one.
`node scripts/stub-llm.mjs --bad` returns deliberately malformed proposals, to watch validation reject
them.

`npm run check` runs the two verification scripts: the tier and baseline gate cases, and the region
catalogue's own invariants.

---

## How it works

CK3 has no state-export API, so the bridge is built from three mechanisms the engine does expose.

**Perception.** The companion mod writes delimited records into `logs/debug.log` through the
`debug_log` effect. Everything is prefixed `HD:` so it stays disjoint from VOTC's `VOTC:` traffic and
both mods can be installed together.

```
HD:/;/realm/;/1002/;/Alfonso VI/;/Kingdom of Leon/;/Kingdom/;/14/;/Castilian/;/Catholic/;/...
```

**Execution.** The orchestrator stages CK3 script into `run/hd.txt`. A 1×1 GUI widget recreates itself
every two seconds and calls `[ExecuteConsoleCommand('run hd.txt')]`. `run` is a console command and
`ExecuteConsoleCommand` is a GUI function, so a self-recreating widget is the only way a mod can
execute script an external program decided on. Recreation is unconditional: a gated recreation state
does not pause the pump, it lets the widget expire without a successor.

**Idempotence.** The pump cannot know it has already run what it finds, so every batch is wrapped in a
token guard: the script compares a global variable against the batch token and does nothing if they
match. A batch executes exactly once however many times it is picked up.

```
Orchestrator  --- run/hd.txt ------>  pump  --->  CK3
Orchestrator  <-- debug.log --------  debug_log effects
```

### The safety argument

The model never writes CK3 script. It returns a JSON proposal naming an action from the toolkit, and
that proposal is re-validated here — against the schema, and against the live snapshot — before it is
even displayed. Every character it names must be one the snapshot reported, values must be in range,
and every string is stripped of the characters CK3 script treats structurally, so nothing the model
emits can escape into the run file as script.

Actions address characters through tags the mod assigns during the snapshot, never by name or id, so
the model's vocabulary is drawn from observed state rather than from its memory of the base game. It
cannot name a title that does not exist, because it does not name titles at all.

A proposal that fails validation is **dropped and reported**, never repaired. Silently fixing up a
malformed proposal would mean executing something the model did not actually ask for. If the game
refuses an approved action because its precondition is false, the sidebar says so rather than
reporting success.

Proposing and executing are separate functions. `preview` renders the argument; `toScript` is only
ever reached after you approve.

---

## Layout

```
mod/                      the CK3 companion mod
  common/scripted_effects/  hd_perception_effects.txt   param-free primitives
  common/on_action/         hd_on_actions.txt           bootstrap + pump watchdog
  gui/custom_gui/           hd_runner.gui               the execution pump
  events/                   hd_events.txt               bootstrap + proposal notification

src/
  bridge/                 protocol, log tailer, run-file handshake, script composer
  model/WorldState.js     stream of records -> a snapshot
  model/Baseline.js       the map as the campaign began
  director/               regions, sphere of influence, toolkit, the Director
  director/bookmarkTiers.js  what the record says, at 867 / 1066 / 1178
  director/momentum.js    the pre-authored amplifications of grant_claim
  knowledge/              Wikipedia + Wikidata retrieval
  lore/LoreBook.js        the ledger
  setup/                  mod deployment and preflight, shared by the exe and the scripts
  runtime.js              source checkout, executable, or test harness
  renderer/               the sidebar

scripts/
  bundle.mjs              src/ -> one CommonJS file, no dependencies
  build-exe.mjs           that file -> a single executable
  smoke.mjs               the whole loop against a fake game and a fake model
  check-tier-fixes.mjs    the tier and baseline-gate cases
  check-regions.mjs       the region catalogue's invariants
```

## Known limitations

- **The pump dies on save load.** GUI widgets do not persist. The yearly watchdog rebuilds it, but
  until it fires the recall decision is the fast path; the sidebar shows a banner when requests are
  going unanswered.
- **Realm footprint is counted within the sphere**, not globally — deliberate, but it means a realm
  straddling the sphere edge reads smaller than it is.
- **Wikidata coverage is uneven.** Realm names are CK3's own constructions and mostly do not resolve,
  so lookups fall back to the dynasty, which usually does. Where nothing resolves the Director is told
  it has no structured backing and instructed to say so.
- **Retrieval is best-effort.** Queries carry the century and results whose leads are entirely
  post-medieval are discarded, but a tangential article still gets through sometimes. Every source is
  shown with its link precisely because it should not be taken on trust.
- **The steppe and East Asia are refused, not guessed at.** A player on the Kazakh steppe is told they
  are outside supported coverage rather than given confident invention. India, West Africa and the
  Horn were in that category until v0.3 and are now Phase I.
- **A wide sphere costs more.** Reach and ceiling are dials because there is no right answer, not
  because the maximum is free: each extra region is another county sweep in game and more realms in
  the prompt. The defaults are deliberately modest.
- **The bookmark tables are three dates.** A campaign at 1300 is measured against 1178, and a hundred
  and twenty years of legitimate change is change those tables cannot account for. They only ever
  permit a proposal the baseline could not reach; absence from them is never treated as licence.

## Licence

GPL-3.0-only.
