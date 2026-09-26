import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorkspace, createCard } from '../extension/core/workspace.js';
import { appendConfirmed } from '../extension/core/ordering.js';
import { rebuildAliasIndex } from '../extension/core/aliases.js';
import { touchOnRecall, supportCard } from '../extension/core/freshness.js';
import { applyArchivistRun } from '../extension/core/apply.js';
import {
  buildArchivistView,
  describeCard,
  recentMovement,
  budgetStatement,
  stageForNextTurn,
} from '../extension/core/archivist-input.js';

function build({ turn = 200, window = 2 } = {}) {
  const w = createWorkspace({
    workspace_id: 't',
    settings: { npc_active_window: window, location_active_window: window, event_active_window: window },
  });
  w.current_turn = turn;
  const add = (id, kind, name, extra = {}) => {
    w.cards[id] = createCard({ id, kind, name_or_title: name, review_state: 'confirmed', ...extra });
    if ((extra.review_state ?? 'confirmed') === 'confirmed') appendConfirmed(w, kind, id);
    else w.unconfirmed[kind].push(id);
    return id;
  };
  return { w, add };
}

// --- the structure that makes wide-scope ranking sound ---------------------

test('a card is described relationally, with links resolved to names', () => {
  const { w, add } = build();
  add('evt:inspection', 'event', 'Hartwell inspection problem');
  add('loc:hartwell', 'location', 'Hartwell');
  add('npc:tomas', 'npc', 'Tomas', {
    summary: 'engineer; direct under pressure',
    link_ids: ['evt:inspection', 'loc:hartwell'],
  });
  supportCard(w, 'npc:tomas');

  const line = describeCard(w, 'npc:tomas');
  assert.match(line, /Tomas/);
  assert.match(line, /Hartwell inspection problem \[event\]/, 'links are names, not ids');
  assert.match(line, /Hartwell \[location\]/);
  assert.ok(!/evt:inspection/.test(line), 'raw ids tell the model nothing it can reason with');
  assert.match(line, /last supported turn 200 of 200/);
});

test('an unresolvable link degrades to the id rather than throwing', () => {
  const { w, add } = build();
  add('npc:tomas', 'npc', 'Tomas', { link_ids: ['loc:gone'] });
  assert.match(describeCard(w, 'npc:tomas'), /loc:gone/);
});

test('maintenance exposes exact IDs without recent movement or changing RP card projection', () => {
  const { w, add } = build({ window: 1 });
  add('loc:archive-9', 'location', 'Archive');
  add('npc:active-7', 'npc', 'Reader', { link_ids: ['loc:archive-9'] });
  add('npc:retired-8', 'npc', 'Reader');
  add('npc:candidate-6', 'npc', 'Reader', { review_state: 'unconfirmed' });
  const before = JSON.stringify(w);
  assert.deepEqual(recentMovement(w, w.current_turn), []);
  const { text } = buildArchivistView(w, { sinceTurn: w.current_turn });
  for (const id of ['loc:archive-9', 'npc:active-7', 'npc:retired-8', 'npc:candidate-6']) {
    assert.ok(text.includes(`(id: ${id})`), 'IDs cannot be derived safely from identical display names');
  }
  assert.match(text, /→ Archive \[location\] \(id: loc:archive-9\)/);
  assert.doesNotMatch(describeCard(w, 'npc:active-7', { includeLinks: false }), /id:|npc:active-7/);
  assert.equal(JSON.stringify(w), before);
});

test('recent movement reports what changed and why', () => {
  const { w, add } = build();
  add('npc:a', 'npc', 'A');
  add('npc:b', 'npc', 'B');
  add('npc:c', 'npc', 'C');

  w.current_turn = 190;
  touchOnRecall(w, 'npc:a');       // read
  w.current_turn = 195;
  supportCard(w, 'npc:b');          // revised
  w.current_turn = 200;

  const moved = recentMovement(w, 180);
  const byId = Object.fromEntries(moved.map((m) => [m.id, m.why]));
  assert.equal(byId['npc:a'], 'recalled');
  assert.equal(byId['npc:b'], 'revised or edited');
  assert.ok(!('npc:c' in byId), 'untouched cards are not reported as movement');
});

test('the view separates active, retired and unconfirmed', () => {
  const { w, add } = build({ window: 1 });
  add('npc:keep', 'npc', 'Keep');
  add('npc:retired', 'npc', 'Retired One');
  add('npc:candidate', 'npc', 'Candidate', { review_state: 'unconfirmed' });
  rebuildAliasIndex(w);

  const { text } = buildArchivistView(w);
  assert.match(text, /active \(projected into the story right now\)/);
  assert.match(text, /retired \(known and recallable, costing nothing\)/);
  assert.match(text, /unconfirmed \(candidates — you may NOT confirm these\)/);
  assert.match(text, /Retired One/, 'retired cards are supplied, not hidden');
});

