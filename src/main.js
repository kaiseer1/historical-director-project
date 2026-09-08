import { loadConfig, describeConfig } from './config.js';
import { LogTailer } from './bridge/LogTailer.js';
import { LogBudget } from './bridge/LogBudget.js';
import { assess as assessLiveness } from './bridge/Liveness.js';
import { RunFileManager } from './bridge/RunFileManager.js';
import { SnapshotAssembler, belligerentName } from './model/WorldState.js';
import { LoreBook } from './lore/LoreBook.js';
import { Baseline } from './model/Baseline.js';
import { AuditClock } from './model/AuditClock.js';
import { LLMClient } from './llm/client.js';
import { Director } from './director/Director.js';
import { seedSphere } from './director/sphere.js';
import { TOOLKIT } from './director/toolkit.js';
import { label, labelList, PROBE_REGIONS, supportedRegions } from './director/regions.js';
import { createServer } from './server.js';
import { createSettingsHandlers } from './llmSettings.js';
import { createDirectorSettings } from './directorSettings.js';
import { locateScript, snapshotScript, actionScript } from './bridge/ck3Script.js';
import { isPackaged, describeRuntime, listAssets } from './runtime.js';
import { deployMod } from './setup/deployMod.js';
import { preflight, problemCount } from './setup/preflight.js';
// Two similarly named things, kept apart on purpose: modVersion's resolves the
// answer by reading the deployed descriptor, momentum's reports the answer the
// toolkit is currently acting on.
import { momentumSupport as resolveMomentumSupport, macroSupport as resolveMacroSupport, momentSupport as resolveMomentSupport, logClearSupport as resolveLogClearSupport, setObservedModVersion, observedModVersion } from './setup/modVersion.js';
import { setMomentumSupport, momentumSupport as momentumSupportState } from './director/momentum.js';
import { setMacroSupport, macroSupport as macroSupportState } from './director/macroEvents.js';
import { setMomentSupport, momentSupport as momentSupportState } from './director/moments.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const cfg = loadConfig();

/**
 * How far out still counts as the player's neighbourhood, in adjacency steps.
 *
 * Not a setting. The sphere's width is a judgement about what the Director
 * should watch and pay attention to; this is a claim about what it is entitled
 * to *act* on, and letting a player widen it would defeat the rule it exists to
 * support. Two steps is the old default sphere - the window everything before
 * v0.3 operated in.
 */
const NEIGHBOURHOOD_REACH = 2;

// Placed before anything is constructed, because the point is to prove the
// build is intact without touching a CK3 folder, writing a ledger, or opening a
// port. scripts/build-exe.mjs runs this against the .exe it has just produced:
// an executable whose assets failed to embed still starts and serves a blank
// sidebar, which is exactly the kind of failure that reaches a tester.
if (process.argv.includes('--selftest')) {
  const renderer = listAssets('src/renderer');
  const mod = listAssets('mod');
  const regions = supportedRegions();
  console.log(`runtime   : ${describeRuntime()}`);
  console.log(`sidebar   : ${renderer.length} files (${renderer.map((f) => f.split('/').pop()).join(', ')})`);
  console.log(`mod       : ${mod.length} files`);
  console.log(`regions   : ${regions.length} supported`);
  console.log(`toolkit   : ${Object.keys(TOOLKIT).length} actions (${Object.keys(TOOLKIT).join(', ')})`);
  console.log(`config    : reads from ${cfg.root}`);
  const missing = [];
  if (renderer.length < 3) missing.push('sidebar files');
  if (mod.length < 11) missing.push('companion mod files');
  if (regions.length < 20) missing.push('region catalogue');
  if (missing.length) {
    console.error(`\nINCOMPLETE BUILD: ${missing.join(', ')}`);
    process.exit(1);
  }
  console.log('\nself-test passed');
  process.exit(0);
}

const loreBook = new LoreBook(cfg.loreBookPath);
const baseline = new Baseline(cfg.baselinePath);
const auditClock = new AuditClock(cfg.auditClockPath);
const runFile = new RunFileManager(cfg.ck3UserFolder);
const tailer = new LogTailer(cfg.debugLogPath);

/**
 * How much of CK3's log budget this session has spent.
 *
 * The engine stops logging after roughly 17MB of cumulative writes and only
 * `log.clearAll` resets that; see bridge/LogBudget.js for why truncating the
 * file from outside does not work. The Director is a heavy writer, so this is
 * a wall a long campaign reaches rather than a theoretical one.
 */
