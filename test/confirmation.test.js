import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorkspace, createCard } from '../extension/core/workspace.js';
import { appendConfirmed, activityOf } from '../extension/core/ordering.js';
import {
  confirmByUser,
  unconfirmByUser,
  considerUserTurn,
  confirmByNativeHostEntity,
  REASON_AMBIGUOUS,
} from '../extension/core/confirmation.js';
import { REASON_CONFIRMATION_WITHHELD } from '../extension/core/origination.js';

function build({ turn = 60 } = {}) {
  const w = createWorkspace({ workspace_id: 't', settings: { npc_active_window: 3 } });
  w.current_turn = turn;
  const add = (name, { state = 'unconfirmed', aliases = [] } = {}) => {
    const id = `npc:${name.toLowerCase()}`;
    w.cards[id] = createCard({
      id,
      kind: 'npc',
      name_or_title: name,
      aliases,
      review_state: state,
    });
    if (state === 'confirmed') appendConfirmed(w, 'npc', id);
    else w.unconfirmed.npc.push(id);
    return id;
  };
  return { w, add };
}

const MODEL_TURN =
  'Samira tilted her head, amused. "You could wish for anything," she said, ' +
  'watching Joe fumble with the words like a man handling something fragile.';

// T25
test('T25 explicit user confirmation confirms', () => {
  const { w, add } = build();
  const id = add('Samira');
  confirmByUser(w, id);

  assert.equal(w.cards[id].review_state, 'confirmed');
  assert.equal(activityOf(w, id), 'active');
  assert.ok(!w.unconfirmed.npc.includes(id));
});

test('confirmation grants membership, not rank', () => {
  const { w, add } = build();
  add('A', { state: 'confirmed' });
  add('B', { state: 'confirmed' });
  const id = add('Samira');

  confirmByUser(w, id);
  assert.equal(w.order.npc.indexOf(id), 2, 'joins the bottom of the confirmed list');
});

test('a user may unconfirm again', () => {
  const { w, add } = build();
  const id = add('Samira');
  confirmByUser(w, id);
  unconfirmByUser(w, id);
  assert.equal(w.cards[id].review_state, 'unconfirmed');
  assert.ok(!w.order.npc.includes(id));
  assert.ok(w.unconfirmed.npc.includes(id));
});

// T26 / T51 — a genuinely user-originated later reference confirms
test('T26 a distinct user-authored reference confirms an unambiguous candidate', () => {
  const { w, add } = build();
  const id = add('Samira');

  const out = considerUserTurn(w, {
    userTurnText: 'I ask Samira whether she has ever regretted a wish.',
    recentModelTurns: [MODEL_TURN],
  });

  assert.deepEqual(out.confirmed, [id]);
  assert.equal(w.cards[id].review_state, 'confirmed');
});

// T50 wired end to end — this is the seam C-A exists to close
test('T50 pasted model text in a user turn does NOT confirm', () => {
  const { w, add } = build();
  const id = add('Samira');

  const out = considerUserTurn(w, {
    userTurnText: MODEL_TURN,
    recentModelTurns: [MODEL_TURN],
  });

  assert.deepEqual(out.confirmed, []);
  assert.equal(w.cards[id].review_state, 'unconfirmed', 'the guard held');
  assert.equal(out.withheld[0].reason_code, REASON_CONFIRMATION_WITHHELD);
});

// T52 — withheld confirmation still surfaces, as a signal
test('T52 a withheld confirmation records a review signal with a reason code', () => {
  const { w, add } = build();
  const id = add('Samira');

  considerUserTurn(w, { userTurnText: MODEL_TURN, recentModelTurns: [MODEL_TURN] });

  const signal = w.cards[id].review_signals[0];
  assert.equal(signal.reason_code, REASON_CONFIRMATION_WITHHELD);
  assert.equal(signal.turn, 60);
  assert.match(signal.detail, /overlap/, 'the human-readable part is derived, not model-authored');
});

test('T52b an ambiguous user reference confirms nothing', () => {
  const { w, add } = build();
  // Two genuinely distinct cards that share an identifying term — the exact
  // long-campaign case where a surname collides.
  const a = add('Elena Reyes', { aliases: ['Reyes'] });
  const b = add('Marco Reyes', { aliases: ['Reyes'] });

  const out = considerUserTurn(w, {
    userTurnText: 'I go looking for Reyes at the depot.',
    recentModelTurns: [],
  });

  assert.deepEqual(out.confirmed, [], 'neither card is picked');
  assert.equal(out.withheld.length, 2);
  assert.ok(out.withheld.every((x) => x.reason_code === REASON_AMBIGUOUS));
  assert.equal(w.cards[a].review_state, 'unconfirmed');
  assert.equal(w.cards[b].review_state, 'unconfirmed');
});

test('a collision with an already-confirmed card also blocks confirmation', () => {
  const { w, add } = build();
  // An unconfirmed candidate whose name collides with an established entity
  // must not ride in on a mention that plausibly meant the other one.
  add('Reyes', { state: 'confirmed' });
  const ghost = add('Reyes the younger', { aliases: ['Reyes'] });

  const out = considerUserTurn(w, {
    userTurnText: 'Reyes is waiting outside.',
    recentModelTurns: [],
  });

  assert.deepEqual(out.confirmed, []);
  assert.equal(w.cards[ghost].review_state, 'unconfirmed');
});

test('an unmentioned candidate is left alone entirely', () => {
  const { w, add } = build();
  const id = add('Samira');
  const out = considerUserTurn(w, {
    userTurnText: 'I go to the kitchen and make coffee.',
    recentModelTurns: [],
  });
  assert.deepEqual(out.confirmed, []);
  assert.deepEqual(out.withheld, []);
  assert.deepEqual(w.cards[id].review_signals, [], 'no signal for a card nobody mentioned');
});

test('an alias mention can confirm the card it uniquely identifies', () => {
  const { w, add } = build();
  const id = add('Samira', { aliases: ['the genie'] });

  const out = considerUserTurn(w, {
    userTurnText: 'I decide to trust the genie, against my better judgement.',
    recentModelTurns: [],
  });
  assert.deepEqual(out.confirmed, [id]);
});

// T27
test('T27 native-host confirmation stays disabled until recon proves the seam', () => {
  assert.throws(confirmByNativeHostEntity, /disabled/);
});
