// Alias index and redirect index. Spec §7.
//
// The alias index is deliberately MULTI-VALUE. Two distinct entities can
// legitimately share an alias across a long campaign, and the correct response
// is to represent the ambiguity, not to pick a winner.
//
//   law: alias_resolution_may_be_ambiguous
//        ambiguous != permission_to_guess

import { normalizeTerm, kindOfId } from './ids.js';

const MAX_REDIRECT_HOPS = 32;

export class RedirectCycleError extends Error {}

export function addAlias(ws, alias, cardId) {
  const key = normalizeTerm(alias);
  if (!key) return ws;
  const bucket = ws.aliases[key] ?? (ws.aliases[key] = []);
  if (!bucket.includes(cardId)) bucket.push(cardId);
  return ws;
}

export function removeAlias(ws, alias, cardId) {
  const key = normalizeTerm(alias);
  const bucket = ws.aliases[key];
  if (!bucket) return ws;
  const next = bucket.filter((id) => id !== cardId);
  if (next.length) ws.aliases[key] = next;
  else delete ws.aliases[key];
  return ws;
}

/**
 * Follow the redirect chain to a canonical id.
 * Throws on a cycle rather than looping or silently returning a mid-chain id —
 * a cycle is a corrupted workspace and must be loud.
 */
export function resolveRedirect(ws, id) {
  let current = id;
  const seen = new Set([current]);
  for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop += 1) {
    const next = ws.redirects[current];
    if (!next) return current;
    if (seen.has(next)) throw new RedirectCycleError(`redirect cycle at ${next}`);
    seen.add(next);
    current = next;
  }
  throw new RedirectCycleError(`redirect chain exceeded ${MAX_REDIRECT_HOPS} hops from ${id}`);
}

/** Would adding redirect[from] = to create a cycle? Used by merge legality. */
export function wouldCycle(ws, from, to) {
  if (from === to) return true;
  let current = to;
  const seen = new Set([from]);
  for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop += 1) {
    if (seen.has(current)) return true;
    seen.add(current);
    const next = ws.redirects[current];
    if (!next) return false;
    current = next;
  }
  return true;
}

/**
 * Canonical match priority, §7 canonical_match_priority:
 *   1. exact stable card id
 *   2. exact unique canonical name
 *   3. exact unique normalized alias
 *   4. ambiguous when multiple retained cards match
 *
 * Returns { status, ids } where status is
 * 'known' | 'alias-of' | 'ambiguous' | 'unknown'.
 * Never picks a winner among several.
 */
export function lookupTerm(ws, term) {
  if (typeof term !== 'string' || !term.trim()) return { status: 'unknown', ids: [] };

  // 1. exact card id (including a redirected old id)
  if (ws.cards[term]) return { status: 'known', ids: [term] };
  if (ws.redirects[term]) {
    return { status: 'alias-of', ids: [resolveRedirect(ws, term)] };
  }

  const key = normalizeTerm(term);

  // 2. exact canonical name
  const byName = Object.values(ws.cards)
    .filter((c) => !c.merged_into && normalizeTerm(c.name_or_title) === key)
    .map((c) => c.id);
  if (byName.length === 1) return { status: 'known', ids: byName };
  if (byName.length > 1) return { status: 'ambiguous', ids: byName.sort() };

  // 3. normalized alias
  const byAlias = (ws.aliases[key] ?? [])
    .map((id) => resolveRedirect(ws, id))
    .filter((id) => ws.cards[id] && !ws.cards[id].merged_into);
  const unique = [...new Set(byAlias)];
  if (unique.length === 1) return { status: 'alias-of', ids: unique };
  if (unique.length > 1) return { status: 'ambiguous', ids: unique.sort() };

  // 4. nothing retained matches
  //    law: unknown != proof_never_existed
  return { status: 'unknown', ids: [] };
}

/**
 * Rebuild the alias index from card state. Used after import and after any
 * operation that could leave the index stale — cheaper and safer than trying
 * to patch it incrementally in every path.
 */
export function rebuildAliasIndex(ws) {
  ws.aliases = {};
  for (const card of Object.values(ws.cards)) {
    if (card.merged_into) continue;
    for (const alias of card.aliases) addAlias(ws, alias, card.id);
  }
  return ws;
}

/** Every id that currently points at `canonicalId`, directly or transitively. */
export function absorbedIdsFor(ws, canonicalId) {
  return Object.keys(ws.redirects).filter((old) => {
    try {
      return resolveRedirect(ws, old) === canonicalId;
    } catch {
      return false;
    }
  });
}

export { kindOfId };
