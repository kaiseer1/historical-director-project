/**
 * Read the coalition probe set out of debug.log and say what each one answered.
 *
 * Same tail-the-end approach read-probe2.mjs uses, for the same reason: the log
 * is cleared repeatedly during a session and the interesting lines are always
 * the recent ones.
 *
 * The one rule this file tries to hold to is the one from issue #1 section 5 -
 * zero errors does not mean nothing failed. Every probe below has an explicit
 * "no output" branch that says what that means, because a probe that silently
 * reports nothing is indistinguishable from a probe that ran and found nothing,
 * and those are opposite conclusions.
 *
 *   node scripts/read-probes.mjs
 */
import fs from 'node:fs';
import { loadConfig } from '../src/config.js';

const cfg = loadConfig();

if (!fs.existsSync(cfg.debugLogPath)) {
  console.log(`\nNo debug.log at ${cfg.debugLogPath}`);
  console.log('Has CK3 run from this user folder, with -debug_mode?\n');
  process.exit(1);
}

const size = fs.statSync(cfg.debugLogPath).size;
const fd = fs.openSync(cfg.debugLogPath, 'r');
const span = Math.min(size, 4_000_000);
const buf = Buffer.allocUnsafe(span);
fs.readSync(fd, buf, 0, span, size - span);
fs.closeSync(fd);

const lines = buf.toString('utf8').split(/\r?\n/);

/** @param {string} tag */
function records(tag) {
  return lines
    .filter((l) => l.includes(`HD:/;/${tag}/;/`))
    .map((l) => l.slice(l.indexOf(`HD:/;/${tag}/;/`) + tag.length + 7).split('/;/'));
}

const bar = (s) => `\n${'='.repeat(74)}\n${s}\n${'='.repeat(74)}`;

// --------------------------------------------------------------------------
// P1 - peace
// --------------------------------------------------------------------------
console.log(bar('P1  Does the AI white-peace out of a war it cannot win?'));

const peace = records('probe_peace');
if (peace.length === 0) {
  console.log('\n  No output. Either hd_probe_peace.txt has not been run, or the filename');
  console.log('  did not exist when CK3 launched and run silently ignored it (issue #1');
  console.log('  section 8). Check the console echo for "Running console command: run".\n');
} else {
  const start = peace.filter((r) => r[0] === 'start');
  const refused = peace.filter((r) => r[0] === 'refused');
  const alive = peace.filter((r) => r[0] === 'alive');
  const gone = peace.filter((r) => r[0] === 'gone');

  if (refused.length && !start.length) {
    console.log('\n  The war was never declared: preconditions failed.');
    console.log('  Attacker not independent, already at war, or a title did not resolve.');
    console.log('  Pick a different pair with --attacker / --anchor and run it again.\n');
  } else {
    if (start.length) console.log(`\n  War declared ${start[0][1] ?? ''}`);
    console.log(`  ${alive.length} reading(s) with the war alive, ${gone.length} with it gone\n`);

    // The timeline is the finding. A single reading answers nothing.
    const timeline = peace
      .filter((r) => r[0] === 'alive' || r[0] === 'gone')
      .map((r) => `    ${String(r[1] ?? '').padEnd(14)}  ${r[0] === 'alive' ? 'alive' : 'GONE '}  ${r[3] ?? ''}`);
    for (const t of timeline.slice(-14)) console.log(t);

    console.log('');
    if (gone.length === 0 && alive.length >= 2) {
      console.log('  VERDICT SO FAR: the war is holding across readings. Keep going -');
      console.log('  the question is months, not minutes. Two readings a year apart is');
      console.log('  the evidence; two readings a minute apart is not.');
    } else if (gone.length) {
      console.log('  VERDICT: the war ended. Now establish WHICH ending it was, because');
      console.log('  they mean opposite things:');
      console.log('');
      console.log('    - attacker won, title transferred      -> the design works');
      console.log('    - white peace, nothing changed hands   -> the AI bailed, and the');
      console.log('      coalition design needs a way to stiffen peace acceptance or it');
      console.log('      does not work at all');
      console.log('');
      console.log('  The log cannot tell you which. Open the attacker in the game and');
      console.log('  look at whether they hold the target title.');
    } else {
      console.log('  Only one reading so far. Unpause, let a few months pass, and run');
      console.log('  hd_probe_peace.txt again. One reading is a fact about a moment.');
    }
    console.log('');
  }
}

