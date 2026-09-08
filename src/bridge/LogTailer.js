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
 * per-session **cumulative** write limit of roughly 17MB, after which debug.log
 * and error.log both stop writing until the game is restarted. Bytes on disk
 * are not the measure - the engine counts what it has written, not what is
 * still there - so the tailer reports what it has consumed since the last time
 * the log was cleared, and `log.clearAll` is the only thing that resets both
 * counters at once. Found and measured by the VOTC project; see issue #1.
 *
 * @fires LogTailer#record  {{kind: string, fields: string[]}}
 * @fires LogTailer#cleared {{bytesBefore: number}} the log was cleared under us
 */
export class LogTailer extends EventEmitter {
  /**
   * @param {string} logPath
   * @param {{intervalMs?: number}} [opts]
   */
  constructor(logPath, opts = {}) {
    super();
    this.logPath = logPath;
    this.intervalMs = opts.intervalMs ?? 500;
    this.offset = 0;
    this.carry = '';
    this.timer = null;

    /**
     * Bytes consumed since the last observed clear.
     *
     * This is the number the log-clear budget is spent against. It resets on a
     * truncation because that is the moment the engine's own counter resets -
     * but only when the clear came from `log.clearAll`, which is the only
     * clear this process ever causes.
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
    try {
      this.offset = fs.existsSync(this.logPath) ? fs.statSync(this.logPath).size : 0;
    } catch {
      this.offset = 0;
    }
    this.timer = setInterval(() => this.poll(), this.intervalMs);
    this.emit('status', `watching ${this.logPath}`);
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

    // The log shrank under us. Either the game restarted, or a log.clearAll
    // we asked for has landed. Both mean the same thing to the tailer - the
    // bytes we were counting are gone and so is the engine's own count of them
    // - and both are handled by rewinding rather than by sitting at an offset
    // past the end of a file that will now never reach it again.
    if (size < this.offset) {
      const bytesBefore = this.bytesSinceClear;
      this.offset = 0;
      this.carry = '';
      this.bytesSinceClear = 0;
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
