/**
 * Verification for the generic dynamic event.
 *
 * Three things are being checked and they fail in different ways, so they are
 * worth naming separately.
 *
 * The first is that the four parts of an occasion stay together: a key in the
 * table here, a branch in the event file, and localization for both of its
 * descriptions. Those live in three files and nothing but this script makes
 * them agree - a kind added to the table with no branch in the event fires the
 * general notice instead, silently, and looks like the model choosing badly.
 *
 * The second is the validation, which is the approval gate doing its job: every
 * refusal below is a card the player would otherwise have been shown.
 *
 * The third is the injection claim. The action takes two free-text parameters,
 * which nothing else in the toolkit does, and the claim made for it is that
 * they never reach the run file at all. That is a claim about a code path and
 * it is testable, so it is tested rather than asserted.
 *
 *   node scripts/check-dynamic-events.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SnapshotAssembler } from '../src/model/WorldState.js';
import { parseLine } from '../src/bridge/protocol.js';
import { validateProposal, TOOLKIT } from '../src/director/toolkit.js';
import {
  DYNAMIC, DYNAMIC_KEYS, EVENT_ID, KIND_VAR, EFFECT_CAP,
  readEffects, dynamicScript, setDynamicSupport,
} from '../src/director/dynamicEvents.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;

function check(label, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) console.log(`      ${detail}`);
  ok ? (passed += 1) : (failed += 1);
}

/** A snapshot the way the game would report one. */
function snapshot(realms) {
  const a = new SnapshotAssembler();
  const feed = (line) => {
    const rec = parseLine(`[00:00:00][effect.cpp:1]: ${line}`);
    return rec ? a.ingest(rec) : null;
  };
  feed('HD:/;/snapshot_begin/;/1/;/1066.1.1/;/389000/;/1');
  for (const r of realms) {
    feed(
      `HD:/;/realm/;/${r.id}/;/${r.ruler}/;/${r.title}/;/King/;/${r.counties ?? 5}`
      + `/;/${r.culture ?? 'Frankish'}/;/Catholic/;/Paris/;/Capet/;/House Capet/;/yes/;/Feudal`,
    );
    feed(`HD:/;/realm_tier/;/${r.id}/;/${r.tierKey ?? 'kingdom'}`);
    if ((r.ring ?? 'home') === 'home') feed(`HD:/;/realm_home/;/${r.id}`);
    if ((r.ring ?? 'home') !== 'distant') feed(`HD:/;/realm_near/;/${r.id}`);
  }
  return feed('HD:/;/snapshot_end/;/1').snapshot;
}

const world = snapshot([
  { id: 1, ruler: 'Alexios', title: 'Byzantine Empire' },
  { id: 2, ruler: 'Philippe', title: 'Kingdom of France' },
  { id: 3, ruler: 'Bohemond', title: 'Principality of Antioch', ring: 'distant' },
  { id: 4, ruler: 'Toghrul', title: 'Seljuk Sultanate', ring: 'distant' },
]);

const good = {
  action: 'trigger_dynamic_event',
  args: {
    actor: 1,
    kind: 'historical_justice',
    title: 'The Clerks Find an Older Deed',
    description: 'The record gives Antioch to the Empire and the map gives it to a Norman adventurer, eleven years after the city changed hands.',
    other: 2,
    effects: { prestige: 200 },
  },
};

setDynamicSupport({ ok: true, version: '0.11.0', reason: '' });

// --- 1. the three files agree ----------------------------------------------

