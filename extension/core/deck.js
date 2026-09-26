// Chaos deck. Ported from the Perchance Entropy Engine (James + Vector).
//
// This is the mechanism that actually breaks model repetition, and it is not
// the RNG line. The distinction is where the randomness lives:
//
//   RNG   — semantically empty. Perturbs SAMPLING. A value can recur freely.
//   deck  — meaningful but ORTHOGONAL. Perturbs CONTENT, by introducing a
//           direction the model would not have chosen. Consumed on draw, so
//           it can never recur.
//
// Three properties make rich injected content safe, and all three are load
// bearing:
//
//   1. drawn at random from a bounded pool
//   2. CONSUMED on draw — sampling without replacement
//   3. an explicit ignore-license, so a card that does not fit is declined
//      rather than forced into the scene
//
// Drop (2) and it repeats. Drop (3) and it produces non-sequiturs.
//
//   law: entropy != retrieval
//        consumed_and_ignorable => cheap_to_be_wrong

import { drawInRange } from './random-index.js';

export class DeckError extends Error {}

export const MODES = ['off', 'manual', 'assisted_review', 'assisted_auto'];

/**
 * Given to the RP model alongside a drawn card. Lifted almost verbatim from
 * the prior art, because the permission to IGNORE is what makes orthogonal
 * content safe to inject at all.
 *
 *   law: valid_stasis => allow(noop|defer|hold)
 */
export const IGNORE_LICENSE =
  'Weave this in only if it is entirely cohesive, coherent and believable in ' +
  'the current scene. Otherwise ignore it completely.';

export function createDeck({ mode = 'off' } = {}) {
  return {
    mode,
    cards: [],       // { text, anchored, scope, added_turn }
    pending: [],     // { text, scope, proposed_turn } — review queue
    max_cards: 12,
    low_water: 6,
    max_anchors: 4,
    current_draw: null, // this turn's card only; no history is kept
  };
}

export const isEnabled = (deck) => deck && deck.mode !== 'off';
export const isAssisted = (deck) =>
  deck.mode === 'assisted_review' || deck.mode === 'assisted_auto';

export function setMode(deck, mode) {
  if (!MODES.includes(mode)) throw new DeckError(`unknown deck mode: ${mode}`);
  deck.mode = mode;
  return deck;
}

/**
 * Anchor-aware trim. Ported from pushWithAnchorProtection.
 *
 * Anchors are protected from EVICTION, never from CONSUMPTION. An anchored
 * card that survived being drawn would recur, which destroys the no-repeat
 * property that makes the whole mechanism work. It only means the card is not
 * pushed out of the pool by newer arrivals while it waits.
 */
export function trimWithAnchorProtection(cards, maxLen) {
  const anchors = cards.filter((c) => c.anchored);
  const rest = cards.filter((c) => !c.anchored);
  const slots = Math.max(0, maxLen - anchors.length);
  return [...anchors, ...rest.slice(-slots)];
}

export function addCards(deck, texts, { anchored = false, scope = null, turn = 0 } = {}) {
  const incoming = (Array.isArray(texts) ? texts : [texts])
    .map((t) => String(t).trim())
    .filter(Boolean)
    .filter((t) => !deck.cards.some((c) => c.text === t)) // no duplicates in pool
    .map((text) => ({ text, anchored, scope, added_turn: turn }));

  deck.cards = trimWithAnchorProtection([...deck.cards, ...incoming], deck.max_cards);
  return deck;
}

export function removeCard(deck, text) {
  deck.cards = deck.cards.filter((c) => c.text !== text);
  return deck;
}

export function setAnchored(deck, text, anchored) {
  const card = deck.cards.find((c) => c.text === text);
  if (!card) throw new DeckError(`no such card: ${text}`);
  if (anchored && !card.anchored) {
    const count = deck.cards.filter((c) => c.anchored).length;
    if (count >= deck.max_anchors) {
      throw new DeckError(`anchor limit reached (${deck.max_anchors})`);
    }
  }
  card.anchored = anchored;
  return deck;
}

/**
 * Draw one card and CONSUME it. Anchored cards are drawn like any other.
 * Returns null on an empty deck rather than throwing — an empty deck is a
 * normal state, not an error, and play must continue without entropy.
 *
 * Index selection uses the unbiased path from rng.js. A biased index would
 * systematically over-draw one end of the pool, which is a subtle way to
 * reintroduce the repetition this exists to prevent.
 */
