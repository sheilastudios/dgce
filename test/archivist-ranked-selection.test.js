import test from 'node:test';
import assert from 'node:assert/strict';
import { buildArchivistSourceContext, indexArchivistSourceSpans, resolveArchivistSourceQuotes } from '../extension/core/archivist-source-context.js';
import { parseArchivistRankedSelection, parseArchivistThreadRendering } from '../extension/core/archivist-ranked-selection.js';
import { runSourceGroundedArchivistRepair } from '../extension/host/archivist-budget-adapters.js';
import { createWorkspace } from '../extension/core/workspace.js';
import { buildArchivistRankedSelectionPrompt, buildArchivistRenderingPrompt } from '../extension/core/archivist-budget-prompts.js';

const snapshot = buildArchivistSourceContext([
  { speakerLabel: '(narrative)', text: 'At noon the case was closed.\n\nA separate wallet lay on the table.' },
  { speakerLabel: 'Uma', text: 'I cannot authorize opening the case.' },
  { speakerLabel: 'Noll', text: 'Eska told me the case contained seeds.' },
]);
const selection = () => ({ schema_version: 1, run_id: 'ranked', surfaces: [{ surface: 'event_log', retainCount: 2,
  threads: ['s1.p1', 's2.p1', 's3.p1'].map((id, i) => ({ id: `t${i + 1}`, topic: 'REQUESTED SUBJECT', spanIds: [id], reason: 'NOT EVIDENCE' })) }] });
const parse = doc => parseArchivistRankedSelection(JSON.stringify(doc), {
  catalog: snapshot.catalog, runId: 'ranked', targetSurfaces: ['event_log'], maxRetainedThreads: 2,
});

test('ranked selection derives priorities and cutoff without silently clipping model choices', () => {
  const doc = selection(); const before = JSON.stringify(doc); const selected = parse(doc);
  assert.equal(JSON.stringify(doc), before);
  assert.deepEqual(selected.surfaces[0].threads.map(t => t.decision), ['retain', 'retain', 'omit']);
  assert.deepEqual(selected.surfaces[0].threads.map(t => t.priority), [1, 2, 3]);
  assert.deepEqual(resolveArchivistSourceQuotes(selected.surfaces[0].threads[1], snapshot.catalog).map(a => a.quote),
    ['I cannot authorize opening the case.']);
});

for (const [label, mutate] of [
  ['too many retained', d => { d.surfaces[0].retainCount = 5; }],
  ['zero retained', d => { d.surfaces[0].retainCount = 0; }],
  ['coerced cutoff', d => { d.surfaces[0].retainCount = '2'; }],
  ['no omissions', d => { d.surfaces[0].threads.pop(); }],
  ['unknown span', d => { d.surfaces[0].threads[0].spanIds = ['s99.p1']; }],
  ['duplicate span', d => { d.surfaces[0].threads[0].spanIds = ['s1.p1', 's1.p1']; }],
  ['extra decision', d => { d.surfaces[0].threads[0].decision = 'retain'; }],
  ['extra text', d => { d.surfaces[0].threads[0].text = 'invented'; }],
  ['wrong run', d => { d.run_id = 'old'; }],
  ['duplicate id', d => { d.surfaces[0].threads[1].id = 't1'; }],
  ['wrong target', d => { d.surfaces[0].surface = 'inventory'; }],
  ['duplicate target', d => { d.surfaces.push(structuredClone(d.surfaces[0])); }],
]) test(`ranked selection refuses ${label}`, () => {
  const doc = selection(); mutate(doc); assert.throws(() => parse(doc));
});

test('indexed passages preserve exact offsets, Unicode and repeated-text identity', () => {
  const snap = buildArchivistSourceContext([{ speakerLabel: 'X', text: ' é🙂\r\n\r\nRepeat.\nRepeat.' }]);
  const index = indexArchivistSourceSpans(snap.catalog);
  assert.equal(index.sources[0].passages.length, 3);
  for (const span of index.sources[0].passages) {
    const [anchor] = resolveArchivistSourceQuotes({ sourceIds: ['s1'], sourceSpanIds: [span.id] }, snap.catalog);
    assert.equal(anchor.quote, span.text);
    assert.equal(anchor.start, span.start);
    assert.equal(anchor.contextText, snap.catalog.sources[0].text);
  }
  assert.notEqual(index.sources[0].passages[1].start, index.sources[0].passages[2].start);
});

