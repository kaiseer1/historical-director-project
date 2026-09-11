import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { appHome } from './runtime.js';

// Where config.json and the two ledgers live. In the repo that is the project
// folder; in the built executable it is the folder the .exe sits in; under a
// test harness it is whatever HD_HOME points at. See runtime.js.
const ROOT = appHome();

/** The default CK3 user folder, which is where the log and run file live. */
function defaultCk3Folder() {
  return path.join(os.homedir(), 'Documents', 'Paradox Interactive', 'Crusader Kings III');
}

/**
 * Load config.json, falling back to config.example.json and then to defaults.
 *
 * The API key is read from the environment first. Keeping it out of the config
 * file by default means the file stays safe to commit and to paste into a bug
 * report, which is not true of the way VOTC stores its keys.
 */
export function loadConfig() {
  const configPath = path.join(ROOT, 'config.json');
  const examplePath = path.join(ROOT, 'config.example.json');

  /** @type {any} */
  let raw = {};
  if (fs.existsSync(configPath)) {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } else if (fs.existsSync(examplePath)) {
    raw = JSON.parse(fs.readFileSync(examplePath, 'utf8'));
  }

  const ck3UserFolder = raw.ck3UserFolder && fs.existsSync(raw.ck3UserFolder)
    ? raw.ck3UserFolder
    : defaultCk3Folder();

  const llm = raw.llm ?? {};
  const apiKey = process.env[llm.apiKeyEnv ?? 'HD_API_KEY'] || llm.apiKey || '';

  return {
    root: ROOT,
    ck3UserFolder,
    debugLogPath: path.join(ck3UserFolder, 'logs', 'debug.log'),
    // Counted against the same budget, never read. Whether CK3's write limit is
    // shared between the two files or is per-file is unsettled, and counting
    // both is the safe choice either way: a modded install can put tens of
    // megabytes into error.log without a line reaching debug.log, and error.log
    // is the file that has been seen to die. See bridge/LogTailer.js.
    errorLogPath: path.join(ck3UserFolder, 'logs', 'error.log'),
    port: raw.port ?? 7842,
    loreBookPath: path.join(ROOT, 'lorebook.json'),
    baselinePath: path.join(ROOT, 'baseline.json'),
    auditClockPath: path.join(ROOT, 'auditclock.json'),
    llm: {
      baseUrl: llm.baseUrl ?? 'https://api.deepseek.com',
      model: llm.model ?? 'deepseek-chat',
      apiKey,
      // Carried through so the settings panel can name the variable it wants
      // you to set, without hardcoding it in two more places.
      apiKeyEnv: llm.apiKeyEnv ?? 'HD_API_KEY',
      temperature: llm.temperature ?? 0.2,
      maxTokens: llm.maxTokens ?? 2000,
    },
    director: {
      // How many in-game years pass between audits. The single most
      // consequential number here: it sets both how often the Director speaks
      // and how much a campaign costs to run, since every audit is a retrieval
      // pass and a paid completion.
      auditEveryYears: raw.director?.auditEveryYears ?? 5,
      // How far the sphere grows outward from the player, in steps through the
      // adjacency graph, and how many regions it may hold in total. Reach was
      // hardcoded at 1 and the cap at 6; both are now the player's to set,
      // because how wide the window should be is a judgement about the campaign
      // and about what the player wants to spend, not a constant. See
      // director/sphere.js.
      sphereReach: raw.director?.sphereReach ?? 2,
      sphereMax: raw.director?.sphereMax ?? 12,
      maxRealmsInPrompt: raw.director?.maxRealmsInPrompt ?? 60,
      maxProposalsPerAudit: raw.director?.maxProposalsPerAudit ?? 2,
      requireApproval: raw.director?.requireApproval !== false,
      // How many megabytes of log to count before asking the game to clear it.
      // VOTC measured CK3 stopping logging after roughly 17MB of cumulative
      // writes in a session, with only the in-game log.clearAll resetting that
      // counter - truncating the file from outside does not, which was
      // established by controlled experiment rather than argument. It has not
      // reproduced at that figure on this machine (see bridge/LogBudget.js),
      // and the threshold stays conservative on purpose. 4MB leaves better than a
      // fourfold margin, which is not politeness: the request is asynchronous
      // and the widget servicing it may be dead, so the margin has to cover a
      // request nobody answers. See bridge/LogBudget.js and issue #1.
      logClearThresholdMB: raw.director?.logClearThresholdMB ?? 4,
      // How often the mod's execution pump re-runs the staged file, in
      // seconds. Unlike every other setting here this one lives in the mod,
      // not the orchestrator: it is written into hd_runner.gui at deploy time,
      // so changing it needs `npm run deploy:mod` and a CK3 restart rather
      // than taking effect on the next audit.
      //
      // Two seconds is the responsive default. Raising it is a real lever on
      // log volume rather than a micro-optimisation: each `run` makes CK3
      // re-validate its entire script database and re-report every unset
      // variable in every loaded mod, measured at 315 error.log lines per tick
      // on a heavy modlist. Ten seconds cuts that by 80%, at the cost of up to
      // ten seconds between approving an action and it reaching the game -
      // which is cheap when the Director's own cadence is measured in in-game
      // years. See bridge/RunFileManager.js and setup/deployMod.js.
      pumpIntervalSeconds: clampInterval(raw.director?.pumpIntervalSeconds),
      // How long a staged batch may go unacknowledged before the sidebar says
      // the execution pump looks dead.
      ackTimeoutSeconds: raw.director?.ackTimeoutSeconds ?? 15,
      // How long the log may go completely silent before the sidebar says the
      // log subsystem itself looks exhausted. Longer than the one above,
      // because it is diagnosing a slower and more expensive thing.
      stallMinutes: raw.director?.stallMinutes ?? 2,
    },
    knowledge: {
      enabled: raw.knowledge?.enabled !== false,
      wikipediaLang: raw.knowledge?.wikipediaLang ?? 'en',
      maxDocuments: raw.knowledge?.maxDocuments ?? 6,
    },
  };
}

/** @param {any} cfg */
export function describeConfig(cfg) {
  return [
    `CK3 folder : ${cfg.ck3UserFolder}`,
    `debug.log  : ${fs.existsSync(cfg.debugLogPath) ? 'found' : 'NOT FOUND (start CK3 with -debug_mode once)'}`,
    `model      : ${cfg.llm.model} @ ${cfg.llm.baseUrl}`,
    `api key    : ${cfg.llm.apiKey ? 'set' : 'MISSING (set HD_API_KEY)'}`,
    `audit every: ${cfg.director.auditEveryYears} in-game years`,
    `sphere     : reach ${cfg.director.sphereReach}, up to ${cfg.director.sphereMax} regions`,
    `log clear  : every ${cfg.director.logClearThresholdMB}MB written to debug.log and error.log`,
    `pump every : ${cfg.director.pumpIntervalSeconds}s (needs a redeploy and a CK3 restart to change)`,
    `knowledge  : ${cfg.knowledge.enabled ? 'Wikipedia + Wikidata' : 'disabled'}`,
  ].join('\n');
}

/**
 * The pump interval, kept inside what CK3 and the rest of the bridge can take.
 *
 * Below one second the widget rebuilds faster than the engine reliably runs the
 * file, and above thirty the acknowledgment machinery starts reporting a
 * healthy pump as dead - the timeouts scale off this, but they cannot scale
 * indefinitely without making a genuinely dead pump invisible for minutes.
 *
 * @param {unknown} v
 * @returns {number}
 */
function clampInterval(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 2;
  return Math.min(30, Math.max(1, Math.round(n)));
}
