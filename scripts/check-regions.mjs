/**
 * Verification for the region catalogue and the sphere it seeds.
 *
 * Three of the properties regions.js relies on are the kind that hold when
 * written and quietly stop holding two edits later, and all three are invisible
 * at runtime: a sphere built on a broken one still looks like a sphere.
 *
 *   - every id is a region the game actually defines, or it is a silent no-op
 *   - Phase I regions do not contain one another, or counties are double-counted
 *   - adjacency is symmetric, or the sphere depends on where you start
 *
 * The partition check needs the CK3 install and skips itself without it. The
 * other two need nothing and always run.
 *
 *   node scripts/check-regions.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { REGIONS, PROBE_REGIONS, supportedRegions, isSupported, label } from '../src/director/regions.js';
import { seedSphere } from '../src/director/sphere.js';

let passed = 0;
let failed = 0;
let skipped = 0;

function check(label, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) console.log(`      ${detail}`);
  ok ? (passed += 1) : (failed += 1);
}

function skip(label, why) {
  console.log(`SKIP  ${label}`);
  console.log(`      ${why}`);
  skipped += 1;
}

console.log('\nHistorical Director - regions and sphere\n');

const phase1 = supportedRegions();

// --- 1. adjacency is symmetric ----------------------------------------------
{
  const asymmetric = [];
  for (const [id, region] of Object.entries(REGIONS)) {
    for (const n of region.neighbours) {
      if (!REGIONS[n]) {
        asymmetric.push(`${id} -> ${n} (no such region)`);
        continue;
      }
      // Only Phase I edges matter for seeding, and Phase II regions are not
      // required to point back at the Phase I ones that border them.
      if (isSupported(id) && isSupported(n) && !REGIONS[n].neighbours.includes(id)) {
        asymmetric.push(`${id} -> ${n}, but not back`);
      }
    }
  }
  check(
    '1. adjacency between supported regions is symmetric',
    asymmetric.length === 0,
    asymmetric.length ? asymmetric.join('\n      ') : `${phase1.length} supported regions`,
  );
}

// --- 2. every catalogued and probed id is a real region ----------------------
const GAME_PATHS = [
  'C:/Program Files (x86)/Steam/steamapps/common/Crusader Kings III',
  'C:/Program Files/Steam/steamapps/common/Crusader Kings III',
  'A:/SteamLibrary/steamapps/common/Crusader Kings III',
  'B:/SteamLibrary/steamapps/common/Crusader Kings III',
  'D:/SteamLibrary/steamapps/common/Crusader Kings III',
];

function gameRegionFile() {
  for (const base of GAME_PATHS) {
    const f = path.join(base, 'game', 'map_data', 'geographical_regions', 'geographical_region.txt');
    if (fs.existsSync(f)) return f;
  }
  return null;
}

const regionFile = gameRegionFile();

if (!regionFile) {
  skip('2. ids exist in the game files', 'CK3 install not found; checked the usual Steam paths');
  skip('3. Phase I is a partition', 'same');
} else {
  const clean = fs.readFileSync(regionFile, 'utf8').replace(/#[^\r\n]*/g, '');

  /** @type {Record<string, string>} */
  const defs = {};
  const re = /^([a-z_0-9]+)\s*=\s*\{/gm;
  let m;
  while ((m = re.exec(clean))) {
    let i = re.lastIndex;
    let depth = 1;
    while (i < clean.length && depth > 0) {
      if (clean[i] === '{') depth++;
      else if (clean[i] === '}') depth--;
      i++;
    }
    defs[m[1]] = clean.slice(re.lastIndex, i - 1);
  }

  const listOf = (body, key) => {
    const mm = body.match(new RegExp(key + '\\s*=\\s*\\{([^}]*)\\}'));
    return mm ? mm[1].split(/\s+/).filter(Boolean) : [];
  };

  const cache = new Map();
  function expand(name) {
    if (cache.has(name)) return cache.get(name);
    const out = new Set();
    cache.set(name, out);
    const body = defs[name];
    if (!body) return out;
    for (const k of ['duchies', 'counties', 'provinces', 'kingdoms', 'empires']) {
      for (const v of listOf(body, k)) out.add(k[0] + ':' + v);
    }
    for (const r of listOf(body, 'regions')) for (const x of expand(r)) out.add(x);
    return out;
  }

  const declared = [...new Set([...Object.keys(REGIONS), ...PROBE_REGIONS])];
  const missing = declared.filter((id) => !defs[id]);
  check(
    '2. every catalogued and probed id exists in the game files',
    missing.length === 0,
    missing.length ? `not defined: ${missing.join(', ')}` : `${declared.length} ids checked against ${path.basename(regionFile)}`,
  );

  // d_kermanshah sits in both world_middle_east_arabia and world_persia in the
  // base game. One duchy in 530 is not worth distorting the vocabulary over,
  // and the county-level guard in snapshotScript absorbs it, so it is allowed
  // by name rather than by loosening the check.
  const ALLOWED = new Set(['d:d_kermanshah']);
  const overlaps = [];
  for (let i = 0; i < phase1.length; i++) {
    for (let j = i + 1; j < phase1.length; j++) {
      const a = expand(phase1[i]);
      const b = expand(phase1[j]);
      const shared = [...a].filter((x) => b.has(x) && !ALLOWED.has(x));
      if (shared.length) overlaps.push(`${phase1[i]} x ${phase1[j]}: ${shared.length} shared (${shared.slice(0, 3).join(' ')})`);
    }
  }
  const covered = phase1.reduce((n, r) => n + expand(r).size, 0);
  check(
    '3. no Phase I region contains another',
    overlaps.length === 0,
    overlaps.length ? overlaps.join('\n      ') : `${phase1.length} regions, ${covered} duchies, no unintended overlap`,
  );
}

