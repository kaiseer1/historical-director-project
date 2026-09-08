# Running the Historical Director

Everything you need to run this without help. If something goes wrong, section 6 lists every failure
that has actually happened, with its cause and fix.

**Project folder.** Wherever you cloned or unzipped this repository. Every command in this guide is
run from there, so open a terminal and change into it once at the start of a session:

```bash
cd path/to/historical-director-project
```

On Windows that path is usually `C:\Users\<you>\Documents\historical-director-project` or wherever
you put it; the commands below assume you are already inside it.

---

## 1. Every session, in short

Three things, in this order.

**1 — Start the orchestrator.** Open a terminal:

```bash
npm start
```

Leave it running. It prints its settings and then `watching for the game`.

**2 — Start CK3**, load your save. **The game must be launched with `-debug_mode`.** Set it in Steam:
right-click Crusader Kings III, Properties, Launch Options, and add `-debug_mode`. Without it the
bridge has no `debug_log` and no console `run`, and nothing will happen at all. Voices of the Court
requires the same flag, so if you already run VOTC you are already set up for this.

**3 — Arm the pump.** Open the console with the **`** key (backtick, top-left) and type:

```
gui.createwidget gui/custom_gui/hd_runner.gui hd_runner
```

Then unpause. Open **http://127.0.0.1:7842** in any browser and play.

That is the whole routine. Step 3 is needed once per save load.

---

## 1a. The executable

`dist/HistoricalDirector.exe` replaces steps 1 and most of the setup. It has Node inside it, so a
tester needs no clone, no `npm`, and no Node installed. Build it with:

```bash
npm run build:exe
```

Double-clicking it will:

- write a starting `config.json` beside itself, if there is not one already
- copy the companion mod into your CK3 user folder, replacing any older copy
- run the same preflight as `npm run doctor`, and print anything not ready
- start the orchestrator and open the sidebar

It still cannot enable the mod in the CK3 launcher playset, and it still needs an API key — set
`HD_API_KEY` in the environment, or paste one into the Settings tab.

Two things worth telling testers in advance. It is **unsigned**, so Windows SmartScreen will warn on
first run: "More info", then "Run anyway". And it is **68 MB**, nearly all of which is Node itself.

`--no-browser` starts it without opening the sidebar. `--selftest` prints what is embedded and exits,
which is how the build verifies itself.

---

## 2. What should happen

Within a few seconds of unpausing, the terminal shows something like:

```
the game is talking to us
1071: audit due
asked the game where the player is (probing 68 regions)
the execution pump is running
player located: Arabian Empire at Cairo. Seeded from Egypt and Ifriqiya, extended to …
requested a snapshot of Egypt and Ifriqiya, The Maghreb, The Levant and Arabia
snapshot received: 62 realms in 15 Sep 1066
auditing 1066 across …
retrieved 6 articles, 2 realms with structured backing
the Director has 2 proposal(s) for your judgement
```

The proposal appears in the browser. Read it, then **Approve** or **Decline**.

On approval you should then see:

```
approved: Destroy the Zirid Grand Emirate held by Tamim ibn al-Muizz …
the game confirmed adjust_title_tier took effect
```

If instead it says **`the game REFUSED …`**, the change did *not* happen — the action's precondition
was false in your campaign. That message is honest, not a bug; see 6.7.

An audit runs every **5 in-game years** by default. It is entirely normal for it to say
`the Director finds this world on track; nothing proposed`. That is the system working.

---

## 3. The sidebar

**http://127.0.0.1:7842** — four tabs.

| Tab | What it shows |
|---|---|
| **Proposals** | Awaiting your judgement. Divergence, historical context, consequences, exact change, sources, Approve / Decline. Also an **Audit now** button. |
| **World** | Where you are, the computed sphere, how many realms were seen, model, cadence. **Warnings appear here.** |
| **Lore Book** | Every verdict you have given. Declines are kept so the Director stops re-proposing them. |
| **Log** | The live trace, same as the terminal. |
| **Settings** | Provider, model, temperature, token limit and API key. Changes apply to the next audit, no restart. |

The dot beside the title: **green** = connected, **amber pulsing** = the Director is thinking,
**red** = the pump is not running.

If the page looks frozen or shows numbers that no longer match your game, **refresh it**. The page
holds its last state when the connection drops; it does not blank itself.

---

## 4. Settings

Four of these are now in the sidebar's **Settings** tab, under *How closely it watches*, and take
effect at the next audit with no restart:

| Setting | What it does | Range |
|---|---|---|
| **Audit every** | In-game years between audits. Every audit is a retrieval pass and one paid completion, so halving this doubles what a campaign costs to run. | 1-100 |
| **Sphere reach** | How far past your own regions the window grows, in steps through the adjacency graph. 0 watches only ground you hold, 2 your neighbourhood, 4 most of the Old World from Iberia, 8 the whole supported map. | 0-8 |
| **Sphere ceiling** | The most regions the sphere may hold. This is the real limit on cost. 25 is everything, Ireland to Bengal. | 1-25 |
| **Realms in prompt** | How many realms the Director is shown. Your own neighbours come first, so raising this adds distant realms rather than nearer ones. | 10-150 |

Anything typed outside a range is clamped, and the panel re-reads itself afterwards so it always shows
what is actually in force rather than what you typed.

Everything else is `config.json` in the project folder — or, for the executable, beside the .exe —
and does need a restart.

```json
{
  "ck3UserFolder": "C:/Users/YOU/Documents/Paradox Interactive/Crusader Kings III",
  "port": 7842,
  "llm": {
    "baseUrl": "https://api.deepseek.com",
    "model": "deepseek-chat",
    "apiKeyEnv": "HD_API_KEY",
    "temperature": 0.2,
    "maxTokens": 2000
  },
  "director": {
    "auditEveryYears": 5,
    "sphereReach": 2,
    "sphereMax": 12,
    "maxRealmsInPrompt": 60,
    "maxProposalsPerAudit": 2
  },
  "knowledge": { "enabled": true, "wikipediaLang": "en", "maxDocuments": 6 }
}
```

The ones worth touching:

- **`auditEveryYears`** — how often it looks. Try **10** if it nags, **2** if it is too quiet.
- **`sphereReach` / `sphereMax`** — how much of the world it watches. Both are in the sidebar too.
- **`maxProposalsPerAudit`** — how much it can put in front of you at once.
- **`temperature`** — 0.2 is deliberately low. Raising it makes the Director more imaginative and
  less reliable.
- **`knowledge.enabled`** — set `false` to run without Wikipedia/Wikidata. Faster, and markedly worse:
  the model then has nothing to ground its claims in.

### Using a different model

Easiest from the **Settings tab** in the sidebar — no restart, no JSON. Pick a provider preset, set
the model, **Test connection**, then **Save**:

| Preset | Endpoint |
|---|---|
| DeepSeek | `https://api.deepseek.com` |
| Ollama (local) | `http://localhost:11434/v1` |
| Custom | anything OpenAI-compatible |

