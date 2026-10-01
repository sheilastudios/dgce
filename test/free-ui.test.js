// Runs against the assembled Free panel, with real storage and history witnesses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as edition from '../extension/core/edition.js';
import { createWorkspace } from '../extension/core/workspace.js';
import { exportToJSON, inspectImport, importWorkspace } from '../extension/core/portable.js';
import { WorkspaceStore, ConflictError, QuotaError } from '../extension/storage.js';
import { captureWorkspaceFence, workspaceFenceMatches } from '../extension/core/temporal-integrity.js';
import { canAttestEmptySessionHistory, attestEmptySessionHistory, hasHistoryCompletenessWitness,
  invalidateHistoryContinuity, loadedInteractionRoots } from '../extension/host/builder-transcript.js';
import { fixture, row } from './helpers/history-surface.js';
import { canonicalSha256 } from '../extension/core/canonical-json.js';
import { captureOpeningSessionHistory, openingSessionHistoryMatches, attestOpeningSessionHistory,
  historyContinuityScope, inspectHistoryLoad, armHistoryLocalSend } from '../extension/host/builder-transcript.js';

const panel = readFileSync(new URL('../extension/ui/panel.js', import.meta.url), 'utf8');
function extract(name) {
  const at = panel.indexOf(`function ${name}(`);
  assert.ok(at >= 0, name);
  return panel.slice(panel.slice(at - 6, at) === 'async ' ? at - 6 : at, panel.indexOf('\n}', at) + 2);
}

// Resolve dependencies from the artifact's imports, not hand-supplied stubs:
// a missing import must fail here just as it does in the mounted extension.
async function sourceReaders(doc) {
  const bindings = { document: doc };
  for (const match of panel.matchAll(/^import\s*\{([^}]+)\}\s*from\s*'([^']+)'/gm)) {
    const names = match[1].split(',').map(name => name.trim());
    const wanted = names.filter(name => ['assertInteractionSourceFidelity', 'semanticInjectionText'].includes(name));
    if (!wanted.length) continue;
    const module = await import(new URL(match[2], new URL('../extension/ui/panel.js', import.meta.url)));
    for (const name of wanted) bindings[name] = module[name];
  }
  return runInNewContext(`${extract('recentModelTurns')}\n({ recentModelTurns })`, bindings);
}

test('Free assembled transcript readers resolve real imports on an empty first send', async () => {
  const readers = await sourceReaders({ querySelectorAll: () => [] });
  assert.equal(readers.recentModelTurns().length, 0);
});

test('Free assembled transcript readers handle short history without Full combat helpers', async () => {
  const long = 'Kit leaves the brass lantern on the desk and explains that the north reading room is closed for repairs.';
  const scroller = { innerText: `Hello.\n\n${long}`, textContent: `Hello.\n\n${long}`,
    getBoundingClientRect: () => ({ x: 100, width: 600 }), scrollHeight: 1000, clientHeight: 400 };
  const readers = await sourceReaders({ querySelectorAll: selector => selector === 'div' ? [scroller] : [] });
  assert.equal(readers.recentModelTurns().join(''), long);
});

test('Free assembled transcript readers retain per-interaction ambiguity rejection', async () => {
  const prose = { textContent: '<ext_ctx id="dgce-fixture">unclosed', querySelectorAll: () => [], cloneNode() { return this; } };
  const output = { querySelectorAll: selector => selector === '.prose' ? [prose] : [] };
  const readers = await sourceReaders({ querySelectorAll: selector => selector === 'div.OUTPUT' ? [output] : [] });
  for (const read of Object.values(readers)) assert.throws(() => read(), { code: 'ambiguous_injection_source' });
});

for (const count of [0, 1, 2]) {
  test(`Free history discovery handles ${count} native delete controls without missing helper bindings`, () => {
    const controls = Array.from({ length: count }, () => ({ offsetParent: {}, getAttribute: key => key === 'aria-label' ? 'Delete interaction' : null }));
    const root = { querySelector: () => null, querySelectorAll: selector => selector === 'button' ? controls : [] };
    const doc = { querySelectorAll: selector => selector === 'div.flex.flex-col.rounded-md.min-h-12' ? [root] : [] };
    const roots = loadedInteractionRoots(doc);
    assert.equal(roots.length, count === 1 ? 1 : 0);
    if (count === 1) assert.equal(roots[0], root);
  });
}

