/**
 * Build a single-file executable.
 *
 * Uses Node's own single-executable support, which is the reason PROJECT.md
 * said packaging would happen this way if it happened at all: it keeps the
 * zero-dependency property intact at runtime. The one thing Node does not
 * provide is the injection step, so `npx postject` is fetched for it at build
 * time. That is a build tool, not a dependency of the thing being built - the
 * executable that comes out has nothing in it but Node and this repo.
 *
 * The steps, each of which fails loudly rather than producing a half-built exe:
 *
 *   1. fold src/ into one CommonJS file        (scripts/bundle.mjs)
 *   2. list the sidebar and mod files          (the asset manifest)
 *   3. build the SEA preparation blob          (node --experimental-sea-config)
 *   4. copy the running node binary            (this is what becomes the .exe)
 *   5. inject the blob into the copy           (postject)
 *   6. run the result's own self-test          (proves the assets embedded)
 *
 *   node scripts/build-exe.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const BUILD = path.join(DIST, 'build');
const NAME = 'HistoricalDirector';
const EXE = path.join(DIST, process.platform === 'win32' ? `${NAME}.exe` : NAME);

// The fuse Node looks for when deciding whether it is a single-executable
// application. It is a constant of the Node version, not of this project.
const SENTINEL = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const POSTJECT = 'postject@1.0.0-alpha.6';

function step(n, what) {
  console.log(`\n[${n}/6] ${what}`);
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', ...opts });
}

fs.rmSync(BUILD, { recursive: true, force: true });
fs.mkdirSync(BUILD, { recursive: true });

// --- 1. bundle ---------------------------------------------------------------
step(1, 'folding src/ into one CommonJS file');
const bundlePath = path.join(BUILD, 'app.cjs');
run(process.execPath, ['scripts/bundle.mjs', bundlePath]);

// --- 2. assets ---------------------------------------------------------------
step(2, 'collecting assets');

/** Walk a directory into ROOT-relative, forward-slash paths. */
function walk(rel) {
  const root = path.join(ROOT, rel);
  /** @type {string[]} */
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath ?? entry.path, entry.name);
    out.push(path.relative(ROOT, full).split(path.sep).join('/'));
  }
  return out;
}

const assetFiles = [...walk('src/renderer'), ...walk('mod')];

// SEA cannot enumerate its own assets, so the list travels as one more asset.
// Written into the build folder rather than the repo: it is an artefact of this
// build, and a stale copy checked in would be worse than none.
const manifestPath = path.join(BUILD, 'asset-manifest.json');
fs.writeFileSync(manifestPath, JSON.stringify(assetFiles, null, 2), 'utf8');

/** @type {Record<string, string>} */
const assets = { 'asset-manifest.json': manifestPath };
for (const rel of assetFiles) assets[rel] = path.join(ROOT, rel);

console.log(`      ${assetFiles.length} files (${walk('src/renderer').length} sidebar, ${walk('mod').length} mod)`);

// --- 3. blob -----------------------------------------------------------------
step(3, 'building the preparation blob');
const seaConfigPath = path.join(BUILD, 'sea-config.json');
const blobPath = path.join(BUILD, 'sea-prep.blob');
fs.writeFileSync(seaConfigPath, JSON.stringify({
  main: bundlePath,
  output: blobPath,
  disableExperimentalSEAWarning: true,
  // Left off deliberately. A startup snapshot would shave a little launch time
  // and forbids anything the snapshot cannot capture, which includes several
  // things this app does at module load.
  useSnapshot: false,
  useCodeCache: true,
  assets,
}, null, 2), 'utf8');

run(process.execPath, ['--experimental-sea-config', seaConfigPath]);

// --- 4. copy the binary ------------------------------------------------------
step(4, 'copying the Node binary');
fs.rmSync(EXE, { force: true });
fs.copyFileSync(process.execPath, EXE);
console.log(`      ${path.relative(ROOT, EXE)} from ${process.execPath} (${process.version})`);

// --- 5. inject ---------------------------------------------------------------
step(5, 'injecting the blob');

// npx is invoked through its own JS entry point rather than as `npx.cmd`.
// Since Node 20.12 a .cmd file cannot be handed to execFile without a shell,
// and running this through a shell would mean quoting paths that contain
// spaces - which this project's own folder does. Calling the script directly
// sidesteps both problems and does not depend on PATH.
const npxCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
const npxArgs = fs.existsSync(npxCli)
  ? [npxCli, '--yes', POSTJECT]
  : null;

try {
  if (!npxArgs) throw new Error(`npx not found beside ${process.execPath}`);
  run(process.execPath, [...npxArgs, EXE, 'NODE_SEA_BLOB', blobPath, '--sentinel-fuse', SENTINEL]);
} catch (err) {
  console.error(`\n${err?.message ?? err}`);
  console.error('\npostject failed. It is fetched from npm at build time, so this');
  console.error('usually means no network. The bundle itself is fine and can be run');
  console.error(`directly:  node ${path.relative(ROOT, bundlePath)}\n`);
  process.exit(1);
}

// --- 6. verify ---------------------------------------------------------------
step(6, 'running the executable\'s self-test');

// Pointed at a scratch HD_HOME so the check cannot write a config.json or a
// baseline into wherever the build happens to be run from.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-build-'));
try {
  run(EXE, ['--selftest'], { env: { ...process.env, HD_HOME: scratch } });
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}

const size = fs.statSync(EXE).size;
console.log(`\nBuilt ${path.relative(ROOT, EXE)}  (${(size / 1024 / 1024).toFixed(0)} MB)`);
console.log('');
console.log('It is unsigned, so Windows SmartScreen will warn the first time it runs:');
console.log('"More info" then "Run anyway". That warning is what an unsigned binary');
console.log('from the internet looks like, and it is worth telling testers to expect it.');
console.log('');
console.log('On first run it writes config.json beside itself, deploys the companion');
console.log('mod into the CK3 user folder, and opens the sidebar.');
