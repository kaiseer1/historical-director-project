/**
 * Telling apart the two ways the bridge goes quiet.
 *
 * Both failures present identically from the orchestrator's chair - a staged
 * batch is never acknowledged and nothing arrives - and they need opposite
 * responses from the player, so guessing is worse than saying nothing:
 *
 *  - **The execution pump is dead.** A fullscreen event window killed the
 *    self-recreating console widget, which CK3 does silently and which no
 *    amount of care on our side prevents. The game is otherwise fine. The
 *    Recall decision rebuilds the pump, and so does loading a save.
 *  - **The log subsystem is exhausted.** The engine has written its ~17MB for
 *    this session and has stopped writing at all. The pump may be perfectly
 *    alive and executing everything it is given; we simply cannot see it. Only
 *    restarting CK3 restores logging, and the Recall decision would do nothing
 *    but waste the player's time.
 *
 * The discriminator is the log file itself, not the records in it. If the
 * engine is still writing *anything* - its own chatter, other mods, warnings -
 * the log subsystem is alive and our silence is the pump's fault. If the file
 * has stopped growing altogether, the subsystem is the suspect.
 *
 * That works without knowing whether the game is paused, which the orchestrator
 * has no way to ask: the pump is a GUI widget on a 2-second timer, and GUI
 * timers keep running while the game is paused. A paused game with a live pump
 * still writes its liveness mark, because `RunFileManager.clear` deliberately
 * leaves `hd_mark_alive` outside the token guard for exactly this reason.
 *
 * The 17MB figure and the log.clearAll remedy are the VOTC project's, measured
 * under controlled experiment; see issue #1 on this repository.
 */

/** How long silence has to last before it means something. */
export const DEFAULT_STALL_MS = 120_000;

/** How long a staged batch may go unacknowledged before it is a problem. */
export const DEFAULT_ACK_MS = 15_000;

/**
 * @typedef {object} LivenessInput
 * @property {number} now
 * @property {boolean} everResponded had the game answered us at least once?
 * @property {number} lastLineAt when the log last grew by any line at all
 * @property {number} lastRecordAt when one of *our* records last arrived
 * @property {number|null} pendingSince when the outstanding batch was staged
 * @property {number} bytesSinceClear what the tailer has consumed since a clear
 * @property {number} thresholdBytes the budget's own threshold, for corroboration
 * @property {number} [stallMs]
 * @property {number} [ackMs]
 */

/**
 * @param {LivenessInput} s
 * @returns {{kind: 'log_exhausted'|'pump_dead', text: string, detail: string} | null}
 */
export function assess(s) {
  const stallMs = s.stallMs ?? DEFAULT_STALL_MS;
  const ackMs = s.ackMs ?? DEFAULT_ACK_MS;

  // Nothing has ever answered, so there is no "stopped" to report. Startup
  // already says the game is not talking to us, and saying it twice in
  // different words would read as two problems.
  if (!s.everResponded) return null;

  const lineSilence = s.now - s.lastLineAt;
  const recordSilence = s.now - s.lastRecordAt;

  // Checked first, and that order is the whole point. When the log is
  // exhausted the pump's acknowledgment cannot reach us either, so every
  // pump-dead symptom is present too - and telling the player to use Recall
  // would send them to fix a thing that is not broken with a tool that cannot
  // work.
  if (lineSilence >= stallMs) {
    // Not required for the diagnosis, but it is the difference between naming
    // a suspect and naming a cause, and the player deserves to know which.
    const nearWall = s.bytesSinceClear >= s.thresholdBytes;
    return {
      kind: 'log_exhausted',
      text: 'Log subsystem may be exhausted. Restart CK3 to restore logging.',
      detail: nearWall
        ? `Nothing has been written to debug.log for ${Math.round(lineSilence / 1000)}s, and ${mb(s.bytesSinceClear)} has gone through it since the last clear. CK3 can stop logging after as little as 17MB in a session, and only a restart brings it back. Anything staged since then may have executed in game without us seeing it.`
        : `Nothing has been written to debug.log for ${Math.round(lineSilence / 1000)}s - not our records, not the game's own. That is the log subsystem rather than the pump, and only restarting CK3 restores it.`,
    };
  }

  // The log is alive, so anything the pump did would have reached us.
  const ackOverdue = s.pendingSince !== null && s.now - s.pendingSince >= ackMs;
  if (ackOverdue || recordSilence >= stallMs) {
    return {
      kind: 'pump_dead',
      text: 'Staged action was not picked up. The execution pump may be dead. Use the Recall decision or load a save to restore it.',
      detail: ackOverdue
        ? `A batch was staged ${Math.round((s.now - /** @type {number} */ (s.pendingSince)) / 1000)}s ago and has not been acknowledged, while the game is still writing to debug.log. A fullscreen event window can kill the pump widget without warning; nothing was lost, and the batch will run as soon as the pump is back.`
        : `The game is still writing to debug.log, but none of it has been ours for ${Math.round(recordSilence / 1000)}s. The pump widget is the part that has stopped.`,
    };
  }

  return null;
}

/** @param {number} bytes */
function mb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
