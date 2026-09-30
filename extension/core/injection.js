// Turn injection. Spec §0b, §5 (Stage 5), §9, §13b.
//
// The probe settled the mechanism. DreamGen assembles the prompt SERVER-side
// from stored interactions: the generation request carries only sessionId,
// headInteractionId and model config, and the longest string in it is a UUID.
// There is no context field to write into.
//
// So the only way to reach the model is to put content into an interaction the
// server will read — i.e. the user's own turn. That is the owner's original
// design, confirmed as the only option rather than the fallback.
//
//   law: server_assembles => inject_into_the_turn
//
// Everything we add is delimited by a nonce WE mint, so removing it later is an
// exact string operation only AFTER the caller verifies local ownership.
// Syntax alone can also occur in user-authored examples and is not authority.
//
//   law: injected_by_us != authored_by_user
//        deterministic_removal > model_removal_of_deterministic_content

import { describeCard } from './archivist-input.js';
import { drawLine } from './deck.js';
import { estimateTokens, enforcementTarget } from './tokens.js';
import { IS_FREE_EDITION, assertEditionWorkspace } from './edition.js';

const NONCE_PREFIX = 'dgce-';

// DreamGen's hidden tag is <hidden>, NOT <h>. An earlier build used <h>, which
// the host does not recognise, so the block would have rendered as literal
// visible text inside the turn.
//
// Candidate syntax is <hidden> wrapping an <ext_ctx> carrying a nonce. A plain
// user <hidden> block matches nothing, but a copied/example ext_ctx can match.
// Destructive callers use stripRecordedInjection with the exact ledger body.
//
// Parsing is local to each call; no shared regex cursor or repaired boundaries.
// Quotes are matched as EITHER straight or curly. Observed live: the stored
// turn comes back as id=\u201Cdgce-096a51\u201D — something in the host path applies
// smart-quote substitution. Matching only `"` meant stripInjections silently
// failed on real turns, which reopens the self-confirmation loop C-A closes:
// our own injected text would reach the confirmation pass and confirm the very
// cards that put it there.
//
//   law: what_we_wrote != what_comes_back
const Q = '["\u201C\u201D]';

export function makeNonce(random = null) {
  const bytes = new Uint8Array(12); // 96 bits
  if (typeof random === 'function') {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(random() * 256) & 0xff;
  } else if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    throw new Error('cryptographic randomness is unavailable');
  }
  return NONCE_PREFIX + [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function wrapInjection(body, nonce) {
  return `<hidden><ext_ctx id="${nonce}">\n${body}\n</ext_ctx></hidden>`;
}

/** Destructive cleanup authority is the recorded body AND nonce, never syntax.
 * The carrier includes augmentTurn's two-newline separator. Allowed host
 * normalization: LF/CRLF interchange and straight/curly ID delimiter quotes
 * ONLY. No body quote conversion, whitespace trimming, or tag repair.
 */
export function stripRecordedInjection(text, record) {
  const refuse = reason => ({ status: 'manual_review', text, nonces: [], reason });
  if (typeof text !== 'string' || typeof record?.body !== 'string' || record.pruned
      || !/^dgce-[0-9a-f]{6,}$/.test(record?.nonce ?? '')) return refuse('exact carrier record unavailable');
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nonce = escape(record.nonce);
  const open = `<hidden><ext_ctx id=${Q}${nonce}${Q}>`;
  if ([...text.matchAll(new RegExp(open, 'g'))].length !== 1) return refuse('owned opener is missing or duplicated');
  const body = escape(record.body.replace(/\r\n/g, '\n')).replace(/\n/g, '\\r?\\n');
  const pattern = new RegExp(`\\r?\\n\\r?\\n${open}\\r?\\n${body}\\r?\\n</ext_ctx></hidden>`, 'g');
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1) return refuse('host carrier differs from the exact recorded carrier');
  const match = matches[0];
  return { status: 'matched', text: text.slice(0, match.index) + text.slice(match.index + match[0].length),
    nonces: [record.nonce] };
}

/**
 * Read-only syntax discovery/filtering before confirmation. This is not
 * ownership verification and its output must never be saved as a host edit.
 * Destructive callers must use stripRecordedInjection instead.
 */
