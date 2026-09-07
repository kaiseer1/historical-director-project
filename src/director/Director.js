import { renderRealmTable } from '../model/WorldState.js';
import { toolSchemas, validateProposal } from './toolkit.js';
import { label, labelList } from './regions.js';
import { bookmarkBriefing } from './bookmarkTiers.js';
import * as wikipedia from '../knowledge/wikipedia.js';
import * as wikidata from '../knowledge/wikidata.js';

/**
 * The Historical Director.
 *
 * Runs one audit: take the world as the mod reported it, retrieve what the
 * record says about the same place and date, ask the model where the two have
 * come apart, and turn its answer into proposals the player can rule on.
 *
 * The model never executes anything. It returns structured proposals, every
 * one of which is re-validated here against the toolkit and the live snapshot
 * before it is even shown, and against the player's judgement before it runs.
 * A proposal that fails validation is dropped and reported, not repaired —
 * silently fixing up a malformed proposal would mean executing something the
 * model did not actually ask for.
 */
export class Director {
  /**
   * @param {{llm: import('../llm/client.js').LLMClient, loreBook: import('../lore/LoreBook.js').LoreBook,
   *          baseline?: import('../model/Baseline.js').Baseline,
   *          knowledge?: {enabled?: boolean, wikipediaLang?: string, maxDocuments?: number},
   *          maxProposals?: number, maxRealmsInPrompt?: number,
   *          log?: (msg: string) => void}} deps
   */
  constructor(deps) {
    this.llm = deps.llm;
    this.loreBook = deps.loreBook;
    this.baseline = deps.baseline ?? null;
    this.knowledge = deps.knowledge ?? { enabled: true };
    this.maxProposals = deps.maxProposals ?? 2;
    this.maxRealmsInPrompt = deps.maxRealmsInPrompt ?? 40;
    this.log = deps.log ?? (() => {});
  }

  /**
   * @param {any} snapshot
   * @param {string[]} sphere region ids
   * @returns {Promise<{proposals: any[], evidence: any, rejected: string[], note: string}>}
   */
  async audit(snapshot, sphere) {
    const year = snapshot.year;
    this.log(`auditing ${year} across ${labelList(sphere)} (${snapshot.realms.length} realms)`);

    const evidence = await this.retrieve(snapshot, sphere, year);
    const raw = await this.propose(snapshot, sphere, evidence);

    /** @type {any[]} */
    const proposals = [];
    /** @type {string[]} */
    const rejected = [];
    let demotionsThisAudit = 0;

    for (const p of raw.proposals ?? []) {
      const check = validateProposal(p, snapshot, this.baseline);
      if (!check.ok) {
        rejected.push(`${p?.action ?? 'unknown'}: ${check.error}`);
        this.log(`rejected proposal - ${check.error}`);
        continue;
      }
      // At most one demotion per audit. The model reaches for adjust_title_tier
      // because it is the bluntest verb available and reads as decisive, and two
      // dissolutions approved in one sitting can take a region apart faster than
      // any historical process did. A cap is cruder than better judgement, and
      // unlike the prompt rule it does not depend on the model having any.
      if (p.action === 'adjust_title_tier') {
        if (demotionsThisAudit >= 1) {
          rejected.push(`${p.action}: only one demotion is offered per audit, and this audit already has one`);
          this.log('rejected proposal - a second demotion in the same audit');
          continue;
        }
        demotionsThisAudit += 1;
      }

      proposals.push({
        id: `${snapshot.token}-${proposals.length}`,
        action: p.action,
        args: p.args,
        preview: check.preview,
        headline: String(p.headline ?? '').slice(0, 160),
        divergence: String(p.divergence ?? '').slice(0, 1200),
        historical_context: String(p.historical_context ?? '').slice(0, 2000),
        consequences: String(p.consequences ?? '').slice(0, 800),
        confidence: p.confidence ?? 'unstated',
        // Surfaced in the sidebar so an action that dissolves a realm does not
        // look like one that nudges an opinion.
        destructive: Boolean(check.action.destructive),
        sources: evidence.sources,
        year,
        date: snapshot.date,
      });
      if (proposals.length >= this.maxProposals) break;
    }

    return { proposals, evidence, rejected, note: raw.assessment ?? '' };
  }