const logBudget = new LogBudget({ thresholdMB: cfg.director.logClearThresholdMB });
const assembler = new SnapshotAssembler();
const llm = new LLMClient(cfg.llm);

/**
 * Everything the sidebar needs to render, and everything the loop needs to
 * decide what to do next.
 */
const state = {
  connected: false,
  date: null,
  year: 0,
  totalDays: 0,
  location: null,
  sphere: { regions: [], home: [], footprint: [], near: [], unsupported: [], note: '' },
  snapshot: null,
  /** @type {any[]} */
  proposals: [],
  /** @type {{token: number, proposal: any} | null} */
  awaitingApply: null,
  busy: false,
  // Restored from disk, so a restart does not reset the cadence to "never".
  lastAuditYear: auditClock.lastAuditYear,
  /**
   * True while the current request is a restart's one free look at the world
   * rather than an audit that is due. The snapshot still arrives and the
   * sidebar still fills; runAudit is what gets skipped, because that is the
   * part that costs money.
   */
  reorienting: false,
  /** Which request we are waiting on, so duplicate answers are ignored. */
  /** @type {'locate'|'snapshot'|null} */
  pending: null,
  /** When that request was staged, for working out whether the pump is dead. */
  pendingSince: 0,
  /**
   * When one of our records last arrived, as distinct from when the log last
   * grew at all. The difference between those two is what tells a dead pump
   * apart from a dead log subsystem; see bridge/Liveness.js.
   */
  lastRecordAt: 0,
  /** @type {{kind: string, text: string, detail: string} | null} */
  banner: null,
  /** Whether the deployed mod can service a log clear at all. */
  logClear: { ok: false, reason: 'not checked yet' },
  /** null until we have evidence either way. */
  /** @type {boolean|null} */
  pumpAlive: null,
  /** Set when the game declined to apply an approved action. */
  /** @type {string|null} */
  lastRefusal: null,
  /** The last Director event the game reported actually firing. */
  /** @type {{event: string, at: number}|null} */
  lastEventFired: null,
  /** What the last audit concluded, so the sidebar can say so without the Log tab. */
  /** @type {{date: string, outcome: string, rejected: string[], at: number}|null} */
  lastAudit: null,
  /** @type {string[]} */
  log: [],
};

function log(msg) {
  const line = `${new Date().toLocaleTimeString()}  ${msg}`;
  state.log.push(line);
  if (state.log.length > 300) state.log.shift();
  console.log(line);
  broadcast('log', line);
}

/** Whether this run has already taken its one free re-orientation snapshot. */
let reorientedThisRun = false;

const director = new Director({
  llm,
  loreBook,
  baseline,
  knowledge: cfg.knowledge,
  maxProposals: cfg.director.maxProposalsPerAudit,
  maxRealmsInPrompt: cfg.director.maxRealmsInPrompt,
  log,
});

// --------------------------------------------------------------------------
// Requests we make of the game. Both go out through the run file, which the
// mod's pump picks up within a couple of seconds.
// --------------------------------------------------------------------------

/**
 * Ask the game where the player is.
 *
 * The probe is composed here rather than by calling the mod's hd_locate_player,
 * so the side that knows which regions it can reason about is the side that
 * decides which get tested. Widening coverage then means editing regions.js,
 * with no mod change and no game restart.
 *
 * The every_player wrapper is load-bearing. capital_county needs a character
 * scope, and hd_probe_region tests it with ?=, so without the wrapper a missing
 * scope reports "no regions found" rather than failing loudly - which is
 * exactly how a campaign sitting in Rayy managed to report itself as nowhere.
 */
function requestLocate() {
  state.pending = 'locate';
  state.pendingSince = Date.now();
  const token = runFile.nextToken();
  // Two questions in one batch: which regions the capital sits in, tested
  // against everything the game defines, and which ones the realm holds land
  // in, tested only against what the Director can reason about. The second is
  // what lets an empire spanning three regions seed a sphere from all three.
  const supported = supportedRegions();
  runFile.write(locateScript(PROBE_REGIONS, supported), token);
  log(`asked the game where the player is (probing ${PROBE_REGIONS.length} regions, and the realm across ${supported.length})`);
}

/**
 * @param {string[]} regions the sphere
 * @param {string[]} homeRegions the player's own ground, swept first
 * @param {string[]} nearRegions the neighbourhood the locality rule acts on
 */
