/**
 * Stage one toolkit action directly into a live campaign, bypassing the model
 * and the approval gate.
 *
 * Section 12 records that spawn_character and set_relations have never been
 * confirmed in-game: only the two map-shaping actions have been observed to
 * land. That gap cannot be closed from a test script, because what is in doubt
 * is whether the composed CK3 script does what it claims when the engine runs
 * it. So this composes exactly what toScript would, stages it, and tells you
 * which log line proves the answer either way.
 *
 * It is a development tool. It is deliberately not reachable from the server,
 * not registered in package.json, and refuses to run without an explicit flag,
 * because everything else in this project routes through a human saying yes and
 * this does not.
 *
 *   node scripts/verify-toolkit.mjs --i-understand-this-bypasses-approval \
 *     --action set_relations --actor 3 --target 5 --value -60
 *
 * Arguments are the same ones the model would supply, except that characters
 * are named by their TAG - their position in the last snapshot - rather than by
 * character id, because that is what the script addresses. Read the tags off
 * the realm table in the sidebar, or count realm records in debug.log from zero.
 */
import process from 'node:process';
import { loadConfig } from '../src/config.js';
import { RunFileManager } from '../src/bridge/RunFileManager.js';
import { TOOLKIT } from '../src/director/toolkit.js';
import { actionScript } from '../src/bridge/ck3Script.js';

const CONSENT = '--i-understand-this-bypasses-approval';

const argv = process.argv.slice(2);
const arg = (name, fallback = undefined) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 || i === argv.length - 1 ? fallback : argv[i + 1];
};

console.log('');
console.log('  !  verify-toolkit stages script into a live game with no approval step.');
console.log('  !  Use a throwaway save. This is not how the Director normally works.');
console.log('');

if (!argv.includes(CONSENT)) {
  console.error(`Refusing to run without ${CONSENT}\n`);
  usage();
  process.exit(1);
}

const action = arg('action');
if (!action || !TOOLKIT[action]) {
  console.error(`Unknown or missing --action. Known: ${Object.keys(TOOLKIT).join(', ')}\n`);
  usage();
  process.exit(1);
}

// Tags, not character ids. The action's own toScript resolves an id through the
// snapshot; here there is no snapshot, so the tag is given directly and a
// minimal fake state is built around it.
const tags = {
  actor: num('actor'),
  target: num('target'),
  host: num('host'),
};

/** @param {string} name */
function num(name) {
  const v = arg(name);
  return v === undefined ? null : Number(v);
}

/**
 * The smallest state object toScript needs: it only ever reads realmsById to
 * turn an id into a tag, so id and tag are made identical here.
 */
const state = {
  realmsById: new Map(
    Object.values(tags)
      .filter((t) => Number.isInteger(t))
      .map((t) => [t, { id: t, tag: t, ruler: `tag ${t}`, primaryTitle: `tag ${t}`, tierKey: arg('tier', 'duchy') }]),
  ),
};

/** Arguments per action, matching each one's schema. */
const ARGS = {
  spawn_character: () => ({
    name: arg('name', 'Testus'),
    sex: arg('sex', 'male'),
    age: Number(arg('age', '30')),
    host: tags.host ?? tags.actor,
  }),
  set_relations: () => ({ actor: tags.actor, target: tags.target, value: Number(arg('value', '-50')) }),
  grant_claim: () => ({ actor: tags.actor, target: tags.target }),
  adjust_title_tier: () => ({ actor: tags.actor, target_tier: arg('target_tier', 'duchy') }),
  trigger_event: () => ({ actor: tags.actor, event: arg('event', 'hd_event.0002') }),
};

const args = ARGS[action]();

for (const [k, v] of Object.entries(args)) {
  if (v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v))) {
    console.error(`Missing --${k} for ${action}\n`);
    usage();
    process.exit(1);
  }
}

const cfg = loadConfig();
const runFile = new RunFileManager(cfg.ck3UserFolder);
const token = runFile.nextToken();
const script = TOOLKIT[action].toScript(args, token, state);

runFile.write(actionScript(script), token);

console.log(`Staged ${action} with token ${token}`);
console.log(`  arguments : ${JSON.stringify(args)}`);
console.log(`  run file  : ${runFile.filePath}`);
console.log('');
console.log('The pump picks this up within about two seconds. If it is not running:');
console.log('  gui.createwidget gui/custom_gui/hd_runner.gui hd_runner');
console.log('');
console.log('Then search debug.log for exactly one of these two lines:');
console.log('');
console.log(`  APPLIED   HD:/;/applied/;/${token}/;/${action}/;/ok`);
console.log(`  REFUSED   HD:/;/refused/;/${token}/;/${action}/;/precondition_failed`);
console.log('');
console.log('Neither line means the batch never executed at all - the pump is not running, or the');
console.log('token guard already consumed this batch. That distinction is the whole point: a silent');
console.log('nothing and a reported refusal are different failures and want different fixes.');
console.log('');

function usage() {
  console.log('Usage:');
  console.log(`  node scripts/verify-toolkit.mjs ${CONSENT} --action <name> [args]`);
  console.log('');
  console.log('  spawn_character    --host <tag> [--name X --sex male|female --age N]');
  console.log('  set_relations      --actor <tag> --target <tag> [--value -100..100]');
  console.log('  grant_claim        --actor <tag> --target <tag>');
  console.log('  adjust_title_tier  --actor <tag> [--target_tier kingdom|duchy|county] [--tier <observed>]');
  console.log('  trigger_event      --actor <tag> [--event hd_event.0002]');
  console.log('');
  console.log('  Tags are positions in the last snapshot, counting realm records from zero.');
}
