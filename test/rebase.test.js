import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorkspace, createCard } from '../extension/core/workspace.js';
import { appendConfirmed } from '../extension/core/ordering.js';
import { runArchivist } from '../extension/host/archivist-run.js';

function base() {
  const ws = createWorkspace({ workspace_id: 't' });
  ws.current_turn = 50;
  ws.surfaces.event_log.text = 'old surface';
  const id = 'npc:joe';
  ws.cards[id] = createCard({ id, kind: 'npc', name_or_title: 'Joe', review_state: 'confirmed' });
  appendConfirmed(ws, 'npc', id);
  return ws;
}

function responseFor(prompt, operations) {
  const runId = String(prompt).match(/run_id:\s*([^\s]+)/)?.[1];
  return JSON.stringify({ schema_version: 1, run_id: runId, operations });
}

const enough = async () => ({ cleared: false, headroom: 1000 });

test('Archivist result applies when the workspace revision is unchanged', async () => {
  const ws = base();
  const out = await runArchivist(ws, {
    authoredOverride: '',
    ensureHeadroomFn: enough,
    getWorkspace: () => ws,
    askFn: async (prompt) => responseFor(prompt, [
      { op: 'SET_SURFACE', surface: 'event_log', text: 'fresh judgment' },
    ]),
  });
  assert.equal(out.status, 'applied');
  assert.equal(out.workspace.surfaces.event_log.text, 'fresh judgment');
  assert.equal(out.promptRevision, 0);
});

test('workspace change during first model call refuses stale surface judgment', async () => {
  const promptState = base();
  let live = promptState;
  const out = await runArchivist(promptState, {
    authoredOverride: '',
    ensureHeadroomFn: enough,
    getWorkspace: () => live,
    askFn: async (prompt) => {
      live = structuredClone(promptState);
      live.revision = 1;
      live.surfaces.event_log.text = 'user edit while model thought';
      return responseFor(prompt, [
        { op: 'SET_SURFACE', surface: 'event_log', text: 'stale model value' },
      ]);
    },
  });
  assert.equal(out.status, 'stale_workspace');
  assert.equal(out.workspace, live);
  assert.equal(live.surfaces.event_log.text, 'user edit while model thought');
  assert.equal(out.receipt, null);
});

test('workspace change during retry refuses the retry judgment', async () => {
  const promptState = base();
  let live = promptState;
  let calls = 0;
  const out = await runArchivist(promptState, {
    authoredOverride: '',
    ensureHeadroomFn: enough,
    getWorkspace: () => live,
    askFn: async (prompt) => {
      calls += 1;
      if (calls === 1) return '{invalid';
      live = structuredClone(promptState);
      live.revision = 1;
      live.surfaces.event_log.text = 'new evidence during retry';
      return responseFor(prompt, [{ op: 'NO_CHANGE' }]);
    },
  });
  assert.equal(calls, 2);
  assert.equal(out.status, 'stale_workspace');
  assert.equal(out.retried, true);
  assert.equal(live.surfaces.event_log.text, 'new evidence during retry');
});

test('stale card operation cannot mutate changed card state', async () => {
  const promptState = base();
  let live = promptState;
  const out = await runArchivist(promptState, {
    authoredOverride: '',
    ensureHeadroomFn: enough,
    getWorkspace: () => live,
    askFn: async (prompt) => {
      live = structuredClone(promptState);
      live.revision = 1;
      live.cards['npc:joe'].summary = 'user-authored current summary';
      return responseFor(prompt, [
        { op: 'UPDATE_CARD', id: 'npc:joe', summary: 'stale summary' },
      ]);
    },
  });
  assert.equal(out.status, 'stale_workspace');
  assert.equal(live.cards['npc:joe'].summary, 'user-authored current summary');
});

test('stale refusal does not corrupt workspace and a fresh rerun applies normally', async () => {
  const old = base();
  let live = old;
  const stale = await runArchivist(old, {
    authoredOverride: '',
    ensureHeadroomFn: enough,
    getWorkspace: () => live,
    askFn: async (prompt) => {
      live = structuredClone(old);
      live.revision = 1;
      live.current_turn = 51;
      live.injections.push({ nonce: 'dgce-midrun', turn: 51 });
      return responseFor(prompt, [{ op: 'NO_CHANGE' }]);
    },
  });
  assert.equal(stale.status, 'stale_workspace');
  assert.equal(live.injections.length, 1);

  const fresh = await runArchivist(live, {
    authoredOverride: '',
    ensureHeadroomFn: enough,
    getWorkspace: () => live,
    askFn: async (prompt) => responseFor(prompt, [{ op: 'NO_CHANGE' }]),
  });
  assert.equal(fresh.status, 'applied');
  assert.equal(fresh.workspace.current_turn, 51);
  assert.equal(fresh.workspace.injections.length, 1);
});

test('insufficient headroom prevents any model request', async () => {
  let asked = false;
  await assert.rejects(() => runArchivist(base(), {
    authoredOverride: '',
    ensureHeadroomFn: async () => { throw new Error('insufficient headroom'); },
    askFn: async () => { asked = true; },
  }), /insufficient headroom/);
  assert.equal(asked, false);
});
