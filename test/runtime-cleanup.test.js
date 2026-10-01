// Exercise the assembled controller paths, following the existing panel harness.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as edition from '../extension/core/edition.js';
import { augmentTurn } from '../extension/core/injection.js';

const panel = readFileSync(new URL('../extension/ui/panel.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function extract(name) {
  const start = panel.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const end = panel.indexOf('\n}', start);
  assert.ok(end > start);
  return panel.slice(panel.slice(start - 6, start) === 'async ' ? start - 6 : start, end + 2);
}

function harness({ injection = null, planError = null, pending = true, eligible = true } = {}) {
  const ws = { workspace_id: 'cleanup-test', unconfirmed: { npc: pending ? ['npc_1'] : [] },
    settings: { origination_compare_window: 3 } };
  const state = { ws, epoch: 1, mutationGeneration: 0, dirty: new Set(), banner: { text: 'prior' },
    store: { read: async () => structuredClone(ws) } };
  const calls = [];
  const bindings = {
    ...edition, state, structuredClone, augmentTurn,
    crypto: { randomUUID: () => 'ordinary-cleanup-test' },
    networkEvidence: { ready: Promise.resolve(), available: () => true },
    isCurrent: epoch => epoch === state.epoch,
    workspaceIdFromLocation: () => 'cleanup-test',
    authoritativeInjectionAllowed: () => eligible,
    mechanicalBasis: target => JSON.stringify(target),
    refreshFreeHistoryContinuity: async () => { calls.push('history'); },
    recentModelTurns: limit => { assert.equal(limit, 3); return ['prior evidence']; },
    considerUserTurn: (target, input) => {
      calls.push('admission'); target.admittedText = input.userTurnText;
    },
    planInjection: (text, target) => {
      calls.push('plan');
      if (pending) assert.equal(target.admittedText, text);
      state.banner = { text: 'prepared' };
      if (planError) throw planError;
      return injection;
    },
    commitOrdinaryTurn: async packet => {
      calls.push('commit');
      assert.equal(packet.text, packet.candidate.admittedText);
      return packet.candidate;
    },
  };
  const api = runInNewContext(`${extract('onUserTurn')}\n${extract('prepareOrdinarySubmission')}\n({ onUserTurn, prepareOrdinarySubmission })`, bindings);
  return { ...api, state, calls };
}

test('ordinary preparation preserves exact text and stages admission until commit', async () => {
  for (const text of ['Hello.', '  Preserve whitespace.\n', '', '0']) {
    const h = harness();
    const priorBanner = h.state.banner;
    const result = await h.prepareOrdinarySubmission(text, () => true);
    assert.equal(result.outgoingText, text);
    assert.deepEqual(h.calls, ['history', 'admission', 'plan']);
    assert.equal(h.state.ws.admittedText, undefined);
    assert.equal(h.state.banner, priorBanner);
    await result.beforeClick();
    assert.equal(h.state.ws.admittedText, text);
    assert.deepEqual(h.calls, ['history', 'admission', 'plan', 'commit']);
  }
});

test('ordinary preparation augments the original text only when injection is present', async () => {
  const text = '  Keep this spacing.\n';
  const injection = { block: '<hidden>owned context</hidden>' };
  const h = harness({ injection });
  const result = await h.prepareOrdinarySubmission(text, () => true);
  assert.equal(result.outgoingText, augmentTurn(text, injection.block));
  assert.deepEqual(h.calls, ['history', 'admission', 'plan']);
});

test('public command rejection precedes admission, injection, and commit', async () => {
  const h = harness();
  await assert.rejects(h.prepareOrdinarySubmission('/campaign accept', () => true), /not available in this public DGCE build/);
  assert.deepEqual(h.calls, []);
});

test('planning failure restores the banner and does not adopt candidate admission', async () => {
  const failure = new Error('planning failed');
  const h = harness({ planError: failure });
  const priorBanner = h.state.banner;
  await assert.rejects(h.prepareOrdinarySubmission('Hello.', () => true), error => error === failure);
  assert.equal(h.state.banner, priorBanner);
  assert.equal(h.state.ws.admittedText, undefined);
  assert.deepEqual(h.calls, ['history', 'admission', 'plan']);
});

test('admission without pending cards or eligibility remains a no-op', () => {
  for (const options of [{ pending: false }, { eligible: false }]) {
    const h = harness(options);
    assert.equal(h.onUserTurn('Hello.', h.state.ws), undefined);
    assert.deepEqual(h.calls, []);
  }
});

test('entity groups continue to come from authored scenario data', () => {
  const groups = { npc: [{ name: 'Kit' }] };
  let reads = 0;
  const getGroups = runInNewContext(`${extract('definedEntityGroups')}\ndefinedEntityGroups`, {
    readAuthoredEntities: () => { reads++; return groups; },
  });
  assert.equal(getGroups(), groups);
  assert.equal(reads, 1);
  assert.match(extract('continuityToolsSection'), /reconcileCardAuthority\(ws, definedEntityGroups\(\)\)/);
});

test('public tabs retain the exact edition list and order', () => {
  const declaration = panel.split('\n').find(line => line.startsWith('const TABS = '));
  assert.ok(declaration);
  assert.equal(runInNewContext(`${declaration}\nTABS`, edition), edition.FREE_TABS);
});
