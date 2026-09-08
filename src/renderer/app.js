/* Sidebar client. Renders whatever the orchestrator pushes and sends back the
   player's verdict. All text from the model is inserted as textContent, never
   as HTML: it is generated content, and the sidebar is not a place to trust it
   with markup. */

const $ = (id) => document.getElementById(id);

let current = { state: null, proposals: [], assessment: '' };

// --- tabs ------------------------------------------------------------------

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    $(`tab-${tab.dataset.tab}`).classList.add('active');
    if (tab.dataset.tab === 'ledger') loadLedger();
    if (tab.dataset.tab === 'settings') loadSettings();
  });
});

$('audit-now').addEventListener('click', async (e) => {
  e.target.disabled = true;
  e.target.textContent = 'asking the game...';
  await post('audit', {});
  setTimeout(() => {
    e.target.disabled = false;
    e.target.textContent = 'Audit now';
  }, 4000);
});

// --- transport -------------------------------------------------------------

async function post(endpoint, body) {
  const res = await fetch(`/api/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

const events = new EventSource('/events');
events.onmessage = (e) => {
  const { type, payload } = JSON.parse(e.data);
  if (type === 'state') { current.state = payload; renderStatus(); renderWorld(); renderLastAudit(); }
  if (type === 'proposals') {
    current.proposals = payload.proposals ?? [];
    if (payload.assessment !== undefined) current.assessment = payload.assessment;
    renderProposals();
  }
  if (type === 'log') appendLog(payload);
};

// Initial fill, since SSE only carries what happens after we connect.
post('state', {}).then((d) => {
  current.state = d.state;
  current.proposals = d.proposals ?? [];
  renderStatus(); renderWorld(); renderProposals();
  $('log').textContent = (d.log ?? []).join('\n');
});

// --- rendering -------------------------------------------------------------

function renderStatus() {
  const s = current.state;
  if (!s) return;
  const dot = $('dot');
  dot.className = 'dot' + (s.busy ? ' busy' : s.pumpAlive === false ? ' dead' : s.connected ? ' live' : '');
  $('status-text').textContent = s.busy
    ? 'the Director is reading'
    : s.pumpAlive === false
      ? 'the pump is not running - see World'
      : s.connected
        ? `${s.date ?? 'in game'} - watching ${s.sphere?.labels?.length ?? 0} regions`
        : 'waiting for the game';
}

/** @param {string} name */
function showTab(name) {
  const tab = document.querySelector(`.tab[data-tab="${name}"]`);
  if (!tab || tab.classList.contains('active')) return;
  tab.click();
}

let lastProposalCount = 0;

function renderProposals() {
  const host = $('proposals');
  host.textContent = '';

  const count = current.proposals.length;

  // Bring the player to a proposal rather than expecting them to go looking.
  // The Director audits on its own every few in-game years, so a proposal can
  // arrive at any moment while the player is reading another tab or playing.
  const arrived = count > lastProposalCount;
  if (arrived) showTab('proposals');
  lastProposalCount = count;
  const badge = $('proposal-count');
  badge.textContent = String(count);
  badge.classList.toggle('alert', count > 0);
  $('empty').hidden = count > 0;

  const assessment = $('assessment');
  assessment.hidden = !current.assessment || count === 0;
  assessment.textContent = current.assessment ?? '';

  renderLastAudit();

  for (const p of current.proposals) host.appendChild(renderProposal(p));

  // Switching the view puts Approve under wherever the cursor already was, so a
  // click already on its way can land on it. Approving has to be a deliberate
  // act - it is the only thing standing between the model and the campaign - so
  // the verdict buttons stay inert for a moment after the view moves on its own.
  if (arrived) {
    const buttons = host.querySelectorAll('.verdict button');
    buttons.forEach((b) => { b.disabled = true; });
    setTimeout(() => buttons.forEach((b) => { b.disabled = false; }), 700);
  }
}

/**
 * The empty state used to be a static sentence, which is indistinguishable from
 * a broken orchestrator: the player had to open the Log tab to find out whether
 * anything was happening at all. It now says when the Director last looked and
 * what it concluded.
 */
function renderLastAudit() {
  const host = $('last-audit');
  if (!host) return;
  const a = current.state?.lastAudit;
  host.textContent = '';
  if (!a) return;

  const when = new Date(a.at).toLocaleTimeString();
  host.appendChild(el('div', null, `Last audit ${when}, in-game ${a.date}: ${a.outcome}.`));

  // A dropped proposal is the most useful thing the sidebar can show when the
  // screen is otherwise empty - it is the difference between "the Director saw
  // nothing" and "the Director proposed something the rules refused".
  for (const r of a.rejected ?? []) {
    host.appendChild(el('div', 'dropped', `Dropped: ${r}`));
  }
}

function renderProposal(p) {
  const card = el('article', 'proposal');

  card.appendChild(el('h2', null, p.headline || p.preview));

  const meta = el('div', 'meta');
  meta.appendChild(el('span', null, `${p.date} · ${p.action}`));
  if (p.confidence) {
    meta.appendChild(document.createTextNode(' · '));
    meta.appendChild(el('span', 'conf', `${p.confidence} confidence`));
  }
  if (p.destructive) {
    meta.appendChild(document.createTextNode(' · '));
    meta.appendChild(el('span', 'destructive', 'destructive'));
  }
  card.appendChild(meta);

  // The card's own voice, above the analysis. It argues for why the moment
  // matters; everything below it is the case and the mechanics.
  if (p.narrative) {
    card.appendChild(el('p', 'narrative', p.narrative));
  }

  section(card, 'The divergence', p.divergence);
  section(card, 'Historical context', p.historical_context);
  section(card, 'If approved', p.consequences);

  card.appendChild(el('h3', null, 'The change itself'));
  // `effect wrap` rather than plain `effect`: the preview is a sentence, not a
  // script snippet, and it grew long enough with the vassal-release warning to
  // hide that warning behind a horizontal scrollbar - which would defeat the
  // reason for adding it.
  card.appendChild(el('div', 'effect wrap', p.preview));

  if (p.sources?.length) {
    card.appendChild(el('h3', null, 'Sources'));
    const ul = el('ul', 'sources');
    for (const src of [...new Set(p.sources)].slice(0, 8)) {
      const a = el('a', null, src.replace(/^https?:\/\//, ''));
      a.href = src;
      a.target = '_blank';
      a.rel = 'noreferrer noopener';
      const li = document.createElement('li');
      li.appendChild(a);
      ul.appendChild(li);
    }
    card.appendChild(ul);
  }

  const verdict = el('div', 'verdict');
  const yes = el('button', 'approve', 'Approve');
  const no = el('button', 'decline', 'Decline');
  yes.onclick = () => rule(p.id, 'approve', card);
  no.onclick = () => rule(p.id, 'decline', card);
  verdict.append(yes, no);
  card.appendChild(verdict);

  return card;
}

async function rule(id, verdict, card) {
  card.querySelectorAll('button').forEach((b) => (b.disabled = true));
  await post(verdict, { id });
}

function renderWorld() {
  const s = current.state;
  const host = $('world');
  host.textContent = '';
  if (!s) return;

  // The bridge has gone quiet, and there are two ways that happens which need
  // opposite responses. Shown above the pump warning because when the log
  // subsystem is exhausted every pump symptom is present too - the echo cannot
  // reach us either - and telling someone to use Recall would send them to fix
  // a thing that is not broken with a tool that cannot work.
  if (s.banner) {
    const warn = el('div', 'warn');
    warn.appendChild(el('strong', null, s.banner.text));
    warn.appendChild(el('p', null, s.banner.detail));
    if (s.banner.kind === 'pump_dead') {
      warn.appendChild(el('div', 'effect', 'gui.createwidget gui/custom_gui/hd_runner.gui hd_runner'));
    }
    host.appendChild(warn);
  }

  // The failure that actually strands people: requests pile up in the run file
  // and nothing ever executes them, which from the game's side looks like
  // nothing at all happening. Say so, and say what to do about it.
  //
  // Suppressed while a banner is up, because the banner has already said this
  // in more detail, or has said something that contradicts it.
  if (s.pumpAlive === false && !s.banner) {
    const warn = el('div', 'warn');
    warn.appendChild(el('strong', null, 'The execution pump is not running.'));
    warn.appendChild(el('p', null,
      'Requests are being staged but the game is not picking them up. The pump is a GUI widget and does not survive loading a save.'));
    warn.appendChild(el('p', null, 'Use the "Recall the Historical Director" decision in game, or paste this into the CK3 console:'));
    warn.appendChild(el('div', 'effect', 'gui.createwidget gui/custom_gui/hd_runner.gui hd_runner'));
    host.appendChild(warn);
  }

  // How close this session is to the wall CK3 puts on its own logging. Only
  // shown once it is worth knowing about: below half the threshold it is noise,
  // and the whole point of the clear chain is that the player should never
  // have to think about it.
  if (s.log && !s.log.supported) {
    host.appendChild(el('div', 'warn',
      'The deployed companion mod cannot clear the game log. CK3 stops logging after about 17MB in a session, '
      + 'and after that the Director goes blind until you restart the game. Redeploy the mod to fix this.'));
  } else if (s.log && s.log.mbSinceClear > s.log.thresholdMB / 2) {
    host.appendChild(el('div', 'note',
      `${s.log.mbSinceClear}MB read from the game log since the last clear, of ${s.log.thresholdMB}MB before the next one is requested`
      + (s.log.clears ? ` (${s.log.clears} so far this session)` : '')));
  }

  if (s.sphere?.unsupported?.length && !s.sphere.home?.length) {
    host.appendChild(el('div', 'warn', s.sphere.note));
  }
  if (!s.config?.hasKey) {
    host.appendChild(el('div', 'warn',
      'No API key is set, so the Director cannot audit. Set HD_API_KEY in your environment and restart.'));
  }

  // The orchestrator and the companion mod are deployed separately, and
  // momentum is the one thing that needs them to agree. Said here rather than
  // left to a dropped-proposal line, because the player should know a whole
  // class of proposal is unavailable before wondering why it never appears.
  // Each feature that lives in mod content rather than in composed script gets
  // its own line, because they arrived in different mod versions and a single
  // "the mod is old" message cannot say which of them is actually withheld.
  const gated = [
    [s.config?.momentum, 'Momentum is unavailable.',
      'Claims can still be granted; only the effects that make a ruler able and willing to press one are withheld.'],
    [s.config?.macro, 'The Iberian pressure event is unavailable.',
      'Its modifiers, its event chain and the union decision all live in the companion mod, so the whole action is withheld rather than partly applied.'],
    [s.config?.moment, 'The historical moment library is unavailable.',
      'Its events and modifiers live in the companion mod, so moments are withheld entirely rather than staged with half their effects.'],
  ];
  for (const [feature, headline, consequence] of gated) {
    if (!feature || feature.ok) continue;
    const warn = el('div', 'warn');
    warn.appendChild(el('strong', null, headline));
    warn.appendChild(el('p', null, feature.reason));
    warn.appendChild(el('p', null,
      `${consequence} The Director will not propose it, so nothing here promises an effect your game cannot execute.`));
    host.appendChild(warn);
  }

  const dl = document.createElement('dl');
  const rows = [
    ['In-game date', s.date ?? 'unknown'],
    ['Player', s.player ? `${s.player.ruler} of ${s.player.primaryTitle}` : (s.location?.title ?? 'not yet located')],
    ['Capital', s.location?.capital ?? 'unknown'],
    ['Culture / faith', s.location ? `${s.location.culture} / ${s.location.faith}` : 'unknown'],
    ['Sphere of influence', s.sphere?.labels?.join('; ') || 'not yet computed'],
    ['Sphere setting', `reach ${s.config?.sphereReach ?? '?'}, up to ${s.config?.sphereMax ?? '?'} regions`],
    ['Realms observed', String(s.realmCount ?? 0)],
    ['Companion mod', (() => {
      const mom = s.config?.momentum;
      const macro = s.config?.macro;
      const version = mom?.version ?? macro?.version;
      if (!version) return mom?.checked ? 'not deployed' : 'unverified';
      const stale = [!mom?.ok && 'momentum', !macro?.ok && 'macro events', !s.config?.moment?.ok && 'historical moments'].filter(Boolean);
      return stale.length ? `v${version} (too old for ${stale.join(' and ')})` : `v${version}`;
    })()],
    ['Model', s.config?.model ?? '-'],
    ['Audit cadence', `every ${s.config?.auditEveryYears ?? '?'} in-game years`],
    ['Knowledge layer', s.config?.knowledge ? 'Wikipedia + Wikidata' : 'disabled'],
  ];
  if (s.awaitingApply) rows.push(['Awaiting the game', s.awaitingApply]);

  for (const [k, v] of rows) {
    const row = el('div', 'field');
    row.appendChild(el('dt', null, k));
    row.appendChild(el('dd', null, v));
    dl.appendChild(row);
  }
  host.appendChild(dl);

  if (s.sphere?.note && s.sphere.home?.length) {
    host.appendChild(el('p', 'muted', s.sphere.note));
  }
}

async function loadLedger() {
  const { entries } = await post('lorebook', {});
  const host = $('ledger');
  host.textContent = '';
  if (!entries?.length) {
    host.appendChild(el('p', 'muted', 'The ledger is empty. It fills as you rule on proposals.'));
    return;
  }
  for (const e of [...entries].reverse()) {
    const div = el('div', `entry ${e.verdict}`);
    div.appendChild(el('div', 'when', `${e.date} · ${e.verdict}`));
    div.appendChild(el('div', null, e.summary));
    host.appendChild(div);
  }
}

// --- settings ---------------------------------------------------------------

/**
 * The key field is write-only by design. The server never returns a key, only
 * whether it has one, so this panel can report the state of the key without
 * ever being able to display it.
 */
/**
 * The Director's own dials, built from what the server says they are.
 *
 * The rows are generated rather than written out in index.html so that the
 * range and the explanation of each control live in exactly one place
 * (directorSettings.js). A second copy here would be a second thing to keep
 * true, and the one most likely to go stale is the sentence explaining what a
 * setting costs.
 */
async function loadDirectorSettings() {
  const s = await post('director', {});
  const host = $('director-fields');
  host.textContent = '';

  for (const [key, spec] of Object.entries(s.fields ?? {})) {
    const row = el('div', 'field-row director-row');

    const label = el('label', null, spec.label);
    label.htmlFor = `dir-${key}`;
    row.appendChild(label);

    const input = document.createElement('input');
    input.type = 'number';
    input.id = `dir-${key}`;
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = '1';
    input.value = String(s[key] ?? spec.fallback);
    row.appendChild(input);

    row.appendChild(el('span', 'unit', `${spec.unit} (${spec.min}–${spec.max})`));
    host.appendChild(row);
    host.appendChild(el('p', 'muted setting-note', spec.note));
  }
}

$('director-save').addEventListener('click', async (e) => {
  e.target.disabled = true;
  const body = {};
  for (const input of $('director-fields').querySelectorAll('input')) {
    body[input.id.replace(/^dir-/, '')] = Number(input.value);
  }
  const r = await post('director', body);
  showResult('director-result',
    r.error
      ? `Could not save: ${r.error}`
      : r.updated?.length
        ? `Saved. Auditing every ${r.auditEveryYears} in-game years, sphere reach ${r.sphereReach}, up to ${r.sphereMax} regions.`
        : 'Nothing changed.',
    !r.error);
  // Re-read rather than trust the form: the server clamps, so a 900 typed into
  // a field capped at 100 has to come back as 100 or the panel is lying about
  // what is in force.
  await loadDirectorSettings();
  e.target.disabled = false;
});

async function loadSettings() {
  await loadDirectorSettings();
  const s = await post('settings', {});
  $('baseUrl').value = s.baseUrl ?? '';
  $('model').value = s.model ?? '';
  $('temperature').value = s.temperature ?? 0.2;
  $('maxTokens').value = s.maxTokens ?? 2000;
  $('apiKey').value = '';

  const note = $('key-note');
  note.textContent = s.hasKey
    ? (s.keyFromEnv
      ? `A key is loaded from the ${s.apiKeyEnv} environment variable. A key typed here overrides it for this session only.`
      : 'A key is loaded for this session. It was typed here, and was never written to disk.')
    : `No key. Set ${s.apiKeyEnv} in your environment for it to persist, or type one here for this session.`;
  note.appendChild(document.createElement('br'));
  note.appendChild(el('span', null,
    'A key typed here is held in memory by this process only. It is never saved to config.json and never sent back to this page.'));
}

$('preset').addEventListener('change', (e) => {
  const v = e.target.value;
  if (!v) return;
  // "custom" clears the field so the user fills it; a preset fills the endpoint
  // and leaves the model alone, since the model is the part that varies.
  $('baseUrl').value = v === 'custom' ? '' : v;
  $('baseUrl').focus();
});

$('settings-save').addEventListener('click', async (e) => {
  e.target.disabled = true;
  const body = {
    baseUrl: $('baseUrl').value,
    model: $('model').value,
    temperature: Number($('temperature').value),
    maxTokens: Number($('maxTokens').value),
  };
  const key = $('apiKey').value.trim();
  if (key) body.apiKey = key;

  const r = await post('settings', body);
  $('apiKey').value = '';
  showSettingsResult(
    r.error ? `Could not save: ${r.error}` : `Saved. Now using ${r.model} at ${r.baseUrl}.`,
    !r.error,
  );
  await loadSettings();
  e.target.disabled = false;
});

$('settings-test').addEventListener('click', async (e) => {
  e.target.disabled = true;
  e.target.textContent = 'testing…';
  const r = await post('testConnection', {});
  showSettingsResult(
    r.ok ? `${r.model} answered.` : `No answer: ${r.error}`,
    r.ok,
  );
  e.target.disabled = false;
  e.target.textContent = 'Test connection';
});

function showSettingsResult(text, ok) {
  showResult('settings-result', text, ok);
}

/** @param {string} id @param {string} text @param {boolean} ok */
function showResult(id, text, ok) {
  const host = $(id);
  if (!host) return;
  host.textContent = '';
  host.appendChild(el('div', ok ? 'settings-ok' : 'warn', text));
}

function appendLog(line) {
  const pre = $('log');
  pre.textContent += (pre.textContent ? '\n' : '') + line;
}

// --- helpers ---------------------------------------------------------------

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function section(card, title, body) {
  if (!body) return;
  card.appendChild(el('h3', null, title));
  card.appendChild(el('p', null, body));
}
