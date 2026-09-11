/**
 * The Director's geographic vocabulary.
 *
 * These identifiers are real CK3 geographical regions from the base game's
 * map_data/geographical_regions, not invented labels: the mod passes them
 * straight to `every_county_in_region`, so a typo here is a silent no-op in
 * game. Coverage is split into the two phases the design calls for, and the
 * Phase II regions are declared but not offered, so the orchestrator can tell
 * a player on the Kazakh steppe that they are outside supported coverage
 * rather than quietly producing confident nonsense about ground it cannot
 * ground.
 *
 * ## The partition rule
 *
 * Phase I must be a set of regions that do not contain one another. This is
 * not tidiness. The snapshot sweeps each region in the sphere and counts the
 * counties each realm holds inside it, so a county lying in two regions of the
 * same sphere was counted twice and the realm read as larger than it is - and
 * `countiesInSphere` is what orders the prompt table, seeds the baseline, and
 * tells the model which realms are worth its attention.
 *
 * The original catalogue was not such a set, and this was live:
 *
 *   world_europe_south  = world_europe_south_italy + world_europe_south_east
 *   world_middle_east   = arabia + jerusalem + (persia + khorasan + daylam
 *                                               + transoxiana + makran
 *                                               + kabulistan)
 *
 * Both supersets were Phase I alongside their own parts, so a player in Rayy -
 * a case tested in a live campaign - got a sphere holding both
 * `world_middle_east` and `world_persia`, and every Persian county counted
 * twice. The supersets are gone. `world_middle_east` is replaced by the two
 * halves the game already defines, and Persia and its eastern neighbours stand
 * on their own.
 *
 * Verified against the 1.19 game files: no region below shares a duchy with
 * another, with one deliberate exception - `d_kermanshah` is named by both
 * `world_middle_east_arabia` and `world_persia`. One duchy in 530 is not worth
 * distorting the vocabulary for, and the sweep now de-duplicates at county
 * level anyway (see snapshotScript), so overlap costs an extra pass and
 * nothing else. That county-level guard is the real defence: a total
 * conversion may redefine these regions freely, and a catalogue verified
 * against vanilla proves nothing about the mod list the player is running.
 */

/** @typedef {{id: string, label: string, phase: 1|2, neighbours: string[]}} Region */

