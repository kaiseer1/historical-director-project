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
   *          summary: string, rationale?: string, sources?: string[]}} entry
   */
  record(entry) {
    this.entries.push({ ...entry, recordedAt: new Date().toISOString() });
    this.save();
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
