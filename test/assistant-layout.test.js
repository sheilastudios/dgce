import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveAssistantPanel, openAssistant, findComposer, activeTabName,
  assistantBlockingDialogs, watchAssistantFailure, ask as actualAsk, ensureHeadroom as actualHeadroom,
  captureAssistantView, restoreAssistantView, awaitAssistantSettled,
} from '../extension/host/assistant.js';

// Existing interaction tests use short settlement windows; dedicated virtual-
// clock cases below exercise the production defaults without wall-clock waits.
const fastReadiness = { quietMs: 2, emptyGraceMs: 2, pollMs: 1 };
const ask = (prompt, opts) => actualAsk(prompt, { readinessOptions: fastReadiness, ...opts });
const ensureHeadroom = (need, opts) => actualHeadroom(need, { readinessOptions: fastReadiness, ...opts });

const box = (shown = true) => ({ width: shown ? 400 : 0, height: shown ? 300 : 0 });
function fixture({ modern = true, opened = true, closeDelay = 0, neverClose = false, collapsed = false } = {}) {
  let toolsWidth = collapsed ? 0 : 400;
  let splitValue = collapsed ? '100' : '65';
  let toggles = 0;
  const handle = { isConnected: true, getBoundingClientRect: () => box(),
    getAttribute: k => k === 'aria-controls' ? 'game-session-content' : k === 'aria-valuenow' ? splitValue : null,
    dispatchEvent(e) { assert.equal(e.key, 'Enter'); toggles++; toolsWidth = toolsWidth ? 0 : 400; splitValue = toolsWidth ? '65' : '100'; } };
  const tools = { getBoundingClientRect: () => ({ width: toolsWidth, height: 300 }),
    parentElement: { querySelectorAll: () => [handle] } };
  let shown = opened;
  let status = '';
  let selected = 'Scenario';
  let launches = 0, closes = 0, sends = 0, legacyClicks = 0;
  const messages = [];
  const extras = [];
  const composer = { value: '', disabled: false, matches: () => false,
    getBoundingClientRect: () => box(shown && toolsWidth > 0), focus() {}, setSelectionRange() {} };
  const composerList = [composer];
  const close = { getBoundingClientRect: () => box(shown), click() {
    closes++;
    if (neverClose) return;
    if (closeDelay) setTimeout(() => { shown = false; }, closeDelay);
    else shown = false;
  } };
  const send = { getBoundingClientRect: () => box(shown), click() {
    sends++; messages.push({ innerText: composer.value }, { innerText: '{"ok":true}' }); composer.value = '';
  } };
  const sendList = [send];
  const statusNode = { get textContent() { return status; } };
  const panel = {
    isConnected: true, getBoundingClientRect: () => box(shown && toolsWidth > 0),
    getAttribute: key => key === 'aria-labelledby' ? 'assistant-heading' : null,
    querySelector(selector) {
      if (selector === (modern ? ':scope > div > [role="status"]' : ':scope > [role="status"]')) return statusNode;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'button[aria-label="Close assistant"]') return [close];
      if (selector === 'button[aria-label="Send message"]') return sendList;
      if (selector === 'textarea, [contenteditable="true"]') return composerList;
      if (selector === '[class*="group/msg"]') return messages;
      return [];
    },
  };
  const oldPanel = modern ? { getBoundingClientRect: () => box(false) } : panel;
  const tab = { textContent: 'Assistant', getBoundingClientRect: () => box(!modern),
    getAttribute: key => key === 'aria-controls' ? 'old-panel' : 'true',
    click() { legacyClicks++; shown = true; selected = 'Assistant'; } };
  const scenario = { textContent: 'Scenario', getBoundingClientRect: () => box(!modern),
    getAttribute: key => key === 'aria-selected' ? String(selected === 'Scenario') : null,
    click() { selected = 'Scenario'; } };
  const launcher = { getBoundingClientRect: () => box(true), click() { launches++; shown = true; } };
  const launchers = modern ? [launcher] : [];
  const heading = { textContent: ' Assistant' };
  const doc = {
    defaultView: { KeyboardEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } } },
    location: { href: 'https://v2.dreamgen.com/app/my/session/test#assistant' },
    getElementById: id => id === 'game-session-tools' && collapsed ? tools : id === 'assistant-heading' ? heading : id === 'old-panel' ? oldPanel : null,
    querySelectorAll(selector) {
      if (selector === 'button') return [scenario, tab];
      if (selector === '[role="dialog"]') return [...(modern && shown ? [panel] : []), ...extras];
      if (selector === '[role="alertdialog"], [role="dialog"]') return [...(modern && shown ? [panel] : []), ...extras];
      if (selector === 'button[aria-label="Open Writing Assistant"]') return launchers;
      throw Error(`Unexpected page-wide lookup: ${selector}`);
    },
    execCommand(_command, _ui, text) { composer.value = text; fx.onSet?.(); return true; },
  };
  const fx = { doc, panel, composer, composerList, sendList, launchers, messages, extras, heading,
    tools, handle, toolState: () => ({ toolsWidth, toggles }), resize: () => { splitValue = '55'; toolsWidth = 500; },
    onSet: null, setStatus: text => { status = text; }, hide: () => { shown = false; },
    counts: () => ({ launches, closes, sends, legacyClicks }) };
  return fx;
}