/** @type {Record<string, Region>} */
export const REGIONS = {
  // --- Europe -------------------------------------------------------------
  world_europe_west_iberia: {
    id: 'world_europe_west_iberia', label: 'Iberia', phase: 1,
    neighbours: ['world_europe_west_francia', 'world_africa_north_west'],
  },
  world_europe_west_francia: {
    id: 'world_europe_west_francia', label: 'Francia', phase: 1,
    neighbours: ['world_europe_west_iberia', 'world_europe_west_germania', 'world_europe_west_britannia', 'world_europe_south_italy'],
  },
  world_europe_west_britannia: {
    id: 'world_europe_west_britannia', label: 'Britain and Ireland', phase: 1,
    neighbours: ['world_europe_west_francia', 'world_europe_north'],
  },
  world_europe_west_germania: {
    id: 'world_europe_west_germania', label: 'Germania', phase: 1,
    neighbours: ['world_europe_west_francia', 'world_europe_east', 'world_europe_north', 'world_europe_south_italy'],
  },
  world_europe_north: {
    id: 'world_europe_north', label: 'Scandinavia', phase: 1,
    neighbours: ['world_europe_west_britannia', 'world_europe_west_germania', 'world_europe_east'],
  },
  world_europe_east: {
    id: 'world_europe_east', label: 'Eastern Europe', phase: 1,
    neighbours: ['world_europe_west_germania', 'world_europe_north', 'world_europe_south_east', 'world_steppe_west'],
  },
  world_europe_south_italy: {
    id: 'world_europe_south_italy', label: 'Italy and Sicily', phase: 1,
    neighbours: ['world_europe_west_francia', 'world_europe_west_germania', 'world_europe_south_east', 'world_africa_north_west', 'world_africa_north_east'],
  },
  world_europe_south_east: {
    id: 'world_europe_south_east', label: 'The Balkans', phase: 1,
    neighbours: ['world_europe_east', 'world_europe_south_italy', 'world_asia_minor'],
  },

  // --- Anatolia and the Near East -----------------------------------------
  // world_asia_minor carries Armenia, Georgia and Shirvan as well as Anatolia
  // proper, which is why it touches Daylam.
  world_asia_minor: {
    id: 'world_asia_minor', label: 'Anatolia and the Caucasus', phase: 1,
    neighbours: ['world_europe_south_east', 'world_middle_east_jerusalem', 'world_middle_east_arabia', 'world_daylam'],
  },
  world_middle_east_jerusalem: {
    id: 'world_middle_east_jerusalem', label: 'Syria and the Levant', phase: 1,
    neighbours: ['world_asia_minor', 'world_middle_east_arabia', 'world_africa_north_east'],
  },
  // Arabia proper plus Yemen, Mesopotamia, the Jazira and Sinai: what the game
  // calls world_middle_east_arabia. The label says Mesopotamia out loud because
  // the model reasons about Baghdad from it.
  world_middle_east_arabia: {
    id: 'world_middle_east_arabia', label: 'Arabia and Mesopotamia', phase: 1,
    neighbours: ['world_middle_east_jerusalem', 'world_asia_minor', 'world_persia', 'world_daylam', 'world_africa_north_east', 'world_africa_east'],
  },
  world_persia: {
    id: 'world_persia', label: 'Persia', phase: 1,
    neighbours: ['world_middle_east_arabia', 'world_daylam', 'world_khorasan', 'world_makran'],
  },
  world_daylam: {
    id: 'world_daylam', label: 'Daylam and Azerbaijan', phase: 1,
    neighbours: ['world_persia', 'world_asia_minor', 'world_middle_east_arabia', 'world_khorasan', 'world_transoxiana'],
  },
  world_khorasan: {
    id: 'world_khorasan', label: 'Khorasan', phase: 1,
    neighbours: ['world_persia', 'world_daylam', 'world_transoxiana', 'world_kabulistan', 'world_makran'],
  },
  world_transoxiana: {
    id: 'world_transoxiana', label: 'Transoxiana and Khwarezm', phase: 1,
    neighbours: ['world_khorasan', 'world_daylam', 'world_kabulistan', 'world_central_asia'],
  },
  world_makran: {
    id: 'world_makran', label: 'Makran and Sistan', phase: 1,
    neighbours: ['world_persia', 'world_khorasan', 'world_kabulistan', 'world_india_rajastan'],
  },
  world_kabulistan: {
    id: 'world_kabulistan', label: 'Kabulistan', phase: 1,
    neighbours: ['world_khorasan', 'world_makran', 'world_transoxiana', 'world_india_rajastan'],
  },

  // --- Africa -------------------------------------------------------------
  world_africa_north_west: {
    id: 'world_africa_north_west', label: 'The Maghreb', phase: 1,
    neighbours: ['world_europe_west_iberia', 'world_europe_south_italy', 'world_africa_north_east', 'world_africa_sahara'],
  },
  // Tripolitania, Cyrenaica and the Nile. The old label said "Egypt and
  // Ifriqiya", but Ifriqiya is Tunisia and Tunisia is in the Maghreb region,
  // so the label named ground this id does not cover.
  world_africa_north_east: {
    id: 'world_africa_north_east', label: 'Egypt and Libya', phase: 1,
    neighbours: ['world_africa_north_west', 'world_middle_east_jerusalem', 'world_middle_east_arabia', 'world_europe_south_italy', 'world_africa_sahara', 'world_africa_east'],
  },
  world_africa_sahara: {
    id: 'world_africa_sahara', label: 'The Sahara', phase: 1,
    neighbours: ['world_africa_north_west', 'world_africa_north_east', 'world_africa_west', 'world_africa_east'],
  },
  world_africa_west: {
    id: 'world_africa_west', label: 'West Africa and the Sahel', phase: 1,
    neighbours: ['world_africa_sahara', 'world_africa_east'],
  },
  world_africa_east: {
    id: 'world_africa_east', label: 'Nubia, Abyssinia and the Horn', phase: 1,
    neighbours: ['world_africa_north_east', 'world_africa_sahara', 'world_africa_west', 'world_middle_east_arabia'],
  },

  // --- India --------------------------------------------------------------
  // Promoted for the same reason Khorasan and Transoxiana were: the Ghaznavids,
  // the Ghurids, the Delhi Sultanate, the Chaulukyas, the Cholas and the Palas
  // are as well attested and as well indexed as anything already in Phase I,
  // and the encyclopedias carry them. What stays deferred below is the steppe
  // and East Asia, where the difficulty was never the sources' existence.
  //
  // The subcontinent enters as its three constituent regions rather than as
  // world_india, which is their union and would break the partition rule.
  world_india_rajastan: {
    id: 'world_india_rajastan', label: 'North India', phase: 1,
    neighbours: ['world_makran', 'world_kabulistan', 'world_india_deccan', 'world_india_bengal'],
  },
  world_india_deccan: {
    id: 'world_india_deccan', label: 'The Deccan and the south', phase: 1,
    neighbours: ['world_india_rajastan', 'world_india_bengal'],
  },
  world_india_bengal: {
    id: 'world_india_bengal', label: 'Bengal and the eastern plain', phase: 1,
    neighbours: ['world_india_rajastan', 'world_india_deccan'],
  },

  // --- Phase II: declared, deliberately not offered ------------------------
  // Steppe succession and the Chinese dynastic cycle need curated structured
  // data before the Director can say anything grounded about them.
  world_india: { id: 'world_india', label: 'The Indian subcontinent', phase: 2, neighbours: ['world_makran'] },
  world_middle_east: { id: 'world_middle_east', label: 'The Middle East', phase: 2, neighbours: [] },
  world_europe_south: { id: 'world_europe_south', label: 'Southern Europe', phase: 2, neighbours: [] },
  world_mesopotamia: { id: 'world_mesopotamia', label: 'Mesopotamia', phase: 2, neighbours: [] },
  world_central_asia: { id: 'world_central_asia', label: 'Turkestan and the Kazakh steppe', phase: 2, neighbours: ['world_transoxiana', 'world_steppe_west'] },
  world_steppe_west: { id: 'world_steppe_west', label: 'The western steppe', phase: 2, neighbours: ['world_europe_east', 'world_central_asia'] },
  world_steppe_east: { id: 'world_steppe_east', label: 'The eastern steppe', phase: 2, neighbours: ['world_steppe_west', 'world_asia_east'] },
  world_asia_east: { id: 'world_asia_east', label: 'East Asia', phase: 2, neighbours: ['world_steppe_east'] },
  world_tibet: { id: 'world_tibet', label: 'Tibet', phase: 2, neighbours: ['world_india_rajastan'] },
};

