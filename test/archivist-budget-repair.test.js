import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createWorkspace } from '../extension/core/workspace.js';
import { estimateTokens } from '../extension/core/tokens.js';
import { parseArchivistOutput } from '../extension/core/parse.js';
import { repairArchivistBudgets } from '../extension/host/archivist-budget-repair.js';

const runId = 'budget-repair-test';
const sourceContext = 'Original source fixture: Neri said Olan reported a closed gate. At noon the box was closed.';
const longText = 'A draft requiring evidence-aware selection, not mechanical truncation. '.repeat(15);
const shortText = 'Neri reported that Olan said the gate was closed.\nAt noon the box was closed.';

function base() {
  const ws = createWorkspace({ workspace_id: 'staged-repair' });
  ws.surfaces.event_log.max_tokens = 125; // enforced 100 tokens / 300 bytes
  ws.surfaces.event_log.text = 'Original memory.';
  ws.surfaces.social_context.text = 'Existing social context.';
  return ws;
}
const surface = (text, name = 'event_log') => ({ op: 'SET_SURFACE', surface: name, text });
const payload = operations => JSON.stringify({ schema_version: 1, run_id: runId, operations });
function selection(request) {
  return JSON.stringify({ schema_version: 1, run_id: request.runId,
    surfaces: request.targets.map(target => ({
      surface: target.surface,
      threads: [1, 2, 3].map(n => ({ id: `t${n}`, priority: n,
        topic: 'UNSUPPORTED UNATTENDED LABEL', reason: 'MODEL REASON NOT EVIDENCE',
        sourceIds: [`s${n}`], decision: n <= 2 ? 'retain' : 'omit' })),
      referenceRepairs: ['UNVERIFIED REPAIR CLAIM'],
    })),
  });
}
function opts(overrides = {}) {
  return {
    sourceContext,
    applyOptions: { outstandingRunId: runId },
    selectFn: async request => selection(request),
    renderFn: async request => payload(request.targets.map(t => surface(shortText, t.surface))),
    ...overrides,
  };
}

test('staged repair preserves input and every non-target operation, atomically', async () => {
  const ws = base(); const before = JSON.stringify(ws);
  const operations = [
    surface(longText),
    surface('Unchanged proposed social update.', 'social_context'),
    { op: 'UPSERT_CARD', kind: 'npc', id: 'npc:neri', name_or_title: 'Neri',
      aliases: [], summary: 'Neri reports on the gate.', link_ids: [], review_state: 'unconfirmed' },
  ];
  const proposal = payload(operations);
  const stages = [];
  const out = await repairArchivistBudgets(ws, proposal, opts({
    selectFn: async request => {
      stages.push('select');
      assert.equal(request.sourceContext, sourceContext);
      assert.equal(request.targets[0].maxBytes, 300);
      assert.ok(Object.isFrozen(request.targets[0]));
      return selection(request);
    },
    renderFn: async request => {
      stages.push('render');
      assert.equal(request.sourceContext, sourceContext);
      assert.equal(request.sourceReferencesVerified, false);
      assert.doesNotMatch(JSON.stringify(request), /UNSUPPORTED|MODEL REASON|UNVERIFIED REPAIR/);
      assert.deepEqual(request.selection[0].retainedThreads.map(t => t.id), ['t1', 't2']);
      return payload([surface(shortText)]);
    },
  }));
  assert.deepEqual(stages, ['select', 'render']);
  assert.equal(out.status, 'applied');
  assert.equal(out.budgetRepaired, true);
  assert.equal(out.budgetFitted, null);
  assert.equal(JSON.stringify(ws), before);
  assert.equal(payload(operations), proposal);
  assert.deepEqual(out.candidate.operations.slice(1), operations.slice(1));
  assert.equal(out.workspace.surfaces.event_log.text, shortText);
  assert.equal(out.workspace.surfaces.social_context.text, operations[1].text);
  assert.equal(out.workspace.cards['npc:neri'].summary, operations[2].summary);
  assert.equal(out.workspace.revision, ws.revision + 1);
  assert.equal(out.workspace.receipts.length, ws.receipts.length + 1);
});