The model field stays yours to fill in — `deepseek-chat`, `llama3.1`, whatever your endpoint serves.
**Test connection** makes one tiny call and reports back, so a wrong endpoint or a missing key is
caught immediately rather than five in-game years later when an audit fails.

Everything except the key is written to `config.json`. The equivalent by hand:

```json
"llm": { "baseUrl": "http://localhost:11434/v1", "model": "llama3.1", "apiKeyEnv": "HD_API_KEY" }
```

### The API key

Already set permanently on this machine as the user environment variable `HD_API_KEY`. To change it:

```bash
setx HD_API_KEY "your-new-key"
```

Then **open a new terminal** — `setx` only affects terminals opened afterwards.

The key is deliberately not stored in `config.json`, so that file stays safe to share, screenshot or
commit.

You can also paste a key into the **Settings tab**, but note what that does and does not do: it is
held in memory by the running process only. It is never written to `config.json`, never sent back to
the page, and it is gone when you stop the orchestrator. Use it to try a provider; use `setx` for the
one you keep.

---

## 5. After changing the code

**Changed anything in `src/`** — restart the orchestrator. Nothing else.

**Changed anything in `mod/`** - redeploy *and* restart CK3.

Most releases do not need this. v0.3 changed no mod script at all: everything it added is composed
orchestrator-side and runs through the existing pump, which is what keeping the mod down to
parameter-free primitives buys.