  /**
   * Retrieval. Narrative context from Wikipedia, checkable intervals from
   * Wikidata. Both are best-effort; whatever comes back is what the model gets,
   * and the shortfall is reported rather than hidden.
   */
  async retrieve(snapshot, sphere, year) {
    if (this.knowledge.enabled === false) {
      return { documents: [], structured: [], sources: [], degraded: true };
    }

    // Topics carry no year: the retriever adds the century itself, which
    // ranks better than a bare date. Dynasty names come first because they are
    // what the encyclopedias actually index - "Zirid" finds the dynasty, while
    // "Zirid Grand Emirate" is a title CK3 made up and finds nothing.
    //
    // Order is load-bearing, which it was not when a sphere held six regions.
    // The retriever issues one query per topic and stops after six, so with a
    // twenty-region sphere a region-first list spent every query on place names
    // and never once looked up a dynasty. Widening the sphere would have
    // quietly starved retrieval of the only topics that reliably resolve.
    const relevant = snapshot.byRelevance ?? snapshot.byFootprint;
    const topics = [...new Set([
      ...relevant.slice(0, 6).map((r) => r.dynasty).filter(Boolean),
      ...relevant.slice(0, 3).map((r) => r.primaryTitle).filter(Boolean),
      ...sphere.map((r) => label(r)),
    ])];

    // Sequential, not concurrent. Running both sources at once halves the wall
    // time and doubles the request rate, and both endpoints throttle anonymous
    // traffic by returning empty results rather than an error - so the audit
    // silently lost most of its sources to buy a few seconds it did not need.
    // An audit happens once every few in-game years; it can afford to be polite.
    const documents = await wikipedia.retrieve(topics, {
      lang: this.knowledge.wikipediaLang ?? 'en',
      maxDocuments: this.knowledge.maxDocuments ?? 6,
      year,
    });
    const structured = await wikidata.evidenceFor(relevant.slice(0, 8), year);

    const dropped = documents.rejected ?? [];
    this.log(`retrieved ${documents.length} articles, ${structured.length} realms with structured backing`);
    if (dropped.length) this.log(`  discarded as wrong era: ${dropped.join(', ')}`);

    return {
      documents,
      structured,
      sources: [...documents.map((d) => d.url), ...structured.map((s) => s.url)],
      degraded: documents.length === 0 && structured.length === 0,
    };
  }

