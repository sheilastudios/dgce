import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorkspace } from '../extension/core/workspace.js';
import {
  checkOrigination,
  mentionContext,
  shingles,
  overlapRatio,
  REASON_CONFIRMATION_WITHHELD,
} from '../extension/core/origination.js';

const ws = () => createWorkspace({ workspace_id: 't' });

const MODEL_TURN =
  'The washing machine groaned again as Samira leaned against the doorframe, ' +
  'watching Joe with the particular patience of someone who has all the time in the world.';

// T50 — copied model text inside a user turn does not confirm
test('T50 a user turn that repeats recent model text does not confirm the entity', () => {
  const out = checkOrigination(ws(), {
    userTurnText: MODEL_TURN,
    term: 'Samira',
    recentModelTurns: [MODEL_TURN],
  });

  assert.equal(out.originated, false);
  assert.equal(out.reason_code, REASON_CONFIRMATION_WITHHELD);
  assert.ok(out.overlap >= 0.6);
});

test('T50b lightly edited paste is still caught', () => {
  const edited =
    'The washing machine groaned again as Samira leaned against the doorframe, ' +
    'watching Joe with the particular patience of someone who has all the time in the world. ' +
    'I sighed.';

  const out = checkOrigination(ws(), {
    userTurnText: edited,
    term: 'Samira',
    recentModelTurns: [MODEL_TURN],
  });
  assert.equal(out.originated, false);
});

// T51 — genuinely user-originated mention still confirms
test('T51 a genuinely new user-authored mention is treated as originated', () => {
  const out = checkOrigination(ws(), {
    userTurnText: 'I ask Samira whether she has ever regretted a wish.',
    term: 'Samira',
    recentModelTurns: [MODEL_TURN],
  });

  assert.equal(out.originated, true);
  assert.ok(out.overlap < 0.6);
});

test('an empty model history cannot withhold confirmation', () => {
  const out = checkOrigination(ws(), {
    userTurnText: 'Samira laughs.',
    term: 'Samira',
    recentModelTurns: [],
  });
  assert.equal(out.originated, true);
});

test('only the configured comparison window is examined', () => {
  const w = ws();
  w.settings.origination_compare_window = 2;

  const out = checkOrigination(w, {
    userTurnText: MODEL_TURN,
    term: 'Samira',
    // the matching turn sits outside the window of 2
    recentModelTurns: ['unrelated one', 'unrelated two', MODEL_TURN],
  });
  assert.equal(out.originated, true, 'a turn outside the window is not compared');
});

test('the comparison is scoped to the sentence containing the mention', () => {
  const context = mentionContext(
    'Joe went to the depot. Samira waited by the window. The kettle boiled.',
    'Samira',
  );
  assert.equal(context, 'Samira waited by the window.');
});

test('the check compares text, not merely the entity name', () => {
  // The name appears in both, but nothing else does. Name-only comparison
  // would wrongly withhold here.
  const out = checkOrigination(ws(), {
    userTurnText: 'Samira, I want to take back the third wish.',
    term: 'Samira',
    recentModelTurns: ['Samira tilted her head, amused by the request.'],
  });
  assert.equal(out.originated, true);
});

test('short mentions degrade to whole-phrase comparison rather than empty shingles', () => {
  const s = shingles('Samira waited', 5);
  assert.equal(s.size, 1, 'text shorter than the shingle size yields one whole-phrase shingle');
  assert.ok(s.has('samira waited'));
});

test('overlapRatio is a fraction of the left-hand set', () => {
  const a = new Set(['x', 'y', 'z', 'w']);
  const b = new Set(['x', 'y']);
  assert.equal(overlapRatio(a, b), 0.5);
  assert.equal(overlapRatio(new Set(), b), 0);
});

test('CJK near-copies retain overlap after a tiny unspaced lexical edit', () => {
  for (const [model, edited, term] of [
    ['彼は静かに扉を開けた。', '彼は静かにドアを開けた。', '彼'],
    ['林站在窗边等待远方传来的脚步声。', '林站在窗边等待远处传来的脚步声。', '林'],
  ]) assert.equal(checkOrigination(ws(), { userTurnText: edited, term, recentModelTurns: [model] }).originated, false);
});
test('unrelated CJK mention still passes; sentence scope respects full-width punctuation', () => {
  assert.equal(checkOrigination(ws(), { userTurnText: '林决定明天乘船离开这座城市。', term: '林',
    recentModelTurns: ['林站在窗边等待远方传来的脚步声。'] }).originated, true);
  assert.equal(mentionContext('雨停了。林决定离开。门关上了。', '林'), '林决定离开。');
});
