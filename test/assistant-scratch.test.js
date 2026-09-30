import test from 'node:test';
import assert from 'node:assert/strict';
import { withAssistantScratch } from '../extension/host/assistant-scratch.js';

function fixture({ modern = false, collapsed = false } = {}) {
  let toolsWidth = collapsed ? 0 : 400;
  const handle = { getBoundingClientRect: () => ({ width: 1, height: 300 }),
    getAttribute: k => k === 'aria-controls' ? 'game-session-content' : k === 'aria-valuenow' ? (toolsWidth ? '65' : '100') : null,
    dispatchEvent() { toolsWidth = toolsWidth ? 0 : 400; } };
  const tools = { getBoundingClientRect: () => ({ width: toolsWidth, height: 300 }),
    parentElement: { querySelectorAll: () => [handle] } };
  const messages = [];
  const handlers = new Map();
  let selected = 'Scenario';
  let modal = null;
  let status = '';
  let clearCount = 0;
  let cancelCount = 0;
  const composer = { value: '', matches: () => false, getBoundingClientRect: () => ({ width: toolsWidth, height: 40 }) };
  const cancel = { textContent: 'Cancel', click() { cancelCount++; modal = null; } };
  const confirm = { textContent: 'Clear chat', click() { clearCount++; messages.length = 0; modal = null; } };
  const clear = { textContent: 'Clear chat', click() {
    modal = {
      getBoundingClientRect: () => ({ width: 100, height: 100 }),
      textContent: 'Clear Assistant Chat Are you sure you want to clear the assistant chat? This action cannot be undone.',
      querySelectorAll: () => [cancel, confirm],
    };
    fx.onClear?.();
  } };
  const panel = {
    isConnected: true,
    getBoundingClientRect: () => ({ width: toolsWidth, height: 100 }),
    getAttribute: attr => attr === 'aria-label' ? 'Assistant' : null,
    querySelector: () => ({ textContent: status }),
    querySelectorAll(selector) {
      if (selector === '[class*="group/msg"]') return messages;
      if (selector === 'button') return [clear];
      if (selector === 'button[aria-label="Close assistant"]') return modern ? [close] : [];
      if (selector === 'textarea, [contenteditable="true"]') return [composer];
      return [];
    },
    addEventListener: (type, fn) => handlers.set(type, fn),
    removeEventListener: type => handlers.delete(type),
  };
  const tabs = ['Scenario', 'Assistant'].map(name => ({
    textContent: name,
    getBoundingClientRect: () => ({ width: modern ? 0 : 100, height: 40 }),
    getAttribute: attr => attr === 'aria-controls' ? 'panel' : String(selected === name),
    click: () => { selected = name; },
  }));
  const close = { getBoundingClientRect: () => ({ width: 10, height: 10 }), click: () => { selected = 'Scenario'; } };
  const doc = {
    defaultView: { KeyboardEvent: class { constructor() {} } },
    location: { href: 'https://example.test/session' },
    querySelectorAll: selector => {
      if (selector === 'button') return tabs;
      if (selector === '[role="dialog"]') return modern ? [panel] : [];
      if (selector === '[role="alertdialog"], [role="dialog"]') return [...(modern ? [panel] : []), ...(modal ? [modal] : [])];
      return [];
    },
    querySelector: () => modal,
    getElementById: id => id === 'game-session-tools' ? (collapsed ? tools : null) : panel,
  };
  const fx = {
    messages, composer, panel, doc, onReply: null, onClear: null, renderPrompt: value => value,
    touch: () => handlers.get('keydown')?.({ isTrusted: true }),
    setStatus: value => { status = value; },
    setModal: value => { modal = value; if (modal) modal.getBoundingClientRect = () => ({ width: 100, height: 100 }); },
    clears: () => clearCount, cancels: () => cancelCount,
    selected: () => selected,
    toolsWidth: () => toolsWidth,
    // Leave scheduler headroom under the concurrent full suite. Production
    // timeouts are unchanged; 40 ms caused an unrelated sporadic false timeout.
    options: { enabled: true, doc, timeoutMs: 500, pollMs: 1,
      readinessOptions: { quietMs: 2, emptyGraceMs: 2, pollMs: 1 },
      leaseFn: task => task({
        ensureHeadroomFn: async () => true,
        askFn: async (prompt, opts) => {
          messages.push({ innerText: fx.renderPrompt(prompt) }, { innerText: 'reply' });
          opts.onPromptAcknowledged(messages[0].innerText);
          await fx.onReply?.();
          return 'reply';
        },
      }),
    },
  };
  return fx;
}

