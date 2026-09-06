import fs from 'node:fs';
import path from 'node:path';

/**
 * When the Director last audited, remembered across restarts.
 *
 * The cadence lived only in memory, so every start of the orchestrator reset it
 * to "never" and the next heartbeat triggered an audit. During one testing
 * session that produced twenty-nine audits across six in-game years against a
 * five-year cadence - eight of them inside 1245 alone - each one a retrieval
 * pass and a paid completion over a hundred-and-twenty-realm prompt. The
 * cadence was working exactly as designed and being reset out from under it.
 *
 * A restart still needs a look at the world: the sidebar has nothing to show
 * and the toolkit has no snapshot to address rulers by. But a *snapshot* is
 * free and an *audit* is not, and main.js keeps those apart - one re-orientation
 * snapshot per run, and the paid audit only when the clock says it is due.
 *
 * Campaign identity is tracked by total days rather than by name, the same way
 * Baseline does it. A game that reports an earlier date than the one recorded
 * against is a different campaign or an earlier save, and a cadence carried
 * over from a future that no longer exists would suppress audits for decades.
 */
export class AuditClock {
  /** @param {string} filePath */
  constructor(filePath) {
    this.filePath = filePath;
    /** @type {{lastAuditYear: number, totalDays: number} | null} */
    this.data = null;
    this.load();
  }

  load() {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (parsed && Number.isFinite(parsed.lastAuditYear)) this.data = parsed;
    } catch {
      this.data = null;
    }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch {
      // A clock that cannot be written still works for this run; losing it
      // costs one extra audit next time, which is not worth failing a start
      // over.
    }
  }

  /** @returns {number} -Infinity when nothing has been recorded */
  get lastAuditYear() {
    return this.data ? this.data.lastAuditYear : -Infinity;
  }

  /**
   * Note that an audit ran.
   * @param {number} year
   * @param {number} totalDays
   */
  record(year, totalDays) {
    if (!Number.isFinite(year)) return;
    this.data = { lastAuditYear: year, totalDays: Number(totalDays) || 0 };
    this.save();
  }

  /**
   * Drop the clock if the game is not the campaign it was recorded against.
   *
   * @param {number} totalDays the game's current date
   * @returns {boolean} whether the clock was discarded
   */
  reconcile(totalDays) {
    const now = Number(totalDays) || 0;
    if (!this.data || !now) return false;
    if (now >= this.data.totalDays) return false;

    this.data = null;
    try {
      fs.rmSync(this.filePath, { force: true });
    } catch {
      // Same reasoning as save(): worst case is one extra audit.
    }
    return true;
  }
}
