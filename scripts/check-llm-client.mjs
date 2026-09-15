/**
 * Verification for how the LLM client reports a reply it cannot use.
 *
 * The failure these cases are about was silent in the worst way: a reply cut
 * off at the token limit reached the player as a JSON syntax error at some
 * character position, and the audit panel above an empty proposal list said
 * nothing at all. Both halves read as "the Director has nothing to say". So the
 * cases below check the message, not only that something was thrown - a throw
 * that names a character offset instead of the setting to change is the bug.
 *
 * A real local HTTP server rather than a mocked fetch, because what is in doubt
 * is the whole request: that max_tokens is sent, and that finish_reason is read
 * off the response the way a provider actually shapes it.
 *
 *   node scripts/check-llm-client.mjs
 */
import http from 'node:http';
import { LLMClient, DEFAULT_MAX_TOKENS } from '../src/llm/client.js';

let passed = 0;
let failed = 0;

function check(label, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (detail) console.log(`      ${detail}`);
  ok ? (passed += 1) : (failed += 1);
}

/** What the next request will get back, and what the last one sent. */
let reply = { content: '{}', finish_reason: 'stop' };
let lastBody = null;

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    lastBody = JSON.parse(body);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const choice = { message: { role: 'assistant', content: reply.content } };
    if (reply.finish_reason !== undefined) choice.finish_reason = reply.finish_reason;
    res.end(JSON.stringify({ choices: [choice] }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

const client = new LLMClient({ baseUrl, model: 'check', apiKey: 'k', maxTokens: 2000 });
const ask = [{ role: 'user', content: 'audit' }];

/** Run a completion and return either its value or its error message. */
async function attempt() {
  try {
    return { value: await client.completeJson(ask) };
  } catch (err) {
    return { error: String(err?.message ?? err) };
  }
}

// --- the ordinary paths still work -----------------------------------------

reply = { content: '{"assessment":"on track","proposals":[]}', finish_reason: 'stop' };
let r = await attempt();
check('L1. a complete reply parses', r.value?.assessment === 'on track', JSON.stringify(r.value));

check(
  'L2. and the configured cap is what is sent',
  lastBody?.max_tokens === 2000 && lastBody?.response_format?.type === 'json_object',
  `max_tokens ${lastBody?.max_tokens}, response_format ${lastBody?.response_format?.type}`,
);

reply = { content: '```json\n{"assessment":"fenced"}\n```', finish_reason: 'stop' };
r = await attempt();
check('L3. a fenced reply still parses', r.value?.assessment === 'fenced', JSON.stringify(r.value));

// --- truncation --------------------------------------------------------------

const truncated = '{"assessment":"Anatolia is recognisable","proposals":[{"action":"grant_claim","args":{"actor":1,"target":2},"headline":"A French duchy","divergence":"Philippe holds';
reply = { content: truncated, finish_reason: 'length' };
r = await attempt();
check(
  'L4. a reply cut off at the limit names the cause and the setting, not a character offset',
  /ran out of room/.test(r.error ?? '') && /Max tokens/.test(r.error ?? '') && /2000/.test(r.error ?? '')
    && !/position \d+/.test(r.error ?? ''),
  r.error,
);

// The one that matters most. A truncated reply that happens to parse is missing
// whatever the model had not reached yet - the letters, the watchlist - and
// accepting it would drop them without a word.
reply = { content: '{"assessment":"cut here","proposals":[]}', finish_reason: 'length' };
r = await attempt();
check(
  'L5. and is refused even when what arrived happens to parse',
  r.value === undefined && /ran out of room/.test(r.error ?? ''),
  r.error ?? `accepted: ${JSON.stringify(r.value)}`,
);

// --- a provider that does not say why it stopped -----------------------------

reply = { content: truncated, finish_reason: undefined };
r = await attempt();
check(
  'L6. with no finish_reason, an unparseable reply still points at Max tokens',
  /not valid JSON/.test(r.error ?? '') && /Max tokens/.test(r.error ?? '') && !/Expected ','/.test(r.error ?? ''),
  r.error,
);

// The regression the second parse used to cause: its own SyntaxError escaped,
// and "Expected ',' or ']' after array element in JSON at position 7143" was the
// whole of what the player was told.
// Cut off just after an inner object closed, so the last-resort slice runs from
// the first brace to that inner one and is itself unbalanced. (A first draft of
// this case used '{"a":1} and then {...', whose leading object is valid JSON on
// its own - the fallback rightly returned it and the case tested nothing.)
reply = { content: '{"proposals": [ {"action": "grant_claim"} ', finish_reason: 'stop' };
r = await attempt();
check(
  'L7. the last-resort parse no longer leaks its raw SyntaxError',
  /not valid JSON/.test(r.error ?? '') && !/SyntaxError|Unexpected token|Expected/.test(r.error ?? ''),
  r.error,
);

// --- the plain completion the connection test uses ---------------------------

reply = { content: 'ready', finish_reason: 'stop' };
let plain;
try {
  plain = await client.complete(ask);
} catch (err) {
  plain = `threw: ${err.message}`;
}
check('L8. complete() still returns the text, for the Settings connection test', plain === 'ready', JSON.stringify(plain));

// --- the default ----------------------------------------------------------------

const unset = new LLMClient({ baseUrl, model: 'check' });
check(
  'L9. an unconfigured client now allows a full audit reply',
  unset.maxTokens === DEFAULT_MAX_TOKENS && DEFAULT_MAX_TOKENS >= 4000,
  `default ${unset.maxTokens}; a two-proposal, six-letter reply measured at about 2,260 tokens`,
);

server.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