  /** Build the prompt and get structured proposals back. */
  async propose(snapshot, sphere, evidence) {
    const system = [
      'You are the Historical Director for a Crusader Kings III campaign.',
      '',
      'Your task is to compare the observed game state against the historical record and identify where they have diverged in ways worth correcting. You do not play the game and you do not execute anything: you propose, the player decides.',
      '',
      'Rules you must follow:',
      '- Ground every proposal in the retrieved evidence below. If the evidence does not support a claim, do not make it. Say plainly when you are working without structured backing.',
      '- Stay inside the sphere of influence. Events elsewhere in the world are not your concern.',
      '- Propose only what is realpolitik-plausible for the period. This is a historical simulator, not a fantasy conversion.',
      '- Divergence is expected and often fine. A world that merely took a different plausible path does not need correcting; propose only where the drift is clear, consequential, and contradicts the record.',
      '- Do not re-propose anything the player has already declined.',
      '',
      'What matters is the SHAPE OF THE MAP, not the identity of the people on it.',
      'Judge the political geography: does a polity of roughly this extent belong here at this date, and is it at the right rank? The same realm under a ruler of the wrong name or dynasty is not a divergence - names drift harmlessly, and a plausible dynasty in the right place at the right tier is historically faithful even when the individual is invented.',
      'adjust_title_tier and grant_claim reshape rank and borders. They are the right tools when rank or borders are what diverged, and the wrong ones otherwise. Use spawn_character only when a polity is missing a court it plainly needs, not to insert a specific famous individual.',
      '',
      'RANK AND POWER ARE SEPARATE AXES.',
      'A king with little effective authority beyond his own demesne is still a king. Sources describing a ruler as weak, nominal, fragmented, overshadowed by his vassals, or holding power in name only are evidence about POWER. They say nothing about TITLE TIER and are never grounds for adjust_title_tier. Early Capetian France and the elective Holy Roman Empire are the standing examples: both are routinely described in exactly those terms, and both held their rank legitimately.',
      '',
      'THE "SINCE CAMPAIGN START" COLUMN IS THE TEST FOR RANK.',
      'It compares each realm against the map as it stood when this campaign began. Propose adjust_title_tier ONLY where that column shows a rise, such as "Kingdom -> Empire". A realm reading "= Empire" has held that rank since the start: that is the bookmark as the game shipped it, not drift, however its ruler is described in the sources. Where the column reads "no baseline" you have no reference for that realm and must say so rather than propose against it.',
      'A rise is permission to look, not a reason to act. Legitimate rises happen - the Normans, the Almoravids - and the retrieved evidence still has to justify the correction.',
      '',
      'A COLUMN READING "= Empire SINCE LOAD" IS A DIFFERENT AND WEAKER STATEMENT.',
      'It appears when this campaign was joined from an existing save rather than started at a bookmark, so the reference map was captured mid-campaign. It means only that the realm has not changed rank since the save was loaded, which is a fact about the session and not about the world: the realm may have risen a century before the player ever saw it. For those realms the reference is the bookmark briefing below rather than the column, and a realm at empire tier that the briefing does not name is a divergence you may raise.',
      '',
      'The realm table leads with realms holding land in the player\'s own regions, marked "neighbour", and then continues by size. Neither position nor size is evidence of drift; the largest realm in a sphere is usually just the largest realm.',
      '',
      'WHAT YOU MAY WATCH IS WIDER THAN WHAT YOU MAY ARRANGE.',
      'Each row is marked "neighbour" (the player\'s own ground), "nearby" (their neighbourhood), or "distant, watch only" (the rim of the sphere). grant_claim, set_relations and trigger_event all push rulers into each other, and every one of them needs at least one party marked neighbour or nearby. A claim granted to one distant realm against another distant realm is a war on the far side of the world in which the player has no stake, and it will be rejected however well argued. adjust_title_tier is not restricted this way: the shape of the map is worth correcting wherever it has gone wrong.',
      'Destroying an empire- or kingdom-tier primary title releases the vassals below it and can fragment a region in a single stroke. Treat it as a major intervention: propose it only at high confidence, and state that consequence plainly in the consequences field.',
      '',
      'PREFER BUILDING OVER BREAKING.',
      'The toolkit can add to the world as well as subtract from it. A macro event sets a historical process in motion and lets the rulers inside it decide; spawn_character supplies a court that is missing one; grant_claim gives a ruler a reason to act. Reach for those first.',
      'adjust_title_tier is the last resort, for drift that nothing constructive can address - not the default way of saying "this realm is wrong". At most one demotion is accepted per audit regardless, so spending the audit on one is a choice about what you are not proposing.',
      '- Returning zero proposals is a good answer when the world is on track. Do not invent work.',
      '',
      'Available actions:',
      JSON.stringify(toolSchemas(), null, 1),
      '',
      'Respond with JSON only, in this shape:',
      '{',
      '  "assessment": "one paragraph on how closely this world tracks the record",',
      '  "proposals": [{',
      '    "action": "<action name from the list>",',
      '    "args": { ... matching that action\'s parameters ... },',
      '    "headline": "short title for the sidebar",',
      '    "divergence": "what the game shows versus what the record says",',
      '    "historical_context": "encyclopedic, neutral, Wikipedia-style explanation for the player",',
      '    "consequences": "what changes in the campaign if this is approved",',
      '    "confidence": "high | medium | low"',
      '  }]',
      '}',
      `Return at most ${this.maxProposals} proposals.`,
    ].join('\n');

    const evidenceBlock = [
      evidence.documents.length
        ? evidence.documents.map((d) => `### ${d.title}\n${d.extract}\nSource: ${d.url}`).join('\n\n')
        : '(no narrative sources retrieved)',
      '',
      'Attested officeholders for this date:',
      evidence.structured.length
        ? evidence.structured
            .map((s) => `- ${s.realm}: ${s.holders ? s.holders.join('; ') : s.note}`)
            .join('\n')
        : '(no structured data retrieved — you are working without date-checkable backing, and must say so)',
    ].join('\n');

    const declined = this.loreBook.declinedSummaries();

    const briefing = bookmarkBriefing(snapshot.year, this.baseline?.capturedYear ?? 0);

    const user = [
      `Date in game: ${snapshot.date} (year ${snapshot.year})`,
      `Player: ${snapshot.player?.ruler ?? 'unknown'} of ${snapshot.player?.primaryTitle ?? 'unknown'}`,
      `Sphere of influence: ${labelList(sphere)}`,
      '',
      '## Observed state',
      'id | ruler | primary title (tier) | footprint | culture/faith | status | [neighbour] | since campaign start',
      renderRealmTable(snapshot, this.maxRealmsInPrompt, this.baseline),
      '',
      ...(briefing ? ['## The record at the nearest bookmark', briefing, ''] : []),
      '## Retrieved historical evidence',
      evidenceBlock,
      '',
      '## Ledger of prior judgements',
      this.loreBook.asPromptContext(),
      declined.length ? `\nAlready declined by the player, do not raise again:\n- ${declined.join('\n- ')}` : '',
    ].join('\n');

    const response = await this.llm.completeJson([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]);

    return {
      assessment: response?.assessment ?? '',
      proposals: Array.isArray(response?.proposals) ? response.proposals : [],
    };
  }
}