/**
 * Every geographical region the base game defines.
 *
 * The mod probes all of them when locating the player, rather than only the
 * ones in the catalogue above. A curated probe list is a promise to keep
 * curating it, and each omission costs a full game restart to discover: a
 * campaign in Khwarezm reported no region at all, and so did one in Rayy.
 * Probing everything means an unrecognised home is a deliberate "outside
 * coverage" answer rather than an accident, and adding support later is a
 * catalogue edit with no mod change at all.
 */
export const PROBE_REGIONS = [
  'world_africa',
  'world_africa_east',
  'world_africa_north',
  'world_africa_north_east',
  'world_africa_north_west',
  'world_africa_sahara',
  'world_africa_west',
  'world_asia',
  'world_asia_and_india',
  'world_asia_borneo',
  'world_asia_cambodia',
  'world_asia_china',
  'world_asia_east',
  'world_asia_indonesia',
  'world_asia_japan',
  'world_asia_khitan_steppe',
  'world_asia_korea',
  'world_asia_malaysia',
  'world_asia_minor',
  'world_asia_north_east',
  'world_asia_philippines',
  'world_asia_sakhalin_hokkaido',
  'world_asia_shiwei_steppe',
  'world_asia_southeast',
  'world_asia_southeast_islands',
  'world_asia_southeast_mainland',
  'world_asia_sulawesi_maluku',
  'world_asia_thailand',
  'world_asia_vietnam',
  'world_atlantic',
  'world_burma',
  'world_central_asia',
  'world_daylam',
  'world_europe',
  'world_europe_east',
  'world_europe_north',
  'world_europe_south',
  'world_europe_south_east',
  'world_europe_south_italy',
  'world_europe_west',
  'world_europe_west_britannia',
  'world_europe_west_francia',
  'world_europe_west_germania',
  'world_europe_west_iberia',
  'world_himalaya',
  'world_india',
  'world_india_bengal',
  'world_india_deccan',
  'world_india_rajastan',
  'world_jazira',
  'world_kabulistan',
  'world_khorasan',
  'world_makran',
  'world_mesopotamia',
  'world_middle_east',
  'world_middle_east_arabia',
  'world_middle_east_jerusalem',
  'world_middle_east_persia',
  'world_persia',
  'world_persian_empire',
  'world_siberia',
  'world_steppe',
  'world_steppe_central',
  'world_steppe_east',
  'world_steppe_tarim',
  'world_steppe_west',
  'world_tibet',
  'world_transoxiana',
];

/** @returns {string[]} region ids the Director is allowed to reason about */
export function supportedRegions() {
  return Object.values(REGIONS).filter((r) => r.phase === 1).map((r) => r.id);
}

/** @param {string} id */
export function label(id) {
  return REGIONS[id]?.label ?? id;
}

/** @param {string} id */
export function isSupported(id) {
  return REGIONS[id]?.phase === 1;
}

/**
 * Render a list of region ids as readable English.
 * Used in log lines and in the prompt, where "a, b and c" reads better than
 * a comma-separated machine list of twenty items.
 *
 * @param {string[]} ids
 */
export function labelList(ids) {
  const names = ids.map(label);
  if (names.length <= 1) return names.join('');

  // Half these labels contain "and" - "Arabia and Mesopotamia", "Nubia,
  // Abyssinia and the Horn" - so a terminal conjunction produced "Arabia and
  // Mesopotamia and Nubia, Abyssinia and the Horn", which reads as four
  // regions rather than two. Where a name already carries the word, commas
  // alone are the unambiguous choice.
  if (names.some((n) => / and |, /.test(n))) return names.join('; ');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