**v0.4 does need it.** The amplified `grant_claim` applies character modifiers, and a modifier has to
be *defined* in the mod before script can apply one. `mod/common/modifiers/hd_modifiers.txt` is new,
so redeploy and restart CK3 before using momentum. If you skip this the claim still lands and the gold
still arrives; only `add_character_modifier` fails, and it fails the way a missing definition always
does - a line in `error.log` and nothing in the game. No trigger can guard against it.


```bash
node scripts/deploy-mod.mjs
```

Most changes are in `src/`. The mod now holds only small parameter-free pieces, so it rarely needs
touching.

### Testing without launching the game

Far faster than a five-minute game load. Three terminals:

```bash
node scripts/stub-llm.mjs
```
```bash
node scripts/simulate-game.mjs --iberia
```
```bash
npm start
```

`--byzantium` gives the 867 scenario and `--andalus` the mid-campaign 1218 one — an alt-history
Andalusian empire spanning Iberia, the Maghreb and Sicily, joined from an existing save. `--refuse`
makes the fake game reject approved actions. `--legacy` makes it emit the older wire format, without
tier records. `node scripts/stub-llm.mjs --bad` returns deliberately malformed proposals so you can
watch validation reject them.

Or run all three at once and have the result checked for you:

```bash
npm run smoke
```

That plays the 1218 scenario for twenty seconds and asserts the lines that prove each stage worked —
the game heard, the player located, a sphere seeded, a snapshot received, a baseline captured, an
audit run, a verdict reached. It runs entirely under a scratch `HD_HOME`, so it cannot touch a real
campaign's `baseline.json`.

```bash
npm run smoke:exe
```

The same checks against the built executable, plus four more: that it knows it is packaged, deploys
the companion mod itself, runs its own preflight, and writes a starting config. This is the run to do
before handing the .exe to anyone.

There are also two self-contained checks that need neither the game nor a model:

```bash
npm run check
```

`check-tier-fixes.mjs` exercises the tier and baseline rules — same-tier demotions, multi-rank
demotions, missing tier data, legacy snapshots, baseline re-capture, and the mid-campaign bookmark
gate. `check-regions.mjs` checks the region catalogue's own invariants: that every id is a region CK3
actually defines, that no Phase I region contains another, that adjacency is symmetric, and that the
sphere grows the way the dials say. Run both after touching anything in `src/model`, `src/bridge` or
`src/director`.

**Important:** the simulator points the app at a fake CK3 folder via `--log`. It does not touch your
real game. Prefer `HD_HOME` over editing `config.json` when testing — it moves the whole app,
`baseline.json` included, somewhere harmless:

```bash
HD_HOME=/tmp/hd-test npm start
```

---

## 5a. Verifying the toolkit

Four of the six actions have been watched working in a live campaign. `set_relations` has not, and
neither has an endowed `spawn_character` — one carrying a house and a pressed claim rather than being
a bare courtier. That is the largest remaining gap between what the design claims and what anyone has
actually seen. Closing it needs a real game, so there is a harness.

**This bypasses the approval gate.** It stages an action straight into the run file with no model and
no proposal. Use a throwaway save.

```bash
node scripts/verify-toolkit.mjs --i-understand-this-bypasses-approval --action set_relations --actor 3 --target 5 --value -60
```