// --------------------------------------------------------------------------
// P2 - coalition slots
// --------------------------------------------------------------------------
console.log(bar('P2  Can a third realm be added to a war already running?'));

let anySlot = false;
for (const slot of ['a', 'b', 'c']) {
  const r = records(`probe_slot_${slot}`);
  if (r.length === 0) continue;
  anySlot = true;
  const verdicts = r.map((x) => x[0]);
  const joined = verdicts.includes('JOINED');
  const ran = verdicts.includes('preconditions_ok');
  const unmet = verdicts.includes('preconditions_unmet');

  console.log(`\n  slot ${slot.toUpperCase()}`);
  if (unmet && !ran) {
    console.log('    preconditions unmet - no running war under that CB, or the player');
    console.log('    is one of the two belligerents. Run P1 first, and make sure the');
    console.log('    probe war is not your own.');
  } else if (joined) {
    console.log('    JOINED - the third realm is now at war with the defender.');
    console.log('    This is the answer. Coalitions are buildable.');
  } else if (ran) {
    console.log('    ran, did not join. The effect parsed but changed nothing, OR it');
    console.log('    failed to parse and the block continued past it. Check error.log');
    console.log('    for a line naming the run file before concluding the effect is');
    console.log('    real but ineffective - those are different findings.');
  }
}
if (!anySlot) {
  console.log('\n  No slot output. Fill one in first:');
  console.log('');
  console.log('    node scripts/find-effects.mjs');
  console.log('    node scripts/make-probes.mjs --slot a \\');
  console.log('      --effect "scope:hd_c_third = { join_war = { war = scope:hd_c_war attacker = yes } }"');
  console.log('');
  console.log('  Use the effect name and parameters find-effects.mjs actually found in');
  console.log('  the game files. Guessing is what the slots are for, but reading is');
  console.log('  cheaper than guessing.\n');
}

// --------------------------------------------------------------------------
// P3 - truce
// --------------------------------------------------------------------------
console.log(bar('P3  Does a script start_war ignore a truce?'));

const truce = records('probe_truce').map((r) => r[0]);
if (truce.length === 0) {
  console.log('\n  No output. Run hd_probe_truce.txt.\n');
} else if (truce.includes('preconditions_unmet')) {
  console.log('\n  Preconditions unmet - the two realms could not be resolved, or they');
  console.log('  are already at war. Pick another pair.\n');
} else if (!truce.includes('truce_confirmed')) {
  console.log('\n  The truce never landed, so the declaration result says nothing about');
  console.log('  truces. add_truce_both_ways may have the wrong parameter names here -');
  console.log('  check find-effects.mjs output and fix the probe before reading further.\n');
} else if (truce.includes('war_started_through_truce')) {
  console.log('\n  Truce confirmed, and the war started anyway.');
  console.log('  start_war from script IGNORES truces.');
  console.log('');
  console.log('  That is a capability and a hazard in the same finding. It means a');
  console.log('  coalition can fire on the record\'s date rather than waiting on the');
  console.log('  game\'s diplomacy - and it means the Director can break a truce the');
  console.log('  player negotiated, which nothing currently stops it doing. If you');
  console.log('  build on this, the truce check belongs in validate, not in the engine.\n');
} else if (truce.includes('blocked_by_truce')) {
  console.log('\n  Truce confirmed, and the declaration was blocked.');
  console.log('  start_war RESPECTS truces, which bounds when a coalition can fire and');
  console.log('  removes the hazard above. The historical date and the game\'s truce');
  console.log('  calendar now have to be reconciled somewhere.\n');
}

// --------------------------------------------------------------------------
// P4 - war name
// --------------------------------------------------------------------------
console.log(bar('P4  Can a war name carry the title it is fought over?'));

