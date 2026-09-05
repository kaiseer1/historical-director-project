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
 */

const SPARQL_ENDPOINT = 'https://query.wikidata.org/sparql';
const API_ENDPOINT = 'https://www.wikidata.org/w/api.php';
const UA = 'HistoricalDirector/0.1 (CK3 research prototype)';

/** @type {Map<string, string|null>} */
const entityCache = new Map();

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
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${SPARQL_ENDPOINT}?format=json&query=${encodeURIComponent(sparql)}`, {
      headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' },
      signal: ctrl.signal,
    });
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

  const url =
    `${API_ENDPOINT}?action=wbsearchentities&search=${encodeURIComponent(label)}` +
    `&language=en&format=json&limit=1&origin=*`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const qid = data?.search?.[0]?.id ?? null;
    entityCache.set(key, qid);
    return qid;
  } catch {
    entityCache.set(key, null);
    return null;
  }
}

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
  const qid = await resolveEntity(`${dynastyLabel} dynasty`);
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

  return out;
}