Characters are named by **tag** — their position in the last snapshot, counting realm records from
zero — not by character id, because the tag is what the script addresses. Read them off the realm
table, or count `HD:/;/realm` lines in `debug.log`.

The command prints the two log lines that decide the outcome. Exactly one should appear:

```
APPLIED   HD:/;/applied/;/<token>/;/<action>/;/ok
REFUSED   HD:/;/refused/;/<token>/;/<action>/;/precondition_failed
```

**Neither line means the batch never ran at all** — the pump is stopped, or the token guard already
consumed it. A silent nothing and a reported refusal are different failures.

What to look for on screen, per action:

| Action | Command | Confirm in game |
|---|---|---|
| `set_relations` | `--action set_relations --actor <tag> --target <tag> --value -60` | Open the actor's character view; the target should carry a new opinion modifier |
| `spawn_character` | `--action spawn_character --host <tag> --name Testus --sex male --age 30` | Open the host ruler's court; a new courtier named Testus, aged 30, **male**, their culture and faith |
| `spawn_character`, endowed | `--action spawn_character --host <tag> --name Testus --house <tag> --claim <tag>` | Same court, but Testus carries the house's name, and his character view's Claims section shows a pressed claim on the claim tag's primary title. The host should gain a claimant casus belli against its holder |
| `grant_claim` | `--action grant_claim --actor <tag> --target <tag>` | The actor's character view, Claims section: a pressed claim on the target's primary title |
| `adjust_title_tier` | `--action adjust_title_tier --actor <tag> --target_tier duchy --tier kingdom` | The realm drops one rank on the map; its kingdom-tier vassals may go independent |
| `trigger_event` | `--action trigger_event --actor <tag> --event hd_event.0100` | The recipient gets a choice; accepting grants a pressed claim on a neighbour |

The Director's events are `hd_event.0002` (notification only), `0100` (intervene across water), `0101`
(the invited crossing) and `0102` (a plea for protection). The last three need the recipient to have a
suitable neighbour; without one the event silently does not fire, and the log says so:

```
the game fired hd_event.0100                                    ← it reached the ruler
the batch ran, but the event did not fire: its own trigger …    ← it did not
```

`--tier` on `adjust_title_tier` is the rank you observe the ruler holding now; the script asserts it,
so a wrong value produces a `refused` line rather than a demotion.

Launch with `-debug_mode` and have the pump running, or nothing will execute.

---

## 6. When something goes wrong

Start here:

```bash
node scripts/doctor.mjs
```

It checks Node, the CK3 folder, `debug.log`, the run folder, whether the mod is deployed, and whether
the key is set — and names whichever is wrong.

### 6.1 Nothing happens at all

Almost always the pump. Run the `gui.createwidget` line from section 1. The **World** tab tells you
outright when requests are going unanswered.

The pump is a GUI widget and **does not survive loading a save**. There is a watchdog that rebuilds it
within an in-game year, and a decision called **Recall the Historical Director** that does it
instantly — but the console command is the quickest.

### 6.2 "Effect is empty. Check error log"

Not an error. The token guard is refusing to run a batch it has already executed. Expected.

### 6.3 The sidebar shows old data

Refresh the page. It keeps its last state when the orchestrator restarts.

### 6.4 `retrieved 0 articles`

Wikipedia or Wikidata throttled the request. It recovers by itself; results are cached, so the next
audit is usually fine. Persistent zeros mean no internet.

### 6.5 "The player could not be located in any known region"

Your capital is outside supported coverage — the steppe, Tibet or East Asia. The Director refuses to
act rather than invent, which is deliberate. Supported since v0.3: 25 regions from Ireland to Bengal —
Europe, the Mediterranean, North and West Africa, the Sahara, Nubia and the Horn, the Near East,
Persia and the settled Islamic east, and the Indian subcontinent.

### 6.5a "The Director only watches my home region, not my whole empire"

