// Direct recall and deterministic one-hop link selection. Spec §6, §8 (C-E).
//
// Merges union and de-duplicate link sets, so a canonical card can accumulate
// more links than linked_result_cap. Without a total order over the candidates,
// the same recall returns different neighbours on different turns — which
// surfaces as apparent model inconsistency, not as a selection bug, and is
// therefore very expensive to diagnose.
//
//   law: recall_is_deterministic
//        same_card + same_state => same_recall_payload

import { kindOfId } from './ids.js';
import { activityOf } from './ordering.js';
import { ordinalRank } from './workspace.js';
import { resolveRedirect } from './aliases.js';
import { freshnessBand, touchOnRecall } from './freshness.js';

// §6 bucket_order_by_requested_kind
const BUCKET_ORDER = {
  npc: ['event', 'location', 'object'],
  location: ['event', 'npc', 'object'],
  event: ['npc', 'location', 'object'],
  object: ['event', 'npc', 'location'],
};

// §6 within_each_bucket_order_by, tiers 1-3
const TIER = { active: 0, retired: 1, unconfirmed: 2 };

/**
 * Deterministically ordered one-hop neighbours, capped AFTER ordering.
 * Applying the cap before ordering would make the cap decide the content.
 */
export function linkedNeighbours(ws, cardId, { includeUnconfirmed = false, cap } = {}) {
  const card = ws.cards[cardId];
  if (!card) return [];

  const limit = cap ?? ws.settings.linked_result_cap;
  const buckets = BUCKET_ORDER[kindOfId(cardId)] ?? [];

  const resolved = [
    ...new Set(
      card.link_ids
        .map((id) => {
          try {
            return resolveRedirect(ws, id);
          } catch {
            return null;
          }
        })
        .filter((id) => id && ws.cards[id] && id !== cardId),
    ),
  ];

  const ordered = [];
  for (const bucketKind of buckets) {
    const inBucket = resolved
      .filter((id) => kindOfId(id) === bucketKind)
      .map((id) => ({ id, activity: activityOf(ws, id) }))
      .filter((n) => includeUnconfirmed || n.activity !== 'unconfirmed')
      .sort((a, b) => {
        const t = TIER[a.activity] - TIER[b.activity];
        if (t !== 0) return t;
        const ra = ordinalRank(ws, a.id) ?? Number.MAX_SAFE_INTEGER;
        const rb = ordinalRank(ws, b.id) ?? Number.MAX_SAFE_INTEGER;
        if (ra !== rb) return ra - rb;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; // total order, no ties left
      });
    ordered.push(...inBucket);
  }

  return ordered.slice(0, limit).map((n) => n.id);
}

/**
 * Direct recall payload. Carries identity AND staleness — a summary that reads
 * present-tense whether it was written last turn or four hundred turns ago is
 * exactly the failure C-C exists to prevent.
 *
 * `touch: false` lets the UI and tests inspect a card without altering it.
 */
export function recallCard(ws, cardId, { includeUnconfirmed = false, touch = true } = {}) {
  const resolvedId = resolveRedirect(ws, cardId);
  const card = ws.cards[resolvedId];
  if (!card) return { status: 'unknown' };

  const neighbours = linkedNeighbours(ws, resolvedId, { includeUnconfirmed });

  if (touch) {
    touchOnRecall(ws, resolvedId);
    for (const id of neighbours) touchOnRecall(ws, id);
  }

  return {
    status: 'known',
    id: resolvedId,
    kind: card.kind,
    canonical_name: card.name_or_title,
    summary: card.summary,
    activity: activityOf(ws, resolvedId),
    freshness: freshnessBand(ws, resolvedId),
    linked: neighbours.map((id) => ({
      id,
      kind: ws.cards[id].kind,
      name: ws.cards[id].name_or_title,
      summary: ws.cards[id].summary,
      activity: activityOf(ws, id),
      freshness: freshnessBand(ws, id),
    })),
  };
}

/**
 * Entity resolution result for the RP model. §7.
 * Negative results stay bounded; positive results now carry staleness too.
 */
export function resolveEntity(ws, term, lookup, { authored = null } = {}) {
  // Higher-authority scenario/campaign definitions win even when a legacy
  // duplicate card is still retained in quarantine for user review.
  const defined = authored?.(term);
  if (defined) {
    return {
      status: 'authored',
      kind: defined.kind,
      canonical_name: defined.name,
      activity: 'always_present',
      note: 'defined outside the emergent card index',
    };
  }
  const hit = lookup(ws, term);

  if (hit.status === 'unknown') {
    // Before reporting unknown, check what the user authored. An entity in a
    // scenario slot deliberately has no card (§8.3 — cards are for emergent
    // continuity), so "no card" must not be reported as "no such entity".
    //
    //   law: uncarded != unknown
    // law: unknown != proof_never_existed
    return { status: 'unknown' };
  }

  if (hit.status === 'ambiguous') {
    // law: ambiguous != permission_to_guess
    return {
      status: 'ambiguous',
      count: hit.ids.length,
      matches: hit.ids.map((id) => ({
        id,
        kind: ws.cards[id].kind,
        canonical_name: ws.cards[id].name_or_title,
        activity: activityOf(ws, id),
        freshness: freshnessBand(ws, id),
      })),
    };
  }

  const id = hit.ids[0];
  return {
    status: hit.status, // 'known' | 'alias-of'
    id,
    kind: ws.cards[id].kind,
    canonical_name: ws.cards[id].name_or_title,
    activity: activityOf(ws, id),
    freshness: freshnessBand(ws, id),
    aliases: ws.cards[id].aliases,
  };
}
