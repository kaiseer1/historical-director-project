import fs from 'node:fs';
import path from 'node:path';
import { readAsset, listAssets } from '../runtime.js';

/**
 * Put the companion mod where CK3 will find it.
 *
 * CK3 wants two things: the mod's files under mod/<name>/, and a .mod
 * descriptor beside them carrying an absolute `path=` pointing at that folder.
 * The repo's own descriptor.mod deliberately has no path - it is the source of
 * truth for version and name, and the path only makes sense once deployed.
 *
 * This used to be a script that copied a directory. It reads from the asset
 * layer instead, so the same function serves `npm run deploy:mod` from a
 * checkout and the executable's first run, where there is no directory to copy
 * from because the mod lives inside the .exe.
 */

export const MOD_NAME = 'historical_director';

/**
 * Rewrite the pump interval in the runner widget on its way to disk.
 *
 * The one piece of the mod that is not shipped verbatim. The interval is a
 * `duration` inside a GUI state, so it cannot be read from a global variable or
 * pushed in through the run file the way everything else is - the value has to
 * be in the file the engine loads. Deploy time is the only moment the
 * orchestrator holds both the config and the file.
 *
 * Marked in the source with `# HD_PUMP_INTERVAL` on the line above, so the
 * substitution is greppable from the mod side and the shipped file stays valid
 * CK3 script for anyone who copies it by hand.
 *
 * Returns the body unchanged when the marker is missing rather than throwing:
 * a mod whose interval could not be set still runs at its default, and failing
 * the whole deploy over it would be the larger harm.
 *
 * @param {string} body
 * @param {number} seconds
 * @returns {{text: string, applied: boolean}}
 */
export function applyPumpInterval(body, seconds) {
  const marker = /(# HD_PUMP_INTERVAL[\s\S]*?\n\s*duration = )\d+(?:\.\d+)?/;
  if (!marker.test(body)) return { text: body, applied: false };
  return { text: body.replace(marker, `$1${seconds}`), applied: true };
}

/** The widget file the interval lives in. */
const RUNNER_ASSET = 'mod/gui/custom_gui/hd_runner.gui';

/**
 * @param {string} ck3UserFolder the Paradox user folder, not the game install
 * @param {{pumpIntervalSeconds?: number}} [opts]
 * @returns {{ok: true, dest: string, descriptorPath: string, files: number, pumpIntervalSeconds: number}
 *          | {ok: false, error: string, modFolder: string}}
 */
export function deployMod(ck3UserFolder, opts = {}) {
  const modFolder = path.join(ck3UserFolder, 'mod');
  const dest = path.join(modFolder, MOD_NAME);

  if (!fs.existsSync(ck3UserFolder)) {
    return {
      ok: false,
      modFolder,
      error: `CK3 user folder not found: ${ck3UserFolder}. Set ck3UserFolder in config.json.`,
    };
  }

  const assets = listAssets('mod');
  if (assets.length === 0) {
    return { ok: false, modFolder, error: 'no mod files are bundled with this build' };
  }

  // Replaced wholesale rather than merged. A file removed from the mod between
  // versions has to disappear from the deployed copy too, and CK3 will happily
  // load a stale scripted effect that no longer matches what the orchestrator
  // sends - which fails as a wrong answer rather than as a missing one.
  fs.rmSync(dest, { recursive: true, force: true });

  const interval = Number.isFinite(opts.pumpIntervalSeconds) && Number(opts.pumpIntervalSeconds) > 0
    ? Math.round(Number(opts.pumpIntervalSeconds))
    : 2;

  let written = 0;
  for (const asset of assets) {
    let body = readAsset(asset);
    if (!body) continue;
    if (asset === RUNNER_ASSET) {
      const { text } = applyPumpInterval(body.toString('utf8'), interval);
      body = Buffer.from(text, 'utf8');
    }
    // "mod/common/x.txt" -> "<dest>/common/x.txt"
    const rel = asset.replace(/^mod\//, '');
    const full = path.join(dest, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
    written += 1;
  }

  const source = readAsset('mod/descriptor.mod');
  if (!source) return { ok: false, modFolder, error: 'descriptor.mod is missing from this build' };

  const deployed = `${source.toString('utf8').trimEnd()}\npath="${dest.split(path.sep).join('/')}"\n`;
  const descriptorPath = path.join(modFolder, `${MOD_NAME}.mod`);
  fs.writeFileSync(descriptorPath, deployed, 'utf8');
  fs.writeFileSync(path.join(dest, 'descriptor.mod'), deployed, 'utf8');

  return { ok: true, dest, descriptorPath, files: written, pumpIntervalSeconds: interval };
}

/** Whether a deployed copy is already present. */
export function modIsDeployed(ck3UserFolder) {
  return fs.existsSync(path.join(ck3UserFolder, 'mod', MOD_NAME, 'descriptor.mod'));
}