function parseInjectionProjection(text, { ownedNonces = null } = {}) {
  const refuse = reason => ({ status: 'ambiguous', text, nonces: [], reason });
  if (typeof text !== 'string') return refuse('source text unavailable');
  if (ownedNonces) return refuse('nonce alone is not deletion authority');
  // Tokenize reserved boundaries, including damaged/unterminated spellings.
  // Never search forward for a closer across another opener. Any ambiguity
  // invalidates the whole view: preserve the original, publish no clean spans.
  const tokens = [...text.matchAll(/<\/?(?:hidden|ext_ctx)[^<>]*(?:>|(?=<)|$)/g)];
  const stack = [], spans = [];
  const opener = new RegExp(`^<ext_ctx id=${Q}(dgce-[0-9a-f]{6,})${Q}>$`);
  for (const token of tokens) {
    const raw = token[0], start = token.index, end = start + raw.length;
    const parent = stack.at(-1);
    if (raw === '<hidden>') {
      if (parent?.nonce) return refuse('nested carrier boundary');
      stack.push({ kind: 'hidden', start, end });
    } else if (opener.test(raw)) {
      if (parent?.kind !== 'hidden' || parent.end !== start || stack.length !== 1) {
        return refuse('unwrapped or nested carrier opener');
      }
      stack.push({ kind: 'ext_ctx', nonce: raw.match(opener)[1], start, end });
    } else if (raw === '</ext_ctx>') {
      if (parent?.kind !== 'ext_ctx') return refuse('unmatched carrier closer');
      stack.pop();
      Object.assign(stack.at(-1), { nonce: parent.nonce, closeEnd: end });
    } else if (raw === '</hidden>') {
      if (parent?.kind !== 'hidden') return refuse('unmatched hidden closer');
      stack.pop();
      if (parent.nonce) {
        if (parent.closeEnd !== start) return refuse('damaged carrier closing wrapper');
        spans.push({ start: parent.start, end, nonce: parent.nonce });
      }
    } else return refuse('malformed reserved boundary');
  }
  if (stack.length) return refuse('unclosed reserved boundary');
  let stripped = '', cursor = 0;
  for (const span of spans) {
    // Retain historical separator behavior only for proven balanced spans.
    const prefix = text.slice(cursor, span.start).replace(/(?:\r?\n){0,2}$/, '');
    stripped += prefix;
    cursor = span.end + (text.slice(span.end).match(/^\r?\n?/)?.[0].length ?? 0);
  }
  return { status: 'clean', text: stripped + text.slice(cursor), nonces: spans.map(span => span.nonce) };
}

export function stripInjections(text, options = {}) {
  const result = parseInjectionProjection(text, options);
  if (result.status !== 'clean' || !result.nonces.length) return result;
  const again = parseInjectionProjection(result.text);
  if (again.status !== 'clean' || again.text !== result.text || again.nonces.length) {
    return { status: 'ambiguous', text, nonces: [], reason: 'projection would manufacture another reserved carrier boundary' };
  }
  return { ...result, source_kind: 'derived_semantic_view', ownership_verified: false };
}

/** Semantic consumers must not mistake preserved ambiguous text for evidence. */
export function semanticInjectionText(text) {
  const result = stripInjections(text);
  if (result.status !== 'clean') {
    const error = new Error(`Ambiguous context-carrier structure; source use deferred: ${result.reason}.`);
    error.code = 'ambiguous_injection_source';
    throw error;
  }
  return result.text;
}

export function hasInjection(text) {
  const result = stripInjections(text);
  return result.status === 'ambiguous' || result.nonces.length > 0;
}

/** Is a surface due for injection on this turn? §11 injection_schedule. */
export function surfaceDue(surface, turn) {
  if (!surface?.enabled || !surface.text) return false;
  const every = surface.injection_schedule?.every_n_turns;
  if (!every || every < 1) return false;
  return turn % every === 0;
}

// Prompt sections use compact camelCase XML-like boundaries. The wrapper is
// input structure only: payloads remain ordinary prose/JSON, and callers keep
// the stable internal `kind` names used for budgets, logs, and pruning.
function promptType(kind) {
  const words = String(kind ?? '').trim().split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (!words.length) return 'extensionInput';
  const [head, ...tail] = words;
  const name = head.toLowerCase()
    + tail.map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase()).join('');
  return /^[A-Za-z]/.test(name) ? name : `extension${name}`;
}

function renderPromptParts(parts) {
  return parts.map((part) => {
    const tag = promptType(part.kind);
    return `<${tag}>\n${part.text}\n</${tag}>`;
  }).join('\n\n');
}

/**
 * Assemble what this turn should carry. Ordered cheapest-signal-last so that
 * if the budget truncates anything, it truncates the least load-bearing part.
 *
 * Returns { body, parts, estimated_tokens } — body is null when there is
 * nothing to inject, which is the common case and not an error.
 */


/**
 * Full injection for a turn: body, nonce, and the wrapped block ready to
 * append. Returns null when nothing is due.
 *
 * Enforces the recall budget with headroom, and drops whole parts rather than
 * truncating one mid-sentence — a half-sentence of memory is worse than none,
 * because the model will try to make sense of the fragment.
 */
