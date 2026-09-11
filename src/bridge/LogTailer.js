import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { parseLine } from './protocol.js';

/**
 * Follows CK3's debug.log and emits our records as they appear.
 *
 * CK3 truncates the log on each launch, so the tailer has to notice the file
 * shrinking and rewind rather than sitting forever at a stale offset. It also
 * starts at the end of the existing file: history in the log is from previous
 * sessions and replaying it would fire stale snapshots at the Director.
 *
 * It counts bytes as well as reading them, because CK3's log subsystem has a
 * per-session **cumulative** write limit, after which logging stops until the
 * game is restarted. Bytes on disk are not the measure - the engine counts
 * what it has written, not what is still there - so the tailer reports what it
 * has consumed since the last time the log was cleared, and `log.clearAll` is
 * the only thing that resets the engine's count. Found and measured by the
 * VOTC project; see issue #1. Exactly where the limit sits, and whether the
 * two files share it, has not reproduced the same way here - see LogBudget.js.
 *
 * ## Counting the engine's session, not ours
 *
 * Two corrections, both from watching a live 2026-09-08 session where this
 * accounting would have read 0MB while the engine had written 34.6MB.
 *
 * **The count is seeded from what is already on disk.** CK3 truncates its logs
 * on launch, so in a running session the size of debug.log is a lower bound on
 * what the engine has written since the last clear. Starting at zero measured
 * the orchestrator's own uptime instead - and the project's own guide recommended
 * restarting `npm start` to pick up changes, which reset the count every time
 * while the engine's counter carried on climbing.
 *
 * **error.log is counted too, though never read.** Whether the engine's limit
 * is shared between the two files or is per-file is not settled - the evidence
 * is recorded in LogBudget.js, and it leans per-file. Counting both is right
 * either way. If the limit is shared, error.log is half the bill and was
 * invisible here. If it is per-file, error.log is the one that dies: twice on
 * this machine it stopped mid-burst, at 24.8MB and at 27.9MB, while debug.log
 * carried on past 34MB. Clearing on the combined count is what keeps it alive,
 * and error.log is the only place a broken mod effect - a bad scope inside
 * create_faction, say - ever says so.
 *
 * @fires LogTailer#record  {{kind: string, fields: string[]}}
 * @fires LogTailer#cleared {{bytesBefore: number}} the log was cleared under us
 */
export class LogTailer extends EventEmitter {
  /**
   * @param {string} logPath
   * @param {{intervalMs?: number, errorLogPath?: string}} [opts]
   */
  constructor(logPath, opts = {}) {
    super();
    this.logPath = logPath;
    /** Counted against the budget, never parsed. May be absent. */
    this.errorLogPath = opts.errorLogPath ?? null;
    this.intervalMs = opts.intervalMs ?? 500;
    this.offset = 0;
    this.errorOffset = 0;
    this.carry = '';
    this.timer = null;

    /**
     * Bytes the *engine* has written since the last observed clear.
     *
     * This is the number the log-clear budget is spent against, and it is not
     * the same as the number of bytes this process has read: it is seeded from
     * what was already on disk when the tailer attached and includes error.log,
     * which is never read at all. See the note at the top of the file.
     *
     * It resets on a truncation because that is the moment the engine's own
     * counter resets - whether that came from the `log.clearAll` we asked for
     * or from the player restarting the game, which are the same event as far
     * as the budget is concerned.
     */
    this.bytesSinceClear = 0;

    /** Bytes consumed for the whole run, which only ever goes up. */
    this.bytesTotal = 0;

    /** When a line was last read. Zero until the first one arrives. */
    this.lastLineAt = 0;

    /** How many times the log has been observed to shrink. */
    this.clears = 0;
  }

  start() {
    if (this.timer) return;
    this.offset = sizeOf(this.logPath);
    this.errorOffset = sizeOf(this.errorLogPath);

    // Seeded rather than zeroed. Reading starts at the end of the file, because
    // history in the log is from previous sessions and replaying it would fire
    // stale snapshots at the Director - but the *budget* has to start where the
    // engine's own counter already is, and on a running game that is everything
    // presently on disk. The two numbers part company here on purpose.
    this.bytesSinceClear = this.offset + this.errorOffset;

    this.timer = setInterval(() => this.poll(), this.intervalMs);
    this.emit('status', `watching ${this.logPath}`);
    if (this.bytesSinceClear > 0) {
      this.emit('status', `${mb(this.bytesSinceClear)} already written this session, counted against the log budget`);
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  poll() {
    let size;
    try {
      size = fs.statSync(this.logPath).size;
    } catch {
      return; // log not created yet; try again next tick
    }

    // Charged to the budget before anything else. If the engine's limit is
    // shared, these bytes come out of the same allowance; if it is per-file,
    // error.log is the file that has been seen to die. Either way a modded
    // install can pour tens of megabytes in here without writing a line we
    // would read. A shrink is handled by the debug.log branch below, which
    // resets both.
    const errorSize = sizeOf(this.errorLogPath);
    if (errorSize > this.errorOffset) {
      this.bytesSinceClear += errorSize - this.errorOffset;
    }
    if (errorSize !== this.errorOffset) this.errorOffset = errorSize;

    // The log shrank under us. Either the game restarted, or a log.clearAll
    // we asked for has landed. Both mean the same thing to the tailer - the
    // bytes we were counting are gone and so is the engine's own count of them
    // - and both are handled by rewinding rather than by sitting at an offset
    // past the end of a file that will now never reach it again.
    if (size < this.offset) {
      const bytesBefore = this.bytesSinceClear;
      this.offset = 0;
      this.carry = '';
      // Both files, because `log.clearAll` clears both and a game restart
      // truncates both. Leaving error.log's offset where it was would charge
      // the next session for bytes the engine has already forgotten.
      this.errorOffset = sizeOf(this.errorLogPath);
      this.bytesSinceClear = this.errorOffset;
      this.clears += 1;
      this.emit('status', 'log cleared by engine, resetting tailer');
      this.emit('cleared', { bytesBefore });
    }
    if (size === this.offset) return;

    let chunk = '';
    try {
      const fd = fs.openSync(this.logPath, 'r');
      const len = size - this.offset;
      const buf = Buffer.allocUnsafe(len);
      fs.readSync(fd, buf, 0, len, this.offset);
      fs.closeSync(fd);
      chunk = buf.toString('utf8');
    } catch (err) {
      this.emit('status', `read error: ${err.message}`);
      return;
    }
    this.offset = size;
    this.bytesSinceClear += chunk.length;
    this.bytesTotal += chunk.length;

    // A read can land mid-line; hold the tail back until its newline arrives.
    const text = this.carry + chunk;
    const lines = text.split(/\r?\n/);
    this.carry = lines.pop() ?? '';

    if (lines.length) this.lastLineAt = Date.now();

    for (const line of lines) {
      const rec = parseLine(line);
      if (rec) this.emit('record', rec);
    }
  }
}

/**
 * A file's size, or zero if it is missing or unreadable.
 *
 * Zero rather than a throw: a log CK3 has not created yet is a normal state at
 * startup, and a budget that cannot be read is better under-counted than fatal.
 *
 * @param {string|null} p
 */
function sizeOf(p) {
  if (!p) return 0;
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

/** @param {number} bytes */
function mb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