test('collapsed legacy pane opens for headroom then returns to collapsed', async () => {
  const fx = fixture({ modern: false, collapsed: true });
  await ensureHeadroom(100, { doc: fx.doc });
  assert.deepEqual(fx.toolState(), { toolsWidth: 0, toggles: 2 });
});

test('collapsed pane is restored after ask, including an already selected Assistant', async () => {
  const fx = fixture({ modern: false, collapsed: true });
  const prior = globalThis.document; globalThis.document = fx.doc;
  try { await ask('A bounded test', { doc: fx.doc, pollMs: 1, isComplete: text => text === '{"ok":true}' }); }
  finally { globalThis.document = prior; }
  assert.equal(fx.counts().sends, 1);
  assert.deepEqual(fx.toolState(), { toolsWidth: 0, toggles: 2 });
});

test('Assistant restoration does not undo a user resize', async () => {
  const fx = fixture({ modern: false, collapsed: true });
  fx.onSet = () => fx.resize();
  const prior = globalThis.document; globalThis.document = fx.doc;
  try { await ask('A bounded test', { doc: fx.doc, pollMs: 1, isComplete: text => text === '{"ok":true}' }); }
  finally { globalThis.document = prior; }
  assert.deepEqual(fx.toolState(), { toolsWidth: 500, toggles: 1 });
});

test('collapsed pane expansion refuses ambiguous and foreign splitter controls', () => {
  for (const mode of ['duplicate', 'foreign']) {
    const fx = fixture({ modern: false, collapsed: true });
    if (mode === 'duplicate') fx.tools.parentElement.querySelectorAll = () => [fx.handle, fx.handle];
    else fx.handle.getAttribute = () => 'unrelated-panel';
    openAssistant(fx.doc, captureAssistantView(fx.doc));
    assert.equal(fx.toolState().toggles, 0);
    assert.equal(findComposer(fx.doc), null);
  }
});

test('collapsed pane containing a user draft is opened but neither sent nor hidden again', async () => {
  const fx = fixture({ modern: false, collapsed: true });
  fx.composer.value = 'Keep my draft';
  await assert.rejects(ask('A bounded test', { doc: fx.doc }), /user draft/);
  assert.equal(fx.composer.value, 'Keep my draft');
  assert.equal(fx.counts().sends, 0);
  assert.deepEqual(fx.toolState(), { toolsWidth: 400, toggles: 1 });
});

test('dialog resolution ignores selected but zero-size legacy tabpanel', () => {
  const fx = fixture();
  assert.equal(resolveAssistantPanel(fx.doc), fx.panel);
  assert.equal(findComposer(fx.doc), fx.composer);
  assert.equal(activeTabName(fx.doc), 'Assistant');
  assert.deepEqual(assistantBlockingDialogs(fx.doc), []);
  assert.equal(openAssistant(fx.doc), true);
  assert.equal(fx.counts().launches, 0);
});