test('invalid selection stops before rendering with no workspace change', async () => {
  const ws = base(); const before = JSON.stringify(ws); let renderCalls = 0;
  const out = await repairArchivistBudgets(ws, payload([surface(longText)]), opts({
    selectFn: async request => {
      const doc = JSON.parse(selection(request)); doc.surfaces[0].threads[2].decision = 'retain';
      return JSON.stringify(doc);
    },
    renderFn: async () => { renderCalls++; throw new Error('must not render'); },
  }));
  assert.equal(out.status, 'rejected');
  assert.equal(out.phase, 'selection');
  assert.equal(renderCalls, 0);
  assert.equal(out.workspace, ws);
  assert.equal(JSON.stringify(ws), before);
});

for (const phase of ['selection', 'rendering']) for (const revise of [false, true]) {
  test(`workspace movement during ${phase}, revision write ${revise}, rejects stale work`, async () => {
    const ws = base(); let live = ws; let calls = 0;
    const move = () => {
      live = structuredClone(ws);
      live.surfaces.event_log.text = 'User edit while waiting.';
      if (revise) live.revision++;
    };
    const out = await repairArchivistBudgets(ws, payload([surface(longText)]), opts({
      getWorkspace: () => live,
      selectFn: async request => { calls++; if (phase === 'selection') move(); return selection(request); },
      renderFn: async () => { calls++; if (phase === 'rendering') move(); return payload([surface(shortText)]); },
    }));
    assert.equal(out.status, 'stale_workspace');
    assert.equal(out.workspace, live);
    assert.equal(out.receipt, null);
    assert.equal(live.surfaces.event_log.text, 'User edit while waiting.');
    assert.equal(calls, phase === 'selection' ? 1 : 2);
  });
}

test('pre-existing stale or unavailable workspace prevents selection', async () => {
  const ws = base(); let calls = 0;
  for (const live of [null, { ...ws, revision: ws.revision + 1 }]) {
    const out = await repairArchivistBudgets(ws, payload([surface(longText)]), opts({
      getWorkspace: () => live,
      selectFn: async () => { calls++; },
    }));
    assert.equal(out.status, 'stale_workspace');
  }
  assert.equal(calls, 0);
});

test('rendered overflow rejects all operations without fitting or partial commits', async () => {
  const ws = base(); const before = JSON.stringify(ws);
  const original = payload([surface(longText), surface('Proposed social update.', 'social_context')]);
  const out = await repairArchivistBudgets(ws, original, opts({ renderFn: async () => payload([surface(`${longText}\nAnother retained thread.`)]) }));
  assert.equal(out.status, 'rejected');
  assert.match(out.errors.join(' '), /exceeds enforced/);
  assert.equal(out.workspace, ws);
  assert.equal(out.budgetFitted, null);
  assert.equal(JSON.stringify(ws), before);
});

for (const [name, operations] of [
  ['non-target rewrite', [surface(shortText), surface('Hijack', 'social_context')]],
  ['extra card operation', [surface(shortText), { op: 'NO_CHANGE' }]],
  ['missing target', []],
  ['duplicate target', [surface(shortText), surface(shortText)]],
  ['excess lines', [surface('one\ntwo\nthree')]],
  ['missing retained line', [surface('Only one retained thread.')]],
  ['empty replacement', [surface(' \n')]],
]) test(`renderer cannot return ${name}`, async () => {
  const ws = base(); const before = JSON.stringify(ws);
  const out = await repairArchivistBudgets(ws, payload([surface(longText)]), opts({
    renderFn: async () => payload(operations),
  }));
  assert.equal(out.status, 'rejected');
  assert.equal(JSON.stringify(ws), before);
});

test('multi-surface repair shares two calls and final atomic validation', async () => {
  const ws = base(); ws.surfaces.social_context.max_tokens = 125;
  let calls = 0;
  const out = await repairArchivistBudgets(ws, payload([surface(longText), surface(longText, 'social_context')]), opts({
    selectFn: async request => { calls++; assert.equal(request.targets.length, 2); return selection(request); },
    renderFn: async request => { calls++; return payload(request.targets.map(t => surface(shortText, t.surface))); },
  }));
  assert.equal(calls, 2);
  assert.equal(out.status, 'applied');
  assert.equal(out.workspace.surfaces.social_context.text, shortText);
});

