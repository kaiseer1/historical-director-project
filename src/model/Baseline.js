import fs from 'node:fs';
import path from 'node:path';
import { isMidCampaignBaseline, nearestBookmark } from '../director/bookmarkTiers.js';

/**
 * The map as the campaign began.
 *
 * Without this the Director has no reference for what is *drift* and what is
 * simply the bookmark as Paradox shipped it, so every audit re-litigates the
 * opening map from zero. That is how it came to propose demoting Philip I of
 * France below king tier in 1066, and dissolving the Holy Roman Empire: both are
 * the start screen, not divergences from it.
 *
 * The trap it also closes is subtler. Retrieved sources will say, correctly,
 * that early Capetian royal authority barely reached past the Île-de-France, and
 * a model reading that concludes Philip should not be a king. De jure rank and
 * de facto power are separate axes, and prose about weakness is evidence about
 * the second. The baseline gives the system a mechanical way to notice that
 * nothing about Philip's *rank* has moved since 1066 - so there is nothing to
 * correct, whatever the sources say about his power.
 *
 * Realms are keyed on primary title rather than character id, because ids change
 * at every succession. Titles can be renamed by a player, which is an accepted
 * limitation: an unmatched realm yields no baseline, and no baseline must never
 * be read as licence to demote.
 */
export class Baseline {
  /** @param {string} filePath */
  constructor(filePath) {
    this.filePath = filePath;
    /** @type {{date: string, year: number, totalDays: number, realms: Record<string, {tierKey: string|null, countiesInSphere: number}>} | null} */
    this.data = null;
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        if (parsed && typeof parsed === 'object' && parsed.realms) this.data = parsed;
      }
    } catch {
      this.data = null;
    }
  }

  save() {
    if (!this.data) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
  }

  /** @returns {boolean} whether a baseline has been captured */
  get captured() {
    return this.data !== null;
  }

  /** @returns {number} the in-game year the baseline was taken, or 0 */
  get capturedYear() {
    return this.data?.year ?? 0;
  }

  /**
   * Whether this baseline describes the map the game shipped, or only the map
   * at the moment the player loaded a save.
   *
   * Everything the baseline says is conditioned on this. A 1066 baseline means
   * "the bookmark as Paradox shipped it", and a realm unchanged against it has
   * genuinely not moved. A 1218 baseline means "twenty minutes ago", and the
   * same reading means only that nothing has moved since the save was loaded -
   * a fact about the session, not about the world. Both were reported in
   * identical words until this existed.
   */
  get midCampaign() {
    return this.captured && isMidCampaignBaseline(this.capturedYear);
  }

  /** The bookmark this campaign is measured against. */
  get bookmark() {
    return this.captured ? nearestBookmark(this.capturedYear) : 0;
  }

  /**
   * Offer a snapshot as the baseline.
   *
   * Captures on the first snapshot of a campaign, and re-captures when the
   * incoming snapshot predates the stored one - which means the player has
   * started a different game or loaded an earlier save, and the old reference
   * now describes a world that no longer exists.
   *
   * @param {any} snapshot
   * @returns {'captured'|'recaptured'|'kept'}
   */
  offer(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.realms)) return 'kept';

    const isEarlier = this.data !== null && snapshot.totalDays < this.data.totalDays;
    if (this.data !== null && !isEarlier) return 'kept';

    /** @type {Record<string, {tierKey: string|null, countiesInSphere: number}>} */
    const realms = {};
    for (const r of snapshot.realms) {
      if (!r.primaryTitle) continue;
      realms[r.primaryTitle] = {
        tierKey: r.tierKey ?? null,
        countiesInSphere: r.countiesInSphere ?? 0,
      };
    }

    this.data = {
      date: snapshot.date ?? '',
      year: snapshot.year ?? 0,
      totalDays: snapshot.totalDays ?? 0,
      realms,
    };
    this.save();
    return isEarlier ? 'recaptured' : 'captured';
  }

  /**
   * @param {string} primaryTitle
   * @returns {{tierKey: string|null, countiesInSphere: number} | null}
   */
  lookup(primaryTitle) {
    if (!this.data || !primaryTitle) return null;
    return this.data.realms[primaryTitle] ?? null;
  }

  /**
   * How this realm's rank compares with the baseline, as a short column for the
   * prompt table.
   *
   * A rise is a gate, not a trigger: the Normans and Almoravids rose
   * legitimately and will read as risen here too. It establishes only that there
   * is something for the evidence to justify.
   *
   * @param {{primaryTitle?: string, tierKey?: string|null}} realm
   * @returns {{label: string, risen: boolean, known: boolean}}
   */
  delta(realm) {
    const prior = this.lookup(realm?.primaryTitle ?? '');
    const now = realm?.tierKey ?? null;

    if (!prior || !prior.tierKey || !now) return { label: 'no baseline', risen: false, known: false };
    // "= Empire" and "= Empire since you loaded" are different claims, and the
    // model acted on the first while only the second was true. The column is
    // read as evidence, so it has to say which one it is.
    if (prior.tierKey === now) {
      return {
        label: this.midCampaign ? `= ${cap(now)} since load` : `= ${cap(now)}`,
        risen: false,
        known: true,
      };
    }

    const risen = RANK[now] > RANK[prior.tierKey];
    return { label: `${cap(prior.tierKey)} -> ${cap(now)}`, risen, known: true };
  }
}

/** Ordering only; the wire values are lowercase tier keys. */
const RANK = { barony: 0, county: 1, duchy: 2, kingdom: 3, empire: 4 };

/** @param {string} s */
function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
