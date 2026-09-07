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
 *
 * ## Three axes, not one
 *
 * Rank was the only axis for a long time, and a live campaign showed what that
 * missed. In 1197 Iberia the player's world had a Kingdom of Calatayud that
 * never existed, an Aragon ruled by a King-Bishop, and no Castile at all - and
 * the Director called it on track for thirty-seven consecutive audits. Rank is
 * the one thing that had not moved: Leon was a kingdom at capture and a kingdom
 * still, so `delta` returned "= Kingdom" and said nothing more.
 *
 * The footprint needed to catch it was already being captured and then thrown
 * away. So there are now three signals:
 *
 *   - rank rose        gates adjust_title_tier, unchanged
 *   - footprint fell   a realm still holding its title on a fraction of its land
 *   - vanished         a realm in the baseline that is not in the world now
 *
 * Only the first gates anything. The other two are told to the model as
 * evidence and nothing else, because "Castile has lost two thirds of its
 * counties" is an argument for looking, exactly as a rank rise is.
 *
 * ## Why the sphere has to be recorded
 *
 * `countiesInSphere` is counted inside the sphere, so it is meaningless across a
 * sphere that changed: widening the window from twelve regions to twenty adds
 * counties to every realm straddling the old edge, and a naive comparison would
 * report growth that never happened and absences that are only a narrower view.
 * The sphere is therefore stored with the baseline, and the two derived signals
 * are reported only when the captured sphere is a *subset* of the current one.
 *
 * That subset rule is what makes them safe rather than merely careful. Widening
 * can only ever add counties and reveal realms - so under a wider window a loss
 * is certainly a real loss, and an absence is certainly a real absence. Both
 * degrade conservatively: a narrowed window suppresses them, and a baseline
 * captured before the sphere was recorded reports them marked unverified rather
 * than silently or not at all.
 */
export class Baseline {
  /** @param {string} filePath */
  constructor(filePath) {
    this.filePath = filePath;
    /** @type {{date: string, year: number, totalDays: number, sphere?: string[], realms: Record<string, {tierKey: string|null, countiesInSphere: number}>} | null} */
    this.data = null;
    /**
     * The sphere the *current* audit is looking through, set once per audit by
     * `observing`. Not persisted: it describes this pass, not the reference.
     * @type {string[]}
     */
    this.sphereNow = [];
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
   * @param {string[]} [sphere] the regions this snapshot was taken across
   * @returns {'captured'|'recaptured'|'kept'}
   */
  offer(snapshot, sphere = []) {
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
      // Recorded so a later audit can tell whether its county counts are
      // comparable with these ones at all. See the header.
      sphere: normaliseSphere(sphere),
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
      // The case the whole footprint signal exists for. Leon was a kingdom at
      // capture and is a kingdom still, and for thirty-seven audits that was the
      // entire report - while Castile was being taken apart beside it.
      const lost = this.footprintLoss(prior, realm);
      return {
        label: withLoss(this.midCampaign ? `= ${cap(now)} since load` : `= ${cap(now)}`, lost),
        risen: false,
        known: true,
        lost,
      };
    }

    const risen = RANK[now] > RANK[prior.tierKey];
    return {
      label: withLoss(`${cap(prior.tierKey)} -> ${cap(now)}`, this.footprintLoss(prior, realm)),
      risen,
      known: true,
      lost: this.footprintLoss(prior, realm),
    };
  }

  /**
   * Declare the sphere this audit is looking through.
   *
   * Called once per audit, before anything reads a delta. Without it the
   * derived signals report themselves as unverified rather than guessing.
   *
   * @param {string[]} regions
   */
  observing(regions) {
    this.sphereNow = normaliseSphere(regions);
  }

  /**
   * Whether county counts and absences can be compared with the baseline's.
   *
   * 'sound'      the captured sphere is contained in the current one, so a loss
   *              is a real loss and an absence is a real absence
   * 'unverified' one of the two spheres is unknown - an older baseline.json, or
   *              an audit that did not call `observing`. Signals are reported
   *              but flagged, the same way a mid-campaign capture reports
   *              "since load" rather than staying silent
   * 'narrowed'   the window has shrunk, so both signals are suppressed
   *
   * @returns {'sound'|'unverified'|'narrowed'}
   */
  get comparability() {
    const then = this.data?.sphere;
    if (!Array.isArray(then) || then.length === 0) return 'unverified';
    if (this.sphereNow.length === 0) return 'unverified';
    const now = new Set(this.sphereNow);
    return then.every((r) => now.has(r)) ? 'sound' : 'narrowed';
  }