test('non-budget errors hidden behind budget preflight block any stage call', async () => {
  const ws = base(); let calls = 0;
  const card = (id, links) => ({ op: 'UPSERT_CARD', id, kind: 'location',
    name_or_title: id, summary: '', aliases: [], link_ids: links, review_state: 'unconfirmed' });
  const out = await repairArchivistBudgets(ws, payload([
    surface(longText), card('loc:temple', ['loc:archive']), card('loc:archive', []),
  ]), opts({ selectFn: async () => { calls++; } }));
  assert.equal(out.status, 'rejected');
  assert.match(out.errors.join(' '), /not an allowed relation shape/);
  assert.equal(calls, 0);
  assert.equal(Object.keys(ws.cards).length, 0);
});

for (const stage of ['selection', 'rendering']) test(`${stage} transport failure is bounded and non-mutating`, async () => {
  const ws = base(); const before = JSON.stringify(ws); let calls = 0;
  const out = await repairArchivistBudgets(ws, payload([surface(longText)]), opts({
    selectFn: async request => { calls++; if (stage === 'selection') throw new Error('offline'); return selection(request); },
    renderFn: async () => { calls++; throw new Error('offline'); },
  }));
  assert.equal(out.status, 'rejected');
  assert.match(out.errors.join(' '), /offline/);
  assert.equal(calls, stage === 'selection' ? 1 : 2);
  assert.equal(JSON.stringify(ws), before);
});

test('preflight refuses wrong runs, ambiguous operations, missing evidence and non-budget calls', async () => {
  const ws = base(); let calls = 0;
  const never = async () => { calls++; throw new Error('unexpected'); };
  const cases = [
    [payload([surface(shortText)]), {}],
    [payload([surface(longText), surface(longText)]), {}],
    [payload([surface(longText), { op: 'NO_CHANGE' }]), {}],
    [payload([surface(longText)]), { sourceContext: '' }],
    [payload([surface(longText)]), { applyOptions: {} }],
    [payload([surface(longText)]), { applyOptions: { outstandingRunId: 'other' } }],
    [payload([surface(longText)]), { applyOptions: { outstandingRunId: runId, expectedRevision: 999 } }],
    [payload([surface(longText)]), { maxRetainedThreads: 0 }],
    ['{bad', {}],
  ];
  for (const [raw, overrides] of cases) {
    const out = await repairArchivistBudgets(ws, raw, opts({ selectFn: never, ...overrides }));
    assert.equal(out.status, 'rejected');
  }
  assert.equal(calls, 0);
});

test('wrong rendered run and malformed stage output are rejected', async () => {
  for (const overrides of [
    { selectFn: async () => '{invalid' },
    { renderFn: async () => '{invalid' },
    { renderFn: async () => payload([surface(shortText)]).replace(runId, 'wrong-run') },
  ]) {
    const ws = base();
    const out = await repairArchivistBudgets(ws, payload([surface(longText)]), opts(overrides));
    assert.equal(out.status, 'rejected');
    assert.equal(out.workspace, ws);
  }
});

test('default runner does not import staged repair and normal apply schema stays strict', async () => {
  const live = readFileSync(new URL('../extension/host/archivist-run.js', import.meta.url), 'utf8');
  assert.doesNotMatch(live, /archivist-budget-repair|repairArchivistBudgets/);
  assert.ok(estimateTokens(shortText) <= 100);
  assert.throws(() => parseArchivistOutput(JSON.stringify({
    ...JSON.parse(payload([surface(shortText)])), selection: {},
  })), /failed validation/);
});

test('replayed run is refused before any stage call', async () => {
  const ws = base(); ws.receipts.push({ run_id: runId, status: 'applied' });
  let calls = 0;
  const out = await repairArchivistBudgets(ws, payload([surface(longText)]), opts({
    selectFn: async () => { calls++; },
  }));
  assert.equal(out.status, 'rejected');
  assert.match(out.errors.join(' '), /already been applied/);
  assert.equal(calls, 0);
});
