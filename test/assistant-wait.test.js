import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForReply, assistantGenerationActive, ASSISTANT_IDLE_TIMEOUT_MS,
  ASSISTANT_MAX_WAIT_MS } from '../extension/host/assistant.js';

function clockFixture(step) {
  let time = 0, status = '', text = '', present = true;
  const panel = { isConnected: true,
    querySelector: () => ({ textContent: status }),
    querySelectorAll: selector => selector === '[class*="group/msg"]'
      ? [...(present ? [{ innerText: 'our prompt' }] : []), ...(text ? [{ innerText: text }] : [])] : [],
  };
  const fx = { panel, time: () => time,
    set: (s, t = text) => { status = s; text = t; }, absent: () => { present = false; },
    options: { panel, beforeCount: 0, prompt: 'our prompt', pollMs: 1000,
      now: () => time, sleep: async ms => { time += ms; step(fx); } } };
  return fx;
}

test('thinking for longer than the old 90-second ceiling completes without another send', async () => {
  const fx = clockFixture(f => f.set(f.time() < 140000 ? 'AI is thinking.' : '', f.time() < 140000 ? '' : '{"done":true}'));
  assert.equal(await waitForReply({ ...fx.options, isComplete: t => t === '{"done":true}' }), '{"done":true}');
  assert.equal(fx.time(), 140000);
  assert.equal(ASSISTANT_IDLE_TIMEOUT_MS, 90000);
  assert.equal(ASSISTANT_MAX_WAIT_MS, 600000);
});

test('non-thinking quick reply returns promptly, not after the maximum wait', async () => {
  const fx = clockFixture(f => f.set('', 'CARD: Rain taps the glass.'));
  assert.equal(await waitForReply(fx.options), 'CARD: Rain taps the glass.');
  assert.equal(fx.time(), 5000);
});

test('stable partial card list is not completion while the host is generating', async () => {
  const fx = clockFixture(f => f.set(f.time() < 120000 ? 'AI is generating.' : '',
    f.time() < 120000 ? 'CARD: A bell rings.' : 'CARD: A bell rings.\nCARD: Rain starts.'));
  assert.equal(await waitForReply(fx.options), 'CARD: A bell rings.\nCARD: Rain starts.');
  assert.equal(fx.time(), 124000);
});

test('even complete-looking JSON waits for host generation to finish', async () => {
  const fx = clockFixture(f => f.set(f.time() < 10000 ? 'AI is thinking.' : '', '{}'));
  assert.equal(await waitForReply({ ...fx.options, isComplete: () => true }), '{}');
  assert.equal(fx.time(), 10000);
});

test('stuck thinking status still reaches a bounded hard deadline', async () => {
  const fx = clockFixture(f => f.set('AI is thinking.'));
  await assert.rejects(waitForReply(fx.options), /hard limit reached.*no automatic resend/);
  assert.equal(fx.time(), 600000);
});

test('missing status and no reply reach the idle deadline', async () => {
  const fx = clockFixture(() => {});
  await assert.rejects(waitForReply(fx.options), /idle limit reached.*no reply appeared/);
  assert.equal(fx.time(), 90000);
});

test('a busy status cannot extend an unobserved prompt', async () => {
  const fx = clockFixture(f => { f.absent(); f.set('AI is thinking.'); });
  await assert.rejects(waitForReply(fx.options), /idle limit reached.*prompt was not observed/);
});

test('real text progress extends idle wait even without a recognized busy status', async () => {
  const fx = clockFixture(f => f.set('', f.time() < 70000 ? '{' : f.time() < 140000 ? '{"a":' : '{"a":1}'));
  assert.equal(await waitForReply({ ...fx.options, isComplete: t => t === '{"a":1}' }), '{"a":1}');
});

test('same-length text changes reset generic stability', async () => {
  const fx = clockFixture(f => f.set('', f.time() < 7000 ? String(f.time()).padEnd(10) : 'final text'));
  assert.equal(await waitForReply(fx.options), 'final text');
  assert.equal(fx.time(), 11000);
});

