import fs from 'node:fs';
import path from 'node:path';

/**
 * Reading and changing which model the Director talks to, at runtime.
 *
 * Switching provider used to mean editing config.json and restarting. Since
 * llm/client.js already speaks to anything OpenAI-compatible, the only thing
 * standing between DeepSeek and a local Ollama was a restart, which is a poor
 * reason to make someone edit JSON mid-campaign.
 *
 * The API key is handled deliberately differently from everything else.
 * config.js keeps it in the environment so that config.json stays safe to
 * commit and to paste into a bug report, and that property is worth more than
 * the convenience of persisting a key typed into a form. So a key entered in
 * the UI lives in this process and nowhere else: it is never written to disk,
 * and it is never returned to the client - callers get a boolean.
 */

/** Fields that may be changed at runtime, and how to coerce each. */
const FIELDS = {
  baseUrl: (v) => String(v ?? '').trim().replace(/\/+$/, ''),
  model: (v) => String(v ?? '').trim(),
  temperature: (v) => clamp(Number(v), 0, 2, 0.2),
  maxTokens: (v) => Math.trunc(clamp(Number(v), 1, 32000, 2000)),
};

function clamp(n, lo, hi, fallback) {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

/**
 * @param {import('./llm/client.js').LLMClient} llm
 * @param {any} cfg the loaded config, for the config path and the env var name
 */
export function createSettingsHandlers(llm, cfg) {
  const configPath = path.join(cfg.root, 'config.json');
  const apiKeyEnv = cfg.llm.apiKeyEnv ?? 'HD_API_KEY';

  // Whether the key currently in use was typed into the panel rather than read
  // from the environment. Tracked so the panel can say which one is in force:
  // the environment variable may still be set while a session key overrides it,
  // and reporting that as "loaded from the environment" would be a small lie
  // about where the credential in use came from.
  let keyOverriddenInSession = false;

  /** Never includes the key itself. */
  const describe = () => ({
    baseUrl: llm.baseUrl,
    model: llm.model,
    temperature: llm.temperature,
    maxTokens: llm.maxTokens,
    hasKey: Boolean(llm.apiKey),
    apiKeyEnv,
    // So the panel can say where a key came from without revealing it.
    keyFromEnv: Boolean(process.env[apiKeyEnv]) && !keyOverriddenInSession,
  });

  /**
   * Persist the non-secret fields, leaving every other key in the file alone.
   * config.example.json is never touched: it is the shipped template.
   */
  function persist() {
    let raw = {};
    try {
      if (fs.existsSync(configPath)) raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
      raw = {};
    }
    raw.llm = {
      ...(raw.llm ?? {}),
      baseUrl: llm.baseUrl,
      model: llm.model,
      temperature: llm.temperature,
      maxTokens: llm.maxTokens,
      apiKeyEnv,
    };
    // Belt and braces: if an older config ever carried an inline key, do not
    // rewrite it back out.
    delete raw.llm.apiKey;
    fs.writeFileSync(configPath, JSON.stringify(raw, null, 2), 'utf8');
  }

  return {
    /**
     * With no body, reports the current settings. With one, updates them.
     * Mutates the live client rather than rebuilding it, so the Director keeps
     * the same instance and nothing needs rewiring.
     */
    settings(body) {
      const patch = body ?? {};
      const touched = [];

      for (const [field, coerce] of Object.entries(FIELDS)) {
        if (patch[field] === undefined) continue;
        const value = coerce(patch[field]);
        if (field === 'baseUrl' && !value) continue; // an empty endpoint is not a setting
        if (field === 'model' && !value) continue;
        llm[field] = value;
        touched.push(field);
      }

      // In memory only, and only for this process. Not persisted, not returned.
      if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) {
        llm.apiKey = patch.apiKey.trim();
        keyOverriddenInSession = true;
        touched.push('apiKey');
      }

      if (touched.some((f) => f !== 'apiKey')) persist();

      return { ...describe(), updated: touched };
    },

    /**
     * One minimal completion against the current settings.
     *
     * Without this, a wrong endpoint or a missing key is discovered when the
     * first audit fails, which can be five in-game years after the mistake.
     */
    async testConnection() {
      if (!llm.apiKey && !llm.baseUrl.includes('localhost') && !llm.baseUrl.includes('127.0.0.1')) {
        return { ok: false, model: llm.model, error: `no API key: set ${apiKeyEnv} in your environment, or paste one below` };
      }
      try {
        const reply = await llm.complete(
          [{ role: 'user', content: 'Reply with the single word: ready' }],
          { timeoutMs: 20_000 },
        );
        return { ok: true, model: llm.model, error: null, reply: String(reply).trim().slice(0, 60) };
      } catch (err) {
        return { ok: false, model: llm.model, error: String(err?.message ?? err).slice(0, 300) };
      }
    },
  };
}
