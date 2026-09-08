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
 * The mod version that first defined the Iberian pressure modifiers, the
 * hd_event.0200 chain and the union decision.
 *
 * Bumped in the same commit that added them, which is the discipline this whole
 * module depends on and which the macro-event work missed: the content went in
 * while the descriptor stayed at 0.4.2, so a mod deployed *before* those
 * commits and one deployed after reported the same version and no check could
 * tell them apart.
 */
export const MACRO_MIN_MOD = '0.4.3';

/**
 * The mod version that first defined the historical moment library: the
 * hd_event.0210 chain and the hd_moment_* modifiers.
 *
 * A third threshold rather than a bump of the second, because the two features
 * are independent: a 0.4.3 mod can run Iberian pressure perfectly well and has
 * no moment content at all. Collapsing them would refuse a working feature to
 * protect a different one.
 */
export const MOMENT_MIN_MOD = '0.5.0';

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
 * Whether the deployed mod is new enough for one feature, and if not, what to
 * tell the player. The reason is shown verbatim in the sidebar and in a
 * dropped-proposal line, so it names the fix rather than only the fault.
 *
 * Written once and called twice on purpose. Momentum had this check and macro
 * events did not, which is exactly how the gap reopened; a second hand-written
 * copy of the same logic is how it would reopen again.
 *
 * @param {string} ck3UserFolder
 * @param {string} minVersion
 * @param {string} feature what the player asked for, named in the refusal
 * @param {string} defines what the newer mod provides, so the reason explains itself
 * @returns {{ok: boolean, version: string|null, reason: string}}
 */
function featureSupport(ck3UserFolder, minVersion, feature, defines) {
  const version = deployedModVersion(ck3UserFolder);

  if (!version) {
    return {
      ok: false,
      version: null,
      reason: `the companion mod is not deployed, so ${feature} cannot be executed. Run: npm run deploy:mod`,
    };
  }

  if (compareVersions(version, minVersion) < 0) {
    return {
      ok: false,
      version,
      reason: `the deployed companion mod is v${version} and ${feature} needs v${minVersion} or newer, which is where ${defines} are defined. Run: npm run deploy:mod, then restart CK3`,
    };
  }

  return { ok: true, version, reason: '' };
}

/** @param {string} ck3UserFolder */
export function momentumSupport(ck3UserFolder) {
  return featureSupport(ck3UserFolder, MOMENTUM_MIN_MOD, 'momentum', 'the modifiers it applies');
}

/** @param {string} ck3UserFolder */
export function momentSupport(ck3UserFolder) {
  return featureSupport(
    ck3UserFolder,
    MOMENT_MIN_MOD,
    'the historical moment library',
    'its events and modifiers',
  );
}

/**
 * @param {string} ck3UserFolder
 */
export function macroSupport(ck3UserFolder) {
  return featureSupport(
    ck3UserFolder,
    MACRO_MIN_MOD,
    'the Iberian pressure event',
    'its modifiers, its event chain and the union decision',
  );
}