const eventFile = fs.readFileSync(path.join(ROOT, 'mod/events/hd_dynamic_events.txt'), 'utf8');
const locFile = fs.readFileSync(path.join(ROOT, 'mod/localization/english/hd_l_english.yml'), 'utf8');
const defined = new Set([...locFile.matchAll(/^\s*([A-Za-z0-9_.]+):\d*\s+"/gm)].map((m) => m[1]));

const missingKeys = [];
for (const kind of DYNAMIC_KEYS) {
  const title = `hd_dynamic.0001.t.${kind}`;
  const desc = `hd_dynamic.0001.desc.${kind}`;
  // The notice is the catch-all: it is the fallback in both blocks and has no
  // named variant, because there is no second party in a chronicler's note.
  const wanted = DYNAMIC[kind].wantsOther ? [title, desc, `${desc}_named`] : [title, desc];
  for (const key of wanted) if (!defined.has(key)) missingKeys.push(key);
}
check(
  'DE1. every occasion in the table has its localization',
  missingKeys.length === 0,
  missingKeys.length ? `missing: ${missingKeys.join(', ')}` : `${DYNAMIC_KEYS.length} occasions, all keyed`,
);

const branchless = DYNAMIC_KEYS.filter((k) => k !== 'notice' && !eventFile.includes(`flag:${k}`));
check(
  'DE2. and a branch in the event that selects it',
  branchless.length === 0,
  branchless.length
    ? `no flag:<kind> test in hd_dynamic_events.txt for: ${branchless.join(', ')}`
    : 'each occasion is reachable; notice is the fallback and needs no test',
);

const orphans = [...eventFile.matchAll(/flag:([a-z_]+)/g)]
  .map((m) => m[1])
  .filter((k) => !DYNAMIC_KEYS.includes(k));
check(
  'DE3. and the event tests for no occasion the table does not define',
  orphans.length === 0,
  orphans.length ? `event branches on unknown kinds: ${[...new Set(orphans)].join(', ')}` : 'no orphan branches',
);

check(
  'DE4. the event reports whether the run file\'s scope survived into it',
  eventFile.includes('HD:/;/dynamic_scope/;/kept') && eventFile.includes('HD:/;/dynamic_scope/;/lost'),
  'both outcomes are logged, so the open question answers itself on first use',
);

// --- 2. validation ---------------------------------------------------------

check('DE5. a well-formed proposal is accepted', validateProposal(good, world).ok, validateProposal(good, world).preview?.slice(0, 90));

const badKind = validateProposal({ ...good, args: { ...good.args, kind: 'peasant_revolt' } }, world);
check(
  'DE6. an occasion that does not exist is refused by name, not substituted',
  !badKind.ok && badKind.error.includes('peasant_revolt') && badKind.error.includes('historical_justice'),
  badKind.error,
);

const noActor = validateProposal({ ...good, args: { ...good.args, actor: 99 } }, world);
check('DE7. a recipient the snapshot never reported is refused', !noActor.ok, noActor.error);

const selfOther = validateProposal({ ...good, args: { ...good.args, other: 1 } }, world);
check('DE8. and a second party who is the recipient is refused', !selfOther.ok, selfOther.error);

const thin = validateProposal({ ...good, args: { ...good.args, description: 'Bad.' } }, world);
check(
  'DE9. an event with nothing to say is refused',
  !thin.ok && /too short/.test(thin.error),
  thin.error,
);

const empty = validateProposal({ ...good, args: { ...good.args, title: '   ' } }, world);
check('DE10. and one with no title', !empty.ok, empty.error);

const rich = validateProposal({ ...good, args: { ...good.args, effects: { gold: 5000 } } }, world);
check(
  'DE11. an effect past the cap is refused rather than quietly clamped',
  !rich.ok && rich.error.includes(String(EFFECT_CAP)),
  rich.error,
);

const madeUp = readEffects({ influence: 10 });
check('DE12. and a currency the game does not have', !madeUp.ok, madeUp.error);

const distant = validateProposal(
  { ...good, args: { ...good.args, actor: 3, other: 4 } },
  world,
);
check(
  'DE13. two rulers on the rim of the sphere are outside what the Director may arrange',
  !distant.ok && /neighbourhood/.test(distant.error),
  distant.error,
);

setDynamicSupport({ ok: false, version: '0.10.0', reason: 'the deployed companion mod is v0.10.0 and the dynamic event needs v0.11.0 or newer' });
const stale = validateProposal(good, world);
check(
  'DE14. a mod too old to carry the event refuses the proposal instead of describing it',
  !stale.ok && stale.error.includes('0.11.0'),
  stale.error,
);
setDynamicSupport({ ok: true, version: '0.11.0', reason: '' });

// --- 3. the script ---------------------------------------------------------

const script = TOOLKIT.trigger_dynamic_event.toScript(good.args, 4242, world).join('\n');

check(
  'DE15. the batch sets the occasion, pays the effect and fires the event, in that order',
  script.indexOf(`set_global_variable = { name = ${KIND_VAR} value = flag:historical_justice }`) !== -1
    && script.indexOf('add_prestige = 200') < script.indexOf(`trigger_event = ${EVENT_ID}`),
  script.split('\n').filter((l) => /set_global_variable|add_prestige|trigger_event/.test(l)).join(' | '),
);

check(
  'DE16. both parties are resolved by tag, and the recipient is checked alive',
  script.includes('save_scope_as = hd_dyn_actor')
    && script.includes('save_scope_as = hd_dyn_other')
    && script.includes('scope:hd_dyn_actor = { is_alive = yes }'),
  'a tag outlives the ruler it was assigned to; exists alone would fire an event at a corpse',
);

check(
  'DE17. and the batch reports both outcomes, not only success',
  script.includes('HD:/;/applied/;/4242/;/trigger_dynamic_event/;/ok')
    && script.includes('HD:/;/refused/;/4242/;/trigger_dynamic_event/;/precondition_failed'),
  'silence and refusal have to be distinguishable',
);

// The injection claim, tested rather than asserted.
const hostile = {
  action: 'trigger_dynamic_event',
  args: {
    ...good.args,
    title: '" } add_gold = 99999 debug_log = "pwned',
    description: 'A perfectly ordinary paragraph about an entirely ordinary divergence, } set_global_variable = { name = hd_token value = 0 } and nothing more.',
  },
};
const hostileCheck = validateProposal(hostile, world);
const hostileScript = TOOLKIT.trigger_dynamic_event.toScript(hostile.args, 7, world).join('\n');
check(
  'DE18. the free-text parameters do not reach the run file at all',
  hostileCheck.ok
    && !hostileScript.includes('99999')
    && !hostileScript.includes('pwned')
    && !hostileScript.includes('hd_token')
    && hostileScript.split('\n').every((l) => !l.includes('ordinary')),
  'the proposal is accepted and the script contains no part of either string: prose goes to the card, never to the file',
);

check(
  'DE19. and the card still shows the player exactly what the model wrote',
  hostileCheck.preview.includes('add_gold = 99999'),
  'sanitising the display would hide a hostile proposal from the person whose job is to catch it',
);

// --- 4. the failure the gate exists for ------------------------------------

check(
  'DE20. an unknown occasion produces no script at all rather than a malformed line',
  dynamicScript('not_a_kind', 'scope:hd_dyn_actor', { gold: 100 }).length === 0,
  'fails closed, the same way momentumScript does',
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