test('temporary Assistant ownership restores its collapsed tools pane', async () => {
  const fx = fixture({ collapsed: true });
  await withAssistantScratch(async () => { assert.equal(fx.toolsWidth(), 400); }, fx.options);
  assert.equal(fx.toolsWidth(), 0);
});

test('temporary Assistant waits for saved history before treating the chat as empty', async () => {
  const fx = fixture({ collapsed: true });
  let elapsed = 0;
  const readinessOptions = { now: () => elapsed, sleep: async ms => {
    elapsed += ms;
    if (elapsed === 3000) fx.messages.push({ innerText: 'saved human exchange' });
  } };
  await assert.rejects(withAssistantScratch(() => assert.fail('must not start in saved chat'),
    { ...fx.options, readinessOptions }), /empty Assistant/);
  assert.equal(elapsed, 4000);
  assert.deepEqual(fx.messages, [{ innerText: 'saved human exchange' }]);
  assert.equal(fx.clears(), 0);
  assert.equal(fx.toolsWidth(), 0);
});

test('temporary Assistant protects trusted user interaction during readiness', async () => {
  const fx = fixture({ collapsed: true });
  let elapsed = 0;
  const readinessOptions = { now: () => elapsed, sleep: async ms => {
    elapsed += ms;
    if (elapsed === 300) fx.touch();
  } };
  await assert.rejects(withAssistantScratch(() => assert.fail('must not start after user activity'),
    { ...fx.options, readinessOptions }), /ownership/);
  assert.equal(fx.clears(), 0);
  assert.equal(fx.toolsWidth(), 400, 'do not hide a pane the user took over');
});

test('scratch requires opt-in and never adopts existing chat or drafts', async () => {
  const fx = fixture();
  const task = () => assert.fail('must not start');
  await assert.rejects(() => withAssistantScratch(task, { ...fx.options, enabled: false }), /opt-in/);
  fx.messages.push({ innerText: 'human history' });
  await assert.rejects(() => withAssistantScratch(task, fx.options), /empty Assistant/);
  fx.messages.length = 0;
  fx.composer.value = 'human draft';
  await assert.rejects(() => withAssistantScratch(task, fx.options), /draft/);
  assert.equal(fx.clears(), 0);
});

test('two owned stages clear separately and return their replies', async () => {
  const fx = fixture();
  const result = await withAssistantScratch(async ({ askFn, ensureHeadroomFn }) => {
    await ensureHeadroomFn(10);
    assert.equal(await askFn('select'), 'reply');
    assert.equal(fx.messages.length, 0);
    return askFn('render');
  }, fx.options);
  assert.equal(result, 'reply');
  assert.equal(fx.clears(), 2);
  assert.equal(fx.messages.length, 0);
  assert.equal(fx.selected(), 'Scenario');
});

for (const [name, mutate] of [
  ['trusted user activity', fx => fx.touch()],
  ['human draft', fx => { fx.composer.value = 'mine'; }],
  ['added message', fx => fx.messages.push({ innerText: 'mine' })],
  ['edited prompt', fx => { fx.messages[0].innerText += ' edit'; }],
  ['edited reply', fx => { fx.messages[1].innerText += ' edit'; }],
  ['reordered messages', fx => fx.messages.reverse()],
  ['route change', fx => { fx.doc.location.href += '/other'; }],
  ['detached panel', fx => { fx.panel.isConnected = false; }],
]) test(`scratch preserves chat after ${name}`, async () => {
  const fx = fixture();
  fx.onReply = () => mutate(fx);
  await assert.rejects(() => withAssistantScratch(({ askFn }) => askFn('test'), fx.options));
  assert.equal(fx.clears(), 0);
  assert.ok(fx.messages.length >= 2);
});

test('ownership loss during confirmation cancels our modal without deleting', async () => {
  const fx = fixture();
  fx.onClear = fx.touch;
  await assert.rejects(() => withAssistantScratch(({ askFn }) => askFn('test'), fx.options), /ownership/);
  assert.equal(fx.cancels(), 1);
  assert.equal(fx.clears(), 0);
});

