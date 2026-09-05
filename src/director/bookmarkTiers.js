/**
 * What the record says the map looked like, at the dates the game ships.
 *
 * ## The hole this fills
 *
 * The baseline (model/Baseline.js) is the map as the campaign began, and the
 * rank gate measures drift against it. That works when the campaign began under
 * the Director's eye. Load a save at 1217 and the baseline is captured at 1217,
 * so "since the campaign began" means "since twenty minutes ago", nothing can
 * have risen relative to it, and the gate refuses everything - correctly, by
 * its own logic, and uselessly. Twenty minutes of live play at 1217-1222
 * produced this and nothing else:
 *
 *   dropped: adjust_title_tier: the banu zahir Empire has stood at empire tier
 *            since the campaign began (= Empire); that is the map as it started,
 *            not drift
 *
 * The refusal was sound. The sentence was not: at 1218 that realm had *not*
 * "stood there since the campaign began" in any sense the player would
 * recognise, because the campaign began at a bookmark the Director never saw.
 *
 * ## What this module claims, and what it refuses to
 *
 * It holds two kinds of curated fact per bookmark, and no more:
 *
 * 1. **Named expectations.** A handful of realms whose rank at that date is not
 *    seriously disputed. Used only to permit a demotion when the observed rank
 *    is *above* the expected one.
 *
 * 2. **The empire list.** Who legitimately held imperial or caliphal rank in
 *    the covered world at that date. This list is short and well attested,
 *    which is what makes the negative usable: a realm at empire tier that is
 *    not on it, in a campaign whose baseline cannot speak, is a divergence
 *    worth putting to the player.
 *
 * Everything else yields nothing. **Absence from these tables is never licence
 * to demote** - it is the absence of an opinion, and the gate treats it as a
 * refusal. That asymmetry is the whole design: the tables can only ever open a
 * door that the baseline could not reach, never widen one it already guards.
 *
 * ## What it does not know
 *
 * Coverage stops where the curation does. These lists are the Mediterranean,
 * Europe, the Near East, the Sahel and the Indian subcontinent - the Phase I
 * world. They say nothing about the steppe or East Asia. They are also indexed
 * to three fixed dates: a campaign at 1300 is measured against 1178, which is a
 * hundred and twenty years of legitimate change the tables cannot account for,
 * so the confidence a proposal carries should reflect that and the player is
 * told the distance outright.
 *
 * Sources are Wikipedia articles on the polities themselves; they are cited on
 * the proposal so the player can check the claim rather than take it.
 */

/** The dates CK3 ships as start bookmarks. */
export const BOOKMARKS = [867, 1066, 1178];

/**
 * How far past a bookmark a baseline may be captured and still be treated as
 * the map as shipped.
 *
 * A campaign started at 1066 and played to 1150 still has a 1066 baseline, so
 * this is measured against the year the baseline was *captured*, not the year
 * being audited. Five years is slack for a player who starts the orchestrator a
 * few in-game years into a fresh campaign.
 */
export const BOOKMARK_GRACE_YEARS = 5;

/**
 * Realms whose rank at a bookmark is not seriously in dispute.
 *
 * Deliberately short. Every entry here is a claim the Director will act on, so
 * the bar is "no competent historian would call this the wrong tier", not "this
 * is roughly right". Aliases exist because CK3 title names are localised and
 * modded; matching is on the stripped name (see `normalise`).
 */
