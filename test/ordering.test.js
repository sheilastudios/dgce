import test from 'node:test';
import assert from 'node:assert/strict';

import {
  promoteToActive,
  userReorder,
  activeIds,
  retiredIds,
  activityOf,
  OrderingError,
} from '../extension/core/ordering.js';
import { ordinalRank } from '../extension/core/workspace.js';
import { wsWithNpcs, ids } from './helpers.js';

// T8 — deterministic insert places candidate at requested active position
test('T8 promotion places the candidate at the requested active position', () => {
  const ws = wsWithNpcs(['a', 'b', 'c', 'd', 'e']);
  promoteToActive(ws, 'npc', 'npc:e', 2);
  assert.deepEqual(ws.order.npc, ids(['a', 'e', 'b', 'c', 'd']));
  assert.equal(ordinalRank(ws, 'npc:e'), 2);
});

// T9 — displaced boundary card lands at retired position N+1
test('T9 the displaced boundary card becomes the first retired card', () => {
  const ws = wsWithNpcs(['a', 'b', 'c', 'd', 'e'], { window: 3 });
  assert.deepEqual(activeIds(ws, 'npc'), ids(['a', 'b', 'c']));

  promoteToActive(ws, 'npc', 'npc:e', 2);

  assert.deepEqual(activeIds(ws, 'npc'), ids(['a', 'e', 'b']));
  // former active_3 was c; it is now the top of RETIRED
  assert.equal(retiredIds(ws, 'npc')[0], 'npc:c');
  assert.equal(activityOf(ws, 'npc:c'), 'retired');
});

// T10 — unrelated retired cards preserve relative order
test('T10 promotion does not disturb the relative order of other retired cards', () => {
  const ws = wsWithNpcs(['a', 'b', 'c', 'd', 'e', 'f', 'g'], { window: 3 });
  const retiredBefore = retiredIds(ws, 'npc'); // d,e,f,g

  promoteToActive(ws, 'npc', 'npc:g', 1);

  const retiredAfter = retiredIds(ws, 'npc');
  const survivors = retiredBefore.filter((id) => id !== 'npc:g');
  // every other retired card keeps its relative order among the retired set
  assert.deepEqual(
    retiredAfter.filter((id) => survivors.includes(id)),
    survivors,
  );
});

test('a retired card stays known and recallable, not deleted', () => {
  const ws = wsWithNpcs(['a', 'b', 'c', 'd'], { window: 3 });
  assert.equal(activityOf(ws, 'npc:d'), 'retired');
  assert.ok(ws.cards['npc:d'], 'retired card is still stored');
  assert.equal(ordinalRank(ws, 'npc:d'), 4, 'retired card still has a rank');
});

// T17 — pinned cards cannot be displaced by Archivist promotion
test('T17 promotion that would displace a pinned card is rejected', () => {
  const ws = wsWithNpcs(['a', 'b', 'c', 'd'], { window: 3 });
  ws.cards['npc:c'].pinned = true;

  assert.throws(
    () => promoteToActive(ws, 'npc', 'npc:d', 1),
    OrderingError,
    'displacing pinned c out of the window must throw',
  );
  // and the rejection must leave ordering untouched
  assert.deepEqual(ws.order.npc, ids(['a', 'b', 'c', 'd']));
});

test('T17b promotion that keeps the pinned card inside the window is allowed', () => {
  const ws = wsWithNpcs(['a', 'b', 'c', 'd'], { window: 3 });
  ws.cards['npc:a'].pinned = true;
  promoteToActive(ws, 'npc', 'npc:d', 3);
  assert.deepEqual(activeIds(ws, 'npc'), ids(['a', 'b', 'd']));
});

// T18 — user reorder is outside the Archivist rules
test('T18 user reorder may move a pinned card', () => {
  const ws = wsWithNpcs(['a', 'b', 'c', 'd'], { window: 3 });
  ws.cards['npc:c'].pinned = true;
  userReorder(ws, 'npc', 'npc:d', 1);
  assert.deepEqual(ws.order.npc, ids(['d', 'a', 'b', 'c']));
  assert.equal(activityOf(ws, 'npc:c'), 'retired');
});

test('promotion refuses an out-of-bounds active position', () => {
  const ws = wsWithNpcs(['a', 'b', 'c', 'd'], { window: 3 });
  assert.throws(() => promoteToActive(ws, 'npc', 'npc:d', 0), OrderingError);
  assert.throws(() => promoteToActive(ws, 'npc', 'npc:d', 4), OrderingError);
});

test('promotion refuses an unconfirmed card', () => {
  const ws = wsWithNpcs(['a', 'b', 'c'], { window: 3 });
  ws.cards['npc:c'].review_state = 'unconfirmed';
  assert.throws(
    () => promoteToActive(ws, 'npc', 'npc:c', 1),
    OrderingError,
    'unconfirmed cards are excluded from ambient projection',
  );
});

test('promoting an already-active card to a new position is a plain move', () => {
  const ws = wsWithNpcs(['a', 'b', 'c', 'd'], { window: 3 });
  promoteToActive(ws, 'npc', 'npc:c', 1);
  assert.deepEqual(ws.order.npc, ids(['c', 'a', 'b', 'd']));
});