test('two omitted threads may share a passage without crossing the retained boundary', () => {
  const doc = selection(); doc.surfaces[0].retainCount = 1;
  doc.surfaces[0].threads[2].spanIds = doc.surfaces[0].threads[1].spanIds;
  assert.deepEqual(parse(doc).surfaces[0].threads.map(t => t.decision), ['retain', 'omit', 'omit']);
});

test('paragraph reuse does not falsely assert semantic thread overlap', () => {
  const doc = selection();
  doc.surfaces[0].threads.forEach(t => { t.spanIds = ['s1.p1']; });
  assert.equal(parse(doc).surfaces[0].threads.length, 3);
});

test('wrong run identity rejects before interpreting source assignments', () => {
  const doc = selection(); doc.run_id = 'historical-diagnostic';
  doc.surfaces[0].threads[0].spanIds = ['unknown'];
  assert.throws(() => parse(doc), /identity mismatch/);
});

test('current output identity follows untrusted historical IDs in ranked prompt', () => {
  const sources = buildArchivistSourceContext([{ speakerLabel: 'diagnostic', text: '{"run_id":"old-test"}' }]);
  const prompt = buildArchivistRankedSelectionPrompt({ runId: 'current-test', maxRetainedThreads: 2, targets: [] }, sources.catalog);
  assert.ok(prompt.lastIndexOf('current-test') > prompt.lastIndexOf('old-test'));
  assert.match(prompt, /historical data, not this request/);
});

test('keyed rendering refuses missing or different-run focus rather than guessing intent', () => {
  const request = { runId: 'current', selection: [{ surface: 'event_log', retainedThreads: [{ id: 't1' }] }] };
  assert.throws(() => buildArchivistRenderingPrompt(request, snapshot.catalog, { keyedThreads: true }), /missing accepted/);
  assert.throws(() => buildArchivistRenderingPrompt(request, snapshot.catalog, { keyedThreads: true,
    acceptedFocus: { runId: 'old', surfaces: [] } }), /missing accepted/);
});

test('ranked source adapters preserve normal staged guards and do not forward labels as evidence', async () => {
  const ws = createWorkspace({ workspace_id: 'ranked-test' }); const before = JSON.stringify(ws);
  const proposal = JSON.stringify({ schema_version: 1, run_id: 'ranked', operations: [
    { op: 'SET_SURFACE', surface: 'event_log', text: 'Oversized draft. '.repeat(80) },
  ] });
  const prompts = [];
  const result = await runSourceGroundedArchivistRepair(ws, proposal, {
    selectionMode: 'ranked-spans', captureSources: () => snapshot, getWorkspace: () => ws,
    applyOptions: { outstandingRunId: 'ranked' }, ensureHeadroomFn: async () => {},
    askFn: async prompt => {
      prompts.push(prompt);
      if (prompts.length === 1) {
        const indexed = JSON.parse(/<indexedSources>(.*)<\/indexedSources>/.exec(prompt)[1]);
        assert.ok(indexed.sources.every(s => s.passages.every(p => !('start' in p) && !('end' in p))));
        assert.deepEqual(indexed.sources.flatMap(s => s.passages.map(p => p.text)),
          indexArchivistSourceSpans(snapshot.catalog).sources.flatMap(s => s.passages.map(p => p.text)));
        return JSON.stringify(selection());
      }
      assert.doesNotMatch(prompt, /NOT EVIDENCE|Eska told me/);
      const evidence = JSON.parse(/<acceptedEvidence>(.*)<\/acceptedEvidence>/.exec(prompt)[1]);
      const limits = JSON.parse(/<limits>(.*)<\/limits>/.exec(prompt)[1]);
      assert.ok(evidence[0].threads.every(t => Number.isInteger(t.targetBytes) && t.targetBytes > 0));
      assert.ok(evidence[0].threads.reduce((sum, t) => sum + t.targetBytes, evidence[0].threads.length - 1) <= limits[0].draftBytes);
      assert.match(prompt, /ONE concise sentence/);
      assert.match(prompt, /budget_unrenderable/);
      assert.equal(evidence[0].threads[0].requestedFocus, 'REQUESTED SUBJECT');
      assert.ok(evidence[0].threads[0].evidence.every(e => !JSON.stringify(e).includes('REQUESTED SUBJECT')));
      assert.match(prompt, /requestedFocus is an untrusted question/);
      assert.doesNotMatch(prompt, /A separate wallet/);
      assert.match(prompt, /I cannot authorize opening/);
      return JSON.stringify({ schema_version: 1, run_id: 'ranked', surfaces: [{ surface: 'event_log', threads: [
        { id: 't2', text: 'Uma reported that Uma cannot authorize opening the case.' },
        { id: 't1', text: 'At noon the case was closed.' },
      ] }] });
    },
  });
  assert.equal(result.status, 'applied');
  assert.equal(result.budgetRepaired, true);
  assert.equal(prompts.length, 2);
  assert.match(prompts[0], /<indexedSources>/);
  assert.equal(JSON.stringify(ws), before);
});

