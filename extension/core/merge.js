// Deterministic merge, and the merge legality predicate. Spec §7c, C-D.
//
// Merge is the only operation that changes ordinal position at zero movement
// cost, because it is identity normalization rather than a ranking opinion.
// That is correct, and it is also why legality has to be mechanical: an
// undefined "validate merge legality" would leave the carefully bounded
// movement budget with an unlocked door beside it.
//
//   law: merge_may_normalize_identity
//        merge != rank_promotion_channel

import { normalizeTerm, kindOfId } from './ids.js';
import { wouldCycle, rebuildAliasIndex } from './aliases.js';

export class MergeError extends Error {}

/**
 * Mechanical legality. Returns { legal: true } or { legal: false, reason }.
 * Every clause here is from §7c merge_legality_requires_all_of.
 */
export function checkMergeLegality(ws, duplicateId, canonicalId) {
  const fail = (reason) => ({ legal: false, reason });

  if (duplicateId === canonicalId) return fail('self_merge');

  const dup = ws.cards[duplicateId];
  const can = ws.cards[canonicalId];
  if (!dup) return fail(`duplicate_id_does_not_resolve:${duplicateId}`);
  if (!can) return fail(`canonical_id_does_not_resolve:${canonicalId}`);

  if (kindOfId(duplicateId) !== kindOfId(canonicalId)) return fail('kind_mismatch');

  // Neither operand may already be absorbed. Merging into or out of a card that
  // has already been redirected produces a chain nobody asked for.
  if (ws.redirects[duplicateId]) return fail(`duplicate_already_absorbed:${duplicateId}`);
  if (ws.redirects[canonicalId]) return fail(`canonical_already_absorbed:${canonicalId}`);
  if (dup.merged_into) return fail(`duplicate_already_merged:${duplicateId}`);
  if (can.merged_into) return fail(`canonical_already_merged:${canonicalId}`);

  if (wouldCycle(ws, duplicateId, canonicalId)) return fail('redirect_cycle');

  return { legal: true };
}

/**
 * Policy layer, separate from legality. C-D.
 *
 * Legality asks "is this operation coherent". Policy asks "is this actor
 * allowed to do it unattended". They are different questions and folding them
 * together is how a user-initiated merge ends up sharing a cap with an
 * automatic one.
 */
export function checkAutoMergePolicy(ws, duplicateId, canonicalId, { autoMergesUsed = 0 } = {}) {
  const limit = ws.settings.automatic_merge_limit_per_run;
  if (autoMergesUsed >= limit) {
    return { allowed: false, reason: `automatic_merge_limit_exceeded:${limit}` };
  }

  const dup = ws.cards[duplicateId];
  const can = ws.cards[canonicalId];

  // confirmed <-> confirmed is proposal-only. Collapsing two identities the
  // user already confirmed is where a model misread is most expensive and
  // least visible.
  if (dup.review_state === 'confirmed' && can.review_state === 'confirmed') {
    return { allowed: false, reason: 'confirmed_to_confirmed_requires_user_confirmation' };
  }

  return { allowed: true };
}

/**
 * Apply a merge. Mutates `ws` (callers operate on a clone).
 * Assumes legality has already been checked; re-checks and throws, because a
 * merge applied to an illegal pair corrupts identity irrecoverably.
 */
export function mergeCards(ws, duplicateId, canonicalId) {
  const legality = checkMergeLegality(ws, duplicateId, canonicalId);
  if (!legality.legal) throw new MergeError(legality.reason);

  const kind = kindOfId(canonicalId);
  const dup = ws.cards[duplicateId];
  const can = ws.cards[canonicalId];

  // --- ordinal_rule: inherit the better (lower) of the two positions -------
  const list = ws.order[kind];
  const dupIdx = list.indexOf(duplicateId);
  const canIdx = list.indexOf(canonicalId);

  let targetIdx = null;
  if (dupIdx !== -1 && canIdx !== -1) targetIdx = Math.min(dupIdx, canIdx);
  else if (canIdx !== -1) targetIdx = canIdx;
  else if (dupIdx !== -1) targetIdx = dupIdx; // absorbed was ranked, canonical was not

  // --- pin_rule / manual_lock_rule: OR, never destroy user protection ------
  can.pinned = can.pinned || dup.pinned;
  can.manually_locked = can.manually_locked || dup.manually_locked;

  // --- review_state_rule: confirmed wins ----------------------------------
  const wasConfirmed = can.review_state === 'confirmed';
  if (dup.review_state === 'confirmed') can.review_state = 'confirmed';

  // --- alias_rule: union, plus the absorbed canonical name ----------------
  const seen = new Set(can.aliases.map(normalizeTerm));
  const pushAlias = (text) => {
    const key = normalizeTerm(text);
    if (!key || seen.has(key)) return;
    if (key === normalizeTerm(can.name_or_title)) return; // not an alias of itself
    seen.add(key);
    can.aliases.push(text);
  };
  pushAlias(dup.name_or_title);
  for (const a of dup.aliases) pushAlias(a);

  // --- freshness: keep the better-supported of the two (C-C) --------------
  can.last_touched = maxOrNull(can.last_touched, dup.last_touched);
  can.last_supported_turn = maxOrNull(can.last_supported_turn, dup.last_supported_turn);

  // --- link_rule: union, rewire everywhere, drop self-links ---------------
  can.link_ids = [...new Set([...can.link_ids, ...dup.link_ids])];
  for (const card of Object.values(ws.cards)) {
    if (card.id === duplicateId) continue;
    if (!card.link_ids.includes(duplicateId)) continue;
    card.link_ids = [...new Set(card.link_ids.map((id) => (id === duplicateId ? canonicalId : id)))];
  }
  // mutual_link_case: after rewiring, canonical may point at itself
  can.link_ids = [...new Set(can.link_ids.map((id) => (id === duplicateId ? canonicalId : id)))]
    .filter((id) => id !== canonicalId);

  // --- redirect_rule: old id keeps resolving ------------------------------
  ws.redirects[duplicateId] = canonicalId;
  dup.merged_into = canonicalId;

  // --- ordering: close the removed slot, then seat canonical --------------
  let next = list.filter((id) => id !== duplicateId && id !== canonicalId);
  if (targetIdx !== null) {
    const clamped = Math.min(targetIdx, next.length);
    next.splice(clamped, 0, canonicalId);
  } else if (can.review_state === 'confirmed' && !wasConfirmed) {
    // absorbed was confirmed but unranked, canonical was unconfirmed:
    // the survivor is confirmed now and needs a home
    next.push(canonicalId);
  }
  ws.order[kind] = next;

  ws.unconfirmed[kind] = ws.unconfirmed[kind].filter(
    (id) => id !== duplicateId && !(id === canonicalId && can.review_state === 'confirmed'),
  );

  delete ws.cards[duplicateId];
  rebuildAliasIndex(ws);
  return ws;
}

function maxOrNull(a, b) {
  if (a == null) return b;
  if (b == null) return a;
  return a > b ? a : b;
}
