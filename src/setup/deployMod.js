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
 * @param {string} ck3UserFolder the Paradox user folder, not the game install
 * @returns {{ok: true, dest: string, descriptorPath: string, files: number}
 *          | {ok: false, error: string, modFolder: string}}
 */
export function deployMod(ck3UserFolder) {
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

  let written = 0;
  for (const asset of assets) {
    const body = readAsset(asset);
    if (!body) continue;
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

  return { ok: true, dest, descriptorPath, files: written };
}

/** Whether a deployed copy is already present. */
export function modIsDeployed(ck3UserFolder) {
  return fs.existsSync(path.join(ck3UserFolder, 'mod', MOD_NAME, 'descriptor.mod'));
}