function requestSnapshot(regions, homeRegions, nearRegions) {
  if (regions.length === 0) {
    log('no supported regions in the sphere; nothing to snapshot');
    state.pending = null;
    return;
  }
  state.pendingSince = Date.now();
  const token = runFile.nextToken();
  runFile.write(snapshotScript(regions, token, homeRegions, nearRegions), token);
  log(`requested a snapshot of ${labelList(regions)}`);
}

// --------------------------------------------------------------------------
// The loop
// --------------------------------------------------------------------------

tailer.on('status', (m) => log(m));

tailer.on('cleared', ({ bytesBefore }) => {
  // Either a clear we asked for has landed or the player restarted the game.
  // Both mean the engine's cumulative write counter is back to zero, which is
  // the only thing the budget cares about.
  logBudget.confirmedClear();
  if (bytesBefore > 0) {
    log(`the game log was cleared after ${(bytesBefore / (1024 * 1024)).toFixed(1)}MB; CK3 can keep logging`);
  }
});

tailer.on('record', async (rec) => {
  state.lastRecordAt = Date.now();
  const out = assembler.ingest(rec);
  if (!out) return;

  if (!state.connected) {
    state.connected = true;
    log('the game is talking to us');
  }

  // Anything other than the yearly heartbeat had to come from a batch the pump
  // executed, so it is proof the pump is running.
  if (out.type !== 'date' && state.pumpAlive !== true) {
    state.pumpAlive = true;
    log('the execution pump is running');
    broadcast('state', publicState());
  }

  switch (out.type) {
    case 'date': {
      state.date = out.date;
      state.totalDays = out.totalDays;
      state.year = Number(String(out.date).match(/\d{3,4}/)?.[0]) || state.year;
      broadcast('state', publicState());

      // A save loaded earlier than the clock was written against is a
      // different campaign, and a cadence carried over from a future that no
      // longer exists would suppress audits for decades.
      if (auditClock.reconcile(state.totalDays)) {
        state.lastAuditYear = -Infinity;
        log('this campaign predates the recorded audit clock; starting the cadence again');
      }

      // `pending` matters as much as `busy`: a staged request that has not
      // been answered yet is an audit already in flight, and the cadence is no
      // longer advanced at request time, so nothing else would stop a second.
      if (!state.busy && !state.pending) {
        const due = state.year - state.lastAuditYear >= cfg.director.auditEveryYears;
        const nextDue = state.lastAuditYear + cfg.director.auditEveryYears;

        if (due) {
          state.reorienting = false;
          log(`${state.year}: audit due`);
          requestLocate();
        } else if (!reorientedThisRun) {
          // One free look per run. The orchestrator has just started and knows
          // nothing about the world; the snapshot costs nothing but a run-file
          // round trip, and without it the sidebar is blank and the toolkit has
          // no rulers to address until the next audit falls due.
          reorientedThisRun = true;
          state.reorienting = true;
          log(`${state.year}: re-orienting after a restart. Last audit ${state.lastAuditYear}, next due ${nextDue}; taking a snapshot without auditing`);
          requestLocate();
        }
      }
      break;
    }

    case 'location': {
      // The pump can execute a staged batch more than once before we manage to
      // clear the file, so the same answer can come back twice. Acting on the
      // second copy would mean a second snapshot and a second paid audit.
      if (state.pending !== 'locate') break;
      state.pending = 'snapshot';

      state.location = out.location;
      // Read from cfg on every audit rather than captured at startup, so a
      // reach changed in the sidebar applies to the very next look.
      state.sphere = seedSphere(out.location.regions, {
        reach: cfg.director.sphereReach,
        max: cfg.director.sphereMax,
        footprint: out.location.realmRegions ?? [],
      });
      log(`player located: ${out.location.title} at ${out.location.capital}. ${state.sphere.note}`);
      broadcast('state', publicState());
      runFile.clear();
      // The neighbourhood: the same seeds, grown at most two steps. At reach 2
      // or less this is the whole sphere and the locality rule is a no-op,
      // which is correct - a narrow sphere is all neighbourhood. At reach 4 it
      // is the difference between a war on your border and one in Bengal.
      state.sphere.near = seedSphere(out.location.regions, {
        reach: Math.min(NEIGHBOURHOOD_REACH, cfg.director.sphereReach),
        max: cfg.director.sphereMax,
        footprint: out.location.realmRegions ?? [],
      }).regions;

      // Home *and* footprint count as the player's own ground for the sweep:
      // both are regions they rule in, and both should lead the prompt table.
      requestSnapshot(
        state.sphere.regions,
        [...state.sphere.home, ...state.sphere.footprint],
        state.sphere.near,
      );
      break;
    }

    case 'snapshot': {
      if (state.pending !== 'snapshot') break;
      state.pending = null;
      runFile.clear();
      state.snapshot = out.snapshot;
      // Wars named in the activity log rather than only in the prompt. The
      // whole reason this exists is that the player could not see what the
      // Director was reacting to, and a count on its own would leave them with
      // the same question one step later.
      const wars = out.snapshot.wars ?? [];
      const naming = (id) => belligerentName(out.snapshot, id);
      const warNote = wars.length
        ? `; ${wars.length} war${wars.length === 1 ? '' : 's'} under way: ${wars.map((w) => `${naming(w.attacker)} -> ${naming(w.defender)}`).join(', ')}`
        : '';
      log(`snapshot received: ${out.snapshot.realms.length} realms in ${out.snapshot.date}${warNote}`);

      // The first snapshot of a campaign becomes the reference every later
      // audit measures drift against.
      // The sphere goes in with it: county counts are only comparable across
      // audits that looked through the same window or a wider one.
      const captured = baseline.offer(out.snapshot, state.sphere.regions);
      if (captured === 'captured') {
        log(`baseline captured at ${out.snapshot.date}: this is the map drift is measured from`);
      } else if (captured === 'recaptured') {
        log(`the game went backwards in time; baseline re-captured at ${out.snapshot.date}`);
      }
      broadcast('state', publicState());

      if (state.reorienting) {
        state.reorienting = false;
        log(`world state refreshed; next audit at ${state.lastAuditYear + cfg.director.auditEveryYears}. Use Audit now to override.`);
        break;
      }
      await runAudit();
      break;
    }

    case 'modVersion': {
      // The running game answering what it actually loaded. Only re-resolve when
      // it changes, so this costs one descriptor read per session rather than
      // one per batch.
      if (out.version === observedModVersion()) break;
      setObservedModVersion(out.version);
      log(`the running game reports companion mod v${out.version}`);
      checkModCapabilities();
      broadcast('state', publicState());
      break;
    }

    case 'logClearRequested':
      log(`the game acknowledged the log-clear request (slot ${out.slot})`);
      break;

    case 'eventFired':
      // Remembered so the applied line that follows can say whether the event
      // really fired. An event blocked by its own trigger does nothing at all,
      // and the batch would report success regardless.
      state.lastEventFired = { event: out.event, at: Date.now() };
      log(`the game fired ${out.event}`);
      break;

    case 'applied': {
      // Only the confirmation for the batch we are actually waiting on counts.
      if (!state.awaitingApply || String(state.awaitingApply.token) !== String(out.token)) break;

      if (out.action === 'trigger_event') {
        const fired = state.lastEventFired && Date.now() - state.lastEventFired.at < 30_000;
        log(fired
          ? `the game confirmed ${state.lastEventFired.event} reached the ruler`
          : 'the batch ran, but the event did not fire: its own trigger was not met, so nothing reached the ruler');
        state.lastEventFired = null;
      } else {
        log(`the game confirmed ${out.action} took effect`);
      }
      runFile.clear();
      state.awaitingApply = null;
      broadcast('state', publicState());
      break;
    }

    case 'refused': {
      if (!state.awaitingApply || String(state.awaitingApply.token) !== String(out.token)) break;
      // The approval stands in the ledger, but the world did not change, and
      // saying otherwise would be the one lie this whole design exists to avoid.
      log(`the game REFUSED ${out.action}: its precondition was false, so nothing changed`);
      log('  the character or title named in the proposal probably does not exist in this campaign');
      state.lastRefusal = `${out.action} could not be applied: ${out.reason}`;
      runFile.clear();
      state.awaitingApply = null;
      broadcast('state', publicState());
      break;
    }
  }
});