test('closed dialog uses exact launcher, not hidden legacy tab', () => {
  const fx = fixture({ opened: false });
  assert.equal(resolveAssistantPanel(fx.doc), null);
  assert.equal(activeTabName(fx.doc), null);
  assert.equal(openAssistant(fx.doc), true);
  assert.equal(fx.counts().launches, 1);
  assert.equal(fx.counts().legacyClicks, 0);
});

test('visible legacy layout remains supported', () => {
  const fx = fixture({ modern: false, opened: false });
  assert.equal(openAssistant(fx.doc), true);
  assert.equal(resolveAssistantPanel(fx.doc), fx.panel);
  assert.equal(findComposer(fx.doc), fx.composer);
  assert.equal(fx.counts().legacyClicks, 1);
});

test('duplicate Assistant dialogs fail closed', () => {
  const fx = fixture(); fx.extras.push(fx.panel);
  assert.equal(resolveAssistantPanel(fx.doc), null);
  assert.equal(openAssistant(fx.doc), false);
});

test('unrelated dialog never becomes an Assistant or permits opening beneath it', () => {
  const fx = fixture(); fx.heading.textContent = 'Delete roleplay';
  assert.equal(resolveAssistantPanel(fx.doc), null);
  assert.equal(findComposer(fx.doc), null);
  assert.equal(openAssistant(fx.doc), false);
});

test('ambiguous launchers and composers fail closed', () => {
  const fx = fixture({ opened: false }); fx.launchers.push(fx.launchers[0]);
  assert.equal(openAssistant(fx.doc), false);
  const other = fixture(); other.composerList.push(other.composer);
  assert.equal(findComposer(other.doc), null);
});

test('nested modal blocks while exact Assistant dialog does not', () => {
  const fx = fixture();
  const modal = { getBoundingClientRect: () => box(), getAttribute: () => 'Clear Assistant Chat' };
  fx.extras.push(modal);
  assert.deepEqual(assistantBlockingDialogs(fx.doc), [modal]);
  assert.equal(openAssistant(fx.doc), false);
});

for (const modern of [true, false]) test(`host failure status is scoped and detects only new errors (${modern})`, () => {
  const fx = fixture({ modern });
  fx.setStatus('Generation stopped because of an error.');
  const watcher = watchAssistantFailure(fx.panel, { Observer: null });
  assert.equal(watcher.getError(), null);
  fx.setStatus('Generating response'); watcher.getError();
  fx.setStatus('Generation stopped because of an error.');
  assert.match(watcher.getError(), /generation error/);
});

test('restoration closes only the same dialog opened by automation', async () => {
  const fx = fixture({ opened: false }); const view = captureAssistantView(fx.doc);
  openAssistant(fx.doc); await restoreAssistantView(view, fx.panel, fx.doc);
  assert.equal(fx.counts().closes, 1);
  const prior = fixture(); const alreadyOpen = captureAssistantView(prior.doc);
  await restoreAssistantView(alreadyOpen, prior.panel, prior.doc);
  assert.equal(prior.counts().closes, 0);
});

test('restoration preserves draft or moved route', async () => {
  for (const mutation of [fx => { fx.composer.value = 'mine'; }, fx => { fx.doc.location.href = 'https://v2.dreamgen.com/app/my/session/other'; }]) {
    const fx = fixture({ opened: false }); const view = captureAssistantView(fx.doc);
    openAssistant(fx.doc); mutation(fx); await restoreAssistantView(view, fx.panel, fx.doc);
    assert.equal(fx.counts().closes, 0);
  }
});

test('headroom opens the dialog, counts scoped chat, then restores closed view', async () => {
  const fx = fixture({ opened: false }); fx.messages.push({ innerText: '123456' });
  const result = await ensureHeadroom(3, { doc: fx.doc, windowTokens: 100, reserve: 0 });
  assert.equal(result.before, 2); assert.equal(result.headroom, 95);
  assert.equal(fx.counts().closes, 1);
});