Fixed in v0.3: the sphere is seeded from where your realm holds land as well as where your capital
sits. No redeploy and no game restart — the probe is composed by the orchestrator and executed through
the existing pump, which is the whole point of keeping the mod down to parameter-free primitives.
Restarting the orchestrator is enough.

The log line tells you which seeding it used. "Seeded from Iberia" alone is capital-only; "plus The
Maghreb; Italy and Sicily, where the realm holds land" means the footprint probe answered.

Then raise **Sphere reach** in Settings. The default of 2 is deliberately modest; 4 covers most of the
Old World from Iberia.

### 6.5b "The Director proposes nothing at all on a save I loaded"

Expected before v0.3 and fixed in it. The baseline is the map as the Director first saw it, so on a
mid-campaign save "since the campaign began" meant "since you loaded", nothing could read as risen,
and the rank gate refused everything. It now notices when its baseline was captured well after a
bookmark and consults a curated table of what the record says instead. The table only ever *permits* a
proposal the baseline could not reach; a realm it does not name still yields nothing, which is why
some saves are legitimately quiet.

### 6.6 "Proposals keep getting rejected as having no script-derived tier"

The snapshot was taken before tier reporting existed, or its `realm_tier` records were lost to log
truncation. Trigger a fresh audit - **Audit now** in the sidebar. Rank demotions are refused rather
than guessed at, deliberately: the printed rank name is localised and cannot be trusted as a guard.

### 6.7 "the game REFUSED …"

The action's precondition was false, so **nothing changed**. Usually the named character or title no
longer qualifies — a ruler already at the lowest tier, a title that has changed hands. Decline it and
move on. The message means the system is being honest, not broken.

### 6.8 `EADDRINUSE` on port 7842

An orchestrator is already running. Either use it, or stop the old one:

```bash
powershell -Command "Get-Process node | Stop-Process -Force"
```

That kills **all** Node processes, so do not run it while something else of yours depends on Node.

### 6.9 Nothing works after editing the mod

CK3 only reads mod files at startup. Redeploy, then fully restart the game.

### Where the logs are

- Orchestrator: the terminal, and the **Log** tab
- CK3 perception: `Documents\Paradox Interactive\Crusader Kings III\logs\debug.log` (search `HD:`)
- CK3 script errors: `…\logs\error.log`
- What is currently staged for the game: `…\run\hd.txt`

`baseline.json` in the project folder holds the map as your campaign began; the Director measures rank
drift against it. It re-captures itself if you load an earlier save. Deleting it is safe - the next
snapshot becomes the new baseline, though drift before that point then goes unnoticed.

---

## 7. Things worth knowing

**`-debug_mode` disables achievements.** Unavoidable — `run` is a console command. VOTC has the same
constraint.

**It costs money per audit.** One model call plus a handful of web requests, roughly a fraction of a
cent on DeepSeek. Over a long campaign at a 5-year cadence this stays small. Point it at Ollama for
zero cost.

**It will occasionally be wrong.** During testing it invented a conquest of Granada that never
happened. That is exactly why every proposal shows its sources and waits for you. Read the argument
before approving — treating Approve as a formality gives up the only real safeguard in the design.

**Declining is useful.** Declines go into the Lore Book and the Director is told not to raise them
again. Declining freely teaches it your campaign.

**It coexists with Voices of the Court.** Different log prefixes, different run files. Both can be
installed and running at once.

---

## 7a. Engine limits discovered by the VOTC project

