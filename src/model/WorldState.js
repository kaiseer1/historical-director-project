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
        if (!this.pending) return null;
        const rid = Number(rec.fields[0]);
        const inRegion = this.pending.realms.find((r) => r.id === rid);
        if (inRegion) {
          if (!Array.isArray(inRegion.regions)) inRegion.regions = [];
          if (!inRegion.regions.includes(rec.fields[1])) inRegion.regions.push(rec.fields[1]);
        }
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

      case 'applied':
        return { type: 'applied', token: rec.fields[0], action: rec.fields[1], subject: rec.fields[2] };

      case 'event_fired':
        // Emitted from inside a Director event's immediate block, so it only
        // appears if the event's own trigger passed. The applied record comes
        // from the batch that fired it and would appear either way.
        return { type: 'eventFired', event: rec.fields[0] };

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
function finalise(snap) {
  const realmsById = new Map(snap.realms.map((r) => [r.id, r]));
  const year = Number(String(snap.date).match(/\d{3,4}/)?.[0]) || 0;
  const byFootprint = [...snap.realms].sort((a, b) => b.countiesInSphere - a.countiesInSphere);
  return {
    ...snap,
    year,
    realmsById,
    player: realmsById.get(snap.playerId) ?? null,
    /** Largest realms first: drift shows up at the top of the table. */
    byFootprint,
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
