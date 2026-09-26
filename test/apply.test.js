import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorkspace, createCard, serialize } from '../extension/core/workspace.js';
import { appendConfirmed } from '../extension/core/ordering.js';
import { applyArchivistRun } from '../extension/core/apply.js';
import { normalize, parseArchivistOutput, ParseError } from '../extension/core/parse.js';
import { applyPreimage } from '../extension/core/undo.js';
import { ArchivistRunner } from './helpers/archivist-runner.js';

function base() {
  const w = createWorkspace({ workspace_id: 't', settings: { npc_active_window: 3 } });
  w.current_turn = 50;
  for (const name of ['a', 'b', 'c', 'd']) {
    const id = `npc:${name}`;
    w.cards[id] = createCard({ id, kind: 'npc', name_or_title: name, review_state: 'confirmed' });
    appendConfirmed(w, 'npc', id);
  }
  return w;
}

const run = (runId, operations) => JSON.stringify({ schema_version: 1, run_id: runId, operations });

// --- parse / normalization ------------------------------------------------

test('a single wrapping code fence is stripped before validation', () => {
  const fenced = '```json\n' + run('r1', [{ op: 'NO_CHANGE' }]) + '\n```';
  const doc = parseArchivistOutput(fenced);
  assert.equal(doc.run_id, 'r1');
});

test('an unpaired fence is malformed and is not guessed at', () => {
  const half = '```json\n' + run('r1', [{ op: 'NO_CHANGE' }]);
  assert.throws(() => normalize(half), ParseError);
});

test('fence-like content inside the JSON survives normalization', () => {
  const doc = parseArchivistOutput(
    run('r1', [{ op: 'SET_SURFACE', surface: 'event_log', text: 'he said ``` loudly' }]),
  );
  assert.equal(doc.operations[0].text, 'he said ``` loudly');
});

test('prose around the JSON is not salvaged', () => {
  assert.throws(
    () => parseArchivistOutput('Sure! Here you go:\n' + run('r1', [{ op: 'NO_CHANGE' }])),
    ParseError,
  );
});

// T38 — unknown op rejects the whole run
test('T38 an unknown op rejects the entire run', () => {
  const ws = base();
  const out = applyArchivistRun(ws, run('r1', [{ op: 'DELETE_EVERYTHING' }]), {
    outstandingRunId: 'r1',
  });
  assert.equal(out.status, 'rejected');
  assert.match(out.errors.join(' '), /unknown op/);
});

test('type coercion is refused: "2" is not 2', () => {
  const ws = base();
  const out = applyArchivistRun(
    ws,
    run('r1', [{ op: 'PROMOTE_TO_ACTIVE', kind: 'npc', id: 'npc:d', active_position: '2' }]),
    { outstandingRunId: 'r1' },
  );
  assert.equal(out.status, 'rejected');
  assert.match(out.errors.join(' '), /expected integer/);
});

test('T53 an unknown reason_code rejects the run', () => {
  const ws = base();
  const out = applyArchivistRun(
    ws,
    run('r1', [{ op: 'REVIEW_SIGNAL', id: 'npc:a', reason_code: 'vibes' }]),
    { outstandingRunId: 'r1' },
  );
  assert.equal(out.status, 'rejected');
  assert.match(out.errors.join(' '), /unknown reason_code/);
});

// T40 — one invalid operation applies none of them
test('T40 a run with one invalid operation applies none of it', () => {
  const ws = base();
  const before = serialize(ws);

  const out = applyArchivistRun(
    ws,
    run('r1', [
      { op: 'SET_SURFACE', surface: 'event_log', text: 'Joe found the lamp.' },
      { op: 'PROMOTE_TO_ACTIVE', kind: 'npc', id: 'npc:ghost', active_position: 1 },
    ]),
    { outstandingRunId: 'r1' },
  );

  assert.equal(out.status, 'rejected');
  assert.equal(serialize(ws), before, 'workspace is byte-for-byte unchanged');
  assert.equal(ws.surfaces.event_log.text, '', 'the valid operation did not sneak through');
});

// T39 — a failed run leaves revision and state untouched
test('T39 a rejected run does not move the revision', () => {
  const ws = base();
  const out = applyArchivistRun(ws, 'not json at all', { outstandingRunId: 'r1' });
  assert.equal(out.status, 'rejected');
  assert.equal(ws.revision, 0);
});

// --- C-B run_id -----------------------------------------------------------

// T54
test('T54 a response whose run_id does not match the outstanding run is rejected', () => {
  const ws = base();
  const out = applyArchivistRun(ws, run('other', [{ op: 'NO_CHANGE' }]), {
    outstandingRunId: 'r1',
  });
  assert.equal(out.status, 'rejected');
  assert.match(out.errors.join(' '), /does not match outstanding/);
});

