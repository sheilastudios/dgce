// Token estimation. Heuristic, never presented as exact. Spec §23.
//
// law: estimated_tokens != exact_tokens
//
// DreamGen ships a tokenizer tool, so exact counts may become available later.
// If they do, replace estimateTokens and record the tokenizer identity — but do
// not remove the headroom until measurement justifies it.

const HEADROOM_FACTOR = 0.8;

const encoder = new TextEncoder();

/**
 * ceil(utf8_bytes / 3). Intentionally conservative for Latin text and less
 * misleading than chars/4 across multilingual content.
 */
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(encoder.encode(String(text)).length / 3);
}

/** The value actually enforced against, leaving ~20% for tokenizer variance. */
export function enforcementTarget(configuredBudget) {
  return Math.floor(configuredBudget * HEADROOM_FACTOR);
}

export function withinBudget(text, configuredBudget) {
  return estimateTokens(text) <= enforcementTarget(configuredBudget);
}

/** UI text must say "estimated". Centralized so no caller invents its own label. */
export function formatEstimate(text) {
  return `~${estimateTokens(text)} estimated tokens`;
}
