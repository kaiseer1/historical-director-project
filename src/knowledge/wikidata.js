/**
 * Wikidata retrieval: the structured half of the knowledge layer.
 *
 * Wikipedia tells the Director what happened and gives the sidebar its prose.
 * Wikidata is what lets it check a date. That distinction carries the
 * hallucination argument: a model asked to justify a proposal from narrative
 * text alone can write something plausible and wrong, whereas "who held this
 * office in 1066, and between which years" is a question with a checkable
 * answer. Where this module returns nothing, the Director is told it is
 * working without structured backing, and says so in the proposal.
 *
 * Realms are resolved by label to a QID first, then queried by QID. Matching
 * on labels inside SPARQL looked simpler and failed on the first real case:
 * CK3 prints "Kingdom of Leon", Wikidata stores "Kingdom of León", and an
 * exact-label match returns nothing at all. The search endpoint handles the
 * accent, the abbreviation and the alternate name for us.
 *
 * ## Why a failed lookup is not a negative answer
 *
 * A live two-hour session reported "0 realms with structured backing" on all
 * forty of its audits - a flat zero with no variance, which is not what uneven
 * coverage looks like. Wikidata was returning HTTP 429 with a Retry-After
 * header, and the old code caught every failure identically and wrote `null`
 * into a cache that lives as long as the process. One throttled burst in the
 * first audit therefore poisoned every dynasty for the rest of the session:
 * nothing was ever retried, and the Director spent two hours being told that
 * no structured evidence exists anywhere in the world.
 *
 * So transport failure and "no such entity" are now different things. Only a
 * genuine empty result set is cached. A 429 sets a cooldown the whole module
 * respects, is reported to the caller rather than swallowed, and is retried on
 * the next audit. `throttledFor()` says whether the last pass degraded and for
 * how long, so the log can say "rate-limited" instead of "no evidence" - the
 * same distinction the run-file bridge draws between a refusal and silence.
 */

const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
const API_ENDPOINT = 'https://www.wikidata.org/w/api.php';
// Wikimedia's user-agent policy asks for a contact address, and traffic that
// supplies one is throttled less aggressively than traffic that does not.
const UA = 'HistoricalDirector/0.4.2 (https://github.com/kaiseer1/historical-director-project)';

/**
 * Only ever holds answers the endpoint actually gave. A lookup that failed in
 * transit is absent rather than null, so the next audit asks again.
 * @type {Map<string, string|null>}
 */
const entityCache = new Map();

/**
 * When the endpoint last told us to back off, as an epoch millisecond.
 *
 * Module-level rather than per-call: a 429 is a statement about the client, not
 * about one query, so every path here respects the same cooldown instead of
 * each discovering it separately and spending a request to do so.
 */
let throttledUntil = 0;

/**
 * How much of the current cooldown is left, in milliseconds. Zero when healthy.
 * Callers use it to report a degraded pass honestly.
 */
export function throttledFor() {
  return Math.max(0, throttledUntil - Date.now());
}

/** Note a rate-limit response and start the cooldown it asks for. */
function noteThrottle(res) {
  const header = Number(res?.headers?.get?.('retry-after'));
  const seconds = Number.isFinite(header) && header > 0 ? Math.min(header, 300) : 60;
  throttledUntil = Math.max(throttledUntil, Date.now() + seconds * 1000);
}

/**
 * Run a SPARQL query. Failures return an empty result set rather than
 * throwing: a timed-out lookup should degrade the evidence available to the
 * Director, not abort the audit.
 *
 * @param {string} sparql
 * @param {number} [timeoutMs]
 * @returns {Promise<Array<Record<string, string>>>}
 */