// T55 / T56
test('T55 a duplicate valid run_id applies exactly once', () => {
  let ws = base();
  const payload = run('r1', [
    { op: 'PROMOTE_TO_ACTIVE', kind: 'npc', id: 'npc:d', active_position: 1 },
  ]);

  const first = applyArchivistRun(ws, payload, { outstandingRunId: 'r1' });
  assert.equal(first.status, 'applied');
  ws = first.workspace;
  assert.deepEqual(ws.order.npc, ['npc:d', 'npc:a', 'npc:b', 'npc:c']);

  // same response delivered again
  const second = applyArchivistRun(ws, payload, {
    outstandingRunId: 'r1',
    expectedRevision: ws.revision,
  });
  assert.equal(second.status, 'rejected');
  assert.equal(second.receipt.status, 'duplicate');
  assert.deepEqual(ws.order.npc, ['npc:d', 'npc:a', 'npc:b', 'npc:c'], 'not applied twice');
});

test('the applied run_id is committed with the state change, not after it', () => {
  const ws = base();
  const out = applyArchivistRun(ws, run('r1', [{ op: 'NO_CHANGE' }]), { outstandingRunId: 'r1' });
  assert.equal(out.status, 'applied');
  assert.equal(out.workspace.receipts[0].run_id, 'r1');
  assert.equal(out.workspace.receipts[0].post_revision, out.workspace.revision);
  assert.equal(out.receipt.no_change, true);
  assert.equal(out.receipt.operation_count, 0, 'NO_CHANGE is a result, not an applied mutation');
});

// T41 — concurrent revision change invalidates a pending commit
test('T41 a workspace that moved under the run invalidates the commit', () => {
  const ws = base();
  ws.revision = 7;
  const out = applyArchivistRun(ws, run('r1', [{ op: 'NO_CHANGE' }]), {
    outstandingRunId: 'r1',
    expectedRevision: 6,
  });
  assert.equal(out.status, 'rejected');
  assert.match(out.errors.join(' '), /refresh and retry/);
});

// --- budgets and confirmation -------------------------------------------

test('T15 exceeding the promotion budget rejects the run', () => {
  const ws = base();
  assert.equal(ws.settings.max_archivist_promotions_per_run, 2);
  const out = applyArchivistRun(
    ws,
    run('r1', [
      { op: 'PROMOTE_TO_ACTIVE', kind: 'npc', id: 'npc:a', active_position: 1 },
      { op: 'PROMOTE_TO_ACTIVE', kind: 'npc', id: 'npc:b', active_position: 2 },
      { op: 'PROMOTE_TO_ACTIVE', kind: 'npc', id: 'npc:c', active_position: 3 },
    ]),
    { outstandingRunId: 'r1' },
  );
  assert.equal(out.status, 'rejected');
  assert.match(out.errors.join(' '), /promotion budget exceeded/);
});

test('T16 budget zero permits maintenance but no reordering', () => {
  const ws = base();
  ws.settings.max_archivist_promotions_per_run = 0;

  const maintenance = applyArchivistRun(
    ws,
    run('r1', [{ op: 'SET_SURFACE', surface: 'event_log', text: 'Joe freed the genie.' }]),
    { outstandingRunId: 'r1' },
  );
  assert.equal(maintenance.status, 'applied');

  const reorder = applyArchivistRun(
    ws,
    run('r2', [{ op: 'PROMOTE_TO_ACTIVE', kind: 'npc', id: 'npc:d', active_position: 1 }]),
    { outstandingRunId: 'r2' },
  );
  assert.equal(reorder.status, 'rejected');
});

// T23 — Archivist-created cards default unconfirmed
test('T23 a new Archivist card defaults unconfirmed even if it asks to be confirmed', () => {
  const ws = base();
  const out = applyArchivistRun(
    ws,
    run('r1', [
      {
        op: 'UPSERT_CARD',
        kind: 'npc',
        id: 'npc:samira',
        name_or_title: 'Samira',
        aliases: [],
        summary: 'A genie.',
        link_ids: [],
        review_state: 'confirmed',
      },
    ]),
    { outstandingRunId: 'r1' },
  );
  assert.equal(out.status, 'applied');
  assert.equal(out.workspace.cards['npc:samira'].review_state, 'unconfirmed');
  assert.ok(!out.workspace.order.npc.includes('npc:samira'), 'not ambiently projected');
});

test('T24 the Archivist cannot confirm an existing card by asserting it', () => {
  const ws = base();
  ws.cards['npc:samira'] = createCard({
    id: 'npc:samira',
    kind: 'npc',
    name_or_title: 'Samira',
    review_state: 'unconfirmed',
  });
  ws.unconfirmed.npc.push('npc:samira');

  const out = applyArchivistRun(
    ws,
    run('r1', [
      {
        op: 'UPSERT_CARD',
        kind: 'npc',
        id: 'npc:samira',
        name_or_title: 'Samira',
        aliases: [],
        summary: 'Definitely real.',
        link_ids: [],
        review_state: 'confirmed',
      },
    ]),
    { outstandingRunId: 'r1' },
  );
  assert.equal(out.status, 'rejected');
  assert.match(out.errors.join(' '), /confirmation is mechanical only/);
});

