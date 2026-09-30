// Copied into the internal Free artifact and run against its actual modules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as edition from '../extension/core/edition.js';
import { createWorkspace, createCard, serialize, deserialize } from '../extension/core/workspace.js';
import { canonicalJson } from '../extension/core/canonical-json.js';
import { exportToJSON, inspectImport, importWorkspace } from '../extension/core/portable.js';
import { buildInjectionBody, buildInjection, evaluateInjectionBudget } from '../extension/core/injection.js';
import { stageForNextTurn } from '../extension/core/archivist-input.js';
import { applyArchivistRun } from '../extension/core/apply.js';
import { WorkspaceStore } from '../extension/storage.js';
import { WorkspaceMutationQueue } from '../extension/host/turn-persistence.js';
import { commitOrdinaryTurn, cancelUnsentOrdinaryTurn } from '../extension/host/ordinary-turn.js';
import { drawCard, isEnabled as deckEnabled } from '../extension/core/deck.js';
import { markInjectionObserved } from '../extension/core/injection-lifecycle.js';
import { stripInjections, wrapInjection } from '../extension/core/injection.js';
import { canonicalSha256 } from '../extension/core/canonical-json.js';
import { plainOrdinaryBinding, matchesPlainOrdinaryBinding, completePlainOrdinaryReadback } from '../extension/host/ordinary-readback.js';
import { bindOrdinaryRequest } from '../extension/host/ordinary-turn.js';

const panel = readFileSync(new URL('../extension/ui/panel.js', import.meta.url), 'utf8');
function extract(name) {
  const at = panel.indexOf(`function ${name}(`);
  assert.ok(at >= 0, name);
  const start = panel.slice(at - 6, at) === 'async ' ? at - 6 : at;
  return panel.slice(start, panel.indexOf('\n}', at) + 2);
}
const fresh = () => createWorkspace({ workspace_id: 'free-fixture' });
function fixture() {
  const ws = fresh();
  ws.current_turn = 1;
  ws.surfaces.event_log.text = 'The lantern is on the bench.';
  ws.surfaces.event_log.enabled = true;
  ws.surfaces.event_log.injection_schedule.every_n_turns = 1;
  const card = createCard({ id: 'npc:kit', kind: 'npc', name_or_title: 'Kit', summary: 'Kit reported that the lantern worked yesterday.', review_state: 'confirmed' });
  ws.cards[card.id] = card;
  ws.order.npc.push(card.id);
  return ws;
}
const forbidden = () => assert.fail('Full-edition execution path reached from Free');