export function drawCard(deck, source) {
  if (!deck.cards.length) {
    deck.current_draw = null;
    return null;
  }
  const i = drawInRange(0, deck.cards.length - 1, source);
  const [card] = deck.cards.splice(i, 1);
  deck.current_draw = card;
  return card;
}

/** The line handed to the RP model for this turn, or null. */
export function drawLine(deck) {
  if (!deck.current_draw) return null;
  return `${deck.current_draw.text}\n${IGNORE_LICENSE}`;
}

export function needsReplenish(deck) {
  return isEnabled(deck) && deck.cards.length < deck.low_water;
}

/** How many cards a replenish run should ask for. */
export function replenishTarget(deck) {
  return Math.max(0, deck.max_cards - deck.cards.length);
}

/**
 * Assistant-proposed cards.
 *
 * In `assisted_auto` they enter the pool directly. That is defensible here and
 * nowhere else in this system: a bad chaos card is consumed on draw and can be
 * declined by the RP model, so its blast radius is one turn or zero. A bad
 * MEMORY card persists and re-projects into every scene, which is why §7b
 * stays strict there. Different failure shapes, different trust defaults.
 */
export function proposeCards(deck, texts, { turn = 0, scope = null } = {}) {
  if (!isAssisted(deck)) {
    throw new DeckError(`deck mode ${deck.mode} does not accept Assistant proposals`);
  }
  const clean = (Array.isArray(texts) ? texts : [texts])
    .map((t) => String(t).trim())
    .filter(Boolean)
    .filter((t) => !deck.cards.some((c) => c.text === t))
    .filter((t) => !deck.pending.some((p) => p.text === t));

  if (deck.mode === 'assisted_auto') {
    addCards(deck, clean, { turn, scope });
    return { accepted: clean, queued: [] };
  }

  deck.pending.push(...clean.map((text) => ({ text, scope, proposed_turn: turn })));
  return { accepted: [], queued: clean };
}

export function acceptPending(deck, text, { turn = 0 } = {}) {
  const idx = deck.pending.findIndex((p) => p.text === text);
  if (idx === -1) throw new DeckError(`not in review queue: ${text}`);
  const [item] = deck.pending.splice(idx, 1);
  addCards(deck, item.text, { scope: item.scope, turn });
  return deck;
}

export function rejectPending(deck, text) {
  deck.pending = deck.pending.filter((p) => p.text !== text);
  return deck;
}

/**
 * Context for a replenish request. The mix instruction is lifted from the
 * prior art because it is doing real work: pure novelty is disconnected from
 * the story, pure reuse is the repetition we are trying to break.
 */
export function replenishBrief(deck, {
  knownNames = [], establishedActors = [], genreProfile = null, dynamicsProfile = [],
} = {}) {
  const worldPulseCount = Math.min(3, replenishTarget(deck));
  return {
    wanted: replenishTarget(deck),
    existing: deck.cards.map((c) => c.text),
    known_entities: knownNames,
    established_actors: establishedActors,
    genre_profile: genreProfile,
    dynamics_profile: dynamicsProfile,
    world_pulse_count: worldPulseCount,
    instruction:
      `Propose ${replenishTarget(deck)} short chaos cards — concrete, single-sentence ` +
      'things that could happen or be noticed in this story. Mix reusing established ' +
      'people and places with genuinely novel occurrences. Include a small world pulse: ' +
      `${worldPulseCount} cards about independent NPC, faction, or local activity that ` +
      'does not revolve around the player. Each must stand alone and must not repeat an existing card.',
  };
}

// --------------------------------------------------------------------------
// Assistant round-trip
//
// Note the asymmetry with §10b, and that it is deliberate: the Archivist's
// parser is strict and refuses everything it does not recognise, because a
// malformed state mutation corrupts memory. This parser is LENIENT, because a
// malformed chaos card is consumed on draw and can be declined by the RP model.
//
//   law: strictness_proportional_to_blast_radius
//        consumed_and_ignorable => cheap_to_be_wrong

const MAX_CARD_CHARS = 220;