const name = records('probe_name');
if (name.length === 0) {
  console.log('\n  No output. This one needs three things, and all three are easy to');
  console.log('  miss: the probe CB deployed (npm run deploy:mod), CK3 fully restarted,');
  console.log('  and hd_probe_name.txt run.\n');
} else {
  for (const r of name) console.log(`\n  war ${r[0]}: ${r[1]}`);
  const joined = name.map((r) => r[1] ?? '').join(' ');
  const aOk = /A=\S/.test(joined) && !/A=\s*(\[|$)/.test(joined);
  const bOk = /B=\S/.test(joined) && !/B=\s*(\[|$)/.test(joined);
  const broken = /ERROR|\[GetTitle|\[war\./.test(joined);

  console.log('');
  if (broken && !aOk && !bOk) {
    console.log('  Neither form resolved - the name came back with its own markup in it.');
    console.log('  Dynamic naming does not work this way, so a generalised war library');
    console.log('  costs one casus belli and one localisation string per war. That caps');
    console.log('  how far the table can grow, and it is worth knowing before you write');
    console.log('  the sixth one rather than the sixtieth.');
  } else {
    console.log(`  A (GetTitle from a parameter):     ${aOk ? 'RESOLVED' : 'did not resolve'}`);
    console.log(`  B (war.GetCasusBelli target):      ${bOk ? 'RESOLVED' : 'did not resolve'}`);
    console.log('');
    if (aOk || bOk) {
      console.log('  At least one form works. A war name can be built from the title it is');
      console.log('  fought over, so one CB per KIND of war - reconquest, holy war,');
      console.log('  succession, intervention, coalition - covers an unbounded number of');
      console.log('  wars. That is the difference between six CBs and sixty.');
    }
  }
  console.log('');
}


// --------------------------------------------------------------------------
// P5 - dispatch reply effects
// --------------------------------------------------------------------------
console.log(bar('P5  Do the dispatch reply effects actually land?'));

const reply = records('probe_reply');
if (reply.length === 0) {
  console.log('\n  No output. Run hd_probe_reply.txt. It takes real gold and piety from');
  console.log('  the player, so use a throwaway campaign.\n');
} else if (reply.some((r) => r[0] === 'preconditions_unmet')) {
  console.log('\n  Preconditions unmet - the sender title did not resolve, or it is you.');
  console.log('  Pass a different --anchor and rebuild the probes.\n');
} else {
  const before = reply.find((r) => r[0] === 'before');
  const after = reply.find((r) => r[0] === 'after');
  if (!before || !after) {
    console.log('\n  Only half the readings arrived, so the block did not finish. Check');
    console.log('  error.log for a line naming the run file.\n');
  } else {
    const n = (v) => Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
    const dg = n(after[1]) - n(before[1]);
    const dp = n(after[2]) - n(before[2]);
    console.log(`\n  gold   ${before[1]} -> ${after[1]}   (${dg})`);
    console.log(`  piety  ${before[2]} -> ${after[2]}   (${dp})\n`);

    if (dg <= -150 && dp <= -100) {
      console.log('  Both costs were charged. A negative add_gold works, which is what the');
      console.log('  reply table depends on: every price the sidebar names is one the');
      console.log('  player actually pays.');
    } else if (dg === 0 && dp === 0) {
      console.log('  NEITHER cost was charged, and nothing reported an error. That is the');
      console.log('  worst outcome available - the sidebar names a price the game does not');
      console.log('  take, so conciliate and tribute are free and the whole pressure');
      console.log('  economy is decorative. Fix before any of this ships.');
    } else {
      console.log('  Partly charged. Whichever one did not move is the effect to replace,');
      console.log('  and until it is, its reply must stop naming a cost it does not take.');
    }

    console.log('');
    console.log('  The opinion cannot be read from the log. Open the sender in game and');
    console.log('  look for the Historical Director modifier on their opinion of you.');
    console.log('  Direction matters: it is THEIR opinion of YOU that should have moved.');
  }
  console.log('');
}

console.log(bar('What to do with this'));
console.log('');
console.log('  P1 gates everything. If the AI abandons unwinnable wars, no amount of');
console.log('  coalition machinery helps and the honest finding is that CK3 will not');
console.log('  carry this design.');
console.log('');
console.log('  P2 is the mechanism. Numbers, not debuffs: a coalition is fair on its');
console.log('  own terms, where a defender debuff on the player reads as cheating.');
console.log('');
console.log('  P3 is a constraint and a safety finding at the same time.');
console.log('');
console.log('  P4 only decides how much hand-written content the design costs.');
console.log('');
console.log('  Whatever comes back, it belongs in the issue #1 thread - including a no.');
console.log('  "No modifier raises faction chance" was one of the more useful things in');
console.log('  that postmortem, and it was a negative result.\n');
