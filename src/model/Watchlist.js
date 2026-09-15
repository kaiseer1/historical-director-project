import fs from 'node:fs';
import path from 'node:path';

/**
 * The people whose deaths are worth interrupting the cadence for.
 *
 * ## Why a clock alone is not enough
 *
 * The Director audits every few in-game years, which is the right cadence for
 * the question it usually asks - has the shape of this map drifted - because
 * the shape of a map drifts slowly. It is the wrong cadence for the other kind
 * of history entirely. Harold Godwinson dying in 1066 is not a slow drift, and
 * an audit that hears about it in 1071 has missed the thing it exists for.
 *
 * So there are two triggers. The clock asks "has the world drifted"; this asks
 * "has something happened", and it can interrupt the clock. The list of people
 * worth interrupting for is nominated by the model during an ordinary audit,
 * from realms the snapshot actually reported, and validated here.
 *
 * ## Identity, and the one thing it cannot survive
 *
 * An entry is keyed on the CHARACTER id, unlike the dispatch ledger, which is
 * keyed on the title - and the difference is the same one written up there. A
 * grievance belongs to a crown and outlives its king; a watch is on a person,
 * and the whole point is to notice when that person stops being there.
 *
 * What it cannot survive is a change of campaign, and a character id from
 * another save is not merely useless but actively wrong: it would resolve to
 * somebody, and the Director would report a stranger's death as a divergence.
 * Hence `belongsTo`, and the total days check, which is how Baseline and
 * AuditClock already tell one campaign from another.
 *
 * ## The tag problem, stated plainly
 *
 * Actions address characters by the tag they were given in the last sweep, not
 * by their character id, because CK3 cannot resolve `character:34497` for a
 * ruler generated at runtime. Tags are assigned in sweep order, so they are
 * only valid until the next snapshot rebuilds the list - which means a
 * watchlist entry's tag goes stale every audit. `refresh` is what re-derives
 * it, by matching the stable character id in the new snapshot. An entry whose
 * id is not in the new snapshot loses its tag and is marked unobserved rather
 * than dropped: out of the window is not the same as dead, and reading it as
 * dead would manufacture exactly the divergence this file exists to detect.
 */
export class Watchlist {
  /** @param {string} filePath */
  constructor(filePath) {
    this.filePath = filePath;
    /** @type {{campaignDays: number, entries: any[]} | null} */
    this.data = null;
    this.load();
  }

