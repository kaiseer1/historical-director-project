import fs from 'node:fs';
import path from 'node:path';

/**
 * The Lore Book: a persistent ledger of every judgement the player has made.
 *
 * This is the answer to context amnesia over a three-century campaign. The
 * Director cannot hold the whole game in its context, and summarising the
 * conversation does not help when the campaign has no conversation — so what
 * gets carried forward is the decision record: what was proposed, what the
 * player did about it, and one line of why.
 *
 * Declines are kept as carefully as approvals. A Director that only remembers
 * what was accepted will propose the same rejected correction every year, and
 * the player will stop reading the sidebar.
 */
/**
 * How long an approval suppresses the same proposal, in in-game years.
 *
 * About a reign. Long enough to cover the repeats actually observed - one
 * campaign re-granted the same claim across twelve years, and another twice in
 * one - and short enough that a genuinely changed situation a generation later
 * is judged on its own terms rather than refused by a decision someone's
 * grandfather made.
 */
const REPEAT_WINDOW_YEARS = 25;

/**
 * Actions that do the same thing to the world, grouped by what they do.
 *
 * The guard first fingerprinted on the verb, which let the same effect through
 * under a second name: Alfonso VIII had been granted a pressed claim on Leon six
 * times as `grant_claim`, and `historical_moment` proposed a seventh because it
 * is spelled differently. Both grant a pressed claim on the same title; the
 * claim after the first is a no-op and the war chest beside it is not.
 *
 * Only actions with genuinely interchangeable effects belong together.
 * `iberian_pressure` grants truces, alliances and hooks and stays on its own.
 */
const EFFECT_CLASS = {
  grant_claim: 'pressed_claim',
  historical_moment: 'pressed_claim',
};

/**
 * The identity of an action: what it does, and to whom.
 *
 * Deliberately only the character ids. `momentum`, `intensity` and `value` are
 * left out because a claim granted with reconquista momentum and the same claim
 * granted with succession pressure are the same claim - the second adds nothing
 * but another war chest, which is precisely the duplication being caught.
 *
 * Null when the action names no characters, which means the entry predates
 * argument recording and cannot be matched this way.
 *
 * @param {string} action
 * @param {object} [args]
 * @returns {string|null}
 */
function fingerprintOf(action, args) {
  if (!action || !args || typeof args !== 'object') return null;
  const effect = EFFECT_CLASS[action] ?? action;

  const ids = [];
  for (const key of ['actor', 'target', 'host', 'unifier']) {
    const v = Number(args[key]);
    if (Number.isFinite(v)) ids.push(v);
  }
  for (const v of Array.isArray(args.partners) ? args.partners : []) {
    const n = Number(v);
    if (Number.isFinite(n)) ids.push(n);
  }

  if (ids.length === 0) return null;
  return `${effect}:${[...ids].sort((a, b) => a - b).join(',')}`;
}

export class LoreBook {
  /** @param {string} filePath */
  constructor(filePath) {
    this.filePath = filePath;
    /** @type {Array<any>} */
    this.entries = [];
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        this.entries = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        if (!Array.isArray(this.entries)) this.entries = [];
      }
    } catch {
      this.entries = [];
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.entries, null, 2), 'utf8');
  }

  /**
   * @param {{date: string, year: number, verdict: 'approved'|'declined', action: string,
   *          summary: string, args?: object, rationale?: string, sources?: string[]}} entry
   */
  record(entry) {
    this.entries.push({
      ...entry,
      // Stored so a later audit can tell "the same thing again" from "something
      // that reads similarly". Names cannot do it: the same Alfonso appears in
      // this ledger as "Alfonso VIII Sanchez" and later as "Alfonso VIII the
      // King of Dice", because CK3 renders nicknames into the title and they
      // change during a reign.
      fingerprint: fingerprintOf(entry.action, entry.args),
      recordedAt: new Date().toISOString(),
    });
    this.save();
  }

  /**
   * Has this exact action against these exact characters already been approved
   * recently?
   *
   * The gap this closes was expensive. The prompt was handed a "do not raise
   * again" list built only from declines, so the Director re-proposed its own
   * approved work indefinitely: one campaign approved Alfonso VIII's claim on
   * Leon in 1193, 1199, 1200, 1201 and 1205, and the same claim on Calatayud
   * twice in six months. Twenty-eight of thirty-four ledger entries were
   * approvals and a large share were repeats.
   *
   * The redundant half is harmless - a pressed claim already held is a no-op -
   * but momentum is not. Every repeat granted another thousand gold, another
   * thousand prestige and a fresh thirty-year appetite for war, so the
   * duplicates compounded into exactly the kind of distorted map the Director
   * exists to correct.
   *
   * A window rather than forever, because character ids identify the living: a
   * genuinely new situation a generation later deserves to be judged again, and
   * a ruler dead for fifty years cannot be the subject of a new proposal
   * anyway.
   *
   * @param {string} action
   * @param {object} args
   * @param {number} year the year being audited
   * @returns {{date: string, year: number} | null} the approval this repeats
   */
  approvedMatch(action, args, year) {
    const wanted = fingerprintOf(action, args);
    if (!wanted) return null;

    for (let i = this.entries.length - 1; i >= 0; i -= 1) {
      const e = this.entries[i];
      if (e.verdict !== 'approved' || e.fingerprint !== wanted) continue;
      if (Number.isFinite(year) && Number.isFinite(e.year) && year - e.year > REPEAT_WINDOW_YEARS) continue;
      return { date: e.date, year: e.year };
    }
    return null;
  }

  /**
   * Approvals, so the Director can be told plainly what it has already done.
   *
   * The instruction half of the same fix. The guard above catches repeats
   * precisely but only for entries recorded with their arguments, and a ledger
   * written before that carries none - so this tells the model in prose, which
   * costs nothing and works on the whole history. Per this project's own
   * lesson, an instruction is not a guard: it is here alongside one, not
   * instead of it.
   *
   * @param {number} [limit]
   */
  approvedSummaries(limit = 15) {
    return this.entries
      .filter((e) => e.verdict === 'approved')
      .slice(-limit)
      .map((e) => `${e.date}: ${e.summary}`);
  }

  /**
   * The ledger as it goes back into the prompt. Newest last, so the model
   * reads it as a chronicle running up to the present moment.
   *
   * @param {number} [limit]
   */
  asPromptContext(limit = 25) {
    if (this.entries.length === 0) return 'No prior interventions. This is the first audit of this campaign.';
    return this.entries
      .slice(-limit)
      .map((e) => `${e.date} - ${e.verdict.toUpperCase()}: ${e.summary}`)
      .join('\n');
  }

  /** Declines, so the Director can be told plainly what not to raise again. */
  declinedSummaries(limit = 15) {
    return this.entries
      .filter((e) => e.verdict === 'declined')
      .slice(-limit)
      .map((e) => e.summary);
  }

  all() {
    return [...this.entries];
  }
}
