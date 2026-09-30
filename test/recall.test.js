import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorkspace, createCard } from '../extension/core/workspace.js';
import { appendConfirmed } from '../extension/core/ordering.js';
import { rebuildAliasIndex, lookupTerm } from '../extension/core/aliases.js';
import { mergeCards } from '../extension/core/merge.js';
import { freshnessBand, touchOnRecall, supportCard } from '../extension/core/freshness.js';
import { linkedNeighbours, recallCard, resolveEntity } from '../extension/core/recall.js';

function build({ turn = 100, window = 3 } = {}) {
  const w = createWorkspace({
    workspace_id: 't',
    settings: { npc_active_window: window, location_active_window: window, event_active_window: window },
  });
  w.current_turn = turn;
  const add = (id, kind, name, extra = {}) => {
    w.cards[id] = createCard({ id, kind, name_or_title: name, review_state: 'confirmed', ...extra });
    appendConfirmed(w, kind, id);
    return id;
  };
  return { w, add };
}

// --- C-C freshness --------------------------------------------------------

test('T59 recall updates last_touched but never last_supported_turn', () => {
  const { w, add } = build({ turn: 100 });
  add('npc:tomas', 'npc', 'Tomas');
  w.cards['npc:tomas'].last_supported_turn = 10;

  touchOnRecall(w, 'npc:tomas');

  assert.equal(w.cards['npc:tomas'].last_touched, 100, 'reading updates recency');
  assert.equal(
    w.cards['npc:tomas'].last_supported_turn,
    10,
    'reading is not evidence about the content',
  );
});

test('T59b querying a stale card does not make it look fresh', () => {
  const { w, add } = build({ turn: 500 });
  add('npc:tomas', 'npc', 'Tomas');
  w.cards['npc:tomas'].last_supported_turn = 10;

  assert.equal(freshnessBand(w, 'npc:tomas'), 'stale');
  recallCard(w, 'npc:tomas');
  assert.equal(freshnessBand(w, 'npc:tomas'), 'stale', 'the read did not manufacture freshness');
});

test('T60 freshness bands track support age, and unknown support reads stale', () => {
  const { w, add } = build({ turn: 100 });
  add('npc:a', 'npc', 'A');
  add('npc:b', 'npc', 'B');
  add('npc:c', 'npc', 'C');
  add('npc:d', 'npc', 'D');

  w.cards['npc:a'].last_supported_turn = 90;  // age 10
  w.cards['npc:b'].last_supported_turn = 20;  // age 80
  w.cards['npc:c'].last_supported_turn = 1;   // age 99 -> still aging
  // npc:d left null

  assert.equal(freshnessBand(w, 'npc:a'), 'fresh');
  assert.equal(freshnessBand(w, 'npc:b'), 'aging');
  assert.equal(freshnessBand(w, 'npc:c'), 'aging');
  assert.equal(freshnessBand(w, 'npc:d'), 'stale', 'never supported reads stale, not fresh');
});

test('supportCard is the only path that moves support', () => {
  const { w, add } = build({ turn: 300 });
  add('npc:a', 'npc', 'A');
  w.cards['npc:a'].last_supported_turn = 5;
  supportCard(w, 'npc:a');
  assert.equal(w.cards['npc:a'].last_supported_turn, 300);
  assert.equal(freshnessBand(w, 'npc:a'), 'fresh');
});

test('a retired card returns identity plus staleness, not bare identity', () => {
  const { w, add } = build({ turn: 400, window: 1 });
  add('npc:keep', 'npc', 'Keep');
  add('npc:tomas', 'npc', 'Tomas');
  w.cards['npc:tomas'].last_supported_turn = 5;

  const payload = recallCard(w, 'npc:tomas');
  assert.equal(payload.activity, 'retired');
  assert.equal(payload.freshness, 'stale');
  assert.equal(payload.status, 'known', 'retired is still known');
});

// --- C-E determinism ------------------------------------------------------

test('T65 the same card in the same state returns the same neighbours', () => {
  const { w, add } = build();
  add('npc:tomas', 'npc', 'Tomas', {
    link_ids: ['evt:storm', 'loc:hartwell', 'evt:inspection', 'loc:depot'],
  });
  add('evt:storm', 'event', 'Storm');
  add('evt:inspection', 'event', 'Inspection');
  add('loc:hartwell', 'location', 'Hartwell');
  add('loc:depot', 'location', 'Depot');

  const first = linkedNeighbours(w, 'npc:tomas');
  const again = linkedNeighbours(w, 'npc:tomas');
  assert.deepEqual(first, again);

  // and recall, which mutates recency, must not change what recall returns
  recallCard(w, 'npc:tomas');
  assert.deepEqual(linkedNeighbours(w, 'npc:tomas'), first);
});

