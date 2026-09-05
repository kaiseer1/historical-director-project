import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/**
 * Where the app's code and its data are, whichever way it was started.
 *
 * There are three ways now - `npm start` from the repo, a built .exe, and a
 * test harness pointed at a scratch directory - and they disagree about two
 * things: where the static files live, and where config.json, lorebook.json and
 * baseline.json should be written. Every module that needs either used to work
 * it out from `import.meta.url`, which answers neither question correctly
 * inside a single-file executable.
 *
 * Nothing here is CK3-specific. It is the boundary between the app and the way
 * it happens to be packaged, and it exists so that no other module has to know
 * which of the three it is running under.
 */

// createRequire wants a path to resolve relative to, and process.execPath is
// one that exists in every mode - unlike import.meta.url, which the bundler
// rewrites, and __filename, which does not exist in the ESM sources.
const nodeRequire = createRequire(process.execPath);

/** The SEA API, or null when running from source. */
const sea = (() => {
  try {
    const api = nodeRequire('node:sea');
    return api?.isSea?.() ? api : null;
  } catch {
    return null;
  }
})();

/** Whether this is the built executable rather than the repo. */
export function isPackaged() {
  return sea !== null;
}

/**
 * The repo root, when running from source: src/runtime.js -> the folder above.
 *
 * Only ever reached in source mode; every caller checks isPackaged() first,
 * because inside the executable there is no source tree for this to point at.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
function sourceRoot() {
  return path.resolve(HERE, '..');
}

/**
 * Where config.json, lorebook.json and baseline.json live.
 *
 * `HD_HOME` wins so a test run can be given a scratch directory and never touch
 * a real campaign's ledger - which matters more than it sounds, because
 * baseline.json *is* the campaign's reference map and overwriting it silently
 * relegitimises whatever the world has already drifted into.
 *
 * For the executable it is the folder the .exe sits in, so a tester can see
 * their own settings and lore book beside it rather than hunting through
 * AppData for them.
 */
export function appHome() {
  if (process.env.HD_HOME) return path.resolve(process.env.HD_HOME);
  if (isPackaged()) return path.dirname(process.execPath);
  return sourceRoot();
}

/**
 * Read a bundled file: the sidebar's HTML and CSS, and the companion mod.
 *
 * Packaged, these come out of the executable itself. From source they come off
 * disk. Callers get a Buffer either way and do not have to care.
 *
 * @param {string} name a forward-slash path, e.g. "renderer/index.html"
 * @returns {Buffer|null} null when there is no such asset
 */
export function readAsset(name) {
  if (isPackaged()) {
    try {
      const raw = sea.getRawAsset(name);
      return Buffer.from(raw);
    } catch {
      return null;
    }
  }
  const full = path.join(sourceRoot(), name);
  try {
    return fs.readFileSync(full);
  } catch {
    return null;
  }
}

/**
 * The list of files under a bundled directory.
 *
 * SEA has no way to enumerate its own assets, so the build writes a manifest in
 * as one more asset and this reads it back. From source the same answer comes
 * from walking the directory, so the two modes cannot drift apart without the
 * build failing.
 *
 * @param {string} prefix e.g. "mod"
 * @returns {string[]} forward-slash paths, including the prefix
 */
export function listAssets(prefix) {
  if (isPackaged()) {
    const manifest = readAsset('asset-manifest.json');
    if (!manifest) return [];
    try {
      /** @type {string[]} */
      const all = JSON.parse(manifest.toString('utf8'));
      return all.filter((f) => f === prefix || f.startsWith(`${prefix}/`));
    } catch {
      return [];
    }
  }

  const root = path.join(sourceRoot(), prefix);
  if (!fs.existsSync(root)) return [];
  /** @type {string[]} */
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const rel = path.relative(sourceRoot(), path.join(entry.parentPath ?? entry.path, entry.name));
    out.push(rel.split(path.sep).join('/'));
  }
  return out;
}

/** A one-line description of how this process was started, for the banner. */
export function describeRuntime() {
  return isPackaged()
    ? `packaged executable, data in ${appHome()}`
    : `source checkout at ${appHome()}`;
}