Three things about CK3 that no amount of care in this codebase can prevent, only survive. All three
were found and measured by the **Voices of the Court** project and written up in
[issue #1](https://github.com/kaiseer1/historical-director-project/issues/1) on this repository. They
are recorded here because each of them, left unhandled, ends a long campaign silently.

### The 17MB wall

**CK3's log subsystem has a per-session cumulative write limit of roughly 17MB.** Once it is reached,
`debug.log` and `error.log` both stop writing and stay stopped until the game is restarted.

The limit counts what the engine has *written*, not what is currently on disk. That distinction is
the whole problem, and VOTC established it by controlled experiment rather than by argument:

| Cleanup method | Peak file | Cumulative writes | Result |
|---|---:|---:|---|
| None | 17.3MB | 17.3MB | **Logging dead** |
| External truncation at every 4MB | 13.4MB | 17.6MB | **Logging dead** |
| In-game `log.clearAll` | 7.2MB | 59.6MB+ | Alive |

So **truncating debug.log from outside does nothing.** Deleting it, rotating it, emptying it with
another program — the engine goes on counting and dies at the same place. Only `log.clearAll`, which
is an engine command, resets the engine's own counter.

This matters more here than it did for VOTC. The Director is a heavy writer: one snapshot of a
twenty-region sphere is several thousand lines, and an audit cadence of one in-game year will reach
17MB in an afternoon.

**What the orchestrator does about it.** It counts the bytes it reads and, past a threshold
(`logClearThresholdMB`, default 4), asks the game to clear its own log. It cannot do this directly:
`log.clearAll` is a console command, no effect in the game can run one, and the run file the
orchestrator stages contains effects. Only a GUI widget can reach the console. So the request is a
global variable, and a widget in the companion mod watches for it through a scripted GUI and runs the
command. Four slots rotate, because a GUI state fires on a false-to-true edge and consecutive
requests need distinct edges.

The clear is never asked for while a staged batch is still waiting to be acknowledged. Clearing the
log destroys the echo that batch is about to write, and the orchestrator would then report a dead
pump for a batch that ran perfectly.

You will see this in the activity log:

```
asked the game to clear its log (slot a, 4.1MB read since the last one)
the game acknowledged the log-clear request (slot a)
the game log was cleared after 4.1MB; CK3 can keep logging
```

The World tab shows how much of the budget is spent once it is past half.

### Fullscreen event windows kill the pump

**A fullscreen event window can silently destroy a console-created widget**, and the execution pump
is one. VOTC reproduced this three times in an evening; it happens with any fullscreen event, not any
particular one, and nothing on the mod side prevents it.

The answer is not to stop the pump dying. It is to put resurrection points wherever it may just have
been killed, which is every window this mod opens: the proposal notification, the macro event, and
the moment acknowledgements all re-arm the pump when they appear. Under that sits a watchdog on
`quarterly_playable_pulse` — quarterly rather than monthly because CK3 has no monthly global pulse;
`yearly_global_pulse` is the only global one it offers.

Each re-arm clears the pump before recreating it. Console commands run serially, so a pump that was
still alive converges back to one instance instead of being doubled.

### A dead pump and a dead log look identical

Both present as silence: a staged batch is never acknowledged, and nothing arrives. They need
opposite responses, so the orchestrator distinguishes them by watching the log file rather than the
records in it.

- If the game is still writing **anything** — its own chatter, other mods, warnings — the log
  subsystem is alive and the silence is the pump's. The sidebar says so and offers the Recall
  decision.
- If the file has stopped growing **altogether**, the log subsystem is the suspect and the sidebar
  says to restart CK3. Recall would not help, and would waste the time it takes to find that out.

The first check has to be the second one, because when the log is exhausted every dead-pump symptom
is present too — the echo cannot reach us either.

## 8. Quick reference

```bash
npm start                       # run the orchestrator
npm run doctor                  # diagnose the setup
npm run deploy:mod              # after editing anything in mod/
npm run check                   # the two verification scripts
npm run smoke                   # the whole loop against a fake game, ~20s
node scripts/check-resilience.mjs  # log-clear chain, re-arm mounts, stall banners
npm run build:exe               # produce dist/HistoricalDirector.exe
npm run smoke:exe               # the same loop, against that executable
```

In the CK3 console:

```
gui.createwidget gui/custom_gui/hd_runner.gui hd_runner
```

Sidebar: **http://127.0.0.1:7842**