test('Free total context budget is independent of recall and forward-fills old workspaces', () => {
  const ws = fixture();
  delete ws.settings.continuity_context_budget;
  ws.settings.recall_budget = 77;
  const restored = deserialize(serialize(ws));
  assert.equal(restored.settings.continuity_context_budget, 1200);
  assert.equal(restored.settings.recall_budget, 77);
  restored.settings.continuity_context_budget = 650;
  assert.equal(deserialize(serialize(restored)).settings.continuity_context_budget, 650);
  assert.equal(evaluateInjectionBudget(restored).diagnostics.configuredBudget, 650);
  assert.equal(evaluateInjectionBudget(restored, { budgetTokens: 90 }).diagnostics.configuredBudget, 90);
  assert.match(extract('schedulesTab'), /numberSetting\('continuity_context_budget'/);
});

test('Free default budget retains simultaneous surfaces, recall and optional deck framing', () => {
  const ws = fixture();
  for (const surface of Object.values(ws.surfaces)) {
    surface.enabled = true;
    surface.injection_schedule.every_n_turns = 1;
    surface.text = 'x'.repeat(Math.floor(surface.max_tokens * 0.8) * 3);
  }
  ws.deck.mode = 'manual';
  ws.deck.current_draw = { text: 'A loose bookmark slips from the green binder.' };
  const result = evaluateInjectionBudget(ws, { staged: ['npc:kit'] });
  assert.equal(ws.settings.recall_budget, 120);
  assert.equal(result.diagnostics.status, 'ready');
  assert.equal(result.diagnostics.enforcedLimit, 960);
  assert.deepEqual(result.parts.map(p => p.kind), ['event_log', 'social_context', 'inventory', 'memory', 'deck']);
  assert.equal(result.diagnostics.droppedParts, 0);
  ws.settings.recall_budget = 1;
  assert.equal(evaluateInjectionBudget(ws, { staged: ['npc:kit'] }).body, result.body,
    'recall selection has its own budget upstream, not a second total-packet cap');
});

test('Free zero and malformed total budgets cannot bypass the ceiling', () => {
  for (const value of [0, -1, NaN, Infinity, '1200', 12.5]) {
    const ws = fixture(); ws.settings.continuity_context_budget = value;
    assert.equal(evaluateInjectionBudget(ws).diagnostics.status, 'budget_exceeded');
    assert.equal(buildInjection(ws), null);
  }
});

test('Free assembled readback completes only the current bound ordinary action, never a stale or altered one', async () => {
  for (const mode of ['exact', 'parent', 'packet', 'stale', 'outcomes', 'failed_write', 'wrong_source', 'missing_release',
    'local_nonce', 'local_request', 'durable_nonce', 'durable_request', 'durable_interaction', 'duplicate_durable',
    'newer_view_after_write', 'new_action_after_write']) {
    const ws = fresh(), nonce = 'dgce-abcdef', body = '<memory>Lantern on desk</memory>';
    const raw = 'Look.\n\n' + wrapInjection(body, nonce);
    ws.ordinary_pending = { id: 'action', nonce };
    ws.injections = [{ nonce, body, ordinary_action_id: 'action', request_id: 'request', interaction_id: 'host-id',
      request_parent_id: null, native_submission: mode !== 'missing_release', native_submit_attempt_at: '2026-09-24T00:00:00.000Z',
      network_observed_at: '2026-09-24T00:00:00.010Z', outgoing_text_hash: canonicalSha256(raw).hash,
      lifecycle_status: 'planned', parts: ['memory'], pending_texts: mode === 'outcomes' ? ['forbidden'] : [] }];
    const stored = new Map(); let rejectWrites = false;
    const store = new WorkspaceStore({ workspaceId: ws.workspace_id, tabId: 'readback-test', backend: {
      get: async key => stored.get(key) ?? null,
      set: async (key, value) => { if (rejectWrites) throw new Error('storage failure'); stored.set(key, value); },
      keys: async () => [...stored.keys()], remove: async key => stored.delete(key),
    } });
    await store.write(0, () => ws);
    rejectWrites = mode === 'failed_write';
    const state = { ws, epoch: 1, persistenceQueue: new WorkspaceMutationQueue(store) }, timers = [];
    let sends = 0, cleanups = 0;
    ws.display_name = 'local view must not be overwritten';
    if (mode.endsWith('after_write')) {
      const queue = state.persistenceQueue;
      state.persistenceQueue = { enqueue: async fn => {
        const saved = await queue.enqueue(fn);
        if (mode === 'newer_view_after_write') state.ws.revision = saved.revision + 1;
        else { state.ws.ordinary_pending.nonce = 'dgce-next'; state.ws.injections[0].nonce = 'dgce-next'; }
        return saved;
      } };
    }
    const verify = runInNewContext(`${extract('verifyFreeOrdinaryReadback')}\nverifyFreeOrdinaryReadback`, {
      ...edition, state, structuredClone, stripInjections, markInjectionObserved, SESSION_READBACK: 'readback',
      workspaceIdFromLocation: () => ws.workspace_id, isCurrent: epoch => epoch === state.epoch,
      scheduleArchivistRecheck() { assert.equal(state.freeReadback.busy, false); },
      chrome: { runtime: { sendMessage: async () => {
        sends++; if (mode === 'stale') state.epoch++;
        if (mode === 'local_nonce') { state.ws.ordinary_pending.nonce = 'dgce-other'; state.ws.injections[0].nonce = 'dgce-other'; }
        if (mode === 'local_request') state.ws.injections[0].request_id = 'another-request';
        if (mode.startsWith('durable_') || mode === 'duplicate_durable') {
          const before = await store.read();
          await store.write(before.revision, changed => {
            if (mode === 'durable_nonce') { changed.ordinary_pending.nonce = 'dgce-other'; changed.injections[0].nonce = 'dgce-other'; }
            if (mode === 'durable_request') changed.injections[0].request_id = 'another-request';
            if (mode === 'durable_interaction') changed.injections[0].interaction_id = 'another-host-id';
            if (mode === 'duplicate_durable') changed.injections.push(structuredClone(changed.injections[0]));
            return changed;
          });
        }
        return { ok: true, value: { workspace_id: ws.workspace_id, interaction_id: 'host-id',
          parent_id: mode === 'parent' ? 'different' : null, raw_text: raw + (mode === 'packet' ? ' ' : ''), candidate_count: 1,
          source: mode === 'wrong_source' ? 'page-message' : 'extension_authenticated_session_get_v1' } };
      } } }, adoptQueuedWrite: runInNewContext(`${extract('adoptQueuedWrite')}\nadoptQueuedWrite`, {
        state, isCurrent: epoch => epoch === state.epoch,
      }), render() {},
      scheduleRecurringInjectionPrune: () => { cleanups++; }, maybeReplenishDeck() {},
      setTimeout: (...args) => timers.push(args),
    });
    await verify();
    if (mode === 'exact') {
      assert.equal(state.ws.ordinary_pending, undefined);
      const durable = await store.read();
      assert.equal(durable.ordinary_pending, undefined);
      assert.equal(state.ws, ws, 'adopts only lifecycle fields, not the entire workspace');
      assert.equal(state.ws.display_name, 'local view must not be overwritten');
      assert.deepEqual(state.ws.injections[0].completion_evidence, durable.injections[0].completion_evidence);
      assert.equal(timers.length, 1, 'only deck scheduling remains; no redundant readback retries');
      assert.equal(cleanups, 1);
      assert.equal(state.ws.injections[0].completion_evidence.source, 'extension_authenticated_session_get_v1');
      assert.equal(state.ws.current_turn, 0, 'does not replay local turn effects');
      await verify(); assert.equal(sends, 1, 'no probe after completion');
    } else {
      assert.ok(state.ws.ordinary_pending, mode); assert.equal(cleanups, 0, mode);
      assert.equal(state.ws.injections[0].completion_evidence, undefined, mode);
      assert.equal(state.banner, undefined, 'no stale success announcement: ' + mode);
      if (!mode.endsWith('after_write')) assert.ok((await store.read()).ordinary_pending, mode);
    }
  }
  assert.match(extract('observeOwnedCarriersInHost'), /verifyFreeOrdinaryReadback\(\)/);
});

for (const mode of ['exact', 'wrong_source', 'packet', 'parent', 'stale', 'failed_write', 'local_request',
  'durable_request', 'durable_parent', 'durable_rollback', 'durable_desync', 'legacy', 'newer_view_after_write', 'new_action_after_write']) {
  test(`Free assembled plain readback: ${mode}`, async () => {
    const ws = fresh(), raw = 'Inspect without dismantling.';
    ws.ordinary_pending = { id: 'plain', nonce: null, created_at: '2026-09-24T00:00:00.000Z',
      release_attempt_at: '2026-09-24T00:00:00.010Z', outgoing_text: raw,
      outgoing_text_hash: canonicalSha256(raw).hash, changes: [] };
    bindOrdinaryRequest(ws, { type: 'dgce:browser-request-v1', sessionId: ws.workspace_id,
      requestId: 'r1', interactionId: 'i1', parentId: null, textHash: ws.ordinary_pending.outgoing_text_hash,
      timestamp: Date.parse('2026-09-24T00:00:00.020Z') });
    if (mode === 'legacy') delete ws.ordinary_pending.network_observed_at;
    const stored = new Map(); let rejectWrites = false;
    const store = new WorkspaceStore({ workspaceId: ws.workspace_id, tabId: 'plain-test', backend: {
      get: async key => stored.get(key) ?? null,
      set: async (key, value) => { if (rejectWrites) throw new Error('storage failure'); stored.set(key, value); },
      keys: async () => [...stored.keys()], remove: async key => stored.delete(key),
    } });
    await store.write(0, () => ws); rejectWrites = mode === 'failed_write';
    const state = { ws, epoch: 1, persistenceQueue: new WorkspaceMutationQueue(store), carrierHygieneStatus: 'history_unverified' };
    const timers = []; let sends = 0;
    ws.display_name = 'Preserve local edit';
    if (mode.endsWith('after_write')) {
      const queue = state.persistenceQueue;
      state.persistenceQueue = { enqueue: async fn => {
        const saved = await queue.enqueue(fn);
        if (mode === 'newer_view_after_write') state.ws.revision = saved.revision + 1;
        else state.ws.ordinary_pending.id = 'new-action';
        return saved;
      } };
    }
    const verify = runInNewContext(`${extract('verifyFreePlainOrdinaryReadback')}\n${extract('verifyFreeOrdinaryReadback')}\nverifyFreeOrdinaryReadback`, {
      ...edition, state, structuredClone, plainOrdinaryBinding, matchesPlainOrdinaryBinding, completePlainOrdinaryReadback,
      SESSION_READBACK: 'readback', workspaceIdFromLocation: () => ws.workspace_id, isCurrent: e => e === state.epoch,
      scheduleArchivistRecheck() { assert.equal(state.freeReadback.busy, false); },
      chrome: { runtime: { sendMessage: async request => {
        sends++; assert.equal(request.interactionId, 'i1');
        if (mode === 'stale') state.epoch++;
        if (mode === 'local_request') ws.ordinary_pending.request_id = 'other';
        if (mode.startsWith('durable_')) {
          const base = await store.read(); await store.write(base.revision, durable => {
            if (mode === 'durable_request') durable.ordinary_pending.request_id = 'other';
            if (mode === 'durable_parent') durable.ordinary_pending.request_parent_id = 'other';
            if (mode === 'durable_rollback') durable.ordinary_pending.changes.push({ key: 'other' });
            if (mode === 'durable_desync') durable.timeline_integrity = { desynchronized: true };
            return durable;
          });
        }
        return { ok: true, value: { source: mode === 'wrong_source' ? 'dom' : 'extension_authenticated_session_get_v1',
          workspace_id: ws.workspace_id, interaction_id: 'i1', parent_id: mode === 'parent' ? 'other' : null,
          raw_text: raw + (mode === 'packet' ? ' ' : ''), candidate_count: 1 } };
      } } },
      adoptQueuedWrite: runInNewContext(`${extract('adoptQueuedWrite')}\nadoptQueuedWrite`, { state, isCurrent: e => e === state.epoch }),
      render() {}, setTimeout: (...args) => timers.push(args),
      scheduleRecurringInjectionPrune: forbidden, maybeReplenishDeck: forbidden,
    });
    await verify();
    assert.equal(state.carrierHygieneStatus, 'history_unverified');
    assert.equal(state.ws.display_name, 'Preserve local edit');
    assert.equal(state.ws.current_turn, 0);
    assert.equal(state.ws.injections.length, 0);
    const durable = await store.read();
    if (mode === 'exact') {
      assert.equal(state.ws.ordinary_pending, undefined);
      assert.equal(durable.ordinary_pending, undefined);
      assert.deepEqual(state.ws.last_ordinary_delivery, durable.last_ordinary_delivery);
      assert.match(state.banner.text, /History clearance is unchanged/);
      assert.equal(timers.length, 0); await verify(); assert.equal(sends, 1);
    } else {
      assert.ok(state.ws.ordinary_pending);
      assert.equal(state.ws.last_ordinary_delivery, undefined);
      assert.equal(state.banner, undefined);
      if (!mode.endsWith('after_write')) assert.ok(durable.ordinary_pending);
      if (mode === 'legacy') assert.equal(sends, 0);
    }
  });
}

test('queued metadata adoption never regresses revision, timestamp or writer provenance', () => {
  const state = { epoch: 1, ws: { workspace_id: 'w', revision: 8, current_turn: 12, updated_at: 900, writer_tab_id: 'new' } };
  const adopt = runInNewContext(`${extract('adoptQueuedWrite')}\nadoptQueuedWrite`, { state, isCurrent: e => e === state.epoch });
  const initial = structuredClone(state.ws);
  adopt({ workspace_id: 'w', revision: 7, current_turn: 99, updated_at: 100, writer_tab_id: 'old' }, 1);
  assert.deepEqual(state.ws, initial);
  adopt({ workspace_id: 'w', revision: 8, current_turn: 12, updated_at: 999, writer_tab_id: 'other' }, 1);
  assert.deepEqual(state.ws, initial, 'equal revision does not replace metadata provenance');
  adopt({ workspace_id: 'w', revision: 9, current_turn: 10, updated_at: 800, writer_tab_id: 'next' }, 1);
  assert.equal(state.ws.revision, 9); assert.equal(state.ws.current_turn, 12);
  assert.equal(state.ws.updated_at, 900); assert.equal(state.ws.writer_tab_id, 'next');
  const current = structuredClone(state.ws);
  adopt({ workspace_id: 'elsewhere', revision: 10, updated_at: 1000 }, 1);
  adopt({ workspace_id: 'w', revision: 10, updated_at: 1000 }, 0);
  assert.deepEqual(state.ws, current);
});

test('artifact really selects Free, not a runtime setting or simulated switch', () => {
  assert.equal(edition.IS_FREE_EDITION, true);
  const ws = fresh(); ws.settings.edition = 'full';
  assert.throws(() => edition.requireFullEdition('Campaign'), /public DGCE build/);
  assert.equal(edition.editionWorkspaceIssue(ws), null);
});

test('Free reload probes saved pending actions after hydration without requiring a DOM carrier', async () => {
  for (const mode of ['pending', 'stale', 'foreign']) {
    const ws = fresh(); ws.ordinary_pending = { id: 'saved-action', nonce: 'dgce-saved' };
    const state = { epoch: 0, dirty: new Set() }; let probes = 0;
    const load = runInNewContext(`${extract('load')}\nload`, {
      state, stopWatchingExternal: null, root: null, surfaceDrafts: new Map(),
      workspaceIdFromLocation: () => ws.workspace_id,
      WorkspaceStore: class { async read() { if (mode === 'stale') state.epoch++; return ws; } async usage() { return {}; } },
      WorkspaceMutationQueue: class {},
      isCurrent: epoch => state.epoch === epoch,
      editionWorkspaceIssue: () => mode === 'foreign' ? 'incompatible' : null,
      structuredClone, reconcileCardAuthority: () => [], readAuthoredEntities: () => ({}),
      mergeEntityGroups: () => ({}), campaignEntityGroups: () => ({}),
      clearInjectionPruneTimer() {}, watchExternalWrites: () => () => {},
      scheduleRecurringInjectionPrune() {},
      verifyFreeOrdinaryReadback() { probes++; assert.equal(state.ws.ordinary_pending.id, 'saved-action'); assert.ok(state.persistenceQueue); },
    });
    await load();
    assert.equal(probes, mode === 'pending' ? 1 : 0, mode);
  }
  let probes = 0;
  const observe = runInNewContext(`${extract('observeOwnedCarriersInHost')}\nobserveOwnedCarriersInHost`, {
    editionWorkspaceIssue: () => null, state: { ws: { injections: [] }, store: {} }, document: { body: {} },
    discoverOwnedInjectionCarriers: () => [], verifyFreeOrdinaryReadback: () => { probes++; }, async refreshFreeHistoryContinuity() {},
    isCurrent: () => true, scheduleArchivistRecheck() {},
  });
  observe(); assert.equal(probes, 1, 'no rendered carrier must not suppress the independent read-only probe');
});

test('fresh and hydrated continuity workspaces remain usable', () => {
  for (const ws of [fresh(), deserialize(serialize(fresh()))]) {
    assert.equal(edition.editionWorkspaceIssue(ws), null);
    ws.surfaces.event_log.text = 'Remember this.';
    assert.equal(edition.editionWorkspaceIssue(ws), null);
  }
});

test('memory projection retains surfaces/cards but never mounts ambient or campaign authority', () => {
  const ws = fixture();
  const result = buildInjectionBody(ws, { staged: ['npc:kit'], includeRng: 'RNG{a=9}',
    ruleLines: ['FORBIDDEN RULE'], campaignContext: 'Begin campaign setup', includeDeck: true });
  assert.match(result.body, /lantern is on the bench/);
  assert.match(result.body, /Kit reported/);
  assert.ok(result.parts.every(part => ['event_log', 'social_context', 'inventory', 'memory'].includes(part.kind)));
  assert.doesNotMatch(result.body, /RNG\{|FORBIDDEN RULE|DGCE CAMPAIGN/);
});

test('continuity backup inspect and restore preserve cards and memory', () => {
  const source = fixture(), json = exportToJSON(source);
  assert.equal(inspectImport(json).counts.cards, 1);
  const restored = importWorkspace(createWorkspace({ workspace_id: 'restore' }), json, { mode: 'replace' }).workspace;
  assert.equal(restored.workspace_id, 'restore');
  assert.deepEqual(restored.cards, source.cards);
  assert.deepEqual(restored.surfaces, source.surfaces);
  assert.equal(edition.editionWorkspaceIssue(restored), null);
});

test('Free still applies a valid Archivist update and rejects its replay', () => {
  const ws = fresh();
  const raw = JSON.stringify({ schema_version: 1, run_id: 'free-maintenance', operations: [
    { op: 'SET_SURFACE', surface: 'event_log', text: 'Kit set the lantern on the bench.' },
    { op: 'UPSERT_CARD', kind: 'npc', id: 'npc:kit', name_or_title: 'Kit', aliases: [],
      summary: 'Kit reported that the lantern worked yesterday.', link_ids: [], review_state: 'unconfirmed' },
  ] });
  const result = applyArchivistRun(ws, raw, { outstandingRunId: 'free-maintenance' });
  assert.equal(result.status, 'applied');
  assert.equal(result.workspace.cards['npc:kit'].review_state, 'unconfirmed');
  assert.equal(edition.editionWorkspaceIssue(result.workspace), null);
  assert.equal(applyArchivistRun(result.workspace, raw).status, 'rejected');
});

const fullChanges = {
  campaign: ws => { ws.campaign = { lifecycle: { mode: 'builder' } }; },
  unknownCampaignField: ws => { ws.campaign = { future_authority: { enabled: true } }; },
  rng: ws => { ws.settings.RNG_enabled = true; },
  rules: ws => { ws.rule_packs.push({ id: 'other' }); },
  mechanical: ws => { ws.mechanical_turns.push({ id: 'roll' }); },
  carrier: ws => { ws.injections.push({ nonce: 'dgce-abcdef', parts: ['campaign_context'] }); },
};
for (const [name, change] of Object.entries(fullChanges)) {
  test(`Free rejects ${name} imports and injection without touching either workspace`, () => {
    const source = fresh(), target = fresh(); change(source);
    const before = serialize(source), targetBefore = serialize(target);
    assert.ok(edition.editionWorkspaceIssue(source));
    const json = exportToJSON(source);
    assert.throws(() => inspectImport(json), /public DGCE build cannot use/);
    for (const mode of ['merge', 'replace']) assert.throws(() => importWorkspace(target, json, { mode }), /public DGCE build cannot use/);
    assert.throws(() => buildInjectionBody(source), /public DGCE build cannot use/);
    assert.equal(serialize(source), before);
    assert.equal(serialize(target), targetBefore);
    assert.equal(JSON.parse(json).workspace.workspace_id, source.workspace_id, 'export remains available');
  });
}

test('Full implementations are absent and commands reject before mutation', () => {
  const ws = fresh(), before = serialize(ws);
  for (const name of ['campaign', 'mechanical-turn', 'clean-start', 'rng', 'rules', 'skill-improvement', 'commands']) {
    assert.equal(existsSync(new URL(`../extension/core/${name}.js`, import.meta.url)), false, name);
  }
  for (const text of ['/check INT', '/attack kit', '/initiative', '/campaign accept', '/skills', '/level up']) {
    assert.throws(() => edition.assertEditionCommand(text), /not available in this public DGCE build/);
  }
  assert.doesNotThrow(() => edition.assertEditionCommand('I inspect the lantern.'));
  assert.equal(serialize(ws), before);
});

function memoryStore(ws) {
  const values = new Map([['dgce:free-fixture:workspace', serialize(ws)]]);
  const backend = { get: async key => values.get(key), keys: async () => [...values.keys()],
    set: async (key, value) => values.set(key, value) };
  return { values, store: new WorkspaceStore({ workspaceId: 'free-fixture', backend }) };
}
test('storage fences protect existing Full data and reject newly activated Full state', async () => {
  for (const change of Object.values(fullChanges)) {
    const full = fresh(); change(full);
    const h = memoryStore(full), before = h.values.get(h.store.key);
    assert.equal(serialize(await h.store.read()), before, 'Full data must remain unhydrated for export');
    await assert.rejects(h.store.write(0, () => assert.fail('mutator must not run')), /public DGCE build cannot use/);
    assert.equal(h.values.get(h.store.key), before);
  }
  const clean = memoryStore(fresh()), cleanBefore = clean.values.get(clean.store.key);
  await assert.rejects(clean.store.write(0, ws => { fullChanges.campaign(ws); return ws; }), /public DGCE build cannot use/);
  assert.equal(clean.values.get(clean.store.key), cleanBefore);
  const saved = await clean.store.write(0, ws => { ws.surfaces.event_log.text = 'Safe continuity edit'; return ws; });
  assert.equal(saved.surfaces.event_log.text, 'Safe continuity edit');
});

test('ordinary Free handoff and pre-release rollback retain existing delivery discipline', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis.navigator, 'locks');
  Object.defineProperty(globalThis.navigator, 'locks', { configurable: true, value: { request: (_name, fn) => fn() } });
  t.after(() => previous ? Object.defineProperty(globalThis.navigator, 'locks', previous) : delete globalThis.navigator.locks);
  const h = memoryStore(fixture()), base = await h.store.read(), candidate = structuredClone(base);
  candidate.current_turn++;
  const saved = await commitOrdinaryTurn({ store: h.store, base, candidate, id: 'ordinary-free',
    text: 'Inspect the lantern.', outgoingText: 'Inspect the lantern.\nOwned context',
    injection: { nonce: 'dgce-' + 'ab'.repeat(12), parts: ['event_log'], estimated_tokens: 10 } });
  assert.equal(saved.current_turn, base.current_turn + 1);
  assert.equal(saved.ordinary_pending.id, 'ordinary-free');
  assert.equal(edition.editionWorkspaceIssue(saved), null);
  await cancelUnsentOrdinaryTurn(h.store, 'ordinary-free');
  const rolledBack = await h.store.read();
  assert.equal(rolledBack.current_turn, base.current_turn);
  assert.equal(rolledBack.ordinary_pending ?? null, null);
});

