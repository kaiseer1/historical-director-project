import fs from 'node:fs';
import path from 'node:path';

import { pressureAfter, PRESSURE_BREAK } from '../director/dispatches.js';

/**
 * What the world remembers about how it has been answered.
 *
 * ## Why this has to persist
 *
 * The whole consent argument for a coalition rests on the player having been
 * warned three times and having chosen silence each time. Pressure that resets
 * when the orchestrator restarts is not escalation, it is a mood - and a world
 * that forgets being ignored the moment you close a window cannot honestly
 * hold anything against you.
 *
 * It is also the difference between a dispatch and a notification. A message
 * that arrives, is dismissed, and leaves no trace is the sidebar talking to
 * itself.
 *
 * ## Pressure belongs to the realm, not to the ruler
 *
 * Keyed on the primary title. Castile is Castile across three kings, and the
 * grievance a crown holds is a fact about the crown.
 *
 * Character ids cannot do this job - the LoreBook uses them deliberately, for
 * the opposite reason, because an *action* is against a person who can die. A
 * stance is not. Fernando III dying does not mean Castile stops noticing that
 * three Catholic realms are smaller than they were.
 *
 * ## But a death is relief
 *
 * A succession decays pressure by one. Not to zero: a new king inherits his
 * father's frontier, his father's losses and his father's court, and the record
 * is short of rulers who forgot a grievance the week they were crowned. But a
 * rival's death is genuinely an opening, the moment when a hard line can be
 * walked back without anyone losing face, and a world where it changes nothing
 * would be a world where nobody's death matters.
 *
 * That is what `sawRuler` is for, and it is why the ledger stores a ruler name
 * it never uses to identify anything.
 */
