import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorkspace, createCard, ordinalRank } from '../extension/core/workspace.js';
import { makeCardId } from '../extension/core/ids.js';
import { appendConfirmed } from '../extension/core/ordering.js';
import { rebuildAliasIndex, lookupTerm, resolveRedirect } from '../extension/core/aliases.js';
import {
  mergeCards,
  checkMergeLegality,
  checkAutoMergePolicy,
  MergeError,
} from '../extension/core/merge.js';

function ws(cards, { window = 3 } = {}) {
  const w = createWorkspace({ workspace_id: 't', settings: { npc_active_window: window } });
  for (const spec of cards) {
    const id = makeCardId('npc', spec.name);
    w.cards[id] = createCard({
      id,
      kind: 'npc',
      name_or_title: spec.name,
      summary: spec.summary ?? '',
      aliases: spec.aliases ?? [],
      link_ids: spec.link_ids ?? [],
      review_state: spec.review_state ?? 'confirmed',
      pinned: spec.pinned ?? false,
    });
    if ((spec.review_state ?? 'confirmed') === 'confirmed') appendConfirmed(w, 'npc', id);
    else w.unconfirmed.npc.push(id);
  }
  rebuildAliasIndex(w);
  return w;
}

// T42 — canonical below absorbed inherits the absorbed card's better position
test('T42 merge inherits the better of the two ordinal positions', () => {
  const w = ws([{ name: 'a' }, { name: 'b' }, { name: 'reyes' }, { name: 'd' }, { name: 'r' }]);
  // absorbed npc:reyes is at 3, canonical npc:r is at 5
  mergeCards(w, 'npc:reyes', 'npc:r');
  assert.equal(ordinalRank(w, 'npc:r'), 3, 'survivor takes min(3,5)');
  assert.deepEqual(w.order.npc, ['npc:a', 'npc:b', 'npc:r', 'npc:d']);
});

// T64 — merge is not a promotion channel
test('T64 merge never yields a position better than either operand held', () => {
  const w = ws([{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }, { name: 'e' }]);
  const before = { d: ordinalRank(w, 'npc:d'), e: ordinalRank(w, 'npc:e') };
  mergeCards(w, 'npc:e', 'npc:d');
  assert.equal(ordinalRank(w, 'npc:d'), Math.min(before.d, before.e));
  assert.ok(ordinalRank(w, 'npc:d') >= Math.min(before.d, before.e));
});

// T43 — absorbed pinned, canonical unpinned => canonical pinned
test('T43 merge OR-preserves the pin', () => {
  const w = ws([{ name: 'canon' }, { name: 'dupe', pinned: true }]);
  mergeCards(w, 'npc:dupe', 'npc:canon');
  assert.equal(w.cards['npc:canon'].pinned, true, 'user protection is never destroyed');
});

// T44 — mutually linked merge produces no self-link
test('T44 merging mutually linked cards leaves no self-link', () => {
  const w = ws([
    { name: 'canon', link_ids: ['npc:dupe', 'loc:hartwell'] },
    { name: 'dupe', link_ids: ['npc:canon', 'evt:storm'] },
  ]);
  mergeCards(w, 'npc:dupe', 'npc:canon');
  const links = w.cards['npc:canon'].link_ids;
  assert.ok(!links.includes('npc:canon'), 'no self-link survives');
  assert.ok(!links.includes('npc:dupe'), 'absorbed id is gone from links');
  assert.deepEqual([...links].sort(), ['evt:storm', 'loc:hartwell']);
});

// T45 — confirmed absorbed + unconfirmed canonical => merged canonical confirmed
test('T45 confirmed absorbed upgrades an unconfirmed canonical', () => {
  const w = ws([{ name: 'dupe' }, { name: 'canon', review_state: 'unconfirmed' }]);
  mergeCards(w, 'npc:dupe', 'npc:canon');
  assert.equal(w.cards['npc:canon'].review_state, 'confirmed');
  assert.ok(w.order.npc.includes('npc:canon'), 'survivor is ranked once confirmed');
  assert.ok(!w.unconfirmed.npc.includes('npc:canon'));
});

// T20 / T21 — aliases and old-id resolution survive
test('T20 merge preserves absorbed name and aliases', () => {
  const w = ws([
    { name: 'Reyes', aliases: ['the inspector'] },
    { name: 'R. Reyes', aliases: ['inspector reyes'] },
  ]);
  mergeCards(w, 'npc:r_reyes', 'npc:reyes');
  const survivor = w.cards['npc:reyes'];
  const norm = survivor.aliases.map((a) => a.toLowerCase());
  assert.ok(norm.includes('r. reyes'), 'absorbed canonical name becomes an alias');
  assert.ok(norm.includes('inspector reyes'), 'absorbed aliases carried over');
  assert.ok(norm.includes('the inspector'), 'existing aliases retained');
});