test('unexpected dialog is never confirmed or cancelled', async () => {
  const fx = fixture();
  fx.onClear = () => fx.setModal({ textContent: 'Delete roleplay?', querySelectorAll: () => [] });
  await assert.rejects(() => withAssistantScratch(({ askFn }) => askFn('test'), fx.options), /Unexpected/);
  assert.equal(fx.cancels(), 0);
  assert.equal(fx.clears(), 0);
});

test('failed transport and unfinished generation remain available for inspection', async () => {
  for (const mode of ['failure', 'streaming']) {
    const fx = fixture();
    fx.onReply = () => {
      if (mode === 'failure') throw new Error('host failure');
      fx.setStatus('Generating response');
    };
    await assert.rejects(() => withAssistantScratch(({ askFn }) => askFn('test'), fx.options));
    assert.equal(fx.clears(), 0);
    assert.equal(fx.messages.length, 2);
  }
});

test('cleanup waits for completed host stream', async () => {
  const fx = fixture();
  fx.onReply = () => { fx.setStatus('Generating response'); setTimeout(() => fx.setStatus(''), 10); };
  await withAssistantScratch(({ askFn }) => askFn('test'), fx.options);
  assert.equal(fx.clears(), 1);
});

test('observed DreamGen ready status permits owned cleanup', async () => {
  const fx = fixture();
  fx.onReply = () => fx.setStatus('The response is ready.');
  await withAssistantScratch(({ askFn }) => askFn('test'), fx.options);
  assert.equal(fx.clears(), 1);
});

test('preexisting dialog prevents the task without interacting with it', async () => {
  const fx = fixture();
  fx.setModal({ textContent: 'Another operation' });
  await assert.rejects(() => withAssistantScratch(() => assert.fail('must not start'), fx.options), /not ready|not found/);
  assert.equal(fx.clears(), 0);
  assert.equal(fx.cancels(), 0);
});

test('confirmation rechecks transcript changes and cancels owned modal', async () => {
  const fx = fixture();
  fx.onClear = () => fx.messages.push({ innerText: 'new human message' });
  await assert.rejects(() => withAssistantScratch(({ askFn }) => askFn('test'), fx.options), /changed/);
  assert.equal(fx.clears(), 0);
  assert.equal(fx.cancels(), 1);
  assert.equal(fx.messages.length, 3);
});

test('sequential-only transport prevents overlapping scratch requests', async () => {
  const fx = fixture();
  await withAssistantScratch(async ({ askFn }) => {
    const first = askFn('first');
    await assert.rejects(() => askFn('second'), /sequential/);
    await first;
  }, fx.options);
  assert.equal(fx.clears(), 1);
});

test('bound scratch functions cannot act after task completion', async () => {
  const fx = fixture();
  let stale;
  await withAssistantScratch(transport => { stale = transport; }, fx.options);
  await assert.rejects(() => stale.askFn('late'), /ownership/);
  await assert.rejects(() => stale.ensureHeadroomFn(10), /ownership/);
  assert.equal(fx.messages.length, 0);
});

test('host-rendered prompt is pinned at acknowledgment, not compared to Markdown source', async () => {
  const fx = fixture();
  fx.renderPrompt = value => value.replace('**test**', 'test');
  await withAssistantScratch(({ askFn }) => askFn('**test**'), fx.options);
  assert.equal(fx.clears(), 1);
});

test('final stream whitespace may settle without permitting substantive reply changes', async () => {
  const fx = fixture();
  fx.onReply = () => { fx.messages[1].innerText += '\n'; };
  assert.equal(await withAssistantScratch(({ askFn }) => askFn('test'), fx.options), 'reply\n');
  assert.equal(fx.clears(), 1);
});

test('modern Assistant dialog permits two owned stages and nested clear confirmation', async () => {
  const fx = fixture({ modern: true });
  await withAssistantScratch(async ({ askFn }) => {
    await askFn('select');
    await askFn('render');
  }, fx.options);
  assert.equal(fx.clears(), 2);
  assert.equal(fx.messages.length, 0);
});

test('modern Assistant dialog still rejects unrelated confirmation', async () => {
  const fx = fixture({ modern: true });
  fx.onClear = () => fx.setModal({ textContent: 'Delete roleplay?', querySelectorAll: () => [] });
  await assert.rejects(() => withAssistantScratch(({ askFn }) => askFn('test'), fx.options), /Unexpected/);
  assert.equal(fx.clears(), 0);
  assert.equal(fx.cancels(), 0);
});
