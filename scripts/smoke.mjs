/**
 * End-to-end smoke test: the whole loop, without CK3 and without a model.
 *
 * Starts the fake game, the stub model and the orchestrator together, lets them
 * talk for a few seconds, and checks that the lines which prove each stage
 * worked actually appeared. It is the difference between "the code parses" and
 * "locate, sphere, snapshot, retrieval, audit and validation still connect to
 * each other", and it takes seconds rather than a five-minute game load.
 *
 *   node scripts/smoke.mjs              # Toledo 1066
 *   node scripts/smoke.mjs --andalus    # the mid-campaign 1218 case
 *   node scripts/smoke.mjs --byzantium
 *   node scripts/smoke.mjs --keep       # leave the scratch folder for reading
 *   node scripts/smoke.mjs --bundle     # run dist/*.cjs instead of src/main.js
 *
 * `--bundle` is the one that matters before a release. The executable does not
 * run these sources: it runs a CommonJS file that scripts/bundle.mjs folded
 * them into, and a bundler that got one import wrong would produce something
 * that still starts and then fails somewhere specific. Running the same checks
 * against the bundle is how that gets caught before it ships.
 *
 * Everything happens under a scratch HD_HOME. That is not tidiness: the app
 * writes baseline.json wherever it is told, and baseline.json is a campaign's
 * reference map, so a test run pointed at the project folder would quietly
 * replace a real campaign's record of how its world started.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const scenario = args.find((a) => ['--andalus', '--byzantium', '--iberia'].includes(a)) ?? '--iberia';
const keep = args.includes('--keep');

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-smoke-'));
const CK3 = path.join(HOME, 'ck3');
const LOG = path.join(CK3, 'logs', 'debug.log');
fs.mkdirSync(path.dirname(LOG), { recursive: true });
fs.mkdirSync(path.join(CK3, 'run'), { recursive: true });
fs.writeFileSync(LOG, '', 'utf8');

const PORT = 7871;
const STUB = 7999;

fs.writeFileSync(path.join(HOME, 'config.json'), JSON.stringify({
  ck3UserFolder: CK3.split(path.sep).join('/'),
  port: PORT,
  llm: { baseUrl: `http://127.0.0.1:${STUB}`, model: 'stub', apiKeyEnv: 'HD_API_KEY', temperature: 0, maxTokens: 2000 },
  director: { auditEveryYears: 5, sphereReach: 2, sphereMax: 12, maxRealmsInPrompt: 60, maxProposalsPerAudit: 2 },
  // Off on purpose. Retrieval reaches the live Wikipedia and Wikidata APIs, and
  // a smoke test that fails when the network is slow is a test nobody trusts.
  knowledge: { enabled: false },
}, null, 2), 'utf8');

/** @type {import('node:child_process').ChildProcess[]} */
const kids = [];
function start(name, argv, env = {}) {
  const kid = spawn(process.execPath, argv, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  kid.name = name;
  kids.push(kid);
  return kid;
}

let appOutput = '';

const BUNDLE = path.join('dist', 'historical-director.cjs');
const EXE = path.join('dist', process.platform === 'win32' ? 'HistoricalDirector.exe' : 'HistoricalDirector');
const useBundle = args.includes('--bundle');
const useExe = args.includes('--exe');

function requireBuilt(rel, how) {
  if (fs.existsSync(path.join(ROOT, rel))) return;
  console.error(`${rel} does not exist. Run: ${how}`);
  process.exit(1);
}
if (useBundle) requireBuilt(BUNDLE, 'node scripts/bundle.mjs');
if (useExe) requireBuilt(EXE, 'npm run build:exe');

const stub = start('stub', ['scripts/stub-llm.mjs', ...(scenario === '--andalus' ? ['--andalus'] : [])]);
const sim = start('sim', ['scripts/simulate-game.mjs', scenario, '--log', LOG]);

// The executable is its own interpreter, so it is spawned directly rather than
// handed to node. --no-browser because a test that opens a browser window every
// run is a test people stop running.
const app = useExe
  ? spawn(path.join(ROOT, EXE), ['--no-browser'], {
    cwd: ROOT,
    env: { ...process.env, HD_HOME: HOME, HD_API_KEY: 'smoke-test-key' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  : start('app', [useBundle ? BUNDLE : 'src/main.js'], { HD_HOME: HOME, HD_API_KEY: 'smoke-test-key' });
if (useExe) { app.name = 'app'; kids.push(app); }

app.stdout.on('data', (d) => { appOutput += d; });
app.stderr.on('data', (d) => { appOutput += d; });
for (const kid of [stub, sim]) kid.stderr.on('data', (d) => { appOutput += `[${kid.name}] ${d}`; });

const SECONDS = 22;
console.log(`running ${scenario.slice(2)} for ${SECONDS}s in ${HOME}\n`);

setTimeout(() => {
  for (const kid of kids) kid.kill();

  console.log('--- orchestrator output '.padEnd(72, '-'));
  console.log(appOutput.trim());
  console.log('-'.repeat(72));

  // Each check names the stage it proves, so a failure says which link broke
  // rather than that "the test failed".
  const checks = [
    ['the game is heard', /the game is talking to us/],
    ['the player is located', /player located:/],
    ['a sphere is seeded', /Seeded from/],
    ['a snapshot arrives', /snapshot received: \d+ realms/],
    ['a baseline is captured', /baseline captured at/],
    ['an audit runs', /auditing \d+ across/],
    ['the audit concludes', /(the Director has \d+ proposal|nothing proposed|proposal\(s\) failed validation)/],
  ];

  if (useExe) {
    // What the executable does over and above `npm start`: it sets its own
    // environment up rather than asking the tester to.
    checks.push(['the executable knows it is packaged', /packaged executable/]);
    checks.push(['it deploys the companion mod itself', /companion mod deployed: \d+ files/]);
    checks.push(['it runs its own preflight', /preflight:/]);
    checks.push(['it writes a starting config', /wrote a starting config\.json|CK3 folder/]);
  }

  if (scenario === '--andalus') {
    // The point of this scenario. Before bookmarkTiers.js the proposal was
    // dropped with "has stood at empire tier since the campaign began".
    checks.push(['the mid-campaign gate lets a proposal through', /the Director has [1-9]\d* proposal/]);
    checks.push(['the sphere is seeded from the whole realm', /where the realm holds land/]);
  }

  let failed = 0;
  console.log('');
  for (const [name, re] of checks) {
    const ok = re.test(appOutput);
    if (!ok) failed++;
    console.log(`${ok ? ' ok ' : 'FAIL'}  ${name}`);
  }

  if (keep) console.log(`\nscratch folder kept: ${HOME}`);
  else fs.rmSync(HOME, { recursive: true, force: true });

  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
}, SECONDS * 1000);

process.on('SIGINT', () => {
  for (const kid of kids) kid.kill();
  process.exit(1);
});