const NAMED = {
  867: [
    { aliases: ['byzantine', 'eastern roman', 'romania', 'rhomaion'], tier: 'empire', source: 'https://en.wikipedia.org/wiki/Byzantine_Empire' },
    { aliases: ['abbasid'], tier: 'empire', source: 'https://en.wikipedia.org/wiki/Abbasid_Caliphate' },
    { aliases: ['west francia', 'western francia'], tier: 'kingdom', source: 'https://en.wikipedia.org/wiki/West_Francia' },
    { aliases: ['east francia', 'eastern francia'], tier: 'kingdom', source: 'https://en.wikipedia.org/wiki/East_Francia' },
    { aliases: ['cordoba', 'cordova', 'andalus'], tier: 'kingdom', source: 'https://en.wikipedia.org/wiki/Emirate_of_C%C3%B3rdoba' },
    { aliases: ['bulgaria'], tier: 'kingdom', source: 'https://en.wikipedia.org/wiki/First_Bulgarian_Empire' },
    { aliases: ['rashtrakuta'], tier: 'empire', source: 'https://en.wikipedia.org/wiki/Rashtrakuta_dynasty' },
  ],
  1066: [
    { aliases: ['byzantine', 'eastern roman', 'romania', 'rhomaion'], tier: 'empire', source: 'https://en.wikipedia.org/wiki/Byzantine_Empire' },
    // The standing example. Early Capetian royal authority barely reached past
    // the Ile-de-France, and sources say so at length - which is evidence about
    // power, not about rank. Philip I was a king.
    { aliases: ['france', 'francia'], tier: 'kingdom', source: 'https://en.wikipedia.org/wiki/Kingdom_of_France' },
    { aliases: ['holy roman', 'germany', 'deutschland'], tier: 'empire', source: 'https://en.wikipedia.org/wiki/Holy_Roman_Empire' },
    { aliases: ['fatimid'], tier: 'empire', source: 'https://en.wikipedia.org/wiki/Fatimid_Caliphate' },
    { aliases: ['abbasid'], tier: 'empire', source: 'https://en.wikipedia.org/wiki/Abbasid_Caliphate' },
    { aliases: ['seljuk', 'seljuq'], tier: 'empire', source: 'https://en.wikipedia.org/wiki/Seljuk_Empire' },
    { aliases: ['england'], tier: 'kingdom', source: 'https://en.wikipedia.org/wiki/Kingdom_of_England' },
    { aliases: ['leon', 'castile'], tier: 'kingdom', source: 'https://en.wikipedia.org/wiki/Kingdom_of_Le%C3%B3n' },
    // Emirs under nominal Fatimid suzerainty, not an imperial power. This is
    // the correction the Director made in a live 1066 campaign and the player
    // approved; it is written down so it does not have to be rediscovered.
    { aliases: ['zirid'], tier: 'kingdom', source: 'https://en.wikipedia.org/wiki/Zirid_dynasty' },
    { aliases: ['ghaznavid'], tier: 'kingdom', source: 'https://en.wikipedia.org/wiki/Ghaznavid_dynasty' },
    { aliases: ['chola'], tier: 'empire', source: 'https://en.wikipedia.org/wiki/Chola_Empire' },
  ],
  1178: [
    { aliases: ['byzantine', 'eastern roman', 'romania', 'rhomaion'], tier: 'empire', source: 'https://en.wikipedia.org/wiki/Byzantine_Empire' },
    { aliases: ['holy roman', 'germany', 'deutschland'], tier: 'empire', source: 'https://en.wikipedia.org/wiki/Holy_Roman_Empire' },
    { aliases: ['almohad'], tier: 'empire', source: 'https://en.wikipedia.org/wiki/Almohad_Caliphate' },
    { aliases: ['abbasid'], tier: 'empire', source: 'https://en.wikipedia.org/wiki/Abbasid_Caliphate' },
    { aliases: ['france'], tier: 'kingdom', source: 'https://en.wikipedia.org/wiki/Kingdom_of_France' },
    { aliases: ['england'], tier: 'kingdom', source: 'https://en.wikipedia.org/wiki/Kingdom_of_England' },
    { aliases: ['sicily'], tier: 'kingdom', source: 'https://en.wikipedia.org/wiki/Kingdom_of_Sicily' },
    { aliases: ['jerusalem'], tier: 'kingdom', source: 'https://en.wikipedia.org/wiki/Kingdom_of_Jerusalem' },
    { aliases: ['rum'], tier: 'kingdom', source: 'https://en.wikipedia.org/wiki/Sultanate_of_Rum' },
    { aliases: ['ghurid', 'ghorid'], tier: 'kingdom', source: 'https://en.wikipedia.org/wiki/Ghurid_dynasty' },
    { aliases: ['kanem'], tier: 'kingdom', source: 'https://en.wikipedia.org/wiki/Kanem%E2%80%93Bornu_Empire' },
  ],
};

