import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArchivistSelection, selectionForRendering } from '../extension/core/archivist-selection.js';

function fixture() {
  return {
    schema_version: 1, run_id: 'repair-1', surfaces: [{
      surface: 'event_log',
      threads: [1, 2, 3].map(n => ({
        id: `t${n}`, priority: n, topic: `Proposal topic ${n}`,
        sourceIds: [`source${n}`], decision: n < 3 ? 'retain' : 'omit',
        reason: `Model judgment ${n}`,
      })),
      referenceRepairs: ['Model-proposed repair, not a source fact.'],
    }],
  };
}
const options = { runId: 'repair-1', targetSurfaces: ['event_log'] };

test('selection accepts bounded metadata without claiming source verification', () => {
  const input = fixture();
  assert.deepEqual(parseArchivistSelection(JSON.stringify(input), options), input);
  const projected = selectionForRendering(input);
  assert.deepEqual(projected, [{ surface: 'event_log', retainedThreads: [
    { id: 't1', sourceIds: ['source1'] }, { id: 't2', sourceIds: ['source2'] },
  ] }]);
  assert.doesNotMatch(JSON.stringify(projected), /Proposal|judgment|repair|topic|reason/);
  projected[0].retainedThreads[0].sourceIds.push('new');
  assert.deepEqual(input.surfaces[0].threads[0].sourceIds, ['source1']);
});

const invalid = [
  ['wrong run', d => { d.run_id = 'other'; }],
  ['wrong version', d => { d.schema_version = 2; }],
  ['unknown field', d => { d.candidate = {}; }],
  ['missing surface', d => { d.surfaces = []; }],
  ['wrong surface', d => { d.surfaces[0].surface = 'social_context'; }],
  ['duplicate surface', d => { d.surfaces.push(structuredClone(d.surfaces[0])); }],
  ['zero retained', d => { d.surfaces[0].threads.forEach(t => { t.decision = 'omit'; }); }],
  ['three retained', d => { d.surfaces[0].threads[2].decision = 'retain'; }],
  ['no omission', d => { d.surfaces[0].threads.pop(); }],
  ['duplicate id', d => { d.surfaces[0].threads[1].id = 't1'; }],
  ['blank id', d => { d.surfaces[0].threads[0].id = ' '; }],
  ['duplicate priority', d => { d.surfaces[0].threads[1].priority = 1; }],
  ['string priority', d => { d.surfaces[0].threads[0].priority = '1'; }],
  ['ranking disagrees', d => { d.surfaces[0].threads[1].decision = 'omit'; d.surfaces[0].threads[2].decision = 'retain'; }],
  ['unknown decision', d => { d.surfaces[0].threads[0].decision = 'keep'; }],
  ['empty sources', d => { d.surfaces[0].threads[0].sourceIds = []; }],
  ['duplicate sources', d => { d.surfaces[0].threads[0].sourceIds = ['s1', 's1']; }],
  ['invalid repair', d => { d.surfaces[0].referenceRepairs = [null]; }],
  ['missing repairs', d => { delete d.surfaces[0].referenceRepairs; }],
  ['missing topic', d => { delete d.surfaces[0].threads[0].topic; }],
  ['extra evidence field', d => { d.surfaces[0].threads[0].verified = true; }],
  ['non-array threads', d => { d.surfaces[0].threads = {}; }],
  ['null thread', d => { d.surfaces[0].threads[0] = null; }],
];
for (const [name, mutate] of invalid) test(`selection rejects ${name}`, () => {
  const doc = fixture(); mutate(doc);
  assert.throws(() => parseArchivistSelection(JSON.stringify(doc), options));
});

test('selection strictly rejects malformed roots and invalid caller policy', () => {
  for (const input of ['null', '[]', '{broken', JSON.stringify({ ...fixture(), surfaces: null })]) {
    assert.throws(() => parseArchivistSelection(input, options));
  }
  assert.throws(() => parseArchivistSelection(JSON.stringify(fixture()), { ...options, maxRetainedThreads: 0 }));
});

test('selection validates each target independently', () => {
  const doc = fixture();
  doc.surfaces.push({ ...structuredClone(doc.surfaces[0]), surface: 'social_context' });
  const opts = { ...options, targetSurfaces: ['event_log', 'social_context'] };
  assert.deepEqual(parseArchivistSelection(JSON.stringify(doc), opts), doc);
  doc.surfaces[1].threads[2].decision = 'retain';
  assert.throws(() => parseArchivistSelection(JSON.stringify(doc), opts));
});