async function runAudit() {
  if (state.busy || !state.snapshot) return;
  state.busy = true;

  // Recorded here rather than when the request was staged, so the cadence
  // tracks audits that were actually attempted. Recorded before the API key
  // check rather than after success, because a key that is missing or a
  // provider that is down would otherwise retry on every heartbeat.
  state.lastAuditYear = state.snapshot.year || state.year;
  auditClock.record(state.lastAuditYear, state.snapshot.totalDays || state.totalDays);

  broadcast('state', publicState());

  try {
    // The live client again, not the startup config: a key pasted into the
    // settings panel should let the very next audit run, without a restart.
    if (!llm.apiKey) {
      log(`no API key set, so no audit. Set ${cfg.llm.apiKeyEnv ?? 'HD_API_KEY'} in your environment, or paste one into the sidebar's Settings tab.`);
      return;
    }
    const result = await director.audit(state.snapshot, state.sphere.regions);
    state.proposals = result.proposals;

    if (result.rejected.length) {
      log(`${result.rejected.length} proposal(s) failed validation and were dropped`);
      for (const r of result.rejected) log(`  dropped: ${r}`);
    }
    log(result.proposals.length
      ? `the Director has ${result.proposals.length} proposal(s) for your judgement`
      : 'the Director finds this world on track; nothing proposed');

    state.lastAudit = {
      date: state.snapshot?.date ?? '',
      outcome: result.proposals.length
        ? `${result.proposals.length} proposal(s)`
        : 'nothing to propose',
      rejected: result.rejected,
      at: Date.now(),
    };

    broadcast('proposals', { proposals: state.proposals, assessment: result.note });
  } catch (err) {
    log(`audit failed: ${err?.message ?? err}`);
  } finally {
    state.busy = false;
    broadcast('state', publicState());
  }
}

