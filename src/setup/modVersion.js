import fs from 'node:fs';
import path from 'node:path';
import { MOD_NAME } from './deployMod.js';

/**
 * What the *deployed* companion mod can actually do.
 *
 * The orchestrator and the mod are versioned separately and deployed
 * separately, and nothing has ever made them agree. That is usually harmless,
 * because almost everything the Director does is composed orchestrator-side and
 * runs through a pump that does not care what version it is. Momentum is the
 * exception: `add_character_modifier` names a modifier that has to be *defined*
 * in the mod, and a missing definition fails the worst way available - a line in
 * error.log and nothing in the game.
 *
 * That failure was live. A 1250 campaign ran with a v0.3.0 mod deployed while
 * the orchestrator was on v0.4.0, so had the model chosen a momentum the
 * sidebar would have promised a thousand gold, a thousand piety and thirty
 * years of belligerence, the player would have approved it, and roughly half of
 * it would have happened. The applied record would still have said "ok",
 * because the batch did run.
 *
 * The whole design rests on the sidebar telling the truth about what approval
 * will do. So this reads the deployed descriptor and the toolkit refuses
 * momentum outright when the mod is too old, rather than describing effects
 * that cannot land.
 */

/** The mod version that first defined the momentum modifiers. */
export const MOMENTUM_MIN_MOD = '0.4.0';

/**
 * Compare two dotted version strings numerically.
 * @returns {number} negative when a < b, 0 when equal, positive when a > b
 */
export function compareVersions(a, b) {
  const pa = String(a ?? '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = String(b ?? '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * The version string in the deployed mod's descriptor, or null when there is
 * no deployed mod to read.
 *
 * @param {string} ck3UserFolder
 * @returns {string|null}
 */
export function deployedModVersion(ck3UserFolder) {
  const descriptor = path.join(ck3UserFolder, 'mod', MOD_NAME, 'descriptor.mod');
  try {
    const text = fs.readFileSync(descriptor, 'utf8');
    return text.match(/^\s*version\s*=\s*"([^"]*)"/m)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Whether the deployed mod can execute momentum, and if not, what to tell the
 * player. The reason is written to be shown verbatim in the sidebar and in a
 * dropped-proposal line, so it names the fix rather than only the fault.
 *
 * @param {string} ck3UserFolder
 * @returns {{ok: boolean, version: string|null, reason: string}}
 */
export function momentumSupport(ck3UserFolder) {
  const version = deployedModVersion(ck3UserFolder);

  if (!version) {
    return {
      ok: false,
      version: null,
      reason: 'the companion mod is not deployed, so momentum cannot be executed. Run: npm run deploy:mod',
    };
  }

  if (compareVersions(version, MOMENTUM_MIN_MOD) < 0) {
    return {
      ok: false,
      version,
      reason: `the deployed companion mod is v${version} and momentum needs v${MOMENTUM_MIN_MOD} or newer, which is where the modifiers it applies are defined. Run: npm run deploy:mod, then restart CK3`,
    };
  }

  return { ok: true, version, reason: '' };
}
