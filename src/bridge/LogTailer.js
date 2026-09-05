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
 * @fires LogTailer#record  {{kind: string, fields: string[]}}
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

    // Game restarted and truncated the log out from under us.
    if (size < this.offset) {
      this.offset = 0;
      this.carry = '';
      this.emit('status', 'debug.log was truncated, rewound to start');
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

    // A read can land mid-line; hold the tail back until its newline arrives.
    const text = this.carry + chunk;
    const lines = text.split(/\r?\n/);
    this.carry = lines.pop() ?? '';

    for (const line of lines) {
      const rec = parseLine(line);
      if (rec) this.emit('record', rec);
    }
  }
}
