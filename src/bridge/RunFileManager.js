import fs from 'node:fs';
import path from 'node:path';

/**
 * Stages CK3 effect script for the mod's execution pump to run.
 *
 * The pump re-runs `run hd.txt` every couple of seconds and has no way to know
 * it has already executed what is in there. So every batch is wrapped in a
 * token guard: the script checks a global variable against the batch's token
 * and does nothing if it matches, meaning a batch executes exactly once no
 * matter how many times the pump picks it up. The orchestrator clears the file
 * once it sees the matching `applied` record come back through the log.
 */
/** Tells the mod's watchdog the pump is still executing this file. */
const HD_ALIVE = 'hd_mark_alive = yes';

/**
 * CK3 wants its script files with a byte-order mark, and says so.
 *
 * Without it every single `run hd.txt` writes this to error.log:
 *
 *   [E][lexer.cpp:306]: File 'run/hd.txt' should be in utf8-bom encoding
 *   (will try to use it anyways)
 *
 * "Anyways" is doing a lot of work there. Watched live on 2026-09-08: 13 pump
 * ticks, 13 warnings, one-to-one, and each one immediately followed by CK3
 * re-validating its whole script database and dumping several thousand
 * "Variable X is used but is never set" lines across every loaded mod. At a
 * two-second cadence that reached **9,900 lines per second** into debug.log and
 * error.log together, and drove the log budget through three clears in three
 * minutes. The Director's own snapshots were not the dominant log cost by two
 * orders of magnitude; this was.
 *
 * Whether the BOM stops the revalidation or only the warning is an empirical
 * question and the answer is in the next session's line counts. It costs three
 * bytes either way.
 *
 * VOTC specifies "UTF-8 BOM, single write" for its own run file in issue #1
 * §2.2. That reads like a detail until you have watched this happen, at which
 * point it reads like something they paid for too.
 */
const BOM = '﻿';

export class RunFileManager {
  /** @param {string} ck3UserFolder */
  constructor(ck3UserFolder) {
    this.runDir = path.join(ck3UserFolder, 'run');
    this.filePath = path.join(this.runDir, 'hd.txt');
    this.token = Date.now() % 1_000_000;
    fs.mkdirSync(this.runDir, { recursive: true });
  }

  /** @returns {number} the token this batch will be guarded by */
  nextToken() {
    this.token = (this.token + 1) % 1_000_000;
    return this.token;
  }

  /**
   * Write a guarded batch of effect calls.
   *
   * @param {string[]} effectCalls lines of CK3 script, already parameterised
   * @param {number} token from nextToken()
   */
  write(effectCalls, token) {
    const body = effectCalls.map((c) => `\t\t${c}`).join('\n');
    const script = [
      `# Historical Director batch ${token} - generated, do not edit by hand`,
      // Outside the guard on purpose. The mod's yearly watchdog uses this flag
      // to decide whether the pump still exists, so it has to be refreshed on
      // every pass, not once per batch. Inside the guard, an idle app leaving a
      // spent batch in place would look exactly like a dead pump.
      HD_ALIVE,
      '',
      `if = {`,
      `\tlimit = {`,
      `\t\tOR = {`,
      `\t\t\tNOT = { has_global_variable = hd_token }`,
      `\t\t\tNOT = { global_var:hd_token = ${token} }`,
      `\t\t}`,
      `\t}`,
      `\tset_global_variable = { name = hd_token value = ${token} }`,
      body,
      `}`,
      '',
    ].join('\n');
    fs.writeFileSync(this.filePath, BOM + script, 'utf8');
    return script;
  }

  /**
   * Retire the current batch but keep the pump reporting for duty. Writing an
   * empty file here would silence the liveness mark and get the pump torn down
   * and rebuilt once a year for no reason.
   */
  clear() {
    try {
      fs.writeFileSync(this.filePath, `${BOM}${HD_ALIVE}\n`, 'utf8');
    } catch { /* the game may hold it briefly; the next clear will catch it */ }
  }
}