test('actual ask uses only dialog composer/send/reply and preserves user drafts', async () => {
  const previous = globalThis.document;
  try {
    const fx = fixture({ opened: false }); globalThis.document = fx.doc;
    assert.equal(await ask('diagnostic', { doc: fx.doc, pollMs: 1, timeoutMs: 1000, isComplete: text => text === '{"ok":true}' }), '{"ok":true}');
    assert.deepEqual(fx.counts(), { launches: 1, closes: 1, sends: 1, legacyClicks: 0 });
    assert.match(fx.messages[0].innerText, /^diagnostic\n\nDGCE request identity [a-f0-9-]{36}$/);
    const draft = fixture(); globalThis.document = draft.doc; draft.composer.value = 'human draft';
    await assert.rejects(() => ask('diagnostic', { doc: draft.doc }), /user draft/);
    assert.equal(draft.composer.value, 'human draft'); assert.equal(draft.counts().sends, 0);
  } finally { globalThis.document = previous; }
});

test('a modal appearing during prompt preparation prevents send', async () => {
  const previous = globalThis.document;
  try {
    const fx = fixture(); globalThis.document = fx.doc;
    fx.onSet = () => fx.extras.push({ getBoundingClientRect: () => box(), getAttribute: () => 'Other' });
    await assert.rejects(() => ask('diagnostic', { doc: fx.doc }), /dialog opened/);
    assert.equal(fx.counts().sends, 0);
  } finally { globalThis.document = previous; }
});

test('actual ask refuses history hydration during typing before clicking send', async () => {
  const previous = globalThis.document;
  try {
    const fx = fixture(); globalThis.document = fx.doc;
    const prompt = 'You are the Archivist for a continuity extension. Maintain the small memory\ncurrent run';
    fx.onSet = () => fx.messages.push(
      { innerText: prompt.replace('current run', 'old run') },
      { innerText: '{"old":true}' },
    );
    await assert.rejects(ask(prompt, { doc: fx.doc, pollMs: 1, timeoutMs: 1000,
      isComplete: text => text.startsWith('{') }), /history or composer changed/);
    assert.equal(fx.counts().sends, 0);
    assert.equal(fx.composer.value, '');
  } finally { globalThis.document = previous; }
});

function readinessClock(fx, step = () => {}) {
  let elapsed = 0;
  return { doc: fx.doc, now: () => elapsed,
    sleep: async ms => { elapsed += ms; step(elapsed); } };
}

test('readiness waits for late saved history and a full quiet interval', async () => {
  const fx = fixture();
  const clock = readinessClock(fx, elapsed => {
    if (elapsed === 3200) fx.messages.push({ innerText: 'saved history' });
  });
  const ready = await awaitAssistantSettled(fx.panel, clock);
  assert.equal(clock.now(), 4200);
  assert.equal(ready.snapshot, '["saved history"]');
  assert.equal(ready.composer, fx.composer);
  assert.equal(fx.counts().sends, 0);
});

test('empty chat uses the five-second grace, not immediate composer presence', async () => {
  const fx = fixture(); const clock = readinessClock(fx);
  assert.equal((await awaitAssistantSettled(fx.panel, clock)).snapshot, '[]');
  assert.equal(clock.now(), 5000);
});

test('same-count changed chat resets the readiness quiet interval', async () => {
  const fx = fixture(); fx.messages.push({ innerText: 'before' });
  const clock = readinessClock(fx, elapsed => {
    if (elapsed === 800) fx.messages[0].innerText = 'after';
  });
  assert.equal((await awaitAssistantSettled(fx.panel, clock)).snapshot, '["after"]');
  assert.equal(clock.now(), 1800);
});

