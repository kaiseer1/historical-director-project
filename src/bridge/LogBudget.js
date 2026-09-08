/**
 * Keeping CK3's log subsystem alive across a long campaign.
 *
 * ## The wall
 *
 * CK3's log subsystem has a per-session **cumulative** write limit of roughly
 * 17MB. Once it is reached, `debug.log` and `error.log` both stop writing and
 * only restarting the game brings them back. The limit counts what the engine
 * has written, not what is currently on disk, which has two consequences that
 * are easy to get wrong:
 *
 *  - **Truncating the file from outside does not help.** The engine keeps
 *    counting. A controlled experiment truncating at every 4MB still died at
 *    17.6MB cumulative.
 *  - **`log.clearAll` does help**, because it is an engine command and resets
 *    the engine's own counter. The same experiment ran past 59.6MB cumulative
 *    and was still logging.
 *
 * Both numbers are the VOTC project's, measured rather than reasoned about;
 * see issue #1 on this repository. The Historical Director is a heavy writer -
 * a single snapshot of a wide sphere emits thousands of lines - so this is not
 * a theoretical ceiling for it. It is a wall a long campaign will hit.
 *
 * ## Why this is a request rather than a call
 *
 * `log.clearAll` is a console command, and nothing in effect script can run
 * one: there is no such effect in the game files, and the run file the
 * orchestrator stages contains effects. Only a GUI widget can reach the
 * console. So the orchestrator cannot clear the log; it can only *ask*, by
 * setting a global variable that a widget in the companion mod is watching.
 *
 * That makes the request asynchronous and unacknowledged, which is why the
 * budget below is spent optimistically and reset by observation: the tailer
 * seeing the log shrink is the only confirmation that ever arrives, and it is
 * indistinguishable from the player restarting the game. Treating those two as
 * the same event is correct - both mean the engine's counter is back to zero.
 */

/** Bytes in a megabyte, as the config means it. */
const MB = 1024 * 1024;

/**
 * The slots a request can be made through.
 *
 * One slot would do if a GUI state re-triggered reliably on the same variable
 * going false and true again. Rotating means each consecutive request is a
 * genuine false-to-true transition on a *different* state, which is the shape
 * VOTC validated in a live game rather than the shape that ought to work.
 */
export const CLEAR_SLOTS = ['a', 'b', 'c', 'd'];

export class LogBudget {
  /**
   * @param {{thresholdMB?: number, minGapMs?: number}} [opts]
   */
  constructor(opts = {}) {
    /**
     * Bytes to spend before asking for a clear.
     *
     * The default of 4MB leaves better than a 4x margin against the observed
     * 17MB wall. The margin is not politeness: the request is asynchronous and
     * the widget servicing it may be dead, so the budget has to cover a
     * request that is never answered plus everything written while nobody
     * notices.
     */
    this.thresholdBytes = Math.max(1, opts.thresholdMB ?? 4) * MB;

    /**
     * The shortest interval between two requests.
     *
     * A clear takes a moment to land and the tailer only learns of it on its
     * next poll, so without this the budget would still read "over" on the
     * next tick and fire a second request into a second slot for the same
     * overage - burning the rotation four times over in two seconds.
     */
    this.minGapMs = opts.minGapMs ?? 30_000;

    /** @type {number} index into CLEAR_SLOTS */
    this.slotIndex = 0;

    /** @type {number} when the last request was staged */
    this.lastRequestAt = 0;

    /** @type {number} how many requests have been staged this session */
    this.requests = 0;

    /** @type {number} how many were seen to land */
    this.confirmed = 0;
  }

  /**
   * Should a clear be asked for right now?
   *
   * Every reason to say no is a reason the request would be wrong rather than
   * merely early, so they are all here rather than spread across the caller.
   *
   * @param {{bytesSinceClear: number, pendingAck: boolean, supported: boolean, now?: number}} state
   * @returns {{due: false, reason: string} | {due: true, slot: string}}
   */
  due(state) {
    const now = state.now ?? Date.now();

    // A mod too old to carry the executor would take the request as a global
    // variable nothing ever reads, and the budget would never reset - so the
    // orchestrator would ask again every tick, for ever, and still hit the
    // wall. Refusing here keeps the failure legible.
    if (!state.supported) return { due: false, reason: 'the deployed mod cannot service a log clear' };

    if (state.bytesSinceClear < this.thresholdBytes) return { due: false, reason: 'under threshold' };

    // The hard rule. A clear is a console command executed by the same widget
    // that runs the staged batch, and clearing the log destroys the echo an
    // in-flight batch is about to write. The orchestrator would then wait out
    // the acknowledgment timeout and report a dead pump for a batch that
    // actually ran. Waiting costs bytes; clearing costs the truth.
    if (state.pendingAck) return { due: false, reason: 'a staged batch is still waiting to be acknowledged' };

    if (now - this.lastRequestAt < this.minGapMs) return { due: false, reason: 'a request was made moments ago' };

    return { due: true, slot: CLEAR_SLOTS[this.slotIndex % CLEAR_SLOTS.length] };
  }

  /** Record that a request was staged, and move to the next slot. */
  staged(now = Date.now()) {
    const slot = CLEAR_SLOTS[this.slotIndex % CLEAR_SLOTS.length];
    this.slotIndex += 1;
    this.lastRequestAt = now;
    this.requests += 1;
    return slot;
  }

  /** Record that the log was seen to shrink, whoever caused it. */
  confirmedClear() {
    this.confirmed += 1;
  }

  /**
   * The effects that make the request.
   *
   * Two of them, and both matter. The variable is what the widget's scripted
   * GUI is watching. Retiring the *previous* slot in the same batch is what
   * keeps the rotation reusable across a long campaign: a slot whose variable
   * is still set would never present a false-to-true edge when its turn came
   * round again, so the fifth clear of a session would silently do nothing.
   *
   * @param {string} slot
   * @returns {string[]} lines of CK3 effect script
   */
  static requestScript(slot) {
    const i = CLEAR_SLOTS.indexOf(slot);
    const previous = CLEAR_SLOTS[(i - 1 + CLEAR_SLOTS.length) % CLEAR_SLOTS.length];
    return [
      `if = {`,
      `\tlimit = { has_global_variable = hd_log_clear_${previous} }`,
      `\tremove_global_variable = hd_log_clear_${previous}`,
      `}`,
      `set_global_variable = { name = hd_log_clear_${slot} value = 1 }`,
      `debug_log = "HD:/;/log_clear_requested/;/${slot}"`,
    ];
  }

  /** For the sidebar: how close to the wall, as a fraction. */
  pressure(bytesSinceClear) {
    return this.thresholdBytes > 0 ? bytesSinceClear / this.thresholdBytes : 0;
  }
}