test('Free planner ignores bootloader and does not route campaign state', () => {
  const ws = fixture(), before = canonicalJson(ws.campaign);
  const plan = runInNewContext(`${extract('planInjection')}\nplanInjection`, { ...edition,
    state: { store: {}, carrierHygieneStatus: 'clean' },
    workspaceIdFromLocation: () => ws.workspace_id, authoritativeInjectionAllowed: () => true,
    hasCurrentHistoryClearance: () => true, hasCampaignBootloader: forbidden,
    beginCampaignBuilder: forbidden, drawCard, deckEnabled,
    updateRuntimeDomainContext: forbidden, updateRuntimeActorContext: forbidden,
    recentModelTurns: () => [], recentModelInteractions: () => [], stageForNextTurn, buildInjection,
    root: null, structuredClone,
  });
  const result = plan('Kit, what happened?', ws);
  assert.ok(result);
  assert.equal(canonicalJson(ws.campaign), before);
  assert.equal(ws.current_turn, 2);
});

test('Free admission ignores model campaign proposals and only confirms continuity cards', () => {
  const ws = fresh(), before = serialize(ws);
  const admission = runInNewContext(`${extract('onUserTurn')}\nonUserTurn`, { ...edition,
    state: { store: {} }, workspaceIdFromLocation: () => ws.workspace_id,
    authoritativeInjectionAllowed: () => true, transcriptText: forbidden,
    captureCampaignProposals: forbidden, admitSocialUpdates: forbidden, handleCampaignCommand: forbidden,
  });
  admission('A normal player action.', ws);
  assert.equal(serialize(ws), before);
  assert.throws(() => admission('/campaign accept', ws), /public DGCE build/);
});

