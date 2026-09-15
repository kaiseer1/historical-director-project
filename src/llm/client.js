/**
 * Minimal OpenAI-compatible chat client.
 *
 * Deliberately not an SDK. Every provider worth using here — DeepSeek,
 * OpenRouter, a local Ollama, anything OpenAI-compatible — speaks the same
 * /chat/completions shape, and depending on a vendor SDK to send one POST
 * would be the only dependency in the project.
 *
 * Long campaigns are the cost story in the design, so local models have to
 * stay first-class: point baseUrl at http://localhost:11434/v1 and nothing
 * else changes.
 */

/**
 * How many tokens the model may write in one reply, when nothing says otherwise.
 *
 * Was 2000, which fitted the reply this project asked for until v0.11 and does
 * not fit it now. An audit reply carries the assessment, up to two proposals
 * with five prose fields each, a letter for every alarmed neighbour (capped at
 * six by stances.js) and a watchlist of up to five. Measured at roughly 2,260
 * tokens with two proposals and six letters, and about 1,070 with nothing to
 * propose - so a 2000 cap does not fail audits at random, it fails exactly the
 * ones that have something to say.
 *
 * Observed vs inferred, since the difference matters here. OBSERVED, 2026-09-15:
 * a live 1245 campaign at cap 2000 audited every in-game year and showed no
 * proposals. INFERRED: that those audits were truncated - the orchestrator's
 * log had died with the process and a new session had wiped debug.log, so
 * nothing on disk could confirm it. REPRODUCED: the same shape of reply against
 * the simulated game fails at 2000 with a JSON syntax error and yields two
 * proposals at 4000. Strong, not proven.
 *
 * 4096 rather than something larger because it is the ceiling a number of
 * OpenAI-compatible providers and local models enforce, and a default the
 * provider rejects outright would trade a silent failure for a loud one on
 * every audit. It leaves close to double the measured reply.
 */
export const DEFAULT_MAX_TOKENS = 4096;

export class LLMClient {
  /**
   * @param {{baseUrl: string, model: string, apiKey?: string, temperature?: number, maxTokens?: number}} cfg
   */
  constructor(cfg) {
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, '');
    this.model = cfg.model;
    this.apiKey = cfg.apiKey ?? '';
    this.temperature = cfg.temperature ?? 0.2;
    this.maxTokens = cfg.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  /**
   * @param {Array<{role: 'system'|'user'|'assistant', content: string}>} messages
   * @param {{json?: boolean, timeoutMs?: number}} [opts]
   * @returns {Promise<string>}
   */
  async complete(messages, opts = {}) {
    return (await this.request(messages, opts)).content;
  }

  /**
   * One completion, with the provider's reason for stopping.
   *
   * `finish_reason` was being thrown away, and it is the one field that says
   * whether the model finished what it was asked or was cut off at the token
   * limit. Without it a truncated reply reached the player as
   * `Expected ',' or ']' after array element in JSON at position 7143` - a true
   * statement about the symptom that names neither the cause nor the setting
   * that fixes it.
   *
   * @param {Array<{role: 'system'|'user'|'assistant', content: string}>} messages
   * @param {{json?: boolean, timeoutMs?: number}} [opts]
   * @returns {Promise<{content: string, finishReason: string|null}>}
   */
  async request(messages, opts = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 90_000);

    /** @type {Record<string, unknown>} */
    const body = {
      model: this.model,
      messages,
      temperature: this.temperature,
      max_tokens: this.maxTokens,
    };
    if (opts.json) body.response_format = { type: 'json_object' };

    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 300)}`);
      }

      const data = await res.json();
      const choice = data?.choices?.[0];
      const content = choice?.message?.content;
      if (typeof content !== 'string') throw new Error('LLM returned no message content');
      return { content, finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : null };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Complete and parse JSON, tolerating the fenced code block models sometimes
   * wrap it in even when asked not to.
   *
   * @param {Array<{role: 'system'|'user'|'assistant', content: string}>} messages
   * @param {{timeoutMs?: number}} [opts]
   * @returns {Promise<any>}
   */
  async completeJson(messages, opts = {}) {
    const { content: raw, finishReason } = await this.request(messages, { ...opts, json: true });

    // Refused before parsing, and refused even when what arrived happens to
    // parse. A reply cut off at the limit is a reply the model did not finish,
    // and the sections it never reached are the ones at the end of the shape -
    // the letters and the watchlist. Accepting a truncated reply that parsed
    // would drop them silently, which is the same class of error as repairing a
    // malformed proposal: acting on something the model did not actually say.
    if (finishReason === 'length') {
      throw new Error(
        `the model ran out of room: its reply was cut off at the ${this.maxTokens}-token limit before it finished,`
        + ' so none of it could be used. Raise Max tokens in the Settings tab'
        + ` (currently ${this.maxTokens}; ${DEFAULT_MAX_TOKENS} is comfortable for a full audit).`,
      );
    }

    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      // Last resort: the outermost balanced object in the response.
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start !== -1 && end > start) {
        try {
          return JSON.parse(cleaned.slice(start, end + 1));
        } catch {
          // Fall through. This parse used to be unguarded, so its own
          // SyntaxError escaped as the audit's failure message and the
          // explanation below was never reached.
        }
      }
      // Not every provider reports finish_reason, so truncation is still named
      // here as the likely cause rather than asserted - the one thing worth
      // telling a player looking at an unparseable reply is which setting to
      // check.
      throw new Error(
        `the model's reply was not valid JSON (${raw.length} characters, ending "${raw.slice(-40).replace(/\s+/g, ' ')}").`
        + ` If it was cut off, raise Max tokens in the Settings tab (currently ${this.maxTokens}).`,
      );
    }
  }
}
