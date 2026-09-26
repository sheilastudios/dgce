// Ordinal ordering, the active window, and deterministic promotion. Spec §5.
//
// The whole ranking model is one array per kind plus a window line. That is not
// a simplification of the spec — it is what makes the spec's laws fall out for
// free rather than needing separate enforcement:
//
//   boundary_displacement_law (former active_N -> retired_N+1)
//     is a consequence of splicing a single array.
//   unrelated_retired_relative_order_is_preserved
//     is a consequence of not touching the rest of the array.
//
// Anything that needed a second archive array would reintroduce both problems.

import { kindOfId } from './ids.js';

export class OrderingError extends Error {}

export function activeWindowSize(ws, kind) {
  return ws.settings[`${kind}_active_window`];
}

export function activeIds(ws, kind) {
  return ws.order[kind].slice(0, activeWindowSize(ws, kind));
}

export function retiredIds(ws, kind) {
  return ws.order[kind].slice(activeWindowSize(ws, kind));
}

/**
 * Derived activity state. §5 derived_state.
 *   active     — confirmed, above the line
 *   retired    — confirmed, below the line (still known, resolvable, recallable)
 *   unconfirmed— retained candidate, never ambiently projected
 *
 * law: retired != deleted, retired != unavailable, retired != unknown
 */
export function activityOf(ws, cardId) {
  const card = ws.cards[cardId];
  if (!card) return null;
  if (card.review_state === 'unconfirmed') return 'unconfirmed';
  const kind = kindOfId(cardId);
  const i = ws.order[kind].indexOf(cardId);
  if (i === -1) return 'unconfirmed';
  return i < activeWindowSize(ws, kind) ? 'active' : 'retired';
}

/** Pinned confirmed cards currently inside the active window. */
function pinnedActive(ws, kind) {
  return activeIds(ws, kind).filter((id) => ws.cards[id]?.pinned);
}

/**
 * Deterministic insert. §5 deterministic_runtime_insert.
 *
 * Mutates `ws` in place — callers in the apply path operate on a clone, so
 * mutation here is contained and avoids copying the whole workspace per
 * operation.
 *
 * Throws OrderingError rather than silently declining, because a rejected
 * promotion must fail the entire Archivist run (§10b atomicity).
 */
export function promoteToActive(ws, kind, cardId, activePosition) {
  const card = ws.cards[cardId];
  if (!card) throw new OrderingError(`no such card: ${cardId}`);
  if (kindOfId(cardId) !== kind) throw new OrderingError(`kind mismatch for ${cardId}`);
  if (card.review_state !== 'confirmed') {
    // Promotion places a card into ambient projection. Unconfirmed cards are
    // excluded from ambient projection by §7b, so this is not a budget question
    // but a legality one.
    throw new OrderingError(`cannot promote unconfirmed card: ${cardId}`);
  }

  const window = activeWindowSize(ws, kind);
  if (!Number.isInteger(activePosition) || activePosition < 1 || activePosition > window) {
    throw new OrderingError(`active_position ${activePosition} out of bounds 1..${window}`);
  }

  const pinnedBefore = new Set(pinnedActive(ws, kind));

  const list = ws.order[kind];
  const from = list.indexOf(cardId);
  const next = from === -1 ? [...list] : [...list.slice(0, from), ...list.slice(from + 1)];
  next.splice(activePosition - 1, 0, cardId);

  // §5 pin_budget_interaction: pinned cards cannot be displaced by Archivist
  // promotion. Checked on the result rather than predicted, so the rule holds
  // regardless of where the candidate came from.
  const activeAfter = new Set(next.slice(0, window));
  for (const pinnedId of pinnedBefore) {
    if (!activeAfter.has(pinnedId)) {
      throw new OrderingError(
        `promotion of ${cardId} would displace pinned card ${pinnedId}`,
      );
    }
  }

  ws.order[kind] = next;
  return ws;
}

/**
 * User reorder. Same mechanics, but outside the Archivist movement budget and
 * permitted to move pinned cards, because the user is the one who pinned them.
 * §5 user_pin_actions.
 */
export function userReorder(ws, kind, cardId, position) {
  const list = ws.order[kind];
  const from = list.indexOf(cardId);
  if (from === -1) throw new OrderingError(`card not in ${kind} order: ${cardId}`);
  if (!Number.isInteger(position) || position < 1 || position > list.length) {
    throw new OrderingError(`position ${position} out of bounds 1..${list.length}`);
  }
  const next = [...list.slice(0, from), ...list.slice(from + 1)];
  next.splice(position - 1, 0, cardId);
  ws.order[kind] = next;
  return ws;
}

/** Move a confirmed card into the ordered list at the end (initial placement). */
export function appendConfirmed(ws, kind, cardId) {
  if (!ws.order[kind].includes(cardId)) ws.order[kind].push(cardId);
  return ws;
}

/** Remove a card from ordering entirely — merge absorption and user delete only. */
export function removeFromOrder(ws, kind, cardId) {
  ws.order[kind] = ws.order[kind].filter((id) => id !== cardId);
  ws.unconfirmed[kind] = ws.unconfirmed[kind].filter((id) => id !== cardId);
  return ws;
}