export class DispatchLedger {
  /** @param {string} filePath */
  constructor(filePath) {
    this.filePath = filePath;
    /** @type {Record<string, any>} */
    this.realms = {};
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        this.realms = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
      }
    } catch {
      // A corrupt ledger is a world that has forgotten, which is recoverable.
      // Refusing to start over it is not.
      this.realms = {};
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.realms, null, 2), 'utf8');
  }

  /**
   * The key a realm is remembered under.
   *
   * Empty for a realm with no primary title, and every method below treats that
   * as "cannot be remembered" rather than inventing a key. A realm the snapshot
   * could not name is one whose grievance we have no honest way to carry.
   *
   * @param {any} realm
   * @returns {string}
   */
  static keyOf(realm) {
    return String(realm?.primaryTitle ?? '').trim();
  }

  /**
   * What this realm currently feels, and how it got there.
   *
   * @param {any} realm
   * @returns {{pressure: number, ruler: string, replies: Array<any>, lastDate: string}}
   */
  entry(realm) {
    const k = DispatchLedger.keyOf(realm);
    const e = k ? this.realms[k] : null;
    return {
      pressure: Number.isFinite(e?.pressure) ? e.pressure : 0,
      ruler: e?.ruler ?? '',
      replies: Array.isArray(e?.replies) ? e.replies : [],
      lastDate: e?.lastDate ?? '',
    };
  }

  /** @param {any} realm */
  pressureOf(realm) {
    return this.entry(realm).pressure;
  }

  /**
   * Note who is on the throne, and decay pressure if it is somebody new.
   *
   * Called once per realm per audit, before any dispatch is built from it, so a
   * dispatch that goes out under a new king goes out at the softened figure
   * rather than at his father's.
   *
   * A realm seen for the first time is not a succession. It records the ruler
   * and changes nothing, because "we have never looked at you" and "your
   * predecessor died" are different facts and only one of them is mercy.
   *
   * @param {any} realm
   * @param {string} date
   * @returns {{decayed: boolean, from: string, to: string, pressure: number}}
   */
  sawRuler(realm, date = '') {
    const k = DispatchLedger.keyOf(realm);
    const to = String(realm?.ruler ?? '').trim();
    if (!k || !to) return { decayed: false, from: '', to, pressure: this.pressureOf(realm) };

    const prev = this.realms[k];
    if (!prev) {
      this.realms[k] = { pressure: 0, ruler: to, replies: [], lastDate: date };
      this.save();
      return { decayed: false, from: '', to, pressure: 0 };
    }

    const from = String(prev.ruler ?? '');
    if (!from || from === to) {
      return { decayed: false, from, to, pressure: this.pressureOf(realm) };
    }

    const before = Number.isFinite(prev.pressure) ? prev.pressure : 0;
    prev.pressure = Math.max(0, before - 1);
    prev.ruler = to;
    prev.lastDate = date || prev.lastDate;
    this.save();
    return { decayed: before > 0, from, to, pressure: prev.pressure };
  }

  /**
   * Record what the player said, and move the pressure.
   *
   * The reply is stored as well as its effect on the number, because the number
   * alone cannot answer the question this ledger exists to answer: not "how
   * angry is Castile" but "what was Castile told, and what did the player say
   * back". A coalition that arrives has to be explicable, line by line, from
   * this list.
   *
   * @param {any} realm
   * @param {string} replyKey
   * @param {{date?: string, year?: number, stance?: string}} [ctx]
   * @returns {{pressure: number, breaking: boolean}}
   */
  record(realm, replyKey, ctx = {}) {
    const k = DispatchLedger.keyOf(realm);
    if (!k) return { pressure: 0, breaking: false };

    const e = this.realms[k] ?? { pressure: 0, ruler: String(realm?.ruler ?? ''), replies: [], lastDate: '' };
    const before = Number.isFinite(e.pressure) ? e.pressure : 0;
    const after = pressureAfter(before, replyKey);

    e.pressure = after;
    e.ruler = String(realm?.ruler ?? e.ruler ?? '');
    e.lastDate = ctx.date ?? e.lastDate ?? '';
    e.replies = [
      ...(Array.isArray(e.replies) ? e.replies : []),
      {
        reply: replyKey,
        stance: ctx.stance ?? '',
        date: ctx.date ?? '',
        year: ctx.year ?? 0,
        ruler: e.ruler,
        pressureBefore: before,
        pressureAfter: after,
        recordedAt: new Date().toISOString(),
      },
    ].slice(-40);

    this.realms[k] = e;
    this.save();
    return { pressure: after, breaking: after >= PRESSURE_BREAK };
  }

  /**
   * Realms that have run out of patience.
   *
   * This is the list a coalition is eventually drawn from, and nothing else
   * should be. A realm reaching this list has written at least three times and
   * been answered with silence or defiance every time.
   *
   * @returns {Array<{title: string, pressure: number, ruler: string, replies: Array<any>}>}
   */
  atBreakingPoint() {
    return Object.entries(this.realms)
      .filter(([, e]) => (Number.isFinite(e?.pressure) ? e.pressure : 0) >= PRESSURE_BREAK)
      .map(([title, e]) => ({
        title,
        pressure: e.pressure,
        ruler: e.ruler ?? '',
        replies: Array.isArray(e.replies) ? e.replies : [],
      }));
  }

  /**
   * The receipts: what this realm was told and what the player said back.
   *
   * Rendered for the sidebar when something finally happens, so a coalition can
   * be read as a consequence rather than as the Director turning on the player.
   * If this cannot be produced, the coalition should not fire.
   *
   * @param {string} title
   * @returns {string}
   */
  historyOf(title) {
    const e = this.realms[title];
    const replies = Array.isArray(e?.replies) ? e.replies : [];
    if (replies.length === 0) return `${title} has never been answered, nor written to.`;

    const lines = replies.map((r) => {
      const when = r.date || `year ${r.year}`;
      return `  ${when}: ${r.ruler || 'they'} wrote as ${r.stance || 'concerned'};`
        + ` you chose "${r.reply}" (pressure ${r.pressureBefore} to ${r.pressureAfter})`;
    });
    return `${title}, pressure ${e.pressure} of ${PRESSURE_BREAK}:\n${lines.join('\n')}`;
  }

  /** Everything, for the sidebar. */
  all() {
    return Object.entries(this.realms).map(([title, e]) => ({ title, ...e }));
  }
}
