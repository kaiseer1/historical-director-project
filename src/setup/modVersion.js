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
 * The mod version that first carried the log-clear executor: the four
 * hd_log_clear_* scripted GUIs and the widget slots that watch them.
 *
 * Gated like the rest, but for a sharper reason than the others. An older mod
 * would take a clear request as a global variable nothing ever reads: no error,
 * no refusal, and no clear - so the byte budget would never reset and the
 * orchestrator would ask again on every tick, for ever, while the log marched
 * on to the 17MB wall it was trying to avoid. A feature that silently does
 * nothing is worse here than one that is refused out loud.
 */
export const LOGCLEAR_MIN_MOD = '0.6.0';

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
 * What the running game has loaded, when it has told us.
 *
 * The descriptor on disk answers "what is deployed", and for a long time this
 * module treated that as the same question as "what can the game execute". It
 * is not, and the two part company in exactly one window: after a deploy and
 * before CK3 restarts. In that window the gate reported a feature as available
 * while the loaded mod had none of it - the precise failure the gate exists to
 * prevent, arriving through the check itself.
 *
 * The mod now reports its own version through the wire on every batch, and that
 * answer wins when we have it. Null until the game says otherwise, which is the
 * honest state before the pump has run once.
 *
 * @type {string|null}
 */
let observed = null;

/** @param {string|null} version as reported by the running game */
export function setObservedModVersion(version) {
  observed = version ? String(version).trim() : null;
}

/** @returns {string|null} */
export function observedModVersion() {
  return observed;
}

/**
 * Whether the mod is new enough for one feature, and if not, what to tell the
 * player. The reason is shown verbatim in the sidebar and in a dropped-proposal
 * line, so it names the fix rather than only the fault - and which fix depends
 * on *why* it is too old.
 *
 * Written once and called three times on purpose. Momentum had this check and
 * macro events did not, which is exactly how the gap reopened; a second
 * hand-written copy of the same logic is how it would reopen again.
 *
 * @param {string} ck3UserFolder
 * @param {string} minVersion
 * @param {string} feature what the player asked for, named in the refusal
 * @param {string} defines what the newer mod provides, so the reason explains itself
 * @returns {{ok: boolean, version: string|null, deployed: string|null, source: 'game'|'disk'|'none', reason: string}}
 */
function featureSupport(ck3UserFolder, minVersion, feature, defines) {
  const deployed = deployedModVersion(ck3UserFolder);
  const version = observed ?? deployed;
  const source = observed ? 'game' : deployed ? 'disk' : 'none';

  if (!version) {
    return {
      ok: false,
      version: null,
      deployed,
      source,
      reason: `the companion mod is not deployed, so ${feature} cannot be executed. Run: npm run deploy:mod`,
    };
  }

  if (compareVersions(version, minVersion) < 0) {
    // Two different faults with two different fixes, and telling them apart is
    // the whole point of asking the game. A loaded mod older than the deployed
    // one needs a restart, not another deploy.
    const stale = observed && deployed && compareVersions(deployed, minVersion) >= 0;
    const reason = stale
      ? `the running game has companion mod v${version} loaded and ${feature} needs v${minVersion} or newer, which is where ${defines} are defined. v${deployed} is already deployed, so restart CK3 to pick it up`
      : `the ${source === 'game' ? 'running game has companion mod' : 'deployed companion mod is'} v${version} and ${feature} needs v${minVersion} or newer, which is where ${defines} are defined. Run: npm run deploy:mod, then restart CK3`;
    return { ok: false, version, deployed, source, reason };
  }

  return { ok: true, version, deployed, source, reason: '' };
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

/** @param {string} ck3UserFolder */
export function logClearSupport(ck3UserFolder) {
  return featureSupport(
    ck3UserFolder,
    LOGCLEAR_MIN_MOD,
    'clearing the game log',
    'the scripted GUIs and widget slots that execute log.clearAll',
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