// --------------------------------------------------------------------------
// The player's verdict
// --------------------------------------------------------------------------

/** @param {string} id */
function findProposal(id) {
  return state.proposals.find((p) => p.id === id);
}

function approve({ id }) {
  const p = findProposal(id);
  if (!p) return { error: 'no such proposal' };

  const action = TOOLKIT[p.action];
  if (!action) return { error: `toolkit no longer has ${p.action}` };

  const token = runFile.nextToken();
  runFile.write(actionScript(action.toScript(p.args, token, state.snapshot)), token);
  state.awaitingApply = { token, proposal: p };

  loreBook.record({
    date: p.date, year: p.year, verdict: 'approved', action: p.action,
    // The arguments, not only the sentence. Names in the summary cannot identify
    // a character across a reign - CK3 renders nicknames into them and those
    // change - so the ledger stores the ids the proposal actually used.
    args: p.args,
    summary: p.preview, rationale: p.divergence, sources: p.sources,
    // The card's prose, kept with the verdict. It is the readable half of what
    // the player was looking at when they decided, and the ledger is thin
    // without it.
    narrative: p.narrative ?? '',
  });

  state.proposals = state.proposals.filter((x) => x.id !== id);
  log(`approved: ${p.preview}`);
  broadcast('state', publicState());
  broadcast('proposals', { proposals: state.proposals });
  return { ok: true };
}

function decline({ id }) {
  const p = findProposal(id);
  if (!p) return { error: 'no such proposal' };

  loreBook.record({
    date: p.date, year: p.year, verdict: 'declined', action: p.action,
    // The arguments, not only the sentence. Names in the summary cannot identify
    // a character across a reign - CK3 renders nicknames into them and those
    // change - so the ledger stores the ids the proposal actually used.
    args: p.args,
    summary: p.preview, rationale: p.divergence, sources: p.sources,
    narrative: p.narrative ?? '',
  });

  state.proposals = state.proposals.filter((x) => x.id !== id);
  log(`declined: ${p.preview}`);
  broadcast('proposals', { proposals: state.proposals });
  return { ok: true };
}

/** What the sidebar needs to warn about a stale mod. */
function momentumState() {
  const m = momentumSupportState();
  return { ok: m.ok, version: m.version, reason: m.reason, checked: m.checked };
}

function macroState() {
  const m = macroSupportState();
  return { ok: m.ok, version: m.version, reason: m.reason, checked: m.checked };
}

function momentState() {
  const m = momentSupportState();
  return { ok: m.ok, version: m.version, reason: m.reason, checked: m.checked };
}

