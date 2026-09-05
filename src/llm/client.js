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

export class LLMClient {
  /**
   * @param {{baseUrl: string, model: string, apiKey?: string, temperature?: number, maxTokens?: number}} cfg
   */
  constructor(cfg) {
    this.baseUrl = cfg.baseUrl.replace(/\/+$/, '');
    this.model = cfg.model;
    this.apiKey = cfg.apiKey ?? '';
    this.temperature = cfg.temperature ?? 0.2;
    this.maxTokens = cfg.maxTokens ?? 2000;
  }

  /**
   * @param {Array<{role: 'system'|'user'|'assistant', content: string}>} messages
   * @param {{json?: boolean, timeoutMs?: number}} [opts]
   * @returns {Promise<string>}
   */
  async complete(messages, opts = {}) {
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
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new Error('LLM returned no message content');
      return content;
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
    const raw = await this.complete(messages, { ...opts, json: true });
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      // Last resort: the outermost balanced object in the response.
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start !== -1 && end > start) {
        return JSON.parse(cleaned.slice(start, end + 1));
      }
      throw new Error(`LLM did not return JSON: ${raw.slice(0, 200)}`);
    }
  }
}