test('T65b events come before locations for an NPC, per the bucket order', () => {
  const { w, add } = build();
  add('npc:tomas', 'npc', 'Tomas', { link_ids: ['loc:hartwell', 'evt:storm'] });
  add('evt:storm', 'event', 'Storm');
  add('loc:hartwell', 'location', 'Hartwell');

  assert.deepEqual(linkedNeighbours(w, 'npc:tomas'), ['evt:storm', 'loc:hartwell']);
});

test('active neighbours outrank retired ones regardless of link order', () => {
  const { w, add } = build({ window: 1 });
  add('evt:first', 'event', 'First');   // active (window 1)
  add('evt:second', 'event', 'Second'); // retired
  add('npc:tomas', 'npc', 'Tomas', { link_ids: ['evt:second', 'evt:first'] });

  assert.deepEqual(linkedNeighbours(w, 'npc:tomas'), ['evt:first', 'evt:second']);
});

test('unconfirmed neighbours are excluded unless explicitly requested', () => {
  const { w, add } = build();
  add('npc:tomas', 'npc', 'Tomas', { link_ids: ['evt:rumour'] });
  w.cards['evt:rumour'] = createCard({
    id: 'evt:rumour',
    kind: 'event',
    name_or_title: 'Rumour',
    review_state: 'unconfirmed',
  });

  assert.deepEqual(linkedNeighbours(w, 'npc:tomas'), []);
  assert.deepEqual(linkedNeighbours(w, 'npc:tomas', { includeUnconfirmed: true }), ['evt:rumour']);
});

test('the cap is applied after ordering, not before', () => {
  const { w, add } = build({ window: 10 });
  add('evt:a', 'event', 'A');
  add('evt:b', 'event', 'B');
  add('loc:z', 'location', 'Z');
  // link order deliberately puts the location first
  add('npc:tomas', 'npc', 'Tomas', { link_ids: ['loc:z', 'evt:a', 'evt:b'] });

  assert.deepEqual(
    linkedNeighbours(w, 'npc:tomas', { cap: 2 }),
    ['evt:a', 'evt:b'],
    'ordering decides the content; the cap only truncates',
  );
});

// T66 — ordering survives a merged link union
test('T66 link ordering stays deterministic across a merge union', () => {
  const { w, add } = build({ window: 10 });
  add('evt:a', 'event', 'A');
  add('evt:b', 'event', 'B');
  add('loc:z', 'location', 'Z');
  add('npc:canon', 'npc', 'Canon', { link_ids: ['evt:a'] });
  add('npc:dupe', 'npc', 'Dupe', { link_ids: ['loc:z', 'evt:b'] });
  rebuildAliasIndex(w);

  mergeCards(w, 'npc:dupe', 'npc:canon');

  const once = linkedNeighbours(w, 'npc:canon');
  const twice = linkedNeighbours(w, 'npc:canon');
  assert.deepEqual(once, twice);
  assert.deepEqual(once, ['evt:a', 'evt:b', 'loc:z'], 'union is ordered, not concatenated');
});

test('recall follows a redirect to the canonical card', () => {
  const { w, add } = build();
  add('npc:canon', 'npc', 'Canon');
  add('npc:dupe', 'npc', 'Dupe');
  rebuildAliasIndex(w);
  mergeCards(w, 'npc:dupe', 'npc:canon');

  const payload = recallCard(w, 'npc:dupe');
  assert.equal(payload.id, 'npc:canon');
});

// --- §7 resolution --------------------------------------------------------

test('T4 an unknown term is reported as unknown, carrying no novelty claim', () => {
  const { w } = build();
  assert.deepEqual(resolveEntity(w, 'nobody', lookupTerm), { status: 'unknown' });
});

test('T3 an ambiguous alias returns every candidate and selects none', () => {
  const { w, add } = build();
  add('npc:reyes_a', 'npc', 'Reyes A', { aliases: ['reyes'] });
  add('npc:reyes_b', 'npc', 'Reyes B', { aliases: ['reyes'] });
  rebuildAliasIndex(w);

  const out = resolveEntity(w, 'Reyes', lookupTerm);
  assert.equal(out.status, 'ambiguous');
  assert.equal(out.count, 2);
  assert.equal(out.matches.length, 2);
});

test('T2 a unique alias resolves to the canonical identity with freshness', () => {
  const { w, add } = build({ turn: 100 });
  add('npc:tomas', 'npc', 'Tomas', { aliases: ['the engineer'] });
  w.cards['npc:tomas'].last_supported_turn = 95;
  rebuildAliasIndex(w);

  const out = resolveEntity(w, 'The Engineer', lookupTerm);
  assert.equal(out.status, 'alias-of');
  assert.equal(out.id, 'npc:tomas');
  assert.equal(out.freshness, 'fresh');
});