function publicState() {
  return {
    connected: state.connected,
    busy: state.busy,
    date: state.date,
    year: state.year,
    location: state.location,
    sphere: {
      ...state.sphere,
      labels: state.sphere.regions.map(label),
    },
    realmCount: state.snapshot?.realms.length ?? 0,
    player: state.snapshot?.player ?? null,
    awaitingApply: state.awaitingApply ? state.awaitingApply.proposal.preview : null,
    pumpAlive: state.pumpAlive,
    banner: state.banner,
    log: {
      // Shown so a long campaign can see the wall coming rather than meet it.
      mbSinceClear: Number((tailer.bytesSinceClear / (1024 * 1024)).toFixed(2)),
      thresholdMB: Number((logBudget.thresholdBytes / (1024 * 1024)).toFixed(2)),
      clears: logBudget.confirmed,
      supported: state.logClear.ok,
    },
    lastRefusal: state.lastRefusal ?? null,
    lastAudit: state.lastAudit,
    config: {
      // Read from the live client, not the loaded config: these can be changed
      // from the settings panel, and the World tab would otherwise go on
      // reporting whatever was in config.json at startup.
      model: llm.model,
      baseUrl: llm.baseUrl,
      hasKey: Boolean(llm.apiKey),
      auditEveryYears: cfg.director.auditEveryYears,
      sphereReach: cfg.director.sphereReach,
      momentum: momentumState(),
      macro: macroState(),
      moment: momentState(),
      sphereMax: cfg.director.sphereMax,
      maxRealmsInPrompt: cfg.director.maxRealmsInPrompt,
      knowledge: cfg.knowledge.enabled,
    },
  };
}

// --------------------------------------------------------------------------
// Wire up
// --------------------------------------------------------------------------

// Provider and model can be changed from the sidebar. The handlers mutate this
// LLMClient in place, so the Director keeps the instance it was given.
const llmSettings = createSettingsHandlers(llm, cfg);

// How the Director watches, as opposed to what it reasons with. Mutates
// cfg.director in place, which is the object the loop above already reads on
// every pass, so a cadence changed mid-campaign applies to the next audit.
const directorSettings = createDirectorSettings(cfg, director);

const { server, broadcast } = createServer({
  state: () => ({ state: publicState(), proposals: state.proposals, log: state.log }),
  lorebook: () => ({ entries: loreBook.all() }),
  approve,
  decline,
  audit: async () => {
    // An explicit request always audits, whatever the clock says. It is the
    // override for a cadence the player has decided is too slow, and for the
    // re-orientation snapshot they would rather have been an audit.
    state.reorienting = false;
    requestLocate();
    return { ok: true };
  },
  settings: (body) => {
    const result = llmSettings.settings(body);
    if (result.updated?.length) {
      log(`settings changed: ${result.updated.join(', ')} (model ${result.model} at ${result.baseUrl})`);
      broadcast('state', publicState());
    }
    return result;
  },
  testConnection: () => llmSettings.testConnection(),
  director: (body) => {
    const result = directorSettings.director(body);
    if (result.updated?.length) {
      log(`director settings changed: ${result.updated.join(', ')} (audit every ${result.auditEveryYears}y, sphere reach ${result.sphereReach} capped at ${result.sphereMax} regions)`);
      broadcast('state', publicState());
    }
    return result;
  },
  ping: () => ({ ok: true }),
});

// A staged request that goes unanswered for this long means the pump is not
// running. Wall-clock rather than game time on purpose: a paused game still
// has a live pump, and a fast-forwarded one is not more broken than a slow one.
const PUMP_TIMEOUT_MS = 25_000;

setInterval(() => {
  if (!state.pending) return;
  if (Date.now() - state.pendingSince < PUMP_TIMEOUT_MS) return;
  if (state.pumpAlive === false) return;

  state.pumpAlive = false;
  log('no answer from the game: the execution pump does not seem to be running');
  broadcast('state', publicState());
}, 5_000);


// --------------------------------------------------------------------------
// Keeping the bridge alive
// --------------------------------------------------------------------------

/**
 * Is the run file holding something we are still waiting on an answer for?
 *
 * Two separate things make this true and both matter. `pending` is a locate
 * or snapshot request; `awaitingApply` is an approved action. Either way the
 * staged file is not ours to overwrite - and a log clear would do exactly
 * that, because there is only one run file and one pump reading it.
 *
 * The second reason is subtler and worse. `log.clearAll` destroys the echo an
 * in-flight batch is about to write, so the orchestrator would wait out the
 * acknowledgment timeout and report a dead pump for a batch that ran
 * perfectly. Waiting costs bytes. Clearing costs the truth.
 */
function ackPending() {
  return state.pending !== null || state.awaitingApply !== null;
}

/**
 * Ask the game to clear its own log, if it is time and nothing is in flight.
 *
 * The request is a global variable the mod's widget is watching; see
 * bridge/LogBudget.js for why it cannot simply be done here. The run file is
 * cleared straight afterwards rather than left standing, because the pump
 * re-runs whatever it finds every two seconds and a standing request would
 * clear the log on every pass until something else overwrote it.
 */
