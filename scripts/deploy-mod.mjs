/**
 * Copy the companion mod into the CK3 mod folder and write its descriptor.
 *
 * The work is in src/setup/deployMod.js, which reads the mod through the asset
 * layer rather than off disk. That is what lets the executable deploy the same
 * mod on first run, where there is no mod/ directory to copy from because the
 * files live inside the .exe.
 */
import { loadConfig } from '../src/config.js';
import { deployMod } from '../src/setup/deployMod.js';

const cfg = loadConfig();
const result = deployMod(cfg.ck3UserFolder, { pumpIntervalSeconds: cfg.director.pumpIntervalSeconds });

if (!result.ok) {
  console.error(result.error);
  process.exit(1);
}

console.log(`Deployed ${result.files} files to ${result.dest}`);
console.log(`Execution pump interval: ${result.pumpIntervalSeconds}s`);
console.log(`Wrote descriptor ${result.descriptorPath}`);
console.log('');
console.log('Next: enable "Historical Director" in the CK3 launcher playset,');
console.log('and make sure the game launches with -debug_mode.');
