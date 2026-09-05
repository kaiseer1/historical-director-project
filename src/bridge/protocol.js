/**
 * Wire protocol between the CK3 companion mod and this orchestrator.
 *
 * The mod writes lines into CK3's logs/debug.log via the `debug_log` effect.
 * Every line we care about is prefixed `HD:` and its fields are separated by
 * `/;/`. The prefix keeps our traffic disjoint from VOTC's `VOTC:` lines, so
 * both mods can be installed at once and neither parser sees the other's data.
 */

export const HD_PREFIX = 'HD:';
export const FIELD_SEP = '/;/';

/**
 * CK3 writes localised text with embedded tooltip and formatting markup, and
 * the NoTooltip variants of the data functions do not strip all of it. A
 * culture comes off the wire looking like:
 *
 *   ONCLICK:CULTURE,156 TOOLTIP:CULTURE,156 L; Kerait!!!
 *
 * This is VOTC's cleanup, which has had years of contact with real save data,
 * plus whitespace collapsing: removing the markup leaves double spaces behind,
 * and those end up inside names shown to the player.
 *
 * @param {string} raw
 * @returns {string}
 */
export function stripMarkup(raw) {
  if (!raw) return '';

  let s = raw
    .replace(/[\x15]/g, '')
    .replace(/\^U[^\n]*/g, '')
    .replace(/\b(?:ONCLICK|TOOLTIP):[A-Z_]+,[^\s)]+/g, '')
    .replace(/^\s*([A-Z][;\s]\s*)+/, '')
    .replace(/(?<![A-Za-z])L\s+/g, '')
    .replace(/(?<![A-Za-z])[A-Z];\s*/g, '');

  // Where a tooltip description marker survives, the readable text follows it.
  const marker = s.indexOf(' L; ');
  if (marker !== -1) s = s.slice(marker + 4);

  return s
    .replace(/!+/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s:!']+$/, '')
    .trim();
}

/**
 * Parse one line of the debug log.
 *
 * @param {string} line
 * @returns {{kind: string, fields: string[]} | null} null when the line is not ours
 */
export function parseLine(line) {
  const start = line.indexOf(HD_PREFIX);
  if (start === -1) return null;

  const parts = line.slice(start + HD_PREFIX.length).split(FIELD_SEP);
  // A leading empty field is expected: our lines begin "HD:/;/kind/;/...".
  const fields = parts.map(stripMarkup).filter((_, i) => i > 0);
  if (fields.length === 0) return null;

  return { kind: fields[0], fields: fields.slice(1) };
}

/**
 * Turn a `realm` record's positional fields into a structured realm.
 * Field order is fixed by hd_perception_effects.txt; keep the two in step.
 *
 * @param {string[]} f
 */
export function toRealm(f) {
  return {
    id: Number(f[0]),
    ruler: f[1] || 'Unknown',
    primaryTitle: f[2] || '',
    tier: f[3] || '',
    countiesInSphere: Number(f[4]) || 0,
    culture: f[5] || '',
    faith: f[6] || '',
    capital: f[7] || '',
    dynasty: f[8] || '',
    house: f[9] || '',
    independent: f[10] === 'yes' || f[10] === '1',
    government: f[11] || '',
  };
}
