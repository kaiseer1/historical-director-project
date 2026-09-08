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
      // How many megabytes of debug.log to read before asking the game to clear
      // it. CK3 stops logging entirely after roughly 17MB of cumulative writes
      // in a session, and only the in-game log.clearAll resets that counter -
      // truncating the file from outside does not, which was established by
      // controlled experiment rather than argument. 4MB leaves better than a
      // fourfold margin, which is not politeness: the request is asynchronous
      // and the widget servicing it may be dead, so the margin has to cover a
      // request nobody answers. See bridge/LogBudget.js and issue #1.
      logClearThresholdMB: raw.director?.logClearThresholdMB ?? 4,
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
    `log clear  : every ${cfg.director.logClearThresholdMB}MB read from debug.log`,
    `knowledge  : ${cfg.knowledge.enabled ? 'Wikipedia + Wikidata' : 'disabled'}`,
  ].join('\n');
}