// --- the rank scope corollary, enforced rather than hoped for -------------

test('rankable covers confirmed cards, active and retired alike', () => {
  const { w, add } = build({ window: 1 });
  add('npc:keep', 'npc', 'Keep');
  add('npc:retired', 'npc', 'Retired One');

  const { rankable } = buildArchivistView(w);
  assert.ok(rankable.has('npc:keep'));
  assert.ok(rankable.has('npc:retired'), 'wide scope is the point');
});

test('unconfirmed cards are supplied but never rankable', () => {
  const { w, add } = build();
  add('npc:candidate', 'npc', 'Candidate', { review_state: 'unconfirmed' });

  const { text, rankable } = buildArchivistView(w);
  assert.match(text, /Candidate/, 'visible for maintenance');
  assert.ok(!rankable.has('npc:candidate'), 'promotion means ambient projection');
});

test('a promotion for a card outside the supplied context rejects the run', () => {
  const { w, add } = build({ window: 2 });
  add('npc:a', 'npc', 'A');
  add('npc:b', 'npc', 'B');
  const { rankable } = buildArchivistView(w);

  // a card that exists locally but was NOT part of this run's view
  w.cards['npc:ghost'] = createCard({
    id: 'npc:ghost',
    kind: 'npc',
    name_or_title: 'Ghost',
    review_state: 'confirmed',
  });
  appendConfirmed(w, 'npc', 'npc:ghost');

  const payload = JSON.stringify({
    schema_version: 1,
    run_id: 'r1',
    operations: [{ op: 'PROMOTE_TO_ACTIVE', kind: 'npc', id: 'npc:ghost', active_position: 1 }],
  });

  const out = applyArchivistRun(w, payload, { outstandingRunId: 'r1', rankable });
  assert.equal(out.status, 'rejected');
  assert.match(out.errors.join(' '), /was not supplied in this run's context/);
});

test('a promotion within the supplied context is accepted', () => {
  const { w, add } = build({ window: 2 });
  add('npc:a', 'npc', 'A');
  add('npc:b', 'npc', 'B');
  add('npc:c', 'npc', 'C');
  const { rankable } = buildArchivistView(w);

  const payload = JSON.stringify({
    schema_version: 1,
    run_id: 'r1',
    operations: [{ op: 'PROMOTE_TO_ACTIVE', kind: 'npc', id: 'npc:c', active_position: 1 }],
  });

  const out = applyArchivistRun(w, payload, { outstandingRunId: 'r1', rankable });
  assert.equal(out.status, 'applied');
  assert.equal(out.workspace.order.npc[0], 'npc:c');
});

test('budgets are handed over as data, not left to be inferred', () => {
  const { w } = build();
  const b = budgetStatement(w);
  assert.equal(b.max_promotions_this_run, 2);
  assert.equal(b.max_automatic_merges_this_run, 1);
  assert.equal(b.unconfirmed_cards_may_be_promoted, false);
  assert.equal(b.active_windows.npc, 2);
});

// --- §9 staging: relevance-keyed retrieval --------------------------------

test('a card matching nothing in the recent story is not sent', () => {
  const { w, add } = build({ window: 5 });
  add('npc:a', 'npc', 'Alice', { summary: 'first' });
  add('npc:b', 'npc', 'Bram', { summary: 'second' });

  // Rank alone used to ship the top of the list every turn regardless of who
  // was in the room. Capacity is meant to grow without per-turn cost growing.
  //
  //   law: unmatched => unsent
  const { staged, considered, matched } = stageForNextTurn(w, {
    recentText: 'The corridor was empty and the lights buzzed.',
  });
  assert.deepEqual(staged, []);
  assert.equal(considered, 2);
  assert.equal(matched, 0);
});

test('a card named in the recent story is sent', () => {
  const { w, add } = build({ window: 5 });
  add('npc:alice', 'npc', 'Alice', { summary: 'first' });
  add('npc:bram', 'npc', 'Bram', { summary: 'second' });

  const { staged, why } = stageForNextTurn(w, {
    recentText: 'Alice pushed the door open without knocking.',
  });
  assert.deepEqual(staged, ['npc:alice']);
  assert.match(why['npc:alice'].join(' '), /named: alice/);
});

test('an alias counts as being named', () => {
  const { w, add } = build({ window: 5 });
  add('npc:samira', 'npc', 'Samira', { summary: 'a genie', aliases: ['the genie'] });
  const { staged } = stageForNextTurn(w, { recentText: 'He looked at the genie for a long moment.' });
  assert.deepEqual(staged, ['npc:samira']);
});

test('a misspelt name still matches, weakly', () => {
  const { w, add } = build({ window: 5 });
  add('npc:samira', 'npc', 'Samira', { summary: 'a genie' });
  const { staged, why } = stageForNextTurn(w, { recentText: 'Samria tilted her head.' });
  assert.deepEqual(staged, ['npc:samira']);
  assert.match(why['npc:samira'].join(' '), /fuzzy/);
});

test('no kind is starved by the id tiebreak', () => {
  // ordinalRank is per-kind, so the #1 npc, #1 location and #1 event all tie.
  // The old id tiebreak resolved that alphabetically — evt: then loc: then
  // npc: — so NPCs never shipped at all.
  //
  //   law: per_kind_rank != cross_kind_order
  const { w, add } = build({ window: 5 });
  add('npc:tomas', 'npc', 'Tomas', { summary: 'x' });
  add('loc:depot', 'location', 'Depot', { summary: 'x' });
  add('evt:storm', 'event', 'Storm', { summary: 'x' });

  const { staged } = stageForNextTurn(w, {
    recentText: 'Tomas walked into the Depot as the Storm broke.',
    budgetTokens: 1000,
  });
  assert.equal(staged.length, 3);
  assert.equal(new Set(staged.map((id) => id.split(':')[0])).size, 3, 'all three kinds present');
});

test('a recalled retired card rides along without being named', () => {
  const { w, add } = build({ window: 1 });
  add('npc:active', 'npc', 'Active');
  add('npc:old', 'npc', 'Old Friend');
  touchOnRecall(w, 'npc:old');

  const { staged } = stageForNextTurn(w, { recentText: 'Nothing relevant here.' });
  assert.ok(staged.includes('npc:old'), 'recall is a relevance signal on its own');
});

test('the ambient floor forces top-ranked cards through when asked', () => {
  const { w, add } = build({ window: 5 });
  add('npc:a', 'npc', 'Alice');
  add('npc:b', 'npc', 'Bram');

  assert.deepEqual(stageForNextTurn(w, { recentText: 'unrelated' }).staged, []);
  const withFloor = stageForNextTurn(w, { recentText: 'unrelated', ambientFloor: 1 });
  assert.deepEqual(withFloor.staged, ['npc:a'], 'the top-ranked card of each kind');
});

test('a prediction is a boost, never a filter', () => {
  const { w, add } = build({ window: 5 });
  add('npc:alice', 'npc', 'Alice');
  add('npc:bram', 'npc', 'Bram');

  const { staged } = stageForNextTurn(w, {
    recentText: 'Alice pushed the door open.',
    predictedIds: ['npc:bram'],
    budgetTokens: 1000,
  });
  assert.ok(staged.includes('npc:alice'), 'what is actually present still ships');
  assert.ok(staged.includes('npc:bram'), 'and the prediction is added');
});

test('a prediction naming a card that does not exist is ignored safely', () => {
  const { w, add } = build({ window: 5 });
  add('npc:alice', 'npc', 'Alice');
  const { staged } = stageForNextTurn(w, {
    recentText: 'Alice arrived.',
    predictedIds: ['npc:nonexistent'],
  });
  assert.deepEqual(staged, ['npc:alice']);
});

test('staging respects its budget and skips rather than stops', () => {
  const { w, add } = build({ window: 5 });
  add('npc:huge', 'npc', 'Huge', { summary: 'x'.repeat(2000) });
  add('npc:small1', 'npc', 'Small One', { summary: 'brief' });
  add('npc:small2', 'npc', 'Small Two', { summary: 'brief' });

  const { staged, estimated_tokens, budget } = stageForNextTurn(w, {
    recentText: 'Huge and Small One and Small Two were all present.',
    budgetTokens: 120,
  });
  assert.ok(estimated_tokens <= budget);
  assert.ok(!staged.includes('npc:huge'), 'the oversized card is skipped');
  assert.ok(staged.includes('npc:small1') && staged.includes('npc:small2'));
});

test('staging is deterministic', () => {
  const { w, add } = build({ window: 5 });
  add('npc:a', 'npc', 'Alice');
  add('npc:b', 'npc', 'Bram');
  const text = 'Alice and Bram argued.';
  assert.deepEqual(
    stageForNextTurn(w, { recentText: text }).staged,
    stageForNextTurn(w, { recentText: text }).staged,
  );
});