test('Free history artifact contains only read-only delete-control recognition, not builder deletion', async () => {
  const history = await import('../extension/host/builder-transcript.js');
  assert.equal(typeof history.isDeleteInteractionControl, 'function');
  assert.equal(history.deleteBuilderTranscript, undefined);
  assert.equal(history.inspectBuilderTranscript, undefined);
  const source = readFileSync(new URL('../extension/host/builder-transcript.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /function (?:deleteOne|confirmDeleteDialog)\(/);
});
async function harness(t, mode = 'accept') {
  const previous = Object.getOwnPropertyDescriptor(globalThis.navigator, 'locks');
  Object.defineProperty(globalThis.navigator, 'locks', { configurable: true, value: { request: (_name, fn) => fn() } });
  t.after(() => previous ? Object.defineProperty(globalThis.navigator, 'locks', previous) : delete globalThis.navigator.locks);
  const fx = fixture(); fx.roots = []; fx.loaded = Infinity; fx.load = false;
  const values = new Map(); let rejectWrite = false, afterWrite = false;
  const backend = { get: async key => values.get(key), keys: async () => [...values.keys()],
    set: async (key, value) => {
      if (rejectWrite) throw new Error('fixture disk failure');
      values.set(key, value);
      if (afterWrite && mode === 'host-after-write') fx.roots.push(row('Kit', 'New history'));
      if (afterWrite && mode === 'route-after-write') fx.doc.location.pathname += '-other';
    } };
  const store = new WorkspaceStore({ workspaceId: 'fixture', backend });
  const initial = await store.write(0, () => createWorkspace({ workspace_id: 'fixture' }));
  const state = { ws: initial, store, epoch: 1, mutationGeneration: 0, carrierHygieneStatus: 'clean',
    persistenceQueue: { whenIdle: async () => {} } };
  const calls = [];
  const context = { ...edition, state, document: fx.doc, ConflictError, QuotaError,
    captureWorkspaceFence, workspaceFenceMatches, inspectImport, importWorkspace,
    canonicalSha256, captureOpeningSessionHistory, openingSessionHistoryMatches, attestOpeningSessionHistory,
    canAttestEmptySessionHistory, attestEmptySessionHistory: (...args) => {
      calls.push('attest'); return attestEmptySessionHistory(...args);
    },
    invalidateHistoryContinuity: doc => { calls.push('invalidate'); invalidateHistoryContinuity(doc); },
    markLocalMutation: () => { state.mutationGeneration++; },
    isCurrent: epoch => epoch === state.epoch,
    roleplayEditorIdle: () => mode !== 'editor-busy', render() {},
    scheduleRecurringInjectionPrune: () => calls.push('cleanup'),
    confirm: () => {
      calls.push('confirm');
      if (mode === 'local-replacement') state.ws = structuredClone(state.ws);
      if (mode === 'local-mutation') state.mutationGeneration++;
      if (mode === 'route') fx.doc.location.pathname += '-other';
      if (mode === 'epoch') state.epoch++;
      if (mode === 'host') fx.roots.push(row('Kit', 'New history'));
      if (mode === 'same-count-edit') fx.roots[0].textContent += 'changed';
      if (mode === 'same-count-remount') fx.roots[0] = row('Narrator', 'Opening 0');
      if (mode === 'pending') state.ws.ordinary_pending = { id: 'new' };
      if (mode === 'carrier') state.ws.injections.push({ nonce: 'dgce-new', pruned: false });
      if (mode === 'archivist') state.archivistBusy = true;
      if (mode === 'pruning') state.injectionPruneBusy = true;
      if (mode === 'failed-write') rejectWrite = true;
      if (mode === 'external-write') {
        const changed = JSON.parse(values.get(store.key)); changed.revision++;
        values.set(store.key, JSON.stringify(changed));
      }
      afterWrite = true;
      return mode !== 'cancel';
    },
  };
  const api = runInNewContext(`let emptySessionBusy = false, restoreBusy = false;
    ${extract('commit')}
    ${extract('confirmEmptySession')}
    ${extract('confirmOpeningSession')}
    ${extract('restoreContinuityBackup')}
    ({ confirmEmptySession, confirmOpeningSession, restoreContinuityBackup })`, context);
  return { ...api, fx, state, store, calls, initial };
}

function withOpening(h) {
  h.fx.roots = Array.from({ length: 10 }, (_, i) => row('Narrator', `Opening ${i}`));
  return h;
}

test('Scenario opening: durable testimony binds ten unchanged messages, not delivery or automatic proof', async t => {
  const h = withOpening(await harness(t));
  assert.equal((await inspectHistoryLoad(h.fx.doc)).complete, false);
  await h.confirmOpeningSession();
  const saved = await h.store.read();
  assert.equal(saved.free_opening_session_attestation.kind, 'user_attested_scenario_opening');
  assert.equal(saved.free_opening_session_attestation.count, 10);
  assert.equal(saved.free_opening_session_attestation.snapshotHash, canonicalSha256(h.fx.roots.map(r => r.textContent)).hash);
  assert.equal(saved.current_turn, 0);
  assert.equal(saved.ordinary_pending, undefined);
  assert.equal(saved.injections.length, 0);
  assert.equal(historyContinuityScope(h.fx.doc), 'user_attested_scenario_opening');
  assert.equal(hasHistoryCompletenessWitness(h.fx.doc), true);
  assert.deepEqual(h.calls, ['confirm', 'cleanup']);
  const fresh = fixture(); fresh.roots = h.fx.roots; fresh.load = false; fresh.loaded = Infinity;
  assert.equal(hasHistoryCompletenessWitness(fresh.doc), false);
  h.fx.roots.push(row('Kit', 'A later interaction'));
  const settled = await inspectHistoryLoad(h.fx.doc, { attempts: 5, delay: 0 });
  assert.equal(settled.complete, true);
  assert.equal(settled.scope, 'user_attested_scenario_opening');
});

test('Scenario opening origin remains testimony across trusted-send reply remounts', async t => {
  const h = withOpening(await harness(t)), fx = h.fx;
  await h.confirmOpeningSession();
  assert.equal(armHistoryLocalSend(fx.doc, { id: 'first', visibleText: 'Inspect the key' }), true);
  const reply = row('Hazelnut', 'It is a large key.');
  fx.roots.push(row('Johnny', 'Inspect the key'), reply);
  fx.generated([reply]);
  assert.equal((await inspectHistoryLoad(fx.doc, { attempts: 5, delay: 0 })).complete, true);
  assert.equal(armHistoryLocalSend(fx.doc, { id: 'second', visibleText: 'Ask about doors' }), true);
  reply.isConnected = false;
  fx.roots[11] = row('Hazelnut', 'It is a large key.');
  const next = row('Hazelnut', 'Doors are extra.');
  fx.roots.push(row('Johnny', 'Ask about doors'), next);
  fx.generated([next]);
  const settled = await inspectHistoryLoad(fx.doc, { attempts: 5, delay: 0 });
  assert.equal(settled.complete, true);
  assert.equal(settled.scope, 'user_attested_scenario_opening');
});

for (const mode of ['cancel', 'local-replacement', 'local-mutation', 'route', 'epoch', 'host',
  'same-count-edit', 'same-count-remount', 'pending', 'carrier', 'archivist', 'pruning',
  'editor-busy', 'failed-write', 'external-write', 'host-after-write', 'route-after-write']) {
  test(`Scenario opening refuses stale or unsafe confirmation: ${mode}`, async t => {
    const h = withOpening(await harness(t, mode));
    await h.confirmOpeningSession();
    assert.equal(hasHistoryCompletenessWitness(h.fx.doc), false);
    assert.equal(h.calls.includes('cleanup'), false);
    assert.equal(Boolean((await h.store.read()).free_opening_session_attestation), mode.endsWith('after-write'));
  });
}

for (const mode of ['empty', 'load-all', 'unsupported', 'carrier-text', 'pending-before', 'used-workspace', 'desynchronized']) {
  test(`Scenario opening ineligible before prompting: ${mode}`, async t => {
    const h = withOpening(await harness(t));
    if (mode === 'empty') h.fx.roots = [];
    if (mode === 'load-all') h.fx.load = true;
    if (mode === 'unsupported') h.fx.doc.documentElement.lang = 'fr';
    if (mode === 'carrier-text') h.fx.roots[0].textContent = '<ext_ctx id="dgce-old">hidden</ext_ctx>';
    if (mode === 'pending-before') h.state.ws.ordinary_pending = { id: 'saved' };
    if (mode === 'used-workspace') h.state.ws.current_turn = 1;
    if (mode === 'desynchronized') h.state.ws.timeline_integrity.desynchronized = true;
    await h.confirmOpeningSession();
    assert.deepEqual(h.calls, []);
    assert.equal(hasHistoryCompletenessWitness(h.fx.doc), false);
  });
}

test('Scenario opening UI ignores synthetic clicks and replaces confirmation only with a current witness', async t => {
  const h = withOpening(await harness(t)); let clicks = 0;
  const view = runInNewContext(`${extract('openingSessionSection')}\nopeningSessionSection`, {
    el: (tag, props, ...children) => ({ tag, props, children }), state: h.state,
    document: h.fx.doc, hasHistoryCompletenessWitness, emptySessionBusy: false,
    confirmOpeningSession: () => clicks++,
  });
  const button = view().children.find(c => c.tag === 'button');
  button.props.onclick({ isTrusted: false }); assert.equal(clicks, 0);
  button.props.onclick({ isTrusted: true }); assert.equal(clicks, 1);
  await h.confirmOpeningSession();
  assert.equal(view().props.role, 'status');
  assert.equal(view().children.some(c => c.tag === 'button'), false);
  invalidateHistoryContinuity(h.fx.doc);
  assert.ok(view().children.some(c => c.tag === 'button'));
});

test('Free empty-session confirmation records testimony before granting page-local clearance', async t => {
  const h = await harness(t);
  assert.equal(hasHistoryCompletenessWitness(h.fx.doc), false);
  await h.confirmEmptySession();
  const saved = await h.store.read();
  assert.equal(saved.free_empty_session_attestation.kind, 'user_attested_empty_session');
  assert.equal(saved.current_turn, 0);
  assert.deepEqual(h.calls, ['confirm', 'attest', 'cleanup']);
  assert.equal(hasHistoryCompletenessWitness(h.fx.doc), true);
  // Loading a new document with the same saved workspace never recreates consent.
  const reloaded = fixture(); reloaded.roots = []; reloaded.loaded = Infinity; reloaded.load = false;
  assert.equal(hasHistoryCompletenessWitness(reloaded.doc), false);
});

for (const mode of ['cancel', 'local-replacement', 'local-mutation', 'route', 'epoch', 'host',
  'pending', 'carrier', 'archivist', 'pruning', 'editor-busy', 'failed-write', 'external-write']) {
  test(`Free empty-session confirmation refuses ${mode}`, async t => {
    const h = await harness(t, mode);
    await h.confirmEmptySession();
    assert.equal(hasHistoryCompletenessWitness(h.fx.doc), false);
    assert.equal((await h.store.read()).free_empty_session_attestation, undefined);
    assert.equal(h.calls.includes('cleanup'), false);
  });
}
for (const mode of ['host-after-write', 'route-after-write']) {
  test(`Free retains the attestation audit but grants no clearance after ${mode}`, async t => {
    const h = await harness(t, mode);
    await h.confirmEmptySession();
    assert.ok((await h.store.read()).free_empty_session_attestation);
    assert.equal(hasHistoryCompletenessWitness(h.fx.doc), false);
    assert.equal(h.calls.includes('cleanup'), false);
  });
}
test('Free rejects nonempty and unsupported histories before asking for attestation', async t => {
  const h = await harness(t);
  h.fx.roots.push(row('Kit', 'Existing story'));
  await h.confirmEmptySession();
  h.fx.roots = []; h.fx.doc.documentElement.lang = 'fr';
  await h.confirmEmptySession();
  assert.deepEqual(h.calls, []);
});
test('Free ignores synthetic clicks on the empty-session confirmation button', () => {
  let calls = 0;
  const el = (tag, props, ...children) => ({ tag, props, children });
  const section = runInNewContext(`${extract('emptySessionSection')}\nemptySessionSection`, {
    el, state: { ws: {} }, emptySessionBusy: false, confirmEmptySession: () => calls++,
  })();
  const button = section.children.find(child => child.tag === 'button');
  button.props.onclick({ isTrusted: false }); assert.equal(calls, 0);
  button.props.onclick({ isTrusted: true }); assert.equal(calls, 1);
});

test('Free confirmed empty-session panel replaces the prompt only with a current page witness', async t => {
  const h = await harness(t);
  const view = runInNewContext(`${extract('emptySessionSection')}\nemptySessionSection`, {
    el: (tag, props, ...children) => ({ tag, props, children }), state: h.state,
    document: h.fx.doc, hasHistoryCompletenessWitness, emptySessionBusy: false,
    confirmEmptySession: h.confirmEmptySession,
  });
  assert.ok(view().children.some(child => child.tag === 'button'));
  await h.confirmEmptySession();
  const confirmed = view();
  assert.equal(confirmed.props.role, 'status');
  assert.equal(confirmed.children.some(child => child.tag === 'button'), false);
  assert.match(JSON.stringify(confirmed), /Empty session confirmed for this page/);
  assert.match(JSON.stringify(confirmed), /not automatic history proof/);
  h.state.banner = null; // Confirmation remains clear after the toast is dismissed.
  assert.equal(view().children.some(child => child.tag === 'button'), false);
  invalidateHistoryContinuity(h.fx.doc);
  assert.ok(view().children.some(child => child.tag === 'button'),
    'a saved audit alone cannot display current page clearance after reload/invalidation');
});

function backup() {
  const ws = createWorkspace({ workspace_id: 'source' });
  ws.surfaces.event_log.text = 'The lantern remains on the bench.';
  return exportToJSON(ws);
}
test('Free restore writes memory before invalidating clearance and scheduling cleanup', async t => {
  const h = await harness(t);
  attestEmptySessionHistory(h.fx.doc, h.fx.doc.location.pathname);
  await h.restoreContinuityBackup(backup(), 'replace');
  const saved = await h.store.read();
  assert.equal(saved.workspace_id, 'fixture');
  assert.match(saved.surfaces.event_log.text, /lantern/);
  assert.deepEqual(h.calls, ['confirm', 'invalidate', 'cleanup']);
  assert.equal(hasHistoryCompletenessWitness(h.fx.doc), false);
});
for (const mode of ['cancel', 'local-replacement', 'local-mutation', 'route', 'epoch',
  'pending', 'carrier', 'archivist', 'pruning', 'failed-write', 'external-write']) {
  test(`Free restore refuses ${mode} without cleanup side effects`, async t => {
    const h = await harness(t, mode);
    await h.restoreContinuityBackup(backup(), 'replace');
    assert.equal((await h.store.read()).surfaces.event_log.text, h.initial.surfaces.event_log.text);
    assert.equal(h.calls.includes('invalidate'), false);
    assert.equal(h.calls.includes('cleanup'), false);
  });
}
test('Free restore rejects incompatible and malformed backups before confirmation', async t => {
  const h = await harness(t);
  const full = JSON.parse(backup()); full.workspace.campaign = { enabled: true };
  await h.restoreContinuityBackup(JSON.stringify(full), 'replace');
  await h.restoreContinuityBackup('not JSON', 'replace');
  assert.deepEqual(h.calls, []);
});
test('Free import draft survives cancellation and redraw but not a session change', async t => {
  const h = await harness(t, 'cancel');
  const json = backup();
  await h.restoreContinuityBackup(json, 'replace');
  const el = (tag, props, ...children) => ({ tag, props, children: children.flat() });
  const draw = runInNewContext(`${extract('dataTab')}\ndataTab`, {
    el, state: h.state, copyBackup() {},
  });
  const input = view => view[0].children.find(child => child.props?.id === 'import-json');
  assert.equal(input(draw()).value, json);
  h.state.epoch++;
  assert.equal(input(draw()).value, '');
});