  load() {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (raw && Array.isArray(raw.entries)) this.data = raw;
    } catch {
      // A corrupt watchlist is a Director that has stopped watching, which the
      // next audit repairs. Refusing to start over it would not.
      this.data = null;
    }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch {
      // Losing the list costs one audit's worth of nominations, which is not
      // worth failing a run over.
    }
  }

  /** @returns {any[]} */
  all() {
    return this.data?.entries ?? [];
  }

  get size() {
    return this.all().length;
  }

  /** Entries that still have a usable tag, which are the ones a probe can ask about. */
  probeable() {
    return this.all().filter((e) => Number.isInteger(e.tag) && !e.retired);
  }

  /**
   * Is this list the same campaign as the game now reporting?
   *
   * The same test Baseline and AuditClock use: a game reporting an earlier date
   * than the one recorded against is a different campaign or an earlier save.
   * Character ids do not carry across either, so the list is dropped rather
   * than re-pointed.
   *
   * @param {number} totalDays
   * @returns {boolean} whether the list was discarded
   */
  reconcile(totalDays) {
    const now = Number(totalDays) || 0;
    if (!this.data || !now) return false;
    if (now >= (this.data.campaignDays ?? 0)) return false;

    this.data = null;
    try {
      fs.rmSync(this.filePath, { force: true });
    } catch { /* one lost list */ }
    return true;
  }

  /**
   * Take the model's nominations, validated against the snapshot that produced
   * them.
   *
   * Nothing is trusted here. An id the snapshot never reported is dropped by
   * name, for the same reason a dispatch from a realm with no stance is: the
   * model may nominate from what it was shown and nothing else. The stored
   * entry is built from the SNAPSHOT's fields rather than from anything the
   * model wrote about them, so a divergence is later measured against what the
   * game said, not against what the model believed.
   *
   * Replaces the list rather than adding to it. The watchlist is what matters
   * NOW; an audit five years on has a different answer and should be allowed to
   * give it. Entries that survive re-nomination keep their original date, so
   * "watched since 1066" stays true.
   *
   * @param {Array<{id: any, why?: any}>} nominations
   * @param {any} snapshot
   * @param {number} max
   * @returns {{kept: any[], rejected: string[]}}
   */
  adopt(nominations, snapshot, max = 5) {
    /** @type {any[]} */
    const kept = [];
    /** @type {string[]} */
    const rejected = [];
    const previous = new Map(this.all().map((e) => [e.id, e]));

    for (const n of nominations ?? []) {
      if (kept.length >= max) break;
      const id = Number(n?.id);
      const realm = Number.isFinite(id) ? snapshot?.realmsById?.get(id) : null;
      if (!realm) {
        rejected.push(`watchlist: no realm with id ${n?.id} in this snapshot`);
        continue;
      }
      if (kept.some((e) => e.id === id)) continue;

      const was = previous.get(id);
      kept.push({
        id,
        tag: Number.isInteger(realm.tag) ? realm.tag : null,
        ruler: realm.ruler ?? '',
        primaryTitle: realm.primaryTitle ?? '',
        tierKey: realm.tierKey ?? null,
        culture: realm.culture ?? '',
        faith: realm.faith ?? '',
        // The model's reason for watching, bounded and kept as prose. It is
        // shown to the player and put back into the divergence audit's prompt;
        // it is never matched against anything.
        why: String(n?.why ?? '').replace(/\s+/g, ' ').trim().slice(0, 240),
        since: was?.since ?? snapshot?.date ?? '',
        sinceYear: was?.sinceYear ?? snapshot?.year ?? 0,
        lastSeen: snapshot?.date ?? '',
        retired: false,
      });
    }

    this.data = { campaignDays: Number(snapshot?.totalDays) || this.data?.campaignDays || 0, entries: kept };
    this.save();
    return { kept, rejected };
  }

  /**
   * Re-point the list at a new snapshot, and report what changed on the way.
   *
   * This is the free half of the divergence check. A snapshot is a complete
   * re-description of every realm in the sphere, so everything the cheap probe
   * asks about is already in it, in more detail - and an audit takes one
   * anyway. The probe exists for the years between.
   *
   * Two kinds of answer, and they must not be confused. An entry whose id is
   * gone from the snapshot is UNOBSERVED: they may be dead, or the sphere may
   * simply have moved off them, and this file has no way to tell. An entry that
   * is present with different facts has DIVERGED, which is a statement about
   * the world rather than about the window.
   *
   * @param {any} snapshot
   * @returns {{divergences: any[], unobserved: any[]}}
   */
  refresh(snapshot) {
    if (!this.data || !snapshot?.realmsById) return { divergences: [], unobserved: [] };

    /** @type {any[]} */
    const divergences = [];
    /** @type {any[]} */
    const unobserved = [];

    for (const e of this.data.entries) {
      const realm = snapshot.realmsById.get(e.id);
      if (!realm) {
        e.tag = null;
        unobserved.push(e);
        continue;
      }

      for (const d of compare(e, {
        alive: true,
        primaryTitle: realm.primaryTitle ?? '',
        culture: realm.culture ?? '',
        faith: realm.faith ?? '',
      }, snapshot.date ?? '')) {
        divergences.push(d);
      }

      // Re-described from the snapshot AFTER the comparison, so the next check
      // measures against what is true now and the same death is never reported
      // twice.
      e.tag = Number.isInteger(realm.tag) ? realm.tag : null;
      e.ruler = realm.ruler ?? e.ruler;
      e.primaryTitle = realm.primaryTitle ?? '';
      e.culture = realm.culture ?? '';
      e.faith = realm.faith ?? '';
      e.lastSeen = snapshot.date ?? e.lastSeen;
    }

    this.data.campaignDays = Number(snapshot.totalDays) || this.data.campaignDays;
    this.save();
    return { divergences, unobserved };
  }

  /**
   * Apply a cheap watch probe's answers.
   *
   * The probe reports by tag, because that is what the script can address, and
   * a tag with no record came back from a list entry the game no longer has -
   * unobserved again, not dead.
   *
   * @param {Array<{tag: number, alive: boolean, id: number, primaryTitle: string, culture: string, faith: string}>} reports
   * @param {string} date
   * @returns {{divergences: any[], unobserved: any[]}}
   */
  applyProbe(reports, date) {
    if (!this.data) return { divergences: [], unobserved: [] };
    const byTag = new Map((reports ?? []).map((r) => [r.tag, r]));

    /** @type {any[]} */
    const divergences = [];
    /** @type {any[]} */
    const unobserved = [];

    for (const e of this.data.entries) {
      if (e.retired) continue;
      const r = Number.isInteger(e.tag) ? byTag.get(e.tag) : undefined;
      if (!r) {
        unobserved.push(e);
        continue;
      }

      for (const d of compare(e, r, date)) divergences.push(d);

      if (!r.alive) {
        // Retired rather than deleted. The entry is the evidence for the
        // divergence audit that is about to run, and a list that forgets why it
        // interrupted the cadence is not much of a witness.
        e.retired = true;
      } else {
        e.primaryTitle = r.primaryTitle || e.primaryTitle;
        e.culture = r.culture || e.culture;
        e.faith = r.faith || e.faith;
      }
      e.lastSeen = date || e.lastSeen;
    }

    this.save();
    return { divergences, unobserved };
  }

  /** Drop the retired entries once their divergence audit has run. */
  sweepRetired() {
    if (!this.data) return;
    this.data.entries = this.data.entries.filter((e) => !e.retired);
    this.save();
  }
}

