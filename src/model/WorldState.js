import { toRealm } from '../bridge/protocol.js';

/**
 * Assembles snapshot records arriving from the log into a world state.
 *
 * Records arrive as a stream, not a document: a snapshot_begin, an arbitrary
 * number of realm lines, then a snapshot_end. Nothing guarantees the stream is
 * complete — the player can quit mid-snapshot, and CK3 can truncate the log
 * between the begin and the end. So a snapshot is only published once its
 * matching end arrives, and a begin that never ends is discarded rather than
 * half-used.
 */
export class SnapshotAssembler {
  constructor() {
    /** @type {null | {token: string, date: string, totalDays: number, playerId: number, realms: any[]}} */
    this.pending = null;
    /** @type {{id: number, capital: string, culture: string, faith: string, title: string, tier: string, date: string, regions: string[]} | null} */
    this.pendingLocation = null;
    /** @type {{token: string, date: string, reports: any[]} | null} */
    this.pendingWatch = null;
  }

  /**
   * @param {{kind: string, fields: string[]}} rec
   * @returns {{type: 'snapshot', snapshot: any} | {type: 'location', location: any} | {type: 'date', date: string, totalDays: number} | {type: 'applied', token: string, action: string, subject: string} | null}
   */
  ingest(rec) {
    switch (rec.kind) {
      case 'snapshot_begin':
        this.pending = {
          token: rec.fields[0],
          date: rec.fields[1],
          totalDays: Number(rec.fields[2]) || 0,
          playerId: Number(rec.fields[3]) || 0,
          realms: [],
          /** @type {Map<number, string[]>} filled before the realms exist */
          regionsById: new Map(),
          /** @type {Map<number, string[]>} which region each realm is ruled from */
          capitalById: new Map(),
          /** @type {Map<number, Array<{name: string, region: string, tierKey: string|null}>>} */
          titlesById: new Map(),
          /** @type {Map<number, {id: number, attacker: number, defender: number, name: string}>} */
          warsById: new Map(),
          /** @type {Map<string, {holder: number|null, top: number|null}>} */
          titleHolders: new Map(),
        };
        return null;

      case 'realm':
        if (this.pending) {
          // The mod tags each realm with its position in the sweep, and emits
          // them in that same order, so arrival order is the tag. Actions use
          // the tag rather than the character id, which CK3 cannot resolve for
          // runtime-generated characters.
          const realm = toRealm(rec.fields);
          realm.tag = this.pending.realms.length;
          this.pending.realms.push(realm);
        }
        return null;

      case 'realm_in_region': {
        // Which regions a realm actually holds land in, one record per pair.
        // Geography rather than culture: a realm's culture says where its
        // rulers came from, not where the realm is.
        //
        // Buffered rather than matched on arrival, because these records arrive
        // BEFORE the realm lines do. The mod emits them from inside each
        // region's sweep, and the realm lines come afterwards from a single pass
        // over the collected set - so a lookup here found an empty list every
        // time and silently dropped all of it. A live snapshot carried 966 of
        // these records and not one reached a realm, which left every action
        // that asks where a realm is falling back to culture, the proxy the
        // geography was added to replace.
        //
        // Keyed by character id and applied in finalise, so arrival order
        // stops mattering in either direction.
        if (!this.pending) return null;
        const rid = Number(rec.fields[0]);
        if (!this.pending.regionsById.has(rid)) this.pending.regionsById.set(rid, []);
        const seen = this.pending.regionsById.get(rid);
        if (!seen.includes(rec.fields[1])) seen.push(rec.fields[1]);
        return null;
      }

      case 'realm_tier': {
        // Arrives as its own record right after the realm line it belongs to,
        // so the realm line's positional parse is untouched. Matched on
        // character id rather than arrival order, because a realm whose tier
        // record was lost to log truncation must leave tierKey unset rather
        // than shift every later realm's tier onto the wrong ruler.
        if (!this.pending) return null;
        const id = Number(rec.fields[0]);
        const target = this.pending.realms.find((r) => r.id === id);
        if (target) target.tierKey = rec.fields[1] || null;
        return null;
      }

      case 'realm_capital': {
        // Which region this realm is ruled FROM. Buffered by character id like
        // realm_in_region, and for the same reason: the realm lines and these
        // arrive from the same pass, but keying on the id means a lost record
        // costs one realm its seat rather than shifting every later seat by one.
        if (!this.pending) return null;
        const capId = Number(rec.fields[0]);
        if (!Number.isFinite(capId) || !rec.fields[1]) return null;
        if (!this.pending.capitalById.has(capId)) this.pending.capitalById.set(capId, []);
        const seats = this.pending.capitalById.get(capId);
        if (!seats.includes(rec.fields[1])) seats.push(rec.fields[1]);
        return null;
      }

      case 'realm_title': {
        // A duchy- or kingdom-tier title this realm's ruler holds personally,
        // and the region its capital county sits in. The one record that lets a
        // holding be named instead of counted.
        if (!this.pending) return null;
        const holder = Number(rec.fields[0]);
        const region = rec.fields[1];
        const tier = rec.fields[2];
        const name = rec.fields[3];
        if (!Number.isFinite(holder) || !region || !name) return null;
        if (!this.pending.titlesById.has(holder)) this.pending.titlesById.set(holder, []);
        const held = this.pending.titlesById.get(holder);
        if (!held.some((t) => t.name === name && t.region === region)) {
          held.push({ name, region, tierKey: tier || null });
        }
        return null;
      }

      case 'realm_home': {
        // Emitted for realms holding land in one of the player's own regions,
        // as its own record for the same reason realm_tier is: the realm line
        // is parsed positionally and must not grow. Matched on character id
        // rather than arrival order, so a lost record costs one realm its
        // marker instead of shifting the marker onto the wrong ruler.
        if (!this.pending) return null;
        const homeId = Number(rec.fields[0]);
        const homeTarget = this.pending.realms.find((r) => r.id === homeId);
        if (homeTarget) homeTarget.inHomeRegion = true;
        return null;
      }

      case 'realm_near': {
        // The wider of the two rings: within the player's neighbourhood rather
        // than sharing ground with them. Home realms are marked both, so this
        // is a superset of realm_home.
        if (!this.pending) return null;
        const nearId = Number(rec.fields[0]);
        const nearTarget = this.pending.realms.find((r) => r.id === nearId);
        if (nearTarget) nearTarget.inNeighbourhood = true;
        return null;
      }

      case 'snapshot_end': {
        if (!this.pending) return null;
        const snap = this.pending;
        this.pending = null;
        if (snap.token !== rec.fields[0]) return null; // interleaved or stale
        return { type: 'snapshot', snapshot: finalise(snap) };
      }

      case 'watch_begin':
        this.pendingWatch = { token: rec.fields[0], date: rec.fields[1] ?? '', reports: [] };
        return null;

      case 'watch': {
        if (!this.pendingWatch) return null;
        const tag = Number(rec.fields[0]);
        if (!Number.isFinite(tag)) return null;
        const alive = rec.fields[1] === 'alive';
        this.pendingWatch.reports.push({
          tag,
          alive,
          id: Number(rec.fields[2]) || 0,
          // Only meaningful on the alive branch; the script does not emit them
          // for a dead character, and an absent field must read as "not asked"
          // rather than as a change.
          primaryTitle: alive ? (rec.fields[3] ?? '') : '',
          culture: alive ? (rec.fields[4] ?? '') : '',
          faith: alive ? (rec.fields[5] ?? '') : '',
        });
        return null;
      }

      case 'watch_end': {
        if (!this.pendingWatch) return null;
        const report = this.pendingWatch;
        this.pendingWatch = null;
        if (report.token !== rec.fields[0]) return null; // interleaved or stale
        return { type: 'watch', watch: report };
      }

      case 'locate_begin':
        this.pendingLocation = {
          id: Number(rec.fields[0]) || 0,
          capital: rec.fields[1] ?? '',
          culture: rec.fields[2] ?? '',
          faith: rec.fields[3] ?? '',
          title: rec.fields[4] ?? '',
          tier: rec.fields[5] ?? '',
          date: rec.fields[6] ?? '',
          regions: [],
          realmRegions: [],
        };
        return null;

      case 'in_region':
        if (this.pendingLocation) this.pendingLocation.regions.push(rec.fields[0]);
        return null;

      case 'realm_region':
        // Where the player's realm holds land, as opposed to where its capital
        // sits. Absent entirely from a mod build that predates the probe, which
        // is why seeding falls back to the capital rather than to nothing.
        if (this.pendingLocation) this.pendingLocation.realmRegions.push(rec.fields[0]);
        return null;

      case 'locate_end': {
        if (!this.pendingLocation) return null;
        const loc = this.pendingLocation;
        this.pendingLocation = null;
        return { type: 'location', location: loc };
      }

      case 'date':
        return { type: 'date', date: rec.fields[0], totalDays: Number(rec.fields[1]) || 0 };

      case 'war': {
        // Who is fighting whom, and what the game calls it. Buffered with the
        // rest of the snapshot rather than returned as an event, because a war
        // is context for the next audit and never a trigger for one.
        //
        // The same war arrives once per belligerent inside the sphere, so it is
        // keyed on the war's own id. That is deliberate on the emitting side:
        // reporting from both sides is what lets a war be seen when only one of
        // its belligerents is somewhere the Director is looking.
        //
        // A field the game could not resolve comes through as the literal
        // "ERROR:[...]" rather than as a failure, so every id is checked before
        // the record is kept. A war nobody can identify is worse than no war,
        // because it would read as a fact.
        if (!this.pending) return null;
        const id = Number(rec.fields[0]);
        const attacker = Number(rec.fields[1]);
        const defender = Number(rec.fields[2]);
        if (!Number.isFinite(id) || !Number.isFinite(attacker) || !Number.isFinite(defender)) return null;
        if (!this.pending.warsById.has(id)) {
          this.pending.warsById.set(id, { id, attacker, defender, name: cleanWarName(rec.fields[3]) });
        }
        return null;
      }

      case 'title_holder': {
        // Who holds one of the handful of titles the historical war library
        // asks about. Only those: the snapshot does not survey titles, it looks
        // up the ones a curated war is fought over, so a war can be refused as
        // already fought rather than offered as though the record had not yet
        // happened. "none" is a title that exists and is held by nobody; a
        // title the campaign's mods do not define sends no record at all.
        if (!this.pending) return null;
        const title = rec.fields[0];
        if (!title) return null;
        const id = rec.fields[1] === 'none' ? null : Number(rec.fields[1]);
        if (id !== null && !Number.isFinite(id)) return null;
        this.pending.titleHolders.set(title, { holder: id, top: null });
        return null;
      }

      case 'title_top': {
        // Always follows its title_holder, from inside the holder's own scope,
        // so an independent ruler reports themself here.
        if (!this.pending) return null;
        const title = rec.fields[0];
        const id = Number(rec.fields[1]);
        if (!title || !Number.isFinite(id)) return null;
        const prior = this.pending.titleHolders.get(title) ?? { holder: null, top: null };
        this.pending.titleHolders.set(title, { ...prior, top: id });
        return null;
      }

      case 'log_clear_requested':
        // The echo of our own request, written by the same batch that set the
        // slot variable. It confirms the batch executed, which is not the same
        // as the clear happening - only the log shrinking says that, and the
        // tailer is what sees it.
        return { type: 'logClearRequested', slot: rec.fields[0] ?? '' };

      case 'mod_version':
        // What the running game has loaded, which is not the same question as
        // what is deployed on disk. Emitted from hd_mark_alive, so it arrives
        // with the first batch the pump executes rather than at the next tick.
        return { type: 'modVersion', version: rec.fields[0] ?? '' };

      case 'applied':
        return { type: 'applied', token: rec.fields[0], action: rec.fields[1], subject: rec.fields[2] };

      case 'event_fired':
        // Emitted from inside a Director event's immediate block, so it only
        // appears if the event's own trigger passed. The applied record comes
        // from the batch that fired it and would appear either way.
        return { type: 'eventFired', event: rec.fields[0] };

      case 'dynamic_scope':
        // hd_dynamic.0001 reporting whether a scope saved by the run file
        // survived into the event fired from that same batch. An open question
        // the mod answers by observation rather than one we go on reasoning
        // about: "kept" means the fuller description was shown and the other
        // party was named, "lost" means the plainer one was.
        return { type: 'dynamicScope', kept: rec.fields[0] === 'kept' };

      case 'refused':
        // The batch ran but the action's precondition was false, so nothing
        // changed in the game. Distinct from silence, which means the batch
        // never executed at all.
        return { type: 'refused', token: rec.fields[0], action: rec.fields[1], reason: rec.fields[2] };

      default:
        return null;
    }
  }
}

