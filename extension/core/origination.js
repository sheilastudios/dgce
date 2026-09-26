// Origination check. Spec §7b (C-A).
//
// §7b closes the model-repetition loop at the Archivist boundary and then
// reopens it at the input boundary. In long-form RP, users routinely paste or
// lightly edit model output into their own turn to steer a scene. When they do,
// an Archivist-invented NPC appears inside a user-authored turn and confirms
// mechanically. The model's own output becomes its own confirming evidence,
// laundered through a copy-paste.
//
// The existing guard checks WHO EMITTED the turn. The property that matters is
// WHO ORIGINATED the content.
//
//   law: user_authored != user_originated
//        paste_of_recent_model_output != user_origin_reference
//
// This is a bounded similarity heuristic, not an authorship proof. Rewording,
// translation and material outside the comparison window can evade it; low
// overlap is not independently established provenance.

import { normalizeTerm } from './ids.js';

export const REASON_CONFIRMATION_WITHHELD = 'confirmation_withheld_recent_model_overlap';

/** Split into sentences, keeping it dumb: terminal punctuation or newlines. */
function sentences(text) {
  return String(text)
    .split(/(?<=[.!?])\s+|(?<=[。！？])|\n+/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The sentence containing the term. Falls back to the whole text when the term
 * is not found in any single sentence — comparing more text than necessary is
 * the safe direction here, since it can only withhold confirmation.
 */
export function mentionContext(text, term) {
  const key = normalizeTerm(term);
  if (!key) return String(text);
  for (const s of sentences(text)) {
    if (normalizeTerm(s).includes(key)) return s;
  }
  return String(text);
}

/** Word-level n-shingles of normalized text. */
export function shingles(text, n) {
  const normalized = normalizeTerm(text);
  const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
  // Unspaced text cannot be one giant word: any edit would erase all overlap.
  // Use adjacent code points for CJK, retaining word tokens for Latin runs.
  // This remains a conservative overlap heuristic, not proof of authorship.
  const words = cjk.test(normalized)
    ? normalized.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\s]+/gu) ?? []
    : normalized.split(' ').filter(Boolean);
  if (cjk.test(normalized)) n = Math.min(n, 2);
  if (words.length === 0) return new Set();
  if (words.length < n) return new Set([words.join(' ')]);
  const out = new Set();
  for (let i = 0; i + n <= words.length; i += 1) out.add(words.slice(i, i + n).join(' '));
  return out;
}

/** Fraction of `a`'s shingles that also appear in `b`. */
export function overlapRatio(a, b) {
  if (a.size === 0) return 0;
  let hits = 0;
  for (const s of a) if (b.has(s)) hits += 1;
  return hits / a.size;
}

/**
 * Decide whether a mention inside a user turn counts as user-originated.
 *
 * `recentModelTurns` should be most-recent-first; only the configured window is
 * compared.
 *
 * Returns:
 *   { originated: true }
 *   { originated: false, reason_code, overlap, matched_turn_index }
 */
export function checkOrigination(ws, { userTurnText, term, recentModelTurns = [] }) {
  const n = ws.settings.origination_shingle_size;
  const threshold = ws.settings.origination_overlap_threshold;
  const window = ws.settings.origination_compare_window;

  const context = mentionContext(userTurnText, term);
  const contextShingles = shingles(context, n);
  if (contextShingles.size === 0) return { originated: true };

  const compared = recentModelTurns.slice(0, window);
  let worst = { overlap: 0, index: -1 };

  for (let i = 0; i < compared.length; i += 1) {
    const overlap = overlapRatio(contextShingles, shingles(compared[i], n));
    if (overlap > worst.overlap) worst = { overlap, index: i };
  }

  if (worst.overlap >= threshold) {
    return {
      originated: false,
      reason_code: REASON_CONFIRMATION_WITHHELD,
      overlap: worst.overlap,
      matched_turn_index: worst.index,
    };
  }

  return { originated: true, overlap: worst.overlap };
}