test('T21 the old absorbed id still resolves after merge', () => {
  const w = ws([{ name: 'canon' }, { name: 'dupe' }]);
  mergeCards(w, 'npc:dupe', 'npc:canon');
  assert.equal(resolveRedirect(w, 'npc:dupe'), 'npc:canon');
  assert.deepEqual(lookupTerm(w, 'npc:dupe'), { status: 'alias-of', ids: ['npc:canon'] });
});

// T22 — no dangling references anywhere
test('T22 merge rewires links on unrelated cards and leaves nothing dangling', () => {
  const w = ws([
    { name: 'canon' },
    { name: 'dupe' },
    { name: 'witness', link_ids: ['npc:dupe'] },
  ]);
  mergeCards(w, 'npc:dupe', 'npc:canon');
  assert.deepEqual(w.cards['npc:witness'].link_ids, ['npc:canon']);
  for (const card of Object.values(w.cards)) {
    assert.ok(!card.link_ids.includes('npc:dupe'), `${card.id} still points at the absorbed id`);
  }
});

// --- C-D legality (T63) ---------------------------------------------------

test('T63 illegal merges are refused with a reason', () => {
  const w = ws([{ name: 'a' }, { name: 'b' }]);
  w.cards['loc:place'] = createCard({
    id: 'loc:place',
    kind: 'location',
    name_or_title: 'place',
    review_state: 'confirmed',
  });

  assert.equal(checkMergeLegality(w, 'npc:a', 'npc:a').reason, 'self_merge');
  assert.equal(checkMergeLegality(w, 'npc:a', 'loc:place').reason, 'kind_mismatch');
  assert.match(checkMergeLegality(w, 'npc:ghost', 'npc:a').reason, /does_not_resolve/);

  mergeCards(w, 'npc:b', 'npc:a');
  assert.match(
    checkMergeLegality(w, 'npc:b', 'npc:a').reason,
    /does_not_resolve|already_absorbed/,
    'an already-absorbed operand is refused',
  );
});

test('T63b applying an illegal merge throws rather than corrupting identity', () => {
  const w = ws([{ name: 'a' }]);
  assert.throws(() => mergeCards(w, 'npc:a', 'npc:a'), MergeError);
});

test('a redirect cycle is refused', () => {
  const w = ws([{ name: 'a' }, { name: 'b' }, { name: 'c' }]);
  mergeCards(w, 'npc:b', 'npc:a'); // b -> a
  // now try to merge a into b: b already resolves to a, so this would cycle
  assert.equal(checkMergeLegality(w, 'npc:a', 'npc:b').legal, false);
});

// --- C-D policy (T61, T62) ------------------------------------------------

test('T61 confirmed<->confirmed automatic merge is refused as proposal-only', () => {
  const w = ws([{ name: 'a' }, { name: 'b' }]);
  const policy = checkAutoMergePolicy(w, 'npc:b', 'npc:a');
  assert.equal(policy.allowed, false);
  assert.equal(policy.reason, 'confirmed_to_confirmed_requires_user_confirmation');
});

test('T61b unconfirmed into confirmed is allowed automatically', () => {
  const w = ws([{ name: 'a' }, { name: 'b', review_state: 'unconfirmed' }]);
  assert.equal(checkAutoMergePolicy(w, 'npc:b', 'npc:a').allowed, true);
});

test('T62 automatic merges obey the per-run cap', () => {
  const w = ws([{ name: 'a' }, { name: 'b', review_state: 'unconfirmed' }]);
  assert.equal(w.settings.automatic_merge_limit_per_run, 1);
  const policy = checkAutoMergePolicy(w, 'npc:b', 'npc:a', { autoMergesUsed: 1 });
  assert.equal(policy.allowed, false);
  assert.match(policy.reason, /automatic_merge_limit_exceeded/);
});

test('legality and policy are separate questions', () => {
  // A confirmed<->confirmed merge is perfectly LEGAL — the user may do it.
  // It is only the unattended Archivist path that is refused.
  const w = ws([{ name: 'a' }, { name: 'b' }]);
  assert.equal(checkMergeLegality(w, 'npc:b', 'npc:a').legal, true);
  assert.equal(checkAutoMergePolicy(w, 'npc:b', 'npc:a').allowed, false);
});