  /**
   * Whether a realm's absence from the baseline can be read as "it did not
   * exist then", rather than "we were not looking at the ground it stands on".
   *
   * The converse of `comparability`, and not interchangeable with it. That one
   * asks whether a realm the baseline *held* can be missed now, and is safe
   * when the window only grew. This asks whether a realm the baseline *lacks*
   * was genuinely absent, and is safe only when the window has not grown: a
   * sphere widened from twelve regions to twenty reveals realms that were there
   * all along, and reading those as newly formed would be inventing a history
   * for every one of them.
   *
   * A live campaign made the difference concrete. A 1178 baseline, a sphere
   * since widened to twenty regions, and a Grand Emirate of Sahara absent from
   * the baseline - which the gate refused as "not present when the baseline was
   * captured". That baseline recorded no sphere at all and the Sahara may never
   * have been in the window; the realm could have stood there for the whole
   * campaign. The refusal was right and its stated reason was a guess.
   *
   * @returns {boolean}
   */
  get absenceMeansNew() {
    const then = this.data?.sphere;
    if (!Array.isArray(then) || then.length === 0) return false;
    if (this.sphereNow.length === 0) return false;
    const thenSet = new Set(then);
    return this.sphereNow.every((r) => thenSet.has(r));
  }

  /**
   * How much ground this realm has lost since the baseline, or null.
   *
   * Losses only. Widening the sphere can add counties to a realm that never
   * gained any, so a reported gain may be an artefact of the window - but it can
   * never hide one, so a loss under a window that only grew is certainly real.
   * Small losses are dropped: a kingdom shedding one county of fourteen is
   * ordinary medieval churn, and a table that says so on every row says nothing.
   *
   * @param {{tierKey: string|null, countiesInSphere: number}} prior
   * @param {{countiesInSphere?: number}} realm
   * @returns {{then: number, now: number, lost: number, share: number, verified: boolean} | null}
   */
  footprintLoss(prior, realm) {
    if (this.comparability === 'narrowed') return null;
    const then = prior?.countiesInSphere ?? 0;
    const now = realm?.countiesInSphere ?? 0;
    if (then <= 0 || now >= then) return null;

    const lost = then - now;
    const share = Math.round((lost / then) * 100);
    if (lost < 2 || share < 25) return null;

    return { then, now, lost, share, verified: this.comparability === 'sound' };
  }

  /**
   * Realms the baseline recorded that are not in the world any more.
   *
   * Filtered rather than exhaustive. Nineteen years of a live campaign took 249
   * realms down to 180 without anything historically interesting happening -
   * small counties are absorbed constantly - so listing every absence would bury
   * the one that matters. Only realms that were kingdom or empire tier, or held
   * real ground, are worth the model's attention.
   *
   * @param {any} snapshot
   * @param {number} [max]
   * @returns {{list: Array<{primaryTitle: string, tierKey: string|null, countiesInSphere: number}>, total: number, verified: boolean}}
   */
  vanished(snapshot, max = 10) {
    const none = { list: [], total: 0, verified: false };
    if (!this.data || this.comparability === 'narrowed') return none;

    const present = new Set(
      (snapshot?.realms ?? []).map((r) => r.primaryTitle).filter(Boolean),
    );

    const gone = Object.entries(this.data.realms)
      .filter(([title, v]) => title && !present.has(title))
      .map(([primaryTitle, v]) => ({
        primaryTitle,
        tierKey: v.tierKey ?? null,
        countiesInSphere: v.countiesInSphere ?? 0,
      }))
      .filter((r) => r.tierKey === 'kingdom' || r.tierKey === 'empire' || r.countiesInSphere >= 5)
      .sort((a, b) => b.countiesInSphere - a.countiesInSphere);

    return { list: gone.slice(0, max), total: gone.length, verified: this.comparability === 'sound' };
  }
}

/** Sphere identity is the set of regions, not the order they were seeded in. */
function normaliseSphere(regions) {
  return Array.isArray(regions) ? [...new Set(regions.filter(Boolean).map(String))].sort() : [];
}

/**
 * Fold a footprint loss into the rank column the prompt table prints.
 * @param {string} label
 * @param {{lost: number, then: number, share: number, verified: boolean} | null} loss
 */
function withLoss(label, loss) {
  if (!loss) return label;
  const mark = loss.verified ? '' : '?';
  return `${label}, down ${loss.lost} of ${loss.then} counties${mark}`;
}

/** Ordering only; the wire values are lowercase tier keys. */
const RANK = { barony: 0, county: 1, duchy: 2, kingdom: 3, empire: 4 };

/** @param {string} s */
function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
