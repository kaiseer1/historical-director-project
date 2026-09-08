/**
 * Verification for the engine-resilience work.
 *
 * The three things here all defend against engine behaviour that cannot be
 * prevented, only survived: CK3's log subsystem dying at ~17MB of cumulative
 * writes, fullscreen event windows killing the execution pump, and a run-file
 * request that is never picked up because the pump was already dead.
 *
 * The 17MB limit, the uselessness of external truncation, and log.clearAll as
 * the only remedy are the VOTC project's findings, measured under controlled
 * experiment; see issue #1 on this repository.
 *
 *   node scripts/check-resilience.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LogTailer } from '../src/bridge/LogTailer.js';
import { LogBudget, CLEAR_SLOTS } from '../src/bridge/LogBudget.js';
import { assess } from '../src/bridge/Liveness.js';
import { SnapshotAssembler } from '../src/model/WorldState.js';
import { parseLine } from '../src/bridge/protocol.js';

let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (detail) console.log(`      ${detail}`);
}

const MB = 1024 * 1024;

console.log('\nHistorical Director - engine resilience\n');

// --- the budget --------------------------------------------------------------

{
  const b = new LogBudget({ thresholdMB: 4 });
  check(
    'B1. under the threshold, nothing is asked for',
    b.due({ bytesSinceClear: 3 * MB, pendingAck: false, supported: true }).due === false,
    '3MB of a 4MB budget',
  );
}

{
  const b = new LogBudget({ thresholdMB: 4 });
  const v = b.due({ bytesSinceClear: 5 * MB, pendingAck: false, supported: true });
  check(
    'B2. over it, a clear is due and names a slot',
    v.due === true && CLEAR_SLOTS.includes(v.slot),
    v.due ? `slot ${v.slot}` : v.reason,
  );
}

{
  // The rule that matters most. A clear is a console command run by the same
  // widget that runs the staged batch, and clearing the log destroys the echo
  // that batch is about to write - so the orchestrator would wait out the
  // acknowledgment timeout and report a dead pump for a batch that ran.
  const b = new LogBudget({ thresholdMB: 4 });
  const v = b.due({ bytesSinceClear: 50 * MB, pendingAck: true, supported: true });
  check(
    'B3. never while a staged batch is still waiting to be acknowledged',
    v.due === false && /acknowledged/.test(v.reason),
    v.due ? 'CLEARED over an in-flight batch' : v.reason,
  );
}

{
  // An older mod takes the request as a global variable nothing reads: no
  // error, no clear, and a budget that never resets - so the orchestrator
  // would ask on every tick for ever and still hit the wall.
  const b = new LogBudget({ thresholdMB: 4 });
  const v = b.due({ bytesSinceClear: 50 * MB, pendingAck: false, supported: false });
  check(
    'B4. and never at a mod that cannot service one',
    v.due === false && /cannot service/.test(v.reason),
    v.reason,
  );
}

{
  // A clear takes a moment to land and the tailer only learns of it on its
  // next poll, so without a gap the same overage would burn the whole rotation
  // in two seconds.
  const b = new LogBudget({ thresholdMB: 4 });
  const now = Date.now();
  b.staged(now);
  const v = b.due({ bytesSinceClear: 50 * MB, pendingAck: false, supported: true, now: now + 1000 });
  check(
    'B5. and not twice in the same breath',
    v.due === false && /moments ago/.test(v.reason),
    v.reason,
  );
}

{
  const b = new LogBudget({ thresholdMB: 4 });
  const seen = [b.staged(0), b.staged(0), b.staged(0), b.staged(0), b.staged(0)];
  check(
    'B6. slots rotate and come back round',
    seen.slice(0, 4).join('') === CLEAR_SLOTS.join('') && seen[4] === CLEAR_SLOTS[0],
    seen.join(' -> '),
  );
}

{
  // The request retires the previous slot as well as setting its own. Without
  // that, a slot left set by a dead widget would never present a fresh
  // false-to-true edge when its turn came round again, and the fifth clear of
  // a session would silently do nothing.
  const script = LogBudget.requestScript('b').join('\n');
  check(
    'B7. a request sets its own slot and retires the one before it',
    /set_global_variable = \{ name = hd_log_clear_b value = 1 \}/.test(script)
      && /remove_global_variable = hd_log_clear_a/.test(script)
      && /has_global_variable = hd_log_clear_a/.test(script),
    'and the removal is guarded, so it is safe when the widget already did it',
  );
}

{
  const script = LogBudget.requestScript('a').join('\n');
  check(
    'B8. the rotation wraps backwards too',
    /remove_global_variable = hd_log_clear_d/.test(script),
    'slot a retires slot d',
  );
}

// --- the tailer --------------------------------------------------------------

/** A tailer over a scratch file, polled by hand rather than on a timer. */
function scratchTailer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-tail-'));
  const file = path.join(dir, 'debug.log');
  fs.writeFileSync(file, '');
  const t = new LogTailer(file);
  t.offset = 0;
  return { t, file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

{
  const { t, file, cleanup } = scratchTailer();
  const seen = [];
  t.on('record', (r) => seen.push(r.kind));
  fs.appendFileSync(file, '[00:00:00][effect.cpp:1]: HD:/;/date/;/1200.1.1/;/438000\n');
  t.poll();
  check(
    'T1. the tailer counts the bytes it reads, not just the records',
    seen.length === 1 && t.bytesSinceClear > 0 && t.bytesSinceClear === t.bytesTotal,
    `${t.bytesSinceClear} bytes, ${seen.length} record`,
  );
  cleanup();
}

{
  // The whole point of the chain. log.clearAll truncates the file under us; the
  // tailer must rewind rather than sit at an offset the file will now never
  // reach again, and the budget must reset because the engine's own counter did.
  const { t, file, cleanup } = scratchTailer();
  const status = [];
  const cleared = [];
  t.on('status', (m) => status.push(m));
  t.on('cleared', (e) => cleared.push(e));

  fs.appendFileSync(file, 'x'.repeat(5000) + '\n');
  t.poll();
  const before = t.bytesSinceClear;

  fs.writeFileSync(file, '');
  fs.appendFileSync(file, '[00:00:00][effect.cpp:1]: HD:/;/date/;/1201.1.1/;/438365\n');
  const after = [];
  t.on('record', (r) => after.push(r.kind));
  t.poll();

  check(
    'T2. a cleared log rewinds the tailer and resets the budget',
    t.offset < before && after.length === 1 && cleared.length === 1
      && cleared[0].bytesBefore === before
      && status.some((m) => /log cleared by engine, resetting tailer/.test(m)),
    `read ${before}B, then cleared; now at ${t.bytesSinceClear}B and still parsing`,
  );
  cleanup();
}

{
  // Total is the honest number for the session and must not reset with the
  // budget, or a long campaign would have no way to know how much it had cost.
  const { t, file, cleanup } = scratchTailer();
  fs.appendFileSync(file, 'y'.repeat(3000) + '\n');
  t.poll();
  fs.writeFileSync(file, '');
  fs.appendFileSync(file, 'z'.repeat(1000) + '\n');
  t.poll();
  check(
    'T3. the session total keeps counting across a clear',
    t.bytesTotal > t.bytesSinceClear && t.clears === 1,
    `${t.bytesTotal}B total, ${t.bytesSinceClear}B since the clear`,
  );
  cleanup();
}

// --- telling the two silences apart -----------------------------------------

const base = {
  now: 1_000_000,
  everResponded: true,
  lastLineAt: 1_000_000,
  lastRecordAt: 1_000_000,
  pendingSince: null,
  bytesSinceClear: 1 * MB,
  thresholdBytes: 4 * MB,
};

{
  check(
    'L1. a healthy bridge says nothing',
    assess(base) === null,
    'no banner',
  );
}

{
  // Never heard from at all is a different problem with its own message, and
  // saying both would read as two faults.
  check(
    'L2. and neither does one that has never spoken',
    assess({ ...base, everResponded: false, lastLineAt: 0, lastRecordAt: 0 }) === null,
    'startup already covers this',
  );
}

{
  // The game is still writing - its own chatter, other mods - so the log
  // subsystem is alive and the silence is ours.
  const r = assess({ ...base, lastRecordAt: base.now - 200_000 });
  check(
    'L3. our records stopping while the log still grows is a dead pump',
    r?.kind === 'pump_dead' && /Recall decision/.test(r.text),
    r ? r.text : 'no banner',
  );
}

{
  const r = assess({ ...base, pendingSince: base.now - 20_000 });
  check(
    'L4. so is a staged batch nobody picked up',
    r?.kind === 'pump_dead' && /not picked up/.test(r.text),
    r ? r.detail.slice(0, 90) : 'no banner',
  );
}

{
  // The ordering that matters. When the log is exhausted every pump symptom is
  // present too, because the echo cannot reach us either - so diagnosing a
  // dead pump would send the player to fix a thing that is not broken, with a
  // tool that cannot work.
  const r = assess({
    ...base,
    lastLineAt: base.now - 200_000,
    lastRecordAt: base.now - 200_000,
    pendingSince: base.now - 200_000,
  });
  check(
    'L5. nothing at all in the log outranks it, and says restart instead',
    r?.kind === 'log_exhausted' && /Restart CK3/.test(r.text) && !/Recall/.test(r.text),
    r ? r.text : 'no banner',
  );
}

{
  // Corroboration, not diagnosis: the megabytes read say whether this is the
  // wall or merely a silence.
  const r = assess({
    ...base,
    lastLineAt: base.now - 200_000,
    lastRecordAt: base.now - 200_000,
    bytesSinceClear: 6 * MB,
  });
  check(
    'L6. and names the wall when the byte count corroborates it',
    r?.kind === 'log_exhausted' && /17MB/.test(r.detail) && /6\.0MB/.test(r.detail),
    r ? r.detail.slice(0, 110) : 'no banner',
  );
}

{
  const r = assess({ ...base, pendingSince: base.now - 5_000 });
  check(
    'L7. a batch staged five seconds ago is not yet a problem',
    r === null,
    'the default patience is 15s',
  );
}

// --- the echo ----------------------------------------------------------------

{
  const a = new SnapshotAssembler();
  const rec = parseLine('[00:00:00][effect.cpp:1]: HD:/;/log_clear_requested/;/c');
  const out = a.ingest(rec);
  check(
    'E1. the clear request echoes back through the wire',
    out?.type === 'logClearRequested' && out.slot === 'c',
    JSON.stringify(out),
  );
}

// --- what the mod actually ships --------------------------------------------
//
// These read the mod files rather than mocking them, because the failure they
// guard against is a slot the orchestrator asks for and the mod has no
// definition of - which fails silently, as a clear that never happens.

// fileURLToPath rather than URL.pathname: the latter percent-encodes, and this
// repository lives in a directory with a space in its name.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

{
  const sgui = read('mod/common/scripted_guis/hd_scripted_guis.txt');
  const missing = CLEAR_SLOTS.filter((slot) => !new RegExp(`hd_log_clear_${slot} = \\{`).test(sgui));
  check(
    'M1. every slot the orchestrator can ask for has a scripted GUI',
    missing.length === 0,
    missing.length ? `missing: ${missing.join(', ')}` : `${CLEAR_SLOTS.length} slots defined`,
  );
}

{
  const sgui = read('mod/common/scripted_guis/hd_scripted_guis.txt');
  const guarded = CLEAR_SLOTS.every((slot) =>
    new RegExp(`is_shown = \\{ has_global_variable = hd_log_clear_${slot} \\}`).test(sgui)
    && new RegExp(`effect = \\{ remove_global_variable = hd_log_clear_${slot} \\}`).test(sgui));
  check(
    'M2. each reads its own slot and retires its own slot',
    guarded,
    'a crossed pair would clear on one request and never stop',
  );
}

{
  const gui = read('mod/gui/custom_gui/hd_runner.gui');
  const wired = CLEAR_SLOTS.every((slot) =>
    new RegExp(`GetScriptedGui\\('hd_log_clear_${slot}'\\).IsShown`).test(gui)
    && new RegExp(`GetScriptedGui\\('hd_log_clear_${slot}'\\).Execute`).test(gui));
  check(
    'M3. and a widget slot watching it that clears the log',
    wired && /ExecuteConsoleCommand\('log\.clearAll'\)/.test(gui),
    'script cannot run a console command; only a widget can',
  );
}

{
  // Sibling states under one widget are mutually exclusive state machines in
  // this engine and an extra one can starve the others. VOTC lost two
  // implementations to that rule, so the slots get one state each.
  const gui = read('mod/gui/custom_gui/hd_runner.gui');
  const slotBlocks = gui.split(/hbox = \{/).filter((b) => /hd_log_clear_/.test(b));
  const singleState = slotBlocks.every((b) => (b.match(/\n\t\tstate = \{/g) ?? []).length === 1);
  check(
    'M4. no slot stacks a second state on one widget',
    slotBlocks.length === CLEAR_SLOTS.length && singleState,
    `${slotBlocks.length} slot widgets, one state apiece`,
  );
}

{
  // The pump dies to fullscreen event windows and cannot be stopped from
  // dying. What can be done is putting resurrection points where it may just
  // have been killed - which is every window this mod opens.
  const events = read('mod/events/hd_events.txt');
  const mounts = (events.match(/gui = "hd_rearm_widget"/g) ?? []).length;
  const pause = read('mod/gui/event_window_widgets/hd_pause_widget.gui');
  check(
    'M5. there are at least two re-arm mounts beyond the bootstrap',
    mounts >= 2 && /gui\.createwidget gui\/custom_gui\/hd_runner\.gui hd_runner/.test(pause),
    `${mounts} event windows carry the re-arm widget, plus the proposal notification`,
  );
}

{
  const rearm = read('mod/gui/event_window_widgets/hd_rearm_widget.gui');
  check(
    'M6. a re-arm clears before it creates, so a live pump is not doubled',
    /ClearWidgets hd_runner/.test(rearm)
      && rearm.indexOf('ClearWidgets') < rearm.indexOf('createwidget'),
    'console commands run serially, so duplicates converge back to one',
  );
}

{
  const onActions = read('mod/common/on_action/hd_on_actions.txt');
  check(
    'M7. the watchdog runs on a hook the engine actually calls',
    /quarterly_playable_pulse = \{/.test(onActions) && !/monthly_global_pulse/.test(onActions),
    'there is no monthly global pulse; yearly_global_pulse is the only global one',
  );
}

{
  // It fires for every playable character on the map, which is hundreds.
  const onActions = read('mod/common/on_action/hd_on_actions.txt');
  const block = onActions.slice(onActions.indexOf('hd_watchdog_on_action'));
  check(
    'M8. and does no work for the four hundred rulers who are not the player',
    /limit = \{ is_ai = no \}/.test(block),
    'gated to the player',
  );
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
