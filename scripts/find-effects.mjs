/**
 * Probe 0: read the answer out of the game before probing for it.
 *
 * Every question in the probe set below is "does CK3 have an effect that does
 * X, and what is it called". A run-file probe answers that in one console round
 * trip per guess, and a wrong guess is indistinguishable from a dead pump until
 * you read error.log carefully. The game's own script files answer it exactly,
 * offline, in a second - and they answer the follow-up question a probe cannot,
 * which is what the parameters are called and what Paradox passes to them.
 *
 * That is how hd_casus_belli_types.txt came to exist: raiktor_claim_cb was
 * found in common/casus_belli_types/00_event_war.txt, being started from
 * bookmark_events.txt, rather than guessed at. Same method, new questions.
 *
 *   node scripts/find-effects.mjs
 *   node scripts/find-effects.mjs "D:/SteamLibrary/steamapps/common/Crusader Kings III"
 *
 * Reports every hit with its file and line, so you can open the surrounding
 * block and read the parameter names off Paradox's own usage.
 */
import fs from 'node:fs';
import path from 'node:path';

/** The usual places, tried in order. Pass one as argv[2] to override. */
const CANDIDATES = [
  'C:/Program Files (x86)/Steam/steamapps/common/Crusader Kings III',
  'C:/Program Files/Steam/steamapps/common/Crusader Kings III',
  'D:/SteamLibrary/steamapps/common/Crusader Kings III',
  'E:/SteamLibrary/steamapps/common/Crusader Kings III',
];

/**
 * What each question needs to find. The terms are deliberately loose: an
 * effect this project has never used may be spelled in a way no guess would
 * reach, and a false positive costs one line of output while a false negative
 * costs a console round trip and a restart.
 */
const QUESTIONS = [
  {
    id: 'P2 coalition',
    why: 'can script put a third realm into a war that is already running',
    terms: ['join_war', 'add_to_war', 'call_ally', 'send_call_to_arms', 'join_defender_wars', 'add_attacker', 'add_defender'],
  },
  {
    id: 'P1 peace',
    why: 'is there any handle on whether the AI will accept or refuse a peace',
    terms: ['end_war', 'war_score', 'ai_peace', 'peace_desire', 'white_peace', 'surrender'],
  },
  {
    id: 'P3 truce',
    why: 'what blocks a declaration, and what ignores the block',
    terms: ['add_truce_both_ways', 'has_truce_with', 'break_truce', 'ignore_truce'],
  },
  {
    id: 'P4 war name',
    why: 'how Paradox builds a war name that carries the title it is fought over',
    terms: ['war_name', 'my_war_name', 'war_name_base', 'cb_name'],
  },
];

/** Where script and localisation actually live. Nothing else is worth reading. */
const SEARCH_DIRS = ['game/common', 'game/events', 'game/localization/english'];

const root = process.argv[2] ?? CANDIDATES.find((c) => fs.existsSync(c));
if (!root || !fs.existsSync(root)) {
  console.log('\nCould not find the CK3 install. Pass it as an argument:\n');
  console.log('  node scripts/find-effects.mjs "C:/path/to/Crusader Kings III"\n');
  process.exit(1);
}
console.log(`\nReading ${root}\n`);

/** @type {string[]} */
const files = [];
for (const dir of SEARCH_DIRS) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) continue;
  walk(abs, files);
}
console.log(`${files.length} script and localisation files\n`);

/** @param {string} dir @param {string[]} out */
function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(txt|yml)$/i.test(e.name)) out.push(p);
  }
}

// One pass over the corpus, all terms at once. Reading 30,000 files four times
// to ask four questions is the same mistake as one Wikipedia query per topic.
/** @type {Map<string, Array<{file: string, line: number, text: string}>>} */
const hits = new Map();
const allTerms = QUESTIONS.flatMap((q) => q.terms);
for (const t of allTerms) hits.set(t, []);

for (const file of files) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
  for (const term of allTerms) {
    if (!text.includes(term)) continue;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      if (!lines[i].includes(term)) continue;
      const list = hits.get(term);
      // Four examples is enough to read the shape off. More is noise.
      if (list.length < 4) {
        list.push({ file: path.relative(root, file), line: i + 1, text: lines[i].trim().slice(0, 120) });
      }
    }
  }
}

for (const q of QUESTIONS) {
  console.log(`\n${'='.repeat(74)}`);
  console.log(`${q.id} - ${q.why}`);
  console.log('='.repeat(74));
  let found = false;
  for (const term of q.terms) {
    const list = hits.get(term) ?? [];
    if (list.length === 0) {
      console.log(`\n  ${term}  -  not present anywhere in the game's script`);
      continue;
    }
    found = true;
    console.log(`\n  ${term}  -  ${list.length >= 4 ? '4+' : list.length} occurrence(s)`);
    for (const h of list) console.log(`      ${h.file}:${h.line}\n        ${h.text}`);
  }
  if (!found) {
    console.log('\n  Nothing found. Either the capability does not exist, or it is spelled');
    console.log('  in a way none of these terms reach. Widen the terms before concluding');
    console.log('  the first: "no faction_* key exists" was worth establishing; "no effect');
    console.log('  I guessed at exists" is not the same statement.');
  }
}

console.log('\nOpen the surrounding block for any hit before writing a probe against it.');
console.log('The parameter names matter as much as the effect name, and only the file has them.\n');