// --- 4. the sphere grows the way the dials say ------------------------------
{
  const at = (reach, max = 40) => seedSphere(['world_europe_west_iberia'], { reach, max }).regions;
  const r0 = at(0);
  const r1 = at(1);
  const r2 = at(2);
  const r3 = at(3);
  check(
    '4. reach grows the sphere monotonically from the home region',
    r0.length === 1
      && r1.length > r0.length
      && r2.length > r1.length
      && r3.length > r2.length
      && r1.every((x) => r2.includes(x))
      && r2.every((x) => r3.includes(x)),
    `Iberia at reach 0/1/2/3: ${r0.length}, ${r1.length}, ${r2.length}, ${r3.length} regions`,
  );
}

{
  const capped = seedSphere(['world_europe_west_iberia'], { reach: 4, max: 5 });
  check(
    '5. the ceiling truncates the periphery, never the home region',
    capped.regions.length === 5 && capped.regions[0] === 'world_europe_west_iberia' && /ceiling/.test(capped.note),
    capped.note,
  );
}

{
  // The reason the footprint probe exists: a realm spanning three regions must
  // seed from all three, not from wherever its capital happens to sit.
  const wide = seedSphere(['world_europe_west_iberia'], {
    reach: 0,
    max: 25,
    footprint: ['world_africa_north_west', 'world_europe_south_italy'],
  });
  check(
    '6. the realm footprint seeds the sphere alongside the capital',
    wide.regions.length === 3 && wide.footprint.length === 2 && /where the realm holds land/.test(wide.note),
    wide.regions.map(label).join('; '),
  );
}

{
  const unsupported = seedSphere(['world_steppe_east'], { reach: 2, max: 12 });
  check(
    '7. an unsupported home yields no sphere and says why',
    unsupported.regions.length === 0 && /Phase II coverage/.test(unsupported.note),
    unsupported.note,
  );
}

{
  // The model may narrow the sphere but never widen it; a region it names that
  // was not seeded has to be dropped rather than honoured.
  const seeded = seedSphere(['world_europe_west_iberia'], { reach: 1, max: 12 });
  const reachedIndia = seeded.regions.includes('world_india_rajastan');
  check(
    '8. reach 1 from Iberia does not reach India',
    !reachedIndia,
    `${seeded.regions.length} regions: ${seeded.regions.map(label).join('; ')}`,
  );
}

console.log(`\n${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped` : ''}\n`);
process.exit(failed === 0 ? 0 : 1);