test('host errors and detached panels stop immediately', async () => {
  const fx = clockFixture(f => f.set('AI is thinking.'));
  await assert.rejects(waitForReply({ ...fx.options, getHostError: () => 'host failure' }), /host failure/);
  const detached = clockFixture(f => { f.panel.isConnected = false; });
  await assert.rejects(waitForReply(detached.options), /panel disappeared/);
});

test('only scoped status or a visible enabled stop control establishes activity', () => {
  const fx = clockFixture(() => {});
  fx.set('A story says AI is thinking.');
  assert.equal(assistantGenerationActive(fx.panel), false);
  const stop = { disabled: false, getBoundingClientRect: () => ({ width: 20, height: 20 }) };
  fx.panel.querySelectorAll = () => [stop];
  assert.equal(assistantGenerationActive(fx.panel), true);
  stop.disabled = true;
  assert.equal(assistantGenerationActive(fx.panel), false);
});

function hydrationFixture(step) {
  let time = 0;
  let nodes = [];
  const marker = 'DGCE request identity 00112233-4455-4677-8899-aabbccddeeff';
  const prefix = 'You are the Archivist for a continuity extension. Maintain the small memory';
  const prompt = `${prefix}\nrun_id: current\n\n${marker}`;
  const panel = { isConnected: true, querySelector: () => ({ textContent: '' }),
    querySelectorAll: s => s === '[class*="group/msg"]' ? nodes : [] };
  const fx = { marker, prompt, prefix, time: () => time,
    set: texts => { nodes = texts.map(innerText => ({ innerText })); },
    options: { panel, beforeCount: 0, prompt, requestMarker: marker, pollMs: 100,
      timeoutMs: 1000, maxWaitMs: 2000, now: () => time,
      sleep: async ms => { time += ms; step(fx); } } };
  return fx;
}

test('late hydrated old Archivist prefix cannot satisfy a fresh request', async () => {
  const fx = hydrationFixture(f => f.set([`${f.prefix}\nrun_id: old`, '{"run_id":"old"}']));
  await assert.rejects(waitForReply({ ...fx.options, isComplete: () => true }), /prompt was not observed/);
});

test('fresh marked prompt binds beyond hydrated old same-prefix exchanges', async () => {
  let acknowledged;
  const fx = hydrationFixture(f => f.set([
    `${f.prefix}\nrun_id: old`, '{"run_id":"old"}',
    ...(f.time() >= 300 ? [f.prompt, '{"run_id":"current"}'] : []),
  ]));
  assert.equal(await waitForReply({ ...fx.options, isComplete: () => true,
    onPromptAcknowledged: text => { acknowledged = text; } }), '{"run_id":"current"}');
  assert.equal(acknowledged, fx.prompt);
  assert.equal(fx.time(), 300);
});

test('prompt replacement at a previously owned index fails closed', async () => {
  const fx = hydrationFixture(f => f.set(f.time() < 200 ? [f.prompt] : [`${f.prefix}\nold`, '{}']));
  await assert.rejects(waitForReply({ ...fx.options, isComplete: () => true }), /identity changed/);
});

test('duplicate request markers cannot choose an arbitrary exchange', async () => {
  const fx = hydrationFixture(f => f.set([f.prompt, '{}', f.prompt, '{}']));
  await assert.rejects(waitForReply({ ...fx.options, isComplete: () => true }), /identity is ambiguous/);
});

test('duplicate marker introduced after ownership also fails closed', async () => {
  const fx = hydrationFixture(f => f.set(f.time() < 200 ? [f.prompt] : [f.prompt, '{}', f.prompt, '{}']));
  await assert.rejects(waitForReply({ ...fx.options, isComplete: () => true }), /identity is ambiguous/);
});

test('marker substring inside prose is not a standalone request identity', async () => {
  const fx = hydrationFixture(f => f.set([`${f.prefix}\nQuoted ${f.marker} in an old example.`, '{}']));
  await assert.rejects(waitForReply({ ...fx.options, isComplete: () => true }), /prompt was not observed/);
});

test('unmarked helper callers require full normalized prompt, not a shared prefix', async () => {
  const fx = hydrationFixture(f => f.set([`${f.prefix}\nold`, '{}']));
  await assert.rejects(waitForReply({ ...fx.options, requestMarker: null, isComplete: () => true }), /prompt was not observed/);
});
