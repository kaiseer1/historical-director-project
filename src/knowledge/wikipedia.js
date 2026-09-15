/**
 * Wikipedia retrieval: the narrative half of the knowledge layer.
 *
 * The design calls for chunked dumps in a local vector store, and that is the
 * right destination. This is the near path to the same place: the live search
 * and summary endpoints, which need no dump, no index and no embedding model,
 * and return the same extracts the dump pipeline would eventually serve. When
 * the store lands, only this module changes.
 *
 * Everything returned carries its source URL, because a claim the player
 * cannot check is not evidence.
 */

const UA = 'HistoricalDirector/0.1 (CK3 research prototype)';

/**
 * Process-lifetime caches.
 *
 * A campaign audits the same sphere over and over, so the same handful of
 * queries recur for hours. Caching them is both politer to Wikipedia and the
 * difference between an audit that reliably has sources and one that quietly
 * has none because the last few asked too fast.
 *
 * @type {Map<string, string[]>}
 */
const searchCache = new Map();
/** @type {Map<string, {title: string, extract: string, url: string} | null>} */
const summaryCache = new Map();

/**
 * @param {string} url
 * @param {number} timeoutMs
 */
async function getJson(url, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Search Wikipedia and return the best-matching article titles.
 *
 * @param {string} query
 * @param {{lang?: string, limit?: number}} [opts]
 * @returns {Promise<string[]>}
 */
export async function search(query, opts = {}) {
  const lang = opts.lang ?? 'en';
  const limit = opts.limit ?? 3;
  const key = `${lang}:${limit}:${query}`;
  if (searchCache.has(key)) return searchCache.get(key);

  const url =
    `https://${lang}.wikipedia.org/w/api.php?action=query&list=search` +
    `&srsearch=${encodeURIComponent(query)}&srlimit=${limit}&format=json&origin=*`;
  try {
    const data = await getJson(url);
    const titles = (data?.query?.search ?? []).map((r) => r.title);
    searchCache.set(key, titles);
    return titles;
  } catch {
    // Deliberately not cached: a failure here is usually throttling or a
    // dropped connection, and caching it would make one bad moment permanent.
    return [];
  }
}

/**
 * Fetch the lead extract of an article.
 *
 * @param {string} title
 * @param {{lang?: string}} [opts]
 * @returns {Promise<{title: string, extract: string, url: string} | null>}
 */
export async function summary(title, opts = {}) {
  const lang = opts.lang ?? 'en';
  const key = `${lang}:${title}`;
  if (summaryCache.has(key)) return summaryCache.get(key);

  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  try {
    const data = await getJson(url);
    if (!data?.extract) return null;
    const doc = {
      title: data.title,
      extract: data.extract,
      url: data.content_urls?.desktop?.page ?? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    };
    summaryCache.set(key, doc);
    return doc;
  } catch {
    return null;
  }
}

/**
 * Is this article plausibly about the era we are auditing?
 *
 * Wikipedia's search has no notion of period, so a query like "The Maghreb
 * 1066" cheerfully returns "Insurgency in the Maghreb (2002-present)". Handing
 * that to a model reasoning about the eleventh century is how a confident
 * fabrication gets made: the Director once invented a conquest of Granada by
 * blending in an article the search had dragged in sideways.
 *
 * The test is deliberately generous: only a document whose lead is entirely
 * post-medieval is rejected. Documents with no dates at all are kept, since a
 * survey article with no years in its lead is not evidence of belonging to the
 * wrong century.
 *
 * @param {string} extract
 * @param {number} year the in-game year being audited
 * @param {number} [modernCutoff] a lead citing only years at or after this is junk
 */
export function plausibleForEra(extract, year, modernCutoff = 1500) {
  if (!year || year >= modernCutoff) return true;

  const numbers = [...String(extract).matchAll(/\b(\d{3,4})\b/g)]
    .map((m) => Number(m[1]))
    .filter((n) => n >= 100 && n <= 2100);

  if (numbers.length === 0) return true;

  // Reject only when every number in the lead is post-medieval. Distance from
  // the target year looked like the obvious test and was wrong: it threw out
  // "Maghreb" (whose lead cites a 2018 population and nothing else numeric)
  // and "Abbasid conquest of Ifriqiya" (761, three centuries early but exactly
  // the background an eleventh-century audit wants). Both are useful. What is
  // never useful is an article with nothing in it but modern dates, which is
  // what "Insurgency in the Maghreb (2002-present)" and "Eastern Bloc" are.
  return !numbers.every((n) => n >= modernCutoff);
}

/**
 * Does this lead belong to the window the audit is actually asking about?
 *
 * `plausibleForEra` answers a much weaker question - "is this not obviously
 * about the twentieth century" - and it has to stay weak, because the general
 * retrieval pass is looking for background and a survey article with no dates
 * in its lead is perfectly good background.
 *
 * A window query is not looking for background. It asks what was happening in
 * this place in these ten years, so a document that cannot place itself in
 * those ten years is not an answer to it, and a lead with no dates at all is
 * the commonest way of failing to be one.
 *
 * Two ways to pass. Either the lead cites a year inside the window - "the
 * Battle of Manzikert was fought in 1071" - or it cites a span that contains
 * the window, which is how dynasty and polity articles date themselves: the
 * Seljuk Empire's lead says 1037 and 1194 and neither is inside an 1066-1076
 * window, while the empire certainly was.
 *
 * @param {string} extract
 * @param {number} from
 * @param {number} to
 */
export function inAuditWindow(extract, from, to) {
  const years = [...String(extract).matchAll(/\b(\d{3,4})\b/g)]
    .map((m) => Number(m[1]))
    .filter((n) => n >= 100 && n <= 2100);

  if (years.length === 0) return false;
  if (years.some((n) => n >= from && n <= to)) return true;
  return Math.min(...years) < from && Math.max(...years) > to;
}

/**
 * Ask what the record has happening HERE, NOW - rather than what it has to say
 * about these dynasties in general.
 *
 * The difference is the point. The general pass takes the realms on the table
 * and looks each of them up, which answers "who are these people" and is what
 * a first audit needs. It cannot answer "is something supposed to be happening
 * this decade that is not", because nothing in it is keyed to the date: an
 * audit in 1050 and an audit in 1250 of the same sphere retrieve almost the
 * same documents.
 *
 * So this builds its queries from the year and the place together, and filters
 * on the window rather than on the century. The queries are returned alongside
 * the documents because an empty result is itself information the model needs -
 * "nothing found for these questions" and "nobody asked" are different states
 * and the prompt says which one it is in.
 *
 * @param {string[]} places labels, not region ids - "Anatolia and the Caucasus"
 * @param {{lang?: string, year: number, span?: number, maxDocuments?: number, maxQueries?: number, pauseMs?: number}} opts
 * @returns {Promise<{documents: Array<{title: string, extract: string, url: string}>, queries: string[], from: number, to: number, rejected: string[]}>}
 */
export async function retrieveWindow(places, opts) {
  const lang = opts.lang ?? 'en';
  const year = Number(opts.year) || 0;
  const span = Math.max(1, Math.trunc(opts.span ?? 5));
  const max = opts.maxDocuments ?? 3;
  const maxQueries = opts.maxQueries ?? 4;
  const pauseMs = opts.pauseMs ?? 150;

  const from = year - span;
  const to = year + span;
  if (!year) return { documents: [], queries: [], from, to, rejected: [] };

  // Two intents per place, in the order they are worth having. Wikipedia's
  // full-text search is what is actually being talked to here, so the queries
  // name the year as a word: an article about a battle in this window says the
  // year in its first sentence, and that is the term doing the work.
  const intents = ['battle siege conquest', 'succession dynasty collapse'];
  const queries = [];
  for (const place of places.filter(Boolean)) {
    for (const intent of intents) {
      if (queries.length >= maxQueries) break;
      queries.push(`${place} ${year} ${intent}`);
    }
  }

  const titles = [];
  for (const q of queries) {
    const hits = await search(q, { lang, limit: 3 });
    for (const h of hits) if (!titles.includes(h)) titles.push(h);
    await sleep(pauseMs);
  }

  /** @type {Array<{title: string, extract: string, url: string}>} */
  const documents = [];
  /** @type {string[]} */
  const rejected = [];
  for (const title of titles) {
    if (documents.length >= max) break;
    const doc = await summary(title, { lang });
    if (!doc) continue;
    if (inAuditWindow(doc.extract, from, to)) documents.push(doc);
    else rejected.push(doc.title);
  }

  return { documents, queries, from, to, rejected };
}

/** 867 -> "9th century", for queries that carry their own period. */
function centuryOf(year) {
  const c = Math.floor((year - 1) / 100) + 1;
  const suffix = c % 10 === 1 && c !== 11 ? 'st' : c % 10 === 2 && c !== 12 ? 'nd' : c % 10 === 3 && c !== 13 ? 'rd' : 'th';
  return `${c}${suffix} century`;
}

/**
 * Retrieve evidence for a set of topics: search, pull each lead extract, and
 * drop the ones that belong to another century.
 *
 * Failures are dropped rather than thrown - the Director degrades to whatever
 * it could actually retrieve, and says so, rather than failing the whole audit
 * because one lookup timed out.
 *
 * @param {string[]} topics
 * @param {{lang?: string, maxDocuments?: number, year?: number}} [opts]
 * @returns {Promise<Array<{title: string, extract: string, url: string}>>}
 */
export async function retrieve(topics, opts = {}) {
  const lang = opts.lang ?? 'en';
  const max = opts.maxDocuments ?? 6;
  const year = opts.year ?? 0;
  const maxQueries = opts.maxQueries ?? 6;
  const pauseMs = opts.pauseMs ?? 150;

  // Naming the century in the query biases the search itself, before any
  // filtering: "Maghreb 11th century" outranks the modern insurgency that
  // "Maghreb 1066" surfaces.
  const era = year ? ` ${centuryOf(year)}` : '';

  // One query per topic, capped. An earlier version issued two per topic over
  // an uncapped list, which came to two dozen searches an audit; Wikipedia
  // began returning nothing at all, and an empty result set is indistinguishable
  // from "no such article" once the error is swallowed. Fewer, better queries.
  const queries = topics.slice(0, maxQueries).map((t) => `${t}${era}`);

  const titles = [];
  for (const q of queries) {
    const hits = await search(q, { lang, limit: 2 });
    for (const h of hits) if (!titles.includes(h)) titles.push(h);
    if (titles.length >= max * 2) break;
    await sleep(pauseMs);
  }

  const kept = [];
  const rejected = [];
  for (const title of titles.slice(0, max * 2)) {
    if (kept.length >= max) break;
    const doc = await summary(title, { lang });
    if (!doc) continue;
    if (plausibleForEra(doc.extract, year)) kept.push(doc);
    else rejected.push(doc.title);
  }

  if (rejected.length) kept.rejected = rejected;
  return kept;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
