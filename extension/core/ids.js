// Card identity, kinds, and text normalization.
//
// Ids are prefixed so a link array can hold any kind without a parallel array
// per kind: `npc:tomas`, `loc:hartwell`, `evt:hartwell_inspection`.
// The prefix IS the type tag. That keeps one link_ids array per card instead of
// three, and makes relation-shape validation a prefix comparison.

export const KINDS = ['npc', 'location', 'event', 'object'];

const PREFIX_BY_KIND = { npc: 'npc', location: 'loc', event: 'evt', object: 'obj' };
const KIND_BY_PREFIX = { npc: 'npc', loc: 'location', evt: 'event', obj: 'object' };

export function prefixForKind(kind) {
  const p = PREFIX_BY_KIND[kind];
  if (!p) throw new Error(`unknown kind: ${kind}`);
  return p;
}

/** Kind of a card id, or null if the id is not well-formed. */
export function kindOfId(id) {
  if (typeof id !== 'string') return null;
  const i = id.indexOf(':');
  if (i <= 0) return null;
  return KIND_BY_PREFIX[id.slice(0, i)] ?? null;
}

export function isCardId(id) {
  return kindOfId(id) !== null && id.length > id.indexOf(':') + 1;
}

/**
 * Normalize a name or alias for lookup.
 * Lowercase, strip accents, collapse internal whitespace, drop surrounding
 * punctuation. Deliberately lossy: this is a lookup key, never display text.
 */
export function normalizeTerm(text) {
  if (typeof text !== 'string') return '';
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Build a card id from a kind and a human name. Stable for the same input. */
export function makeCardId(kind, name) {
  const slug = normalizeTerm(name).replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '');
  return `${prefixForKind(kind)}:${slug || 'unnamed'}`;
}

/**
 * The spec's allowed_relation_shape: NPC<->Location, NPC<->Event,
 * Location<->Event. Same-kind links are not part of the public scope, and a
 * self-link is never legal.
 */
export function isLegalRelation(idA, idB) {
  if (idA === idB) return false;
  const a = kindOfId(idA);
  const b = kindOfId(idB);
  if (!a || !b) return false;
  return a !== b;
}