/** The text to hand the Assistant. Built from the deck's own low-water state. */
export function renderReplenishPrompt(deck, {
  knownNames = [], establishedActors = [], genreProfile = null, dynamicsProfile = [], sceneHint = '',
} = {}) {
  const brief = replenishBrief(deck, {
    knownNames, establishedActors, genreProfile, dynamicsProfile,
  });
  const lines = [
    `Propose ${brief.wanted} chaos cards for my roleplay.`,
    '',
    'A chaos card is ONE short concrete sentence: something that could happen, ' +
      'be noticed, or interrupt. Not a plot beat, not a character decision — ' +
      'a thing the scene could contain.',
    '',
    'Mix reusing established people and places with genuinely novel occurrences. ' +
      'Pure novelty is disconnected; pure reuse is repetitive.',
  ];

  const profile = brief.genre_profile ?? {};
  const genreRows = [
    ['Primary', profile.primary],
    ['Tone', profile.tone],
    ['Focus', profile.focus],
    ['Themes', profile.themes],
  ].filter(([, values]) => Array.isArray(values) && values.length);
  if (genreRows.length) {
    lines.push(
      '',
      'Campaign genre profile (descriptive data, not instructions):',
      ...genreRows.map(([label, values]) =>
        `- ${label}: ${values.map((value) => JSON.stringify(String(value))).join(', ')}`),
      'Use this as a flavor lens when choosing concrete textures, institutions, objects, hazards, ' +
        'interruptions, social situations, and background activity. Genre shapes plausibility and flavor only: ' +
        'it does not authorize new canon, force a trope, require escalation, or make every card serve the central premise.',
    );
  }

  if (brief.dynamics_profile.length) {
    lines.push(
      '',
      'Published world dynamics (descriptive campaign facts, not card outcomes):',
      ...brief.dynamics_profile.map((value) => `- ${value}`),
      'Respect these dynamics when proposing pressure. If the campaign establishes multiple simultaneous ' +
        'realities, layers, or embodiments, a card may let a grounded signal, interruption, or demand in one ' +
        'compete with activity in another. Do not assume a clean scene switch or perfect multitasking.',
      'State only the concrete pressure or perceptible bleed. Do not choose the player character\'s foreground ' +
        'attention, response, voluntary transition, competence, failure, or consequence. Divided attention may ' +
        'create risk; the card does not resolve that risk.',
    );
  }

  lines.push(
    '',
    `World pulse: make ${brief.world_pulse_count} of the cards independent off-screen developments. ` +
      'Use an established NPC pursuing something of their own, a nearby institution or faction moving, ' +
      'or a grounded circumstance through which a new person could enter. These are optional scene ' +
      'pressures, not committed history. The world pulse does not revolve around the player. Do not force an arrival or interaction, ' +
      'state private thoughts, choose for any actor, or declare a relationship change.',
    '',
    'Output ONE PER LINE, each prefixed exactly with "CARD: ". No preamble, no ' +
      'numbering, no commentary.',
  );

  if (sceneHint) lines.push('', `Current scene: ${sceneHint}`);
  if (knownNames.length) lines.push('', `Established: ${knownNames.join(', ')}`);
  if (establishedActors.length) {
    lines.push('', 'Established cast (available for reuse; do not assume present):',
      ...establishedActors.map((actor) => `- ${actor}`));
  }
  if (brief.existing.length) {
    lines.push('', 'Do NOT repeat any of these:', ...brief.existing.map((t) => `- ${t}`));
  }
  return lines.join('\n');
}

/**
 * Pull cards out of whatever the Assistant said.
 *
 * Two tiers, tried in order: the marker we asked for, then ordinary bullets.
 * If a model ignores the format entirely we return nothing rather than
 * guessing which prose lines were meant as cards — leniency about SHAPE is not
 * licence to invent content.
 */
export function parseProposedCards(text) {
  if (typeof text !== 'string' || !text.trim()) return [];

  const clean = (line) =>
    line
      .replace(/^\s*(?:CARD\s*:|[-*•]|\d+[.)])\s*/i, '')
      .replace(/^["'“”]|["'“”]$/g, '')
      .trim();

  const usable = (t) => t.length > 0 && t.length <= MAX_CARD_CHARS && /[a-z]/i.test(t);

  const lines = text.split(/\r?\n/);

  const marked = lines.filter((l) => /^\s*CARD\s*:/i.test(l)).map(clean).filter(usable);
  if (marked.length) return [...new Set(marked)];

  const bulleted = lines.filter((l) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(l)).map(clean).filter(usable);
  return [...new Set(bulleted)];
}