test('T1 a surface that busts its token budget rejects the run', () => {
  const ws = base();
  const out = applyArchivistRun(
    ws,
    run('r1', [{ op: 'SET_SURFACE', surface: 'event_log', text: 'x'.repeat(20000) }]),
    { outstandingRunId: 'r1' },
  );
  assert.equal(out.status, 'rejected');
  assert.match(out.errors.join(' '), /estimated tokens exceeds/);
});

test('an illegal relation shape is caught by the invariants', () => {
  const ws = base();
  const out = applyArchivistRun(
    ws,
    run('r1', [{ op: 'SET_LINKS', id: 'npc:a', link_ids: ['npc:b'] }]),
    { outstandingRunId: 'r1' },
  );
  assert.equal(out.status, 'rejected');
  assert.match(out.errors.join(' '), /not an allowed relation shape/);
});

// --- C-F undo + quota ----------------------------------------------------

// T69
test('T69 undo restores changed state without a full workspace snapshot', () => {
  const ws = base();
  const out = applyArchivistRun(
    ws,
    run('r1', [
      { op: 'SET_SURFACE', surface: 'event_log', text: 'Joe freed the genie.' },
      { op: 'PROMOTE_TO_ACTIVE', kind: 'npc', id: 'npc:d', active_position: 1 },
    ]),
    { outstandingRunId: 'r1' },
  );
  assert.equal(out.status, 'applied');
  const next = out.workspace;

  // T67 — the preimage carries only what changed
  assert.ok(next.undo.surfaces.event_log, 'changed surface is captured');
  assert.ok(!next.undo.surfaces.social_context, 'untouched surface is not captured');
  assert.deepEqual(next.undo.order.npc, ['npc:a', 'npc:b', 'npc:c', 'npc:d']);

  applyPreimage(next, next.undo);
  assert.equal(next.surfaces.event_log.text, '');
  assert.deepEqual(next.order.npc, ['npc:a', 'npc:b', 'npc:c', 'npc:d']);
  assert.equal(next.undo, null, 'depth 1: undoing consumes the preimage');
});

test('undo deletes a card the run created', () => {
  const ws = base();
  const out = applyArchivistRun(
    ws,
    run('r1', [
      {
        op: 'UPSERT_CARD',
        kind: 'npc',
        id: 'npc:samira',
        name_or_title: 'Samira',
        aliases: [],
        summary: 'A genie.',
        link_ids: [],
        review_state: 'unconfirmed',
      },
    ]),
    { outstandingRunId: 'r1' },
  );
  const next = out.workspace;
  assert.ok(next.cards['npc:samira']);
  assert.equal(next.undo.cards['npc:samira'], null, 'null marks did-not-exist');

  applyPreimage(next, next.undo);
  assert.ok(!next.cards['npc:samira'], 'undo removed it again');
});

// T68
test('T68 a quota failure preserves the current state', () => {
  const ws = base();
  ws.settings.storage_quota_bytes = 256; // absurdly small on purpose
  const before = serialize(ws);

  const out = applyArchivistRun(
    ws,
    run('r1', [{ op: 'SET_SURFACE', surface: 'event_log', text: 'Joe freed the genie.' }]),
    { outstandingRunId: 'r1' },
  );

  assert.equal(out.status, 'rejected');
  assert.match(out.errors.join(' '), /exceeds safe headroom/);
  assert.equal(serialize(ws), before);
});

// --- C-B single flight ---------------------------------------------------

test('T57/T58 concurrent requests coalesce to one follow-up on the newest revision', async () => {
  let ws = base();
  const seenRevisions = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  let calls = 0;

  const runner = new ArchivistRunner({
    getWorkspace: () => ws,
    mintRunId: () => `run-${calls}`,
    invoke: async (workspace, runId) => {
      calls += 1;
      seenRevisions.push(workspace.revision);
      if (calls === 1) await gate; // hold the first run open
      return run(runId, [
        { op: 'SET_SURFACE', surface: 'event_log', text: `pass ${calls}` },
      ]);
    },
    apply: applyArchivistRun,
    commit: (result) => { ws = result.workspace; },
  });

  const first = runner.request();
  const second = runner.request();
  const third = runner.request();
  assert.equal(runner.isPending, true, 'extra clicks collapse into one pending flag');

  release();
  await Promise.all([first, second, third]);

  assert.equal(calls, 2, 'three requests produced two runs, not three');
  assert.deepEqual(seenRevisions, [0, 1], 'the follow-up read the newest revision');
  assert.equal(ws.surfaces.event_log.text, 'pass 2');
  assert.equal(ws.revision, 2);
});
