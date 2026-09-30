import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorkspace } from '../extension/core/workspace.js';
import {
  createDeck,
  setMode,
  addCards,
  removeCard,
  setAnchored,
  drawCard,
  drawLine,
  needsReplenish,
  replenishTarget,
  replenishBrief,
  proposeCards,
  acceptPending,
  rejectPending,
  trimWithAnchorProtection,
  isEnabled,
  IGNORE_LICENSE,
  DeckError,
} from '../extension/core/deck.js';

/** Deterministic 32-bit source, so draws are reproducible. */
const seq = (...values) => {
  let i = 0;
  return () => values[i++ % values.length];
};

const stocked = (texts, opts = {}) => {
  const d = createDeck({ mode: 'manual', ...opts });
  addCards(d, texts);
  return d;
};

// --- the three load-bearing properties ------------------------------------

test('a drawn card is CONSUMED, so it can never recur', () => {
  const d = stocked(['a', 'b', 'c']);
  const first = drawCard(d, seq(0));
  assert.equal(d.cards.length, 2);
  assert.ok(!d.cards.some((c) => c.text === first.text), 'the drawn card left the pool');

  // drain the rest; nothing repeats
  const seen = [first.text];
  while (d.cards.length) seen.push(drawCard(d, seq(0)).text);
  assert.deepEqual([...seen].sort(), ['a', 'b', 'c']);
});

test('the drawn line carries the ignore-license', () => {
  const d = stocked(['Her phone buzzes.']);
  drawCard(d, seq(0));
  const line = drawLine(d);
  assert.match(line, /Her phone buzzes\./);
  assert.match(line, /Otherwise ignore it completely/);
  assert.ok(line.includes(IGNORE_LICENSE));
});

test('drawing from an empty deck is a normal state, not an error', () => {
  const d = createDeck({ mode: 'manual' });
  assert.equal(drawCard(d, seq(0)), null);
  assert.equal(drawLine(d), null);
});

test('only the current draw is kept — no history accumulates', () => {
  const d = stocked(['a', 'b']);
  drawCard(d, seq(0));
  drawCard(d, seq(0));
  assert.equal(d.current_draw.text, 'b');
  const keys = Object.keys(d);
  assert.ok(!keys.some((k) => /history|drawn_cards|log/i.test(k)));
});

test('index selection is unbiased across the pool', () => {
  const counts = {};
  for (let i = 0; i < 3000; i += 1) {
    const d = stocked(['a', 'b', 'c', 'd', 'e', 'f', 'g']); // 7 — does not divide 2^32
    const card = drawCard(d);
    counts[card.text] = (counts[card.text] ?? 0) + 1;
  }
  const expected = 3000 / 7;
  for (const [text, n] of Object.entries(counts)) {
    const deviation = Math.abs(n - expected) / expected;
    assert.ok(deviation < 0.25, `card ${text} deviated ${(deviation * 100).toFixed(1)}%`);
  }
  assert.equal(Object.keys(counts).length, 7, 'every card is reachable');
});

// --- anchors: protected from eviction, NOT from consumption ---------------

test('an anchored card is still consumed when drawn', () => {
  const d = stocked(['keeper']);
  setAnchored(d, 'keeper', true);
  const drawn = drawCard(d, seq(0));
  assert.equal(drawn.text, 'keeper');
  assert.equal(d.cards.length, 0, 'anchoring protects from eviction, never from the draw');
});

test('an anchored card survives being pushed out by newer cards', () => {
  const d = createDeck({ mode: 'manual' });
  d.max_cards = 3;
  addCards(d, ['old']);
  setAnchored(d, 'old', true);
  addCards(d, ['n1', 'n2', 'n3', 'n4']);

  assert.equal(d.cards.length, 3);
  assert.ok(d.cards.some((c) => c.text === 'old'), 'the anchor held');
  assert.ok(d.cards.some((c) => c.text === 'n4'), 'newest non-anchors are kept');
  assert.ok(!d.cards.some((c) => c.text === 'n1'), 'oldest non-anchors are evicted');
});

test('the anchor limit is enforced', () => {
  const d = stocked(['a', 'b', 'c', 'd', 'e']);
  d.max_anchors = 2;
  setAnchored(d, 'a', true);
  setAnchored(d, 'b', true);
  assert.throws(() => setAnchored(d, 'c', true), DeckError);
  setAnchored(d, 'a', false);
  setAnchored(d, 'c', true); // a slot freed up
});