/**
 * The comparison itself, in one place because the snapshot path and the probe
 * path must never answer it differently.
 *
 * Three questions, which are the three the design calls for: is this person
 * still alive, do they still hold what they held, and are they still who they
 * were. A field the report could not fill is skipped rather than read as a
 * change - a missing field fails closed, never as a difference. That rule is
 * the reason a truncated log cannot manufacture a death.
 *
 * @param {any} entry as recorded
 * @param {{alive: boolean, primaryTitle?: string, culture?: string, faith?: string}} now as reported
 * @param {string} date
 * @returns {any[]}
 */
function compare(entry, now, date) {
  /** @type {any[]} */
  const out = [];
  const who = `${entry.ruler}${entry.primaryTitle ? ` of ${entry.primaryTitle}` : ''}`;

  if (now.alive === false) {
    out.push({
      id: entry.id,
      kind: 'died',
      who,
      date,
      what: `${who} is dead`,
      why: entry.why,
      since: entry.since,
    });
    // Nothing else is asked of a dead character. Their titles have already
    // moved and reporting that as a second divergence would double-count one
    // event.
    return out;
  }

  if (now.primaryTitle && entry.primaryTitle && now.primaryTitle !== entry.primaryTitle) {
    out.push({
      id: entry.id,
      kind: 'lost_primary_title',
      who,
      date,
      what: `${who} no longer holds ${entry.primaryTitle}; their primary title is now ${now.primaryTitle}`,
      why: entry.why,
      since: entry.since,
    });
  }

  if (now.faith && entry.faith && now.faith !== entry.faith) {
    out.push({
      id: entry.id,
      kind: 'changed_faith',
      who,
      date,
      what: `${who} has changed faith from ${entry.faith} to ${now.faith}`,
      why: entry.why,
      since: entry.since,
    });
  }

  if (now.culture && entry.culture && now.culture !== entry.culture) {
    out.push({
      id: entry.id,
      kind: 'changed_culture',
      who,
      date,
      what: `${who} has changed culture from ${entry.culture} to ${now.culture}`,
      why: entry.why,
      since: entry.since,
    });
  }

  return out;
}

/**
 * How a set of divergences reads in one sentence, for the activity log and the
 * banner.
 *
 * @param {any[]} divergences
 */
export function describeDivergences(divergences) {
  if (!divergences?.length) return '';
  const first = divergences[0].what;
  return divergences.length === 1 ? first : `${first}, and ${divergences.length - 1} other change(s) on the watchlist`;
}