/**
 * Who held imperial or caliphal rank in the covered world, at each bookmark.
 *
 * The point of this list is its shortness. Empires are the rank whose historical
 * roster is genuinely closed at a given date - there were not fifteen of them
 * and the disagreement is at the edges, not the centre - so a realm at empire
 * tier that appears nowhere on it is saying something checkable about the map.
 * The same negative would be worthless at duchy tier and is not offered there.
 *
 * Borderline cases are included rather than excluded. Every name on this list
 * is a demotion the Director will *not* propose, so erring towards inclusion
 * errs towards silence.
 */
const EMPIRES = {
  867: {
    names: [
      'the Byzantine Empire under Basil I',
      'the Carolingian Empire, with Louis II holding the imperial title',
      'the Abbasid Caliphate at Samarra',
      'the Rashtrakuta Empire in the Deccan',
      'the Tibetan Empire, in its final decades',
    ],
    sources: [
      'https://en.wikipedia.org/wiki/Byzantine_Empire',
      'https://en.wikipedia.org/wiki/Carolingian_Empire',
      'https://en.wikipedia.org/wiki/Abbasid_Caliphate',
      'https://en.wikipedia.org/wiki/Rashtrakuta_dynasty',
    ],
  },
  1066: {
    names: [
      'the Byzantine Empire',
      'the Holy Roman Empire under Henry IV',
      'the Fatimid Caliphate in Egypt',
      'the Abbasid Caliphate at Baghdad, by then largely nominal',
      'the Great Seljuk Empire under Alp Arslan',
      'the Chola Empire in southern India',
    ],
    sources: [
      'https://en.wikipedia.org/wiki/Byzantine_Empire',
      'https://en.wikipedia.org/wiki/Holy_Roman_Empire',
      'https://en.wikipedia.org/wiki/Fatimid_Caliphate',
      'https://en.wikipedia.org/wiki/Seljuk_Empire',
      'https://en.wikipedia.org/wiki/Chola_Empire',
    ],
  },
  1178: {
    names: [
      'the Byzantine Empire under Manuel I Komnenos',
      'the Holy Roman Empire under Frederick Barbarossa',
      'the Almohad Caliphate, holding both the Maghreb and al-Andalus',
      'the Ayyubid Sultanate under Saladin',
      'the Abbasid Caliphate at Baghdad',
      'the Khwarazmian realm, then rising in the east',
    ],
    sources: [
      'https://en.wikipedia.org/wiki/Byzantine_Empire',
      'https://en.wikipedia.org/wiki/Holy_Roman_Empire',
      'https://en.wikipedia.org/wiki/Almohad_Caliphate',
      'https://en.wikipedia.org/wiki/Ayyubid_dynasty',
      'https://en.wikipedia.org/wiki/Khwarazmian_Empire',
    ],
  },
};

/**
 * Words CK3 puts around a realm's name that carry rank rather than identity.
 * Stripped before matching, so "the Zirid Grand Emirate", "Grand Emirate of the
 * Zirids" and "Zirid Sultanate" all reduce to "zirid".
 */
const TITLE_WORDS = /\b(the|of|grand|empire|imperial|kingdom|realm|duchy|dukedom|county|barony|caliphate|sultanate|emirate|sheikhdom|principality|khanate|taifa|wilayah|republic|confederation|horde|dynasty|state)\b/g;