test('trimWithAnchorProtection keeps anchors and the newest of the rest', () => {
  const cards = [
    { text: 'anchor', anchored: true },
    { text: 'x1', anchored: false },
    { text: 'x2', anchored: false },
    { text: 'x3', anchored: false },
  ];
  const out = trimWithAnchorProtection(cards, 3).map((c) => c.text);
  assert.deepEqual(out, ['anchor', 'x2', 'x3']);
});

// --- pool hygiene ---------------------------------------------------------

test('duplicate cards do not enter the pool', () => {
  const d = stocked(['a', 'b']);
  addCards(d, ['b', 'c']);
  assert.deepEqual(d.cards.map((c) => c.text), ['a', 'b', 'c']);
});

test('blank cards are ignored', () => {
  const d = stocked(['a']);
  addCards(d, ['   ', '', 'b']);
  assert.deepEqual(d.cards.map((c) => c.text), ['a', 'b']);
});

test('a card can be removed by the user', () => {
  const d = stocked(['a', 'b']);
  removeCard(d, 'a');
  assert.deepEqual(d.cards.map((c) => c.text), ['b']);
});

// --- replenishment --------------------------------------------------------

test('replenish is requested at the low-water mark, not at empty', () => {
  const d = stocked(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  d.low_water = 6;

  assert.equal(d.cards.length, 7);
  assert.equal(needsReplenish(d), false, 'above the mark');

  drawCard(d, seq(0));
  assert.equal(d.cards.length, 6);
  assert.equal(needsReplenish(d), false, 'AT the mark is not yet below it');

  drawCard(d, seq(0));
  assert.equal(d.cards.length, 5);
  assert.equal(needsReplenish(d), true, 'below the mark, and still five cards from dry');
});

test('an off deck never asks to be replenished', () => {
  const d = createDeck({ mode: 'off' });
  assert.equal(isEnabled(d), false);
  assert.equal(needsReplenish(d), false);
});

test('the replenish brief asks for a mix, a world pulse, and excludes what is already held', () => {
  const d = stocked(['already here']);
  const brief = replenishBrief(d, {
    knownNames: ['Samira', 'Joe'],
    establishedActors: ['Sarah Lin: resident adviser'],
    genreProfile: { primary: ['Dating Sim'], tone: ['Psychological Drama'] },
    dynamicsProfile: ['Character architecture.attentionPartitioning: divided attention has costs'],
  });
  assert.equal(brief.wanted, replenishTarget(d));
  assert.deepEqual(brief.existing, ['already here']);
  assert.deepEqual(brief.known_entities, ['Samira', 'Joe']);
  assert.deepEqual(brief.established_actors, ['Sarah Lin: resident adviser']);
  assert.deepEqual(brief.genre_profile, {
    primary: ['Dating Sim'], tone: ['Psychological Drama'],
  });
  assert.deepEqual(brief.dynamics_profile, [
    'Character architecture.attentionPartitioning: divided attention has costs',
  ]);
  assert.equal(brief.world_pulse_count, 3);
  assert.match(brief.instruction, /Mix reusing established/, 'pure novelty is disconnected');
  assert.match(brief.instruction, /independent NPC, faction, or local activity/);
  assert.match(brief.instruction, /must not repeat an existing card/);
});

// --- the four modes -------------------------------------------------------

test('manual mode refuses Assistant proposals', () => {
  const d = stocked(['a']);
  assert.throws(() => proposeCards(d, ['proposed']), DeckError);
});

test('assisted_review queues proposals for approval', () => {
  const d = createDeck({ mode: 'assisted_review' });
  const out = proposeCards(d, ['one', 'two']);
  assert.deepEqual(out.queued, ['one', 'two']);
  assert.deepEqual(out.accepted, []);
  assert.equal(d.cards.length, 0, 'nothing enters the pool unreviewed');
  assert.equal(d.pending.length, 2);
});

test('assisted_auto admits proposals directly', () => {
  const d = createDeck({ mode: 'assisted_auto' });
  const out = proposeCards(d, ['one', 'two']);
  assert.deepEqual(out.accepted, ['one', 'two']);
  assert.equal(d.pending.length, 0);
  assert.deepEqual(d.cards.map((c) => c.text), ['one', 'two']);
});

test('a queued proposal can be accepted or rejected', () => {
  const d = createDeck({ mode: 'assisted_review' });
  proposeCards(d, ['keep', 'drop']);

  acceptPending(d, 'keep');
  rejectPending(d, 'drop');

  assert.deepEqual(d.cards.map((c) => c.text), ['keep']);
  assert.equal(d.pending.length, 0);
});

test('accepting something not in the queue is refused', () => {
  const d = createDeck({ mode: 'assisted_review' });
  assert.throws(() => acceptPending(d, 'ghost'), DeckError);
});

test('a proposal duplicating a held or queued card is dropped', () => {
  const d = createDeck({ mode: 'assisted_review' });
  addCards(d, ['held']);
  proposeCards(d, ['queued']);
  const out = proposeCards(d, ['held', 'queued', 'fresh']);
  assert.deepEqual(out.queued, ['fresh']);
});

test('an unknown mode is refused', () => {
  const d = createDeck();
  assert.throws(() => setMode(d, 'yolo'), DeckError);
  setMode(d, 'assisted_auto');
  assert.equal(d.mode, 'assisted_auto');
});

// --- integration ----------------------------------------------------------

test('a new workspace carries a deck, disabled by default', () => {
  const ws = createWorkspace({ workspace_id: 'w' });
  assert.equal(ws.deck.mode, 'off');
  assert.equal(ws.deck.cards.length, 0);
  assert.equal(isEnabled(ws.deck), false, 'opt-in, not opt-out');
});

// --- Assistant round-trip -------------------------------------------------

test('the replenish prompt asks for the marker, world motion, established cast, and held-card exclusion', async () => {
  const { renderReplenishPrompt } = await import('../extension/core/deck.js');
  const d = stocked(['The radiator knocks.'], { mode: 'assisted_review' });
  const prompt = renderReplenishPrompt(d, {
    knownNames: ['Chloe', 'Sam', 'Sarah Lin'],
    establishedActors: ['Sarah Lin: resident adviser and fellow student'],
    genreProfile: {
      primary: ['Dating Sim'],
      tone: ['Romantic Comedy / Psychological Drama Hybrid'],
      focus: ['Witty Banter', 'Character Depth'],
    },
    dynamicsProfile: [
      'Core experience.transitionAuthority: voluntary shifts are player-chosen; grounded events may pull attention',
      'Character architecture.attentionPartitioning: simultaneous presence is imperfect',
    ],
    sceneHint: 'creative writing class',
  });

  assert.match(prompt, /CARD: /, 'the marker we parse for is the marker we ask for');
  assert.match(prompt, /Mix reusing established/);
  assert.match(prompt, /The radiator knocks\./, 'existing cards are listed as do-not-repeat');
  assert.match(prompt, /Chloe, Sam/);
  assert.match(prompt, /Sarah Lin: resident adviser and fellow student/);
  assert.match(prompt, /independent off-screen developments/);
  assert.match(prompt, /does not revolve around the player/);
  assert.match(prompt, /force an arrival or interaction/);
  assert.match(prompt, /relationship change/);
  assert.match(prompt, /creative writing class/);
  assert.match(prompt, /Campaign genre profile/);
  assert.match(prompt, /Dating Sim/);
  assert.match(prompt, /Romantic Comedy \/ Psychological Drama Hybrid/);
  assert.match(prompt, /Witty Banter/);
  assert.match(prompt, /flavor lens/);
  assert.match(prompt, /does not authorize new canon/);
  assert.match(prompt, /Published world dynamics/);
  assert.match(prompt, /grounded events may pull attention/);
  assert.match(prompt, /Do not assume a clean scene switch or perfect multitasking/);
  assert.match(prompt, /Do not choose the player character's foreground attention/);
  assert.match(prompt, /card does not resolve that risk/);
});

test('the replenish prompt omits genre instructions when no published genre is available', async () => {
  const { renderReplenishPrompt } = await import('../extension/core/deck.js');
  const prompt = renderReplenishPrompt(createDeck({ mode: 'assisted_auto' }));
  assert.doesNotMatch(prompt, /Campaign genre profile/);
  assert.doesNotMatch(prompt, /Published world dynamics/);
});

test('world pulse count shrinks with a nearly full deck', () => {
  const d = createDeck({ mode: 'assisted_auto' });
  d.max_cards = 4;
  addCards(d, ['a', 'b', 'c']);
  const brief = replenishBrief(d);
  assert.equal(brief.wanted, 1);
  assert.equal(brief.world_pulse_count, 1);
});

test('marked lines parse, and surrounding prose is ignored', async () => {
  const { parseProposedCards } = await import('../extension/core/deck.js');
  const reply = [
    "Sure! Here are some ideas for your scene:",
    "",
    "CARD: The radiator starts knocking again.",
    'CARD: "Chloe\'s pen runs dry mid-sentence."',
    "CARD:   Someone\u2019s phone buzzes face-down on the desk.",
    "",
    "Let me know if you want more!",
  ].join('\n');

  assert.deepEqual(parseProposedCards(reply), [
    'The radiator starts knocking again.',
    "Chloe's pen runs dry mid-sentence.",
    'Someone\u2019s phone buzzes face-down on the desk.',
  ]);
});

test('bullets are the fallback when the marker is ignored', async () => {
  const { parseProposedCards } = await import('../extension/core/deck.js');
  const reply = '- The lights flicker.\n2. A chair scrapes.\n* Rain starts.';
  assert.deepEqual(parseProposedCards(reply), [
    'The lights flicker.',
    'A chair scrapes.',
    'Rain starts.',
  ]);
});

test('the marker wins when both forms are present', async () => {
  const { parseProposedCards } = await import('../extension/core/deck.js');
  const reply = 'Thinking:\n- some reasoning\n- more reasoning\n\nCARD: The real one.';
  assert.deepEqual(parseProposedCards(reply), ['The real one.']);
});

test('unformatted prose yields nothing rather than guesses', async () => {
  const { parseProposedCards } = await import('../extension/core/deck.js');
  const reply = 'I think a good chaos card would be the radiator knocking. Another might be rain.';
  assert.deepEqual(parseProposedCards(reply), [], 'leniency about shape is not licence to invent');
  assert.deepEqual(parseProposedCards(''), []);
  assert.deepEqual(parseProposedCards(null), []);
});

test('overlong lines are rejected as prose that leaked in', async () => {
  const { parseProposedCards } = await import('../extension/core/deck.js');
  const long = 'CARD: ' + 'x'.repeat(400);
  assert.deepEqual(parseProposedCards(`${long}\nCARD: Short one.`), ['Short one.']);
});

test('duplicates within one reply collapse', async () => {
  const { parseProposedCards } = await import('../extension/core/deck.js');
  const reply = 'CARD: Same thing.\nCARD: Same thing.\nCARD: Other thing.';
  assert.deepEqual(parseProposedCards(reply), ['Same thing.', 'Other thing.']);
});

test('parsed cards flow into the review queue end to end', async () => {
  const { parseProposedCards, proposeCards } = await import('../extension/core/deck.js');
  const d = createDeck({ mode: 'assisted_review' });
  const found = parseProposedCards('CARD: One.\nCARD: Two.');
  const res = proposeCards(d, found, { turn: 12 });

  assert.deepEqual(res.queued, ['One.', 'Two.']);
  assert.equal(d.cards.length, 0, 'review mode holds them back');
  assert.equal(d.pending[0].proposed_turn, 12);
});

test('in auto mode the same flow lands them straight in the pool', async () => {
  const { parseProposedCards, proposeCards } = await import('../extension/core/deck.js');
  const d = createDeck({ mode: 'assisted_auto' });
  proposeCards(d, parseProposedCards('CARD: One.\nCARD: Two.'), { turn: 12 });
  assert.deepEqual(d.cards.map((c) => c.text), ['One.', 'Two.']);
});

test('the prompt we send parses to nothing — the old bug, pinned', async () => {
  const { renderReplenishPrompt, parseProposedCards, createDeck } = await import('../extension/core/deck.js');
  const prompt = renderReplenishPrompt(createDeck({ mode: 'assisted_auto' }), { knownNames: ['Samira'] });

  // waitForReply once returned our own prompt because it renders as a message
  // node too, and renders FIRST. The parser then found nothing in it — which is
  // exactly the "Assistant replied but no cards were found" symptom.
  assert.deepEqual(
    parseProposedCards(prompt),
    [],
    'the instruction text mentions "CARD: " but no line starts with it',
  );
});

test('a real Assistant reply parses whole', async () => {
  const { parseProposedCards } = await import('../extension/core/deck.js');
  const reply = [
    'CARD: The doilies in the box are arranged in a pattern neither of them placed.',
    "CARD: Samira's smoke trail briefly forms the shape of a door before dissolving.",
    'CARD: The washing machine drains clear water for the first time in months.',
    "CARD: A wish is scratched into the tarnish on the lamp's underside that Joe didn't write.",
  ].join('\n');
  assert.equal(parseProposedCards(reply).length, 4);
});