function maybeRequestLogClear() {
  const verdict = logBudget.due({
    bytesSinceClear: tailer.bytesSinceClear,
    pendingAck: ackPending(),
    supported: state.logClear.ok,
  });
  if (!verdict.due) return;

  const slot = logBudget.staged();
  const token = runFile.nextToken();
  runFile.write(LogBudget.requestScript(slot), token);
  log(
    `asked the game to clear its log (slot ${slot}, ${(tailer.bytesSinceClear / (1024 * 1024)).toFixed(1)}MB read since the last one). ` +
    'CK3 stops logging after about 17MB in a session and only an in-game clear resets that.',
  );

  // Retired immediately. The batch is one-shot by its token guard anyway, but
  // leaving it staged would block the next snapshot request behind it.
  setTimeout(() => {
    if (!ackPending()) runFile.clear();
  }, 3_000);
}

/**
 * Work out whether the bridge has gone quiet, and if so, in which of the two
 * ways it can. See bridge/Liveness.js: they need opposite responses from the
 * player, so a wrong guess sends them to fix the wrong thing.
 */
function checkLiveness() {
  const banner = assessLiveness({
    now: Date.now(),
    everResponded: state.connected,
    lastLineAt: tailer.lastLineAt,
    lastRecordAt: state.lastRecordAt,
    pendingSince: state.pending || state.awaitingApply ? state.pendingSince : null,
    bytesSinceClear: tailer.bytesSinceClear,
    thresholdBytes: logBudget.thresholdBytes,
    stallMs: (cfg.director.stallMinutes ?? 2) * 60_000,
    ackMs: (cfg.director.ackTimeoutSeconds ?? 15) * 1000,
  });

  // Only announced on the way in and the way out, because this runs every
  // five seconds and a banner that re-logged itself would bury the campaign.
  const was = state.banner?.kind ?? null;
  const now = banner?.kind ?? null;
  if (was === now) return;

  state.banner = banner;
  if (banner) log(`${banner.text} ${banner.detail}`);
  else log('the game is talking to us again');
  broadcast('state', publicState());
}

setInterval(() => {
  maybeRequestLogClear();
  checkLiveness();
}, 5_000);

// --------------------------------------------------------------------------
// Starting up
// --------------------------------------------------------------------------

/**
 * Ask the deployed mod what it can execute, and tell the toolkit.
 *
 * Called at startup and again after any deploy. The orchestrator and the mod
 * are versioned and deployed separately, and momentum is the one thing that
 * needs them to agree: it applies a character modifier the mod has to define.
 * Without this the sidebar would describe effects a stale mod cannot land, and
 * the applied record would still say ok.
 */
function checkModCapabilities() {
  const mom = resolveMomentumSupport(cfg.ck3UserFolder);
  setMomentumSupport(mom);

  // Asked separately because the two features arrived in different mod
  // versions, and a single "is the mod new enough" answer is exactly what let
  // macro events ship ungated behind momentum's older threshold.
  const macro = resolveMacroSupport(cfg.ck3UserFolder);
  setMacroSupport(macro);

  const moment = resolveMomentSupport(cfg.ck3UserFolder);
  setMomentSupport(moment);

  // Not handed to a module the way the others are: nothing in the toolkit
  // depends on it, because clearing the log is maintenance and never touches
  // game state. It only decides whether asking is worth doing.
  state.logClear = resolveLogClearSupport(cfg.ck3UserFolder);

  const version = mom.version ?? macro.version ?? moment.version;
  if (mom.ok && macro.ok && moment.ok) {
    log(`companion mod v${version} deployed; momentum, macro events and the moment library available`);
  } else {
    if (version) log(`companion mod v${version} deployed`);
    if (!mom.ok) log(`momentum unavailable: ${mom.reason}`);
    if (!macro.ok) log(`macro events unavailable: ${macro.reason}`);
    if (!moment.ok) log(`historical moments unavailable: ${moment.reason}`);
    if (!state.logClear.ok) log(`log clearing unavailable: ${state.logClear.reason}. CK3 stops logging after about 17MB in a session; a long campaign will need a restart.`);
  }
  return { momentum: mom, macro, moment };
}

