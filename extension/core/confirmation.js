// Mechanical confirmation. Spec §7b (C-A).
//
// The core rule of the document: a card becomes ambient memory only through a
// mechanical event, never through model judgment.
//
//   law: confirmation != model_judgment
//        model_repetition != confirmation
//        user_authored != user_originated
//
// Confirming does NOT grant rank. A confirmed card joins the bottom of its
// ordered list and competes for the active window through the normal bounded
// promotion path, which is the only thing that may reorder anything.
//
//   law: confirmation != promotion

import { normalizeTerm } from './ids.js';
import { checkOrigination, REASON_CONFIRMATION_WITHHELD } from './origination.js';
import { supportCard } from './freshness.js';
import { stripInjections } from './injection.js';

export const REASON_AMBIGUOUS = 'ambiguous_user_reference';

function addSignal(card, reason_code, detail, turn) {
  card.review_signals = [
    ...card.review_signals.filter((s) => s.reason_code !== reason_code),
    { reason_code, detail: detail ?? null, turn },
  ];
}

/** Explicit user action. The unconditional path — no checks, the user decided. */
export function confirmByUser(ws, cardId) {
  const card = ws.cards[cardId];
  if (!card) throw new Error(`no such card: ${cardId}`);
  if (card.authority_conflict) {
    throw new Error(`${card.name_or_title} is defined by ${card.authority_conflict.source} and cannot be carded`);
  }
  if (card.review_state === 'confirmed') return ws;

  card.review_state = 'confirmed';
  ws.unconfirmed[card.kind] = ws.unconfirmed[card.kind].filter((id) => id !== cardId);
  if (!ws.order[card.kind].includes(cardId)) ws.order[card.kind].push(cardId);
  supportCard(ws, cardId);
  return ws;
}

export function unconfirmByUser(ws, cardId) {
  const card = ws.cards[cardId];
  if (!card) throw new Error(`no such card: ${cardId}`);
  card.review_state = 'unconfirmed';
  ws.order[card.kind] = ws.order[card.kind].filter((id) => id !== cardId);
  if (!ws.unconfirmed[card.kind].includes(cardId)) ws.unconfirmed[card.kind].push(cardId);
  return ws;
}

/** Every term that could identify a card: its canonical name plus its aliases. */
function termsFor(card) {
  return [card.name_or_title, ...card.aliases].map(normalizeTerm).filter(Boolean);
}

/**
 * A later distinct user-authored turn. §7b later_direct_user_reference, as
 * amended by C-A.
 *
 * For each unconfirmed card mentioned in the turn:
 *   - if the mention is ambiguous across several cards, do not confirm (T52)
 *   - if the surrounding text substantially repeats recent model output,
 *     do not confirm — emit a review signal instead (C-A)
 *   - otherwise confirm
 *
 * Returns { confirmed: [ids], withheld: [{id, reason_code}] }.
 */
export function considerUserTurn(ws, { userTurnText, recentModelTurns = [] }) {
  // Strip our own injected blocks FIRST. Since injection rides in the user's
  // turn, a staged card summary mentioning Samira would otherwise appear
  // inside a "user-authored" turn and confirm the very card that put it there
  // — a self-confirmation loop through a door C-A does not watch, because the
  // text is neither model-authored nor user-authored. It is ours.
  //
  //   law: injected_by_us != authored_by_user
  const source = stripInjections(userTurnText);
  const models = recentModelTurns.map(turn => stripInjections(turn));
  if (source.status !== 'clean' || models.some(turn => turn.status !== 'clean')) {
    return { confirmed: [], withheld: [], deferred: 'ambiguous_injection_source' };
  }
  const authored = source.text;
  recentModelTurns = models.map(turn => turn.text);
  const haystack = normalizeTerm(authored);
  const confirmed = [];
  const withheld = [];

  // Build term -> [cardIds] across ALL cards, so an unconfirmed card whose name
  // collides with a confirmed one is treated as ambiguous rather than confirmed.
  const byTerm = new Map();
  for (const card of Object.values(ws.cards)) {
    if (card.merged_into) continue;
    for (const term of termsFor(card)) {
      if (!byTerm.has(term)) byTerm.set(term, new Set());
      byTerm.get(term).add(card.id);
    }
  }

  const candidates = Object.values(ws.cards)
    .filter((c) => c.review_state === 'unconfirmed' && !c.authority_conflict);

  for (const card of candidates) {
    const mentioned = termsFor(card).find((term) => haystack.includes(term));
    if (!mentioned) continue;

    // T52 — a mention that could be several entities confirms none of them.
    if (byTerm.get(mentioned).size > 1) {
      addSignal(card, REASON_AMBIGUOUS, `"${mentioned}" matches more than one card`, ws.current_turn);
      withheld.push({ id: card.id, reason_code: REASON_AMBIGUOUS });
      continue;
    }

    const origin = checkOrigination(ws, {
      userTurnText: authored, // compare what the USER wrote, not what we added
      term: mentioned,
      recentModelTurns,
    });

    if (!origin.originated) {
      addSignal(
        card,
        REASON_CONFIRMATION_WITHHELD,
        `overlap ${origin.overlap.toFixed(2)} with a recent model turn`,
        ws.current_turn,
      );
      withheld.push({ id: card.id, reason_code: origin.reason_code });
      continue;
    }

    confirmByUser(ws, card.id);
    confirmed.push(card.id);
  }

  return { confirmed, withheld };
}

/**
 * §7b proven_native_host_entity. Disabled until Stage 0 proves a reliable
 * native entity seam. Present as an explicit closed door rather than an
 * omission, so enabling it is a deliberate act.
 */
export function confirmByNativeHostEntity() {
  throw new Error(
    'native-host confirmation is disabled: no PROVEN_POSSIBLE entity seam in recon findings',
  );
}