// Included in the generated Free injection module, after the shared carrier helpers.
export function buildInjectionBody(ws, { staged = [], includeDeck = true } = {}) {
  assertEditionWorkspace(ws);
  const parts = [];
  for (const [kind, label] of [['event_log', 'Event log'], ['social_context', 'Social context'], ['inventory', 'Inventory']]) {
    const surface = ws.surfaces[kind];
    if (surfaceDue(surface, ws.current_turn)) parts.push({ kind, text: `${label}:\n${surface.text}` });
  }
  const lines = staged.map(id => describeCard(ws, id, { includeLinks: false })).filter(Boolean);
  if (lines.length) parts.push({ kind: 'memory', text: `Established:\n${lines.join('\n')}` });
  if (includeDeck && ws.deck?.mode !== 'off' && ws.deck?.current_draw) {
    const line = drawLine(ws.deck);
    if (line) parts.push({ kind: 'deck', text: line });
  }
  return { body: parts.length ? renderPromptParts(parts) : null, parts,
    estimated_tokens: parts.length ? estimateTokens(renderPromptParts(parts)) : 0 };
}
export function evaluateInjectionBudget(ws, opts = {}) {
  const result = buildInjectionBody(ws, opts);
  if (!result.body) return { ...result, diagnostics: { status: 'nothing_due', requiredTokens: 0 } };
  // Recall limits card selection, not the whole surfaces + cards + deck packet.
  // Old workspaces acquire this independent setting during hydration.
  const configuredBudget = opts.budgetTokens ?? ws.settings.continuity_context_budget ?? 1200;
  if (!Number.isSafeInteger(configuredBudget) || configuredBudget < 0) {
    return { body: null, parts: [], diagnostics: { status: 'budget_exceeded',
      configuredBudget, enforcedLimit: 0, requiredTokens: result.estimated_tokens,
      reason: 'The continuity context budget must be a nonnegative integer.' } };
  }
  const enforcedLimit = enforcementTarget(configuredBudget);
  const kept = [...result.parts];
  while (kept.length > 1 && estimateTokens(renderPromptParts(kept)) > enforcedLimit) kept.pop();
  const body = renderPromptParts(kept), requiredTokens = estimateTokens(body);
  return { body, parts: kept, diagnostics: {
    status: requiredTokens > enforcedLimit ? 'budget_exceeded' : 'ready',
    configuredBudget, enforcedLimit, initialTokens: result.estimated_tokens, requiredTokens,
    shortfallTokens: Math.max(0, requiredTokens - enforcedLimit), minimumConfiguredBudget: Math.ceil(requiredTokens / 0.8),
    essentialFallback: false, droppedParts: result.parts.length - kept.length,
    partEstimates: kept.map(part => ({ kind: part.kind, estimatedTokens: estimateTokens(renderPromptParts([part])) })),
  } };
}


/** Same budget decision for sending and read-only diagnostics. Nonces are
 * minted only for payloads that actually fit, never for debug previews. */
export function buildInjection(ws, opts = {}) {
  const result = evaluateInjectionBudget(ws, opts);
  // Optional observation sink; never changes the body or budget policy.
  if (opts.diagnostics) Object.assign(opts.diagnostics, result.diagnostics);
  if (result.diagnostics.status !== 'ready') return null;

  const nonce = makeNonce(opts.random);
  return {
    nonce,
    body: result.body,
    block: wrapInjection(result.body, nonce),
    parts: result.parts.map((p) => p.kind),
    dropped: result.diagnostics.droppedParts,
    estimated_tokens: result.diagnostics.requiredTokens,
    budget: result.diagnostics,
    projection_diagnostics: result.parts.find((p) => p.kind === 'campaign_context')?.projection_diagnostics ?? null,
  };
}

/** Append our block to the user's typed text. Their text is never altered. */
export function augmentTurn(userText, block) {
  return `${userText}\n\n${block}`;
}

/**
 * Turn-keyed audit record. This is the answer to "payload injection is
 * invisible" — except we are injecting into the turn, so it is visible anyway.
 * The log exists so the extension can reconcile and prune, and so the user can
 * see exactly what was added and when.
 */
export function makeInjectionRecord(
  injection,
  { interactionId = null, turn, recordedAt = Date.now(), requestId = null } = {},
) {
  const timestamp = new Date(recordedAt);
  const plannedAt = Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
  return {
    nonce: injection.nonce,
    request_id: requestId == null ? null : String(requestId),
    turn: injection.turn ?? turn,
    // Wall-clock observability is deliberately separate from campaign turn
    // order. Old records may not have it; new records receive one immutable
    // creation time so a stalled bridge can be distinguished from an old turn
    // number that merely happens to be the latest injected turn.
    recorded_at: plannedAt,
    planned_at: plannedAt,
    lifecycle_status: 'planned',
    dispatch_status: 'pending',
    dispatch_ack_at: null,
    observed_in_host_history_at: null,
    response_observed_at: null,
    prune_requested_at: null,
    host_save_verified_at: null,
    pruned_at: null,
    failure_reason: null,
    workspace_revision: injection.workspace_revision ?? null,
    campaign_revision: injection.campaign_revision ?? null,
    projection_hash: injection.projection_hash ?? null,
    interaction_id: interactionId,
    parts: injection.parts,
    estimated_tokens: injection.estimated_tokens,
    budget: injection.budget ?? null,
    projection_diagnostics: injection.projection_diagnostics ?? null,
    // What was staged and WHY it was staged. Without this the log says a card
    // shipped but not what earned it, which is the only interesting part.
    staged: injection.staged ?? [],
    why: injection.why ?? {},
    body: injection.body,
    pruned: false,
  };
}
