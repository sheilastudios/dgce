// Evidential freshness. Spec §5b (C-C).
//
// The whole point of this module is one separation:
//
//   last_touched         — when the card was last READ
//   last_supported_turn  — when the card was last SUPPORTED by evidence
//
// Deriving freshness from last_touched would mean that querying a stale card
// makes it look fresh: the read manufactures the evidence that the read is
// trustworthy. That is a closed loop with no external input, which is the same
// defect §7b exists to prevent on the confirmation side.
//
//   law: known != current
//        recall_updates_last_touched
//        recall_does_not_update_last_supported_turn

export const BANDS = ['fresh', 'aging', 'stale'];

/**
 * Coarse band, never a number. A band is cheap in tokens and does not invite
 * the model to do arithmetic on it or read it as precision.
 */
export function freshnessBand(ws, cardId) {
  const card = ws.cards[cardId];
  if (!card) return null;
  if (card.last_supported_turn == null) return 'stale';

  const age = ws.current_turn - card.last_supported_turn;
  if (age <= ws.settings.freshness_fresh_max_turns) return 'fresh';
  if (age <= ws.settings.freshness_aging_max_turns) return 'aging';
  return 'stale';
}

/**
 * Reading a card. Updates recency and makes it an ingress candidate for the
 * next bounded rank decision — but is NOT evidence about the content.
 *
 * law: recall_is_a_relevance_signal
 *      recall != permanent_pin
 *      recall != automatic_durable_rank_change
 */
export function touchOnRecall(ws, cardId) {
  const card = ws.cards[cardId];
  if (!card) return ws;
  card.last_touched = ws.current_turn;
  card.session_touched = true;
  return ws;
}

/**
 * Supporting a card. The only path that moves last_supported_turn.
 * Callers: a direct user edit, or an Archivist revision made from current
 * evidence in a maintenance run. Nothing else.
 */
export function supportCard(ws, cardId) {
  const card = ws.cards[cardId];
  if (!card) return ws;
  card.last_supported_turn = ws.current_turn;
  card.last_touched = ws.current_turn;
  return ws;
}