/** @param {string} name */
function normalise(name) {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(TITLE_WORDS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The bookmark a year is measured against: the latest one at or before it, or
 * the earliest bookmark for a campaign that somehow predates them all.
 *
 * @param {number} year
 * @returns {number}
 */
export function nearestBookmark(year) {
  const at = BOOKMARKS.filter((b) => b <= year);
  return at.length ? at[at.length - 1] : BOOKMARKS[0];
}

/**
 * Whether a baseline captured in this year describes the map as shipped, or
 * merely the map at the moment the player happened to load.
 *
 * This is the question the whole module exists to answer, and it is asked of
 * the baseline's capture year, never of the year being audited.
 *
 * @param {number} baselineYear
 */
export function isMidCampaignBaseline(baselineYear) {
  if (!baselineYear) return false;
  return baselineYear - nearestBookmark(baselineYear) > BOOKMARK_GRACE_YEARS;
}

/**
 * What the record expects of this realm, at the bookmark nearest the audited
 * year.
 *
 * @param {{primaryTitle?: string, dynasty?: string, house?: string, tierKey?: string|null}} realm
 * @param {number} year
 * @returns {{kind: 'named', tier: string, bookmark: number, matched: string, source: string}
 *          | {kind: 'unlisted-empire', bookmark: number, names: string[], sources: string[]}
 *          | {kind: 'none', bookmark: number}}
 */
export function expectationFor(realm, year) {
  const bookmark = nearestBookmark(year);

  // Matched on the title and on the dynasty, because CK3 names realms after
  // both and the encyclopedias index the dynasty: "Zirid" finds the dynasty,
  // "Zirid Grand Emirate" is a title the game invented and finds nothing.
  const haystacks = [normalise(realm?.primaryTitle), normalise(realm?.dynasty), normalise(realm?.house)]
    .filter(Boolean);

  for (const entry of NAMED[bookmark] ?? []) {
    for (const alias of entry.aliases) {
      if (haystacks.some((h) => h.includes(alias))) {
        return { kind: 'named', tier: entry.tier, bookmark, matched: alias, source: entry.source };
      }
    }
  }

  // The negative, offered at empire tier only. A realm the curation does not
  // name, at a rank whose roster the curation does close.
  if (realm?.tierKey === 'empire') {
    const list = EMPIRES[bookmark];
    if (list) return { kind: 'unlisted-empire', bookmark, names: list.names, sources: list.sources };
  }

  return { kind: 'none', bookmark };
}

/**
 * The prose the prompt gets: who held imperial rank at the relevant bookmark,
 * and how far the audited year has travelled from it.
 *
 * @param {number} year
 * @param {number} baselineYear
 * @returns {string}
 */
export function bookmarkBriefing(year, baselineYear) {
  const bookmark = nearestBookmark(year);
  const list = EMPIRES[bookmark];
  if (!list) return '';

  const drift = year - bookmark;
  const lines = [
    `At the ${bookmark} bookmark, imperial or caliphal rank in this part of the world was held by:`,
    ...list.names.map((n) => `- ${n}`),
    '',
    `The audited year is ${year}, ${drift} year${drift === 1 ? '' : 's'} after that bookmark. Legitimate change over that span is expected, and this list is evidence about ${bookmark}, not about ${year}. Treat a realm's absence from it as a question worth asking, not as a finding.`,
  ];

  if (isMidCampaignBaseline(baselineYear)) {
    lines.push(
      '',
      `The baseline for this campaign was captured at ${baselineYear}, well after the ${bookmark} bookmark. It therefore records the map as it stood when this save was loaded, not the map the game shipped. A realm reading "= Empire" in the table below has not "held that rank since the start" in any historically meaningful sense - it has held it since the player loaded, which is a fact about the save file and not about the world. Where such a realm appears nowhere in the list above, the divergence is real and you may propose against it.`,
    );
  }

  return lines.join('\n');
}
