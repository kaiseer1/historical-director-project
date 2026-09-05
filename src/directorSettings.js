import fs from 'node:fs';
import path from 'node:path';

/**
 * Reading and changing how the Director watches, at runtime.
 *
 * Its companion, llmSettings.js, does the same for which model it reasons with.
 * The two are kept apart because they answer to different concerns: that one
 * guards a credential and must never write it down, this one guards nothing and
 * writes everything down.
 *
 * All four of these used to be constants - some in config.json, one hardcoded
 * in sphere.js - and all four are questions with no universally right answer.
 * How often should the Director speak? How far past your own borders should it
 * look? Those depend on the campaign, on how much the player wants to spend per
 * audit, and on taste. Making them a restart-and-edit-JSON affair was a way of
 * pretending they had defaults rather than answers.
 *
 * Changes take effect at the next audit. Nothing here needs a restart, and
 * nothing here touches the game.
 */

/**
 * The settable fields, with the range each is clamped to and a sentence saying
 * what it costs. The costs are not decoration: three of these four multiply
 * what an audit spends, and a player raising them deserves to know that from
 * the thing that changes them rather than from a bill.
 */
export const DIRECTOR_FIELDS = {
  auditEveryYears: {
    min: 1,
    max: 100,
    fallback: 5,
    label: 'Audit every',
    unit: 'in-game years',
    note: 'How long the Director waits between looks. Every audit is a retrieval pass and one paid completion, so halving this doubles what a campaign costs to run.',
  },
  sphereReach: {
    min: 0,
    max: 8,
    fallback: 2,
    label: 'Sphere reach',
    unit: 'steps outward',
    // Eight is the graph's own diameter: the number of steps it takes to see
    // every supported region from the furthest corner, which is Britain. Any
    // lower and the dial has an arbitrary edge that stops short of the map; any
    // higher and the extra values do nothing. The ceiling below is the real
    // limit on cost, so this one only decides shape.
    note: 'How far past your own regions the sphere grows, in steps through the adjacency graph. 0 watches only the ground you hold, 2 your immediate neighbourhood, 4 most of the Old World from Iberia. At 8, with the ceiling raised, every supported region is in view from anywhere.',
  },
  sphereMax: {
    min: 1,
    max: 25,
    fallback: 12,
    label: 'Sphere ceiling',
    unit: 'regions',
    note: 'The most regions the sphere may hold. This is the real limit on cost: every region is another county sweep in game and more realms in the prompt. 25 is the whole supported world, Ireland to Bengal.',
  },
  maxRealmsInPrompt: {
    min: 10,
    max: 150,
    fallback: 60,
    label: 'Realms in prompt',
    unit: 'rows',
    note: 'How many realms the Director is shown. Your own neighbours come first, then the largest of the rest, so raising this adds distant realms rather than nearer ones.',
  },
};

/** @param {number} n @param {{min: number, max: number, fallback: number}} spec */
function clampTo(n, spec) {
  if (!Number.isFinite(n)) return spec.fallback;
  return Math.min(spec.max, Math.max(spec.min, Math.trunc(n)));
}

/**
 * @param {any} cfg the loaded config; its `director` block is mutated in place
 * @param {{maxRealmsInPrompt: number}} director the live Director instance
 */
export function createDirectorSettings(cfg, director) {
  const configPath = path.join(cfg.root, 'config.json');

  const describe = () => ({
    ...Object.fromEntries(Object.keys(DIRECTOR_FIELDS).map((k) => [k, cfg.director[k]])),
    // Shipped alongside the values so the sidebar renders one description of
    // these controls rather than a second copy that can drift from this one.
    fields: DIRECTOR_FIELDS,
  });

  /** Persist the director block, leaving every other key in the file alone. */
  function persist() {
    let raw = {};
    try {
      if (fs.existsSync(configPath)) raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
      raw = {};
    }
    raw.director = { ...(raw.director ?? {}) };
    for (const key of Object.keys(DIRECTOR_FIELDS)) raw.director[key] = cfg.director[key];
    fs.writeFileSync(configPath, JSON.stringify(raw, null, 2), 'utf8');
  }

  return {
    /** With no body, reports the current settings. With one, updates them. */
    director(body) {
      const patch = body ?? {};
      const updated = [];

      for (const [field, spec] of Object.entries(DIRECTOR_FIELDS)) {
        if (patch[field] === undefined) continue;
        const value = clampTo(Number(patch[field]), spec);
        if (value === cfg.director[field]) continue;
        cfg.director[field] = value;
        updated.push(field);
      }

      // The Director was handed this at construction and keeps its own copy, so
      // the config object alone is not the live value. main.js reads the other
      // three off cfg on each pass, which is why only this one is pushed.
      if (updated.includes('maxRealmsInPrompt')) {
        director.maxRealmsInPrompt = cfg.director.maxRealmsInPrompt;
      }

      if (updated.length) persist();
      return { ...describe(), updated };
    },
  };
}