test('continuously changing chat reaches bounded readiness refusal', async () => {
  const fx = fixture();
  const clock = readinessClock(fx, elapsed => { fx.messages.splice(0, fx.messages.length, { innerText: String(elapsed) }); });
  await assert.rejects(awaitAssistantSettled(fx.panel, clock), /history did not settle/);
  assert.equal(clock.now(), 10000);
  assert.equal(fx.counts().sends, 0);
});

for (const [name, mutate, error] of [
  ['draft', fx => { fx.composer.value = 'human draft'; }, /user draft/],
  ['route', fx => { fx.doc.location.href = 'https://v2.dreamgen.com/app/my/session/other'; }, /surface changed/],
  ['generation', fx => fx.setStatus('AI is thinking.'), /still generating/],
  ['modal', fx => fx.extras.push({ getBoundingClientRect: () => box(), getAttribute: () => 'Other' }), /surface changed/],
]) test(`readiness stops for ${name} during its wait`, async () => {
  const fx = fixture(); const clock = readinessClock(fx, elapsed => { if (elapsed === 300) mutate(fx); });
  await assert.rejects(awaitAssistantSettled(fx.panel, clock), error);
  assert.equal(fx.counts().sends, 0);
  if (name === 'draft') assert.equal(fx.composer.value, 'human draft');
});

test('headroom measures hydrated history rather than the initial empty render', async () => {
  const fx = fixture();
  const clock = readinessClock(fx, elapsed => { if (elapsed === 3000) fx.messages.push({ innerText: '123456' }); });
  const result = await actualHeadroom(3, { doc: fx.doc, windowTokens: 100, reserve: 0, readinessOptions: clock });
  assert.equal(result.before, 2); assert.equal(result.headroom, 95);
  assert.equal(clock.now(), 4000);
});

test('headroom waits for delayed modal teardown before the next actual ask', async () => {
  const previous = globalThis.document;
  try {
    const fx = fixture({ opened: false, closeDelay: 50 }); globalThis.document = fx.doc;
    await ensureHeadroom(3, { doc: fx.doc });
    assert.equal(resolveAssistantPanel(fx.doc), null);
    assert.equal(await ask('after headroom', { doc: fx.doc, pollMs: 1, timeoutMs: 1000, isComplete: text => text === '{"ok":true}' }), '{"ok":true}');
    assert.deepEqual(fx.counts(), { launches: 2, closes: 2, sends: 1, legacyClicks: 0 });
    assert.equal(resolveAssistantPanel(fx.doc), null);
  } finally { globalThis.document = previous; }
});

test('headroom waits past two seconds for actual host teardown without sending', async () => {
  const fx = fixture({ opened: false, closeDelay: 2300 });
  await ensureHeadroom(3, { doc: fx.doc });
  assert.equal(resolveAssistantPanel(fx.doc), null);
  assert.deepEqual(fx.counts(), { launches: 1, closes: 1, sends: 0, legacyClicks: 0 });
});

test('a stuck closing Assistant still fails closed without another click or send', async () => {
  const fx = fixture({ opened: false, neverClose: true });
  await assert.rejects(ensureHeadroom(3, { doc: fx.doc }), /close did not settle/);
  assert.equal(resolveAssistantPanel(fx.doc), fx.panel);
  assert.deepEqual(fx.counts(), { launches: 1, closes: 1, sends: 0, legacyClicks: 0 });
});

test('actual ask refuses an already-generating Assistant without sending again', async () => {
  const fx = fixture(); fx.setStatus('AI is thinking.');
  await assert.rejects(ask('diagnostic', { doc: fx.doc }), /still generating/);
  assert.equal(fx.counts().sends, 0);
  assert.equal(fx.composer.value, '');
});

test('actual ask rechecks busy state after preparing its composer', async () => {
  const previous = globalThis.document;
  try {
    const fx = fixture(); globalThis.document = fx.doc;
    fx.onSet = () => fx.setStatus('AI is thinking.');
    await assert.rejects(ask('diagnostic', { doc: fx.doc }), /began generating/);
    assert.equal(fx.counts().sends, 0);
    assert.equal(fx.composer.value, '');
  } finally { globalThis.document = previous; }
});