/**
 * What the executable does that `npm start` does not.
 *
 * Someone running from a checkout has already cloned a repo and read a README,
 * so they can be asked to run `npm run deploy:mod` themselves. Someone who
 * downloaded one file has not agreed to any of that, and every step between
 * double-clicking it and seeing a proposal is a step they can get wrong. So the
 * executable deploys the mod itself, checks its own environment, and opens the
 * sidebar.
 *
 * The mod is redeployed on every start rather than only when missing. It is
 * eleven small files, and the failure it prevents is the nasty one: a mod left
 * over from an older build whose scripted effects no longer match what this
 * orchestrator sends, which fails as a wrong answer rather than a missing one.
 */
function packagedSetup() {
  // Written out on first run so a tester has something to edit. loadConfig
  // falls back to sane defaults without it, but "edit config.json" is only
  // useful advice when the file exists.
  const configPath = path.join(cfg.root, 'config.json');
  if (!fs.existsSync(configPath)) {
    const starter = {
      ck3UserFolder: cfg.ck3UserFolder.split(path.sep).join('/'),
      port: cfg.port,
      llm: { baseUrl: cfg.llm.baseUrl, model: cfg.llm.model, apiKeyEnv: cfg.llm.apiKeyEnv, temperature: cfg.llm.temperature, maxTokens: cfg.llm.maxTokens },
      director: { ...cfg.director },
      knowledge: { ...cfg.knowledge },
    };
    try {
      fs.writeFileSync(configPath, JSON.stringify(starter, null, 2), 'utf8');
      log(`wrote a starting config.json beside the executable`);
    } catch (err) {
      log(`could not write config.json: ${err?.message ?? err}`);
    }
  }

  const result = deployMod(cfg.ck3UserFolder);
  if (result.ok) {
    log(`companion mod deployed: ${result.files} files to ${result.dest}`);
  } else {
    log(`could not deploy the companion mod: ${result.error}`);
  }

  // After deploying, not before: the deploy is what may have just made
  // momentum available.
  checkModCapabilities();

  const findings = preflight(cfg);
  const problems = findings.filter((f) => !f.ok);
  if (problems.length === 0) {
    log('preflight: all clear');
  } else {
    // Reported, not enforced. A tester who has not started CK3 yet fails two of
    // these, and refusing to run would be the wrong answer to "not yet".
    log(`preflight: ${problems.length} thing(s) not ready yet`);
    for (const p of problems) log(`  - ${p.label}: ${p.detail}`);
  }
}

/** Open the sidebar in whatever the system considers the browser. */
function openSidebar(url) {
  try {
    const [cmd, args] = process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // Not worth a word: the URL is printed either way, and a headless machine
    // failing to open a browser is not a problem with the Director.
  }
}

server.on('error', (err) => {
  if (err?.code === 'EADDRINUSE') {
    console.error(`\n  Port ${cfg.port} is already in use.`);
    console.error('  Another copy of the Historical Director is probably running.');
    console.error(`  Close it, or change "port" in ${cfg.root}\\config.json.\n`);
  } else {
    console.error(`\n  Could not start: ${err?.message ?? err}\n`);
  }
  // A double-clicked executable closes its window the instant it exits, taking
  // the only explanation with it.
  holdOpen(() => process.exit(1));
});

/** @param {() => void} then */
function holdOpen(then) {
  if (!isPackaged() || !process.stdin.isTTY) return then();
  console.error('  Press Enter to close.');
  process.stdin.resume();
  process.stdin.once('data', then);
}

server.listen(cfg.port, '127.0.0.1', () => {
  console.log('');
  console.log('  The Historical Director');
  console.log('  ' + '-'.repeat(46));
  console.log(describeConfig(cfg).split('\n').map((l) => '  ' + l).join('\n'));
  console.log(`  runtime    : ${describeRuntime()}`);
  console.log('  ' + '-'.repeat(46));
  console.log(`  sidebar: http://127.0.0.1:${cfg.port}`);
  console.log('');
  // Stage the liveness marker straight away, so a pump that is already running
  // starts reporting before we have anything to ask of it.
  runFile.clear();
  tailer.start();
  log('watching for the game');

  // Packaged runs check this inside packagedSetup, after deploying. A source
  // run deploys nothing, so it has to ask here.
  if (!isPackaged()) checkModCapabilities();

  if (isPackaged()) {
    packagedSetup();
    if (!process.argv.includes('--no-browser')) openSidebar(`http://127.0.0.1:${cfg.port}`);
  }
});

process.on('SIGINT', () => {
  tailer.stop();
  runFile.clear();
  server.close();
  process.exit(0);
});
