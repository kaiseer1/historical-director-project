/**
 * Verification for the window retrieval: the half of the knowledge layer that
 * is keyed to the date rather than to the dynasties on the table.
 *
 * Both halves of it are checked here, and the second one only exists in this
 * file. The smoke test runs with retrieval off on purpose - a test that fails
 * when Wikipedia is slow is a test nobody trusts - so the queries themselves
 * are exercised against a stubbed fetch, because a filter that works perfectly
 * on documents nobody asked for is worth nothing.
 *
 * The discipline the filter cases are really about: **a missing field must
 * never read as a difference.** A document with no dates in its lead is not
 * evidence about a decade, and treating it as some would let an audit conclude
 * things about a century from an article that never mentioned one.
 *
 *   node scripts/check-window.mjs
 */
import { inAuditWindow, retrieveWindow } from '../src/knowledge/wikipedia.js';

let passed = 0;
let failed = 0;

function check(label, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) console.log(`      ${detail}`);
  ok ? (passed += 1) : (failed += 1);
}

// --- 1. the window filter --------------------------------------------------

check(
  'W1. a lead that names a year inside the window is window evidence',
  inAuditWindow('The Battle of Manzikert was fought on 26 August 1071 between the Byzantine Empire and the Seljuk Turks.', 1066, 1076),
  '1071 is inside 1066-1076',
);

check(
  'W2. so is one whose span contains the window, which is how polities date themselves',
  inAuditWindow('The Seljuk Empire was a Turco-Persian empire which existed from 1037 to 1194.', 1066, 1076),
  '1037 and 1194 are both outside, and the empire plainly is not',
);

check(
  'W3. a lead entirely outside the window is not',
  !inAuditWindow('The Ottoman Empire was founded in 1299 and dissolved in 1922.', 1066, 1076),
  'the general era filter would have kept this; a window question is narrower',
);

check(
  'W4. and a lead with no dates at all is not evidence about a decade',
  !inAuditWindow('Anatolia is a large peninsula in Western Asia and the western part of Turkey.', 1066, 1076),
  'undated is kept by the general pass as background and refused here as an answer',
);

// The queries themselves, with the network stubbed out. Retrieval is off in the
// smoke test on purpose - a test that fails when Wikipedia is slow is a test
// nobody trusts - so this is the only place the query construction is checked,
// and it is the half of the feature that decides whether anything relevant
// comes back at all.
const realFetch = globalThis.fetch;
const asked = [];
globalThis.fetch = async (url) => {
  asked.push(String(url));
  return { ok: true, json: async () => ({ query: { search: [] } }) };
};
const built = await retrieveWindow(['Anatolia and the Caucasus', 'The Balkans'], { year: 1071, span: 5, maxQueries: 4 });
globalThis.fetch = realFetch;

check(
  'W5. the queries name the place and the year together, which is the whole point',
  built.queries.length === 4
    && built.queries.every((q) => /1071/.test(q))
    && built.queries.some((q) => /Anatolia/.test(q) && /battle/.test(q))
    && built.queries.some((q) => /Anatolia/.test(q) && /succession/.test(q)),
  built.queries.join(' | '),
);

check(
  'W6. and the window is the decade around the current date',
  built.from === 1066 && built.to === 1076 && asked.length === 4,
  `${built.from}-${built.to}, ${asked.length} searches issued`,
);

console.log(`
${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