export async function query(sparql, timeoutMs = 15000) {
  // Already told to back off: spend no request to be told again.
  if (throttledFor() > 0) return [];

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${SPARQL_ENDPOINT}?format=json&query=${encodeURIComponent(sparql)}`, {
      headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' },
      signal: ctrl.signal,
    });
    if (res.status === 429 || res.status === 503) {
      noteThrottle(res);
      return [];
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data?.results?.bindings ?? []).map((row) =>
      Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v.value])),
    );
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve a realm name to a Wikidata QID.
 *
 * @param {string} label
 * @returns {Promise<string|null>} e.g. "Q175276"
 */
export async function resolveEntity(label) {
  const key = label.toLowerCase().trim();
  if (entityCache.has(key)) return entityCache.get(key) ?? null;
  if (throttledFor() > 0) return null; // unknown, and deliberately not cached

  const url =
    `${API_ENDPOINT}?action=wbsearchentities&search=${encodeURIComponent(label)}` +
    `&language=en&format=json&limit=1&origin=*`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.status === 429 || res.status === 503) {
      // The endpoint declined to answer. That is not evidence of absence, so
      // nothing is written to the cache and the next audit will ask again.
      noteThrottle(res);
      return null;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // A well-formed response with no hits *is* an answer, and worth remembering:
    // most CK3 dynasties are invented and will never resolve, and re-asking for
    // them every audit is what provokes the throttling in the first place.
    const qid = data?.search?.[0]?.id ?? null;
    entityCache.set(key, qid);
    return qid;
  } catch {
    // Timeout, DNS, socket. Transport, not absence: leave the cache alone.
    return null;
  }
}

/**
 * Search once, keeping the description as well as the id.
 *
 * `resolveEntity` deliberately returns only a QID, because for a title that is
 * all a caller needs. Dynasties need more: the fallback query below is a bare
 * place-name once the particle is stripped, and "Barcelona" is a city before it
 * is a house. The description is what tells the two apart, and it comes back in
 * the same response, so checking it costs nothing.
 *
 * @param {string} label
 * @returns {Promise<{qid: string, description: string}|null>}
 */
async function searchWithDescription(label) {
  if (throttledFor() > 0) return null;
  const url =
    `${API_ENDPOINT}?action=wbsearchentities&search=${encodeURIComponent(label)}` +
    `&language=en&format=json&limit=5&origin=*`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.status === 429 || res.status === 503) {
      noteThrottle(res);
      return null;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    for (const hit of data?.search ?? []) {
      const description = hit.description ?? '';
      if (NOT_A_DYNASTY.test(description)) continue;
      if (DYNASTIC.test(description)) return { qid: hit.id, description };
    }
    return null;
  } catch {
    return null;
  }
}

/** Leading particles CK3 keeps and Wikidata usually drops. */
const PARTICLE = /^(?:de la |de |d'|del |della |di |van |von |af |ibn |bin |al-|el-)/i;
/** What a dynasty's description looks like. */
const DYNASTIC = /dynast|famil|house|clan|lineage|noble|royal/i;
/** ...and what it does not. "Barcelona" is a city long before it is a house. */
const NOT_A_DYNASTY = /\b(city|town|municipality|commune|village|river|province|region|surname|given name|film|album|song|footballer|species|genus)\b/i;

/**
 * Who held office in this polity in this year, with the reign interval that
 * justifies the claim.
 *
 * A start date is required: without one there is no interval to test, and
 * including undated statements let fourteenth-century emperors answer an
 * eleventh-century question during development. An open end is allowed, since
 * plenty of reigns are recorded with only a beginning.
 *
 * @param {string} realmLabel as CK3 prints it, e.g. "Kingdom of Leon"
 * @param {number} year
 * @param {{limit?: number}} [opts]
 * @returns {Promise<Array<{person: string, start?: string, end?: string, qid: string}>>}
 */
export async function officeholdersInYear(realmLabel, year, opts = {}) {
  const limit = opts.limit ?? 6;
  const qid = await resolveEntity(realmLabel);
  if (!qid) return [];

  const rows = await query(`
SELECT ?personLabel ?start ?end WHERE {
  ?person p:P39 ?st .
  ?st ps:P39 ?position .
  ?position wdt:P1001 wd:${qid} .
  ?st pq:P580 ?start .
  OPTIONAL { ?st pq:P582 ?end . }
  FILTER(YEAR(?start) <= ${year})
  FILTER(!BOUND(?end) || YEAR(?end) >= ${year})
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT ${limit}`);

  const yearOf = (iso) => (iso ? String(Number(iso.slice(0, 4))) : undefined);
  return rows.map((r) => ({
    person: r.personLabel,
    start: yearOf(r.start),
    end: yearOf(r.end),
    qid,
  }));
}

/**
 * What a dynasty was and when, as a description rather than a reign list.
 *
 * This exists because realm names mostly do not resolve. CK3 prints titles
 * like "Zirid Grand Emirate" or "Ra'isate of Cyrenaica", which are the game's
 * constructions and not names any encyclopedia carries; against a total
 * conversion the mismatch is total. Dynasties are different - "Zirid dynasty"
 * and "Fatimid Caliphate" both resolve immediately - and the snapshot already
 * knows each realm's dynasty, so it is simply a better key to look up.
 *
 * @param {string} dynastyLabel
 * @returns {Promise<{label: string, description: string, qid: string} | null>}
 */
export async function dynastyFacts(dynastyLabel) {
  // "<name> dynasty" is the high-precision query and stays first: it is what
  // resolves Zirid, Nasrid and Zengid, and it is cached either way.
  let qid = await resolveEntity(`${dynastyLabel} dynasty`);

  // It is also the query that misses every European house, because CK3 prints
  // "de Barcelona" and "d'Ivrea" where Wikidata stores "House of Barcelona" and
  // "Anscarids". A live Iberian campaign was almost entirely this shape. One
  // extra attempt on a genuine miss is affordable now that a miss is cached and
  // a throttle is not - the old code could not tell those apart, so it could
  // not afford to ask twice.
  if (!qid && throttledFor() === 0) {
    const core = dynastyLabel.replace(PARTICLE, '').trim();
    if (core) {
      const hit = await searchWithDescription(`House of ${core}`);
      if (hit) qid = hit.qid;
    }
  }
  if (!qid) return null;

  const rows = await query(`
SELECT ?itemLabel ?itemDescription ?inception ?dissolved WHERE {
  BIND(wd:${qid} AS ?item)
  OPTIONAL { ?item wdt:P571 ?inception . }
  OPTIONAL { ?item wdt:P576 ?dissolved . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 1`);

  const r = rows[0];
  if (!r) return null;

  // Wikidata pads years to four digits, so a tenth-century inception arrives
  // as "0972-01-01" and reads as "0972" unless the padding is trimmed.
  const yearOf = (iso) => (iso ? String(Number(iso.slice(0, 4))) : null);
  const span = [yearOf(r.inception), yearOf(r.dissolved)].filter(Boolean).join('-');
  const description = r.itemDescription ?? '';
  const spanIsRedundant = span && description.includes(span.split('-')[0]);
  return {
    label: r.itemLabel ?? dynastyLabel,
    description: [description, spanIsRedundant ? null : span].filter(Boolean).join('; '),
    qid,
  };
}

/**
 * Gather structured evidence for the realms in a snapshot.
 *
 * Tries the realm's own name first, since a vanilla campaign often has titles
 * that do resolve, then falls back to the dynasty, which resolves far more
 * often and is what makes this useful on a modded map.
 *
 * @param {Array<{primaryTitle?: string, dynasty?: string}>} realms
 * @param {number} year
 * @returns {Promise<Array<{realm: string, holders?: string[], note?: string, url: string}>>}
 */
export async function evidenceFor(realms, year, opts = {}) {
  const maxLookups = opts.maxLookups ?? 8;
  const pauseMs = opts.pauseMs ?? 250;

  const out = [];
  const seenDynasties = new Set();
  let lookups = 0;

  const pause = () => new Promise((r) => setTimeout(r, pauseMs));

  // Dynasties first, deduplicated. They resolve far more often than titles, and
  // several realms usually share one, so this is both the higher-yield query
  // and much the cheaper. Wikidata throttles anonymous traffic, and an earlier
  // version firing two queries per realm was quietly getting rate-limited into
  // returning nothing at all - which read as "no data exists" rather than "we
  // asked too fast".
  for (const realm of realms) {
    if (lookups >= maxLookups) break;
    if (throttledFor() > 0) break; // stop early rather than burn the budget
    const dynasty = realm.dynasty;
    if (!dynasty || seenDynasties.has(dynasty.toLowerCase())) continue;
    seenDynasties.add(dynasty.toLowerCase());

    lookups += 1;
    const facts = await dynastyFacts(dynasty);
    await pause();
    if (facts) {
      out.push({
        realm: `${realm.primaryTitle ?? dynasty} (${facts.label})`,
        note: facts.description,
        url: `https://www.wikidata.org/wiki/${facts.qid}`,
      });
    }
  }

  // Then reign intervals for the largest realms, which is the properly
  // date-checkable evidence when the title happens to be a real polity name.
  for (const realm of realms.slice(0, 3)) {
    if (lookups >= maxLookups) break;
    if (throttledFor() > 0) break;
    const title = realm.primaryTitle;
    if (!title) continue;

    lookups += 1;
    const holders = await officeholdersInYear(title, year);
    await pause();
    if (holders.length > 0) {
      out.push({
        realm: title,
        holders: holders.map((h) => `${h.person} (${h.start}${h.end ? `-${h.end}` : '-'})`),
        url: `https://www.wikidata.org/wiki/${holders[0].qid}`,
      });
    }
  }

  // Carried on the array the way wikipedia.retrieve carries `rejected`, so the
  // Director can say "rate-limited" rather than reporting an empty pass as
  // though the world simply has no attested history in it.
  const waiting = throttledFor();
  if (waiting > 0) out.throttled = Math.ceil(waiting / 1000);
  return out;
}