test('Free UI retains only static preview tabs, not Full controls', () => {
  const el = (tag, props, ...children) => ({ tag, props, children: children.flat().filter(Boolean) });
  const state = { ws: fresh(), tab: 'Memory' };
  const context = { ...edition, el, state, TABS: edition.FREE_TABS, toggle() {}, render() {}, copyBackup() {} };
  const nav = runInNewContext(`${extract('nav')}\nnav`, context)();
  const header = runInNewContext(`${extract('header')}\nheader`, context)();
  const data = runInNewContext(`${extract('dataTab')}\ndataTab`, context)();
  const preview = runInNewContext(`${extract('previewTab')}\npreviewTab`, context)('Campaign');
  const text = JSON.stringify([nav, header, data, preview]);
  assert.match(text, /Continuity/);
  assert.match(text, /Copy export JSON/);
  assert.match(text, /Load continuity backup JSON/);
  assert.match(text, /Campaign.*In development/);
  assert.doesNotMatch(text, /Review check|Import clean start|Start over|Buy now|Purchase/);
});

test('Full workspace observers, cleanup and Archivist are inert under Free', async () => {
  const ws = fresh(); fullChanges.campaign(ws);
  for (const name of ['observeBrowserRequest', 'observeOwnedCarriersInHost', 'runRecurringInjectionPrune', 'refreshWithArchivist']) {
    const run = runInNewContext(`${extract(name)}\n${name}`, { ...edition, state: { ws } });
    // No document/store/network dependencies: reaching those would fail.
    await run({ sessionId: ws.workspace_id });
  }
});