/**
 * @param {{token: string, date: string, totalDays: number, playerId: number, realms: any[]}} snap
 */
/**
 * A war name with CK3's own markup taken out of it.
 *
 * `War.GetName` returns the string the game would render in its UI, not the
 * string it would show a reader, and a live probe returned 128 wars looking
 * like this:
 *
 *   ONCLICK:TITLE,11849 TOOLTIP:LANDED_TITLE,11849 L; Tsang!!! Claim on the
 *   ONCLICK:TITLE,11773 TOOLTIP:LANDED_TITLE,11773 L; Duchy of Yarlung!!!
 *
 * The click targets, tooltip bindings and format markers are instructions to a
 * renderer that does not exist here. Left in, they would reach the model as if
 * they were part of the war's name and reach the player in the activity log,
 * and the one thing worse than a war the Director cannot see is a war it
 * describes in a language nobody reads.
 *
 * Deliberately conservative: it removes the directives and the `!!` span
 * terminators and keeps every word between them, so an unrecognised marker
 * leaves an odd name rather than an empty one.
 *
 * @param {string} raw
 */
export function cleanWarName(raw) {
  return String(raw ?? '')
    .replace(/\b(?:ONCLICK|TOOLTIP):\S+/g, ' ')
    .replace(/(^|\s)[A-Za-z];\s*/g, '$1')
    .replace(/#[!\w]+/g, ' ')
    .replace(/!!+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * How a belligerent is described when the snapshot has never heard of them.
 *
 * Emitting each war from both sides means a war reaches the Director whenever
 * *either* party is inside the sphere - which is the point, and which
 * guarantees that some of the other parties are outside it. The first live
 * Iberian snapshot to carry a war read "character 57275 -> Kingdom of Navarra".
 *
 * A bare id is worse than useless there: it occupies the place where a name
 * goes, so it reads as one, and the model cannot address it, look it up, or
 * reason about it. Saying where the gap is instead keeps the war legible and
 * says plainly why half of it is not.
 *
 * @param {any} snap
 * @param {number} id
 */
export function belligerentName(snap, id) {
  const r = snap.realmsById?.get(id);
  if (!r) return 'a ruler outside the observed sphere';
  return r.primaryTitle || r.ruler || 'a ruler outside the observed sphere';
}

function finalise(snap) {
  const wars = [...(snap.warsById ?? new Map()).values()];
  const realmsById = new Map(snap.realms.map((r) => [r.id, r]));

  // Geography, attached now that every realm exists. Buffered on the way in
  // because the region records arrive first; see the realm_in_region case.
  for (const [id, regions] of snap.regionsById ?? new Map()) {
    const realm = realmsById.get(id);
    if (realm) realm.regions = regions;
  }

  // Seats and major titles, attached the same way and for the same reason.
  for (const [id, seats] of snap.capitalById ?? new Map()) {
    const realm = realmsById.get(id);
    if (realm) realm.capitalRegions = seats;
  }
  for (const [id, held] of snap.titlesById ?? new Map()) {
    const realm = realmsById.get(id);
    if (realm) realm.majorTitles = held;
  }

  // Did the seat probe run at all?
  //
  // One realm with no seat means it is ruled from outside the swept sphere.
  // EVERY realm with no seat means nobody asked - an orchestrator older than
  // the probe, or a log truncated before those records - and reading that as
  // "they are all foreigners" would turn a gap into a verdict. The player's own
  // capital is inside their own sphere by construction, so a snapshot where the
  // probe ran always has at least one seat in it.
  const seated = [...realmsById.values()].some((r) => (r.capitalRegions ?? []).length > 0);
  const year = Number(String(snap.date).match(/\d{3,4}/)?.[0]) || 0;
  const byFootprint = [...snap.realms].sort((a, b) => b.countiesInSphere - a.countiesInSphere);
  return {
    ...snap,
    year,
    realmsById,
    /** Whether any realm reported a seat, so absence can be told from silence. */
    seatsObserved: seated,
    player: realmsById.get(snap.playerId) ?? null,
    /** Largest realms first: drift shows up at the top of the table. */
    byFootprint,
    wars,
    /**
     * Is a war under way between these two, in either direction?
     *
     * Direction-insensitive on purpose. What the toolkit needs to know is
     * whether these two are already fighting; which of them declared is a
     * different question, and not one that changes the answer.
     *
     * @param {number} a
     * @param {number} b
     */
    warBetween: (a, b) => wars.find(
      (w) => (w.attacker === a && w.defender === b) || (w.attacker === b && w.defender === a),
    ) ?? null,
    /**
     * Every war either of these two is fighting, against anyone.
     *
     * A ruler already at war on two fronts is not short of a casus belli.
     *
     * @param {number} id
     */
    warsOf: (id) => wars.filter((w) => w.attacker === id || w.defender === id),
    /**
     * The order the prompt table is truncated in.
     *
     * Largest-first is the right order to *read* a sphere and the wrong one to
     * *cut* a wide one. At reach 1 the two coincide, because everything in a
     * six-region sphere is a neighbour. At reach 3 they part company: an
     * Iberian player's sphere now runs to Mesopotamia and the Sahel, and the
     * forty largest realms in that space are Seljuks and Almoravids and
     * Ghanaians, none of whom share a border with them. The player's own
     * neighbours - the realms the toolkit can act on to any effect - fell off
     * the bottom of the table exactly when widening the sphere was supposed to
     * show more.
     *
     * So realms holding land in the player's own regions come first, each group
     * ordered by footprint. Nothing is hidden that a narrower sphere would have
     * shown; the cut simply falls somewhere defensible.
     */
    byRelevance: [
      ...byFootprint.filter((r) => r.inHomeRegion),
      ...byFootprint.filter((r) => !r.inHomeRegion),
    ],
  };
}

/**
 * Render a snapshot as the compact table that goes into the prompt.
 * Ids are included because the toolkit addresses characters by id, and a model
 * that cannot see an id cannot propose an action against it.
 *
 * @param {any} snapshot
 * @param {number} [max]
 */
export function renderRealmTable(snapshot, max = 40, baseline = null) {
  const order = snapshot.byRelevance ?? snapshot.byFootprint;
  const rows = order.slice(0, max).map((r) => {
    const indep = r.independent ? 'independent' : 'vassal';
    // Named in the row rather than left implicit in the ordering. The model
    // reads rows, not slice boundaries, and "neighbour" is the difference
    // between a realm it can act on and one it can only describe.
    //
    // Three rings, because at reach 4 the sphere is wide enough that the
    // difference matters: home ground, the neighbourhood the toolkit may act
    // in, and the rim the Director watches but cannot arrange wars across.
    const where = r.inHomeRegion
      ? ' | neighbour'
      : r.inNeighbourhood
        ? ' | nearby'
        : ' | distant, watch only';
    // "Since start" is the column that separates drift from the bookmark as
    // shipped. Without it every audit re-argues the opening map, and a realm
    // that has stood at its historical rank since 1066 reads exactly like one
    // that climbed there last week.
    const since = baseline ? ` | ${baseline.delta(r).label}` : '';
    return `${r.id} | ${r.ruler} | ${r.primaryTitle} (${r.tier}) | ${r.countiesInSphere} counties | ${r.culture}/${r.faith} | ${indep}${where}${since}`;
  });
  const omitted = snapshot.realms.length - rows.length;
  // "further" rather than "smaller": with neighbours promoted ahead of size,
  // what falls off the end is no longer necessarily the smallest.
  return rows.join('\n') + (omitted > 0 ? `\n... and ${omitted} further realms in the sphere, not listed` : '');
}