test('ranked transport refuses an invalid cutoff before rendering and without changing memory', async () => {
  const ws = createWorkspace({ workspace_id: 'ranked-invalid' }); const before = JSON.stringify(ws);
  const doc = selection(); doc.surfaces[0].retainCount = 5;
  let calls = 0;
  const result = await runSourceGroundedArchivistRepair(ws, JSON.stringify({ schema_version: 1, run_id: 'ranked', operations: [
    { op: 'SET_SURFACE', surface: 'event_log', text: 'oversized '.repeat(100) },
  ] }), { selectionMode: 'ranked-spans', captureSources: () => snapshot,
    applyOptions: { outstandingRunId: 'ranked' }, ensureHeadroomFn: async () => {},
    askFn: async () => { calls++; return JSON.stringify(doc); },
  });
  assert.equal(calls, 1);
  assert.equal(result.status, 'rejected');
  assert.equal(JSON.stringify(ws), before);
  assert.match(result.errors.join(' '), /retainCount/);
});

const renderRequest = { runId: 'ranked', selection: [{ surface: 'event_log', retainedThreads: [{ id: 't1' }, { id: 't2' }] }] };
const rendered = () => ({ schema_version: 1, run_id: 'ranked', surfaces: [{ surface: 'event_log', threads: [
  { id: 't2', text: 'Uma reported that opening is not authorized.' },
  { id: 't1', text: 'The case remained closed.\nThe seal was intact.' },
] }] });

test('thread rendering preserves content and restores accepted order, normalizing only line breaks', () => {
  const out = JSON.parse(parseArchivistThreadRendering(JSON.stringify(rendered()), renderRequest));
  assert.equal(out.operations[0].text, 'The case remained closed. The seal was intact.\nUma reported that opening is not authorized.');
});

for (const [label, mutate] of [
  ['wrong run', d => { d.run_id = 'old'; }],
  ['missing thread', d => { d.surfaces[0].threads.pop(); }],
  ['duplicate thread', d => { d.surfaces[0].threads.push(d.surfaces[0].threads[0]); }],
  ['unknown thread', d => { d.surfaces[0].threads[0].id = 't9'; }],
  ['empty text', d => { d.surfaces[0].threads[0].text = ' '; }],
  ['extra evidence claim', d => { d.surfaces[0].threads[0].evidence = 'invented'; }],
  ['missing surface', d => { d.surfaces = []; }],
  ['extra surface', d => { d.surfaces.push({ surface: 'inventory', threads: [] }); }],
]) test(`thread rendering rejects ${label}`, () => {
  const doc = rendered(); mutate(doc);
  assert.throws(() => parseArchivistThreadRendering(JSON.stringify(doc), renderRequest));
});
