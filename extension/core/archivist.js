// The Archivist prompt. Spec §10, §10b.
//
// STATELESS BY CONSTRUCTION. Every run carries its own complete relational
// view and its own budgets, so nothing depends on what was said in the chat
// before it. That is not an aesthetic choice — the DreamGen Assistant has no
// compaction, so its chat fills and then hard-errors. Statelessness is what
// makes clearing that chat free.
//
//   law: stateless_archivist => chat_is_disposable
//
// The output contract is strict on purpose (§10b): the Archivist proposes,
// the runtime validates and applies. A malformed run changes nothing.
//
//   law: [GEN] != [CAN]
//        [VAL] => [CMT]|[REJ]

import { buildArchivistView, budgetStatement } from './archivist-input.js';
import { parseArchivistOutput, REASON_CODES } from './parse.js';
import { estimateTokens } from './tokens.js';
import { ARCHIVIST_FIDELITY, ARCHIVIST_SURFACE_LINES } from './archivist-fidelity.js';

/** A run id the extension mints, which the Archivist must echo back (C-B). */
export function mintRunId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `run-${uuid}`;
  return `run-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffffff).toString(16)}-${Math.floor(Math.random() * 0xffffffff).toString(16)}`;
}

const SCHEMA_BLOCK = `{
  "schema_version": 1,
  "run_id": "<echo the run_id given below, exactly>",
  "operations": [ ... ]
}`;

const OPS_BLOCK = `SET_SURFACE       { "op":"SET_SURFACE", "surface":"event_log"|"social_context"|"inventory", "text":"..." }
UPSERT_CARD       { "op":"UPSERT_CARD", "kind":"npc"|"location"|"event"|"object", "id":"npc:slug",
                    "name_or_title":"...", "aliases":[], "summary":"...", "link_ids":[],
                    "review_state":"unconfirmed" }
PROMOTE_TO_ACTIVE { "op":"PROMOTE_TO_ACTIVE", "kind":"npc", "id":"npc:slug", "active_position":2 }
SET_LINKS         { "op":"SET_LINKS", "id":"npc:slug", "link_ids":["loc:x","evt:y"] }
MERGE_CARD        { "op":"MERGE_CARD", "duplicate_id":"npc:a", "canonical_id":"npc:b" }
REVIEW_SIGNAL     { "op":"REVIEW_SIGNAL", "id":"npc:slug", "reason_code":"<enum>", "detail":"..." }
NO_CHANGE         { "op":"NO_CHANGE" }`;

/**
 * Build the full instruction.
 *
 * `view` is the relational picture from buildArchivistView — links resolved to
 * names, support ages, recent movement. Ranking is only sound when the
 * material carries the basis for the judgment, which is what that view is for.
 */
export function buildArchivistPrompt(ws, { runId, view = null, authored = null } = {}) {
  const v = view ?? buildArchivistView(ws);
  const b = budgetStatement(ws);

  return [
    'You are the Archivist for a continuity extension. Maintain the small memory',
    'surfaces below from the role-play you can see in this session.',
    '',
    '## OUTPUT CONTRACT — read this first',
    '',
    'Reply with ONE JSON document and NOTHING else. No prose, explanations or markdown fences.',
    '',
    SCHEMA_BLOCK,
    '',
    `run_id: ${runId}`,
    '',
    '### allowed operations',
    OPS_BLOCK,
    '',
    `valid reason_code values: ${[...REASON_CODES].join(' | ')}`,
    '',
    '## FORMAT OF THE SURFACES',
    '',
    ARCHIVIST_SURFACE_LINES,
    'Select before drafting: rank coherent evidence threads by relevance to the next',
    'decision, current state, unresolved commitments and authority limits. A thread',
    'includes its reporting chain and necessary qualifications. Not every source or',
    'speaker needs representation. Omit lower-priority threads completely, not their',
    'limitations; do not assume omitted information is recoverable later.',
    'Order retained lines from most important/current to least important.',
    '',
    '## WHAT TO DO',
    '',
    'SOURCE/TARGET DISCIPLINE:',
    '  - The visible role-play transcript is the SOURCE; CURRENT MEMORY below is only',
    '    the TARGET. Inspect the actual role-play on every run.',
    '  - Previous Archivist prompts and replies are not story evidence.',
    '  - Before returning NO_CHANGE, compare source against target: no supported repair',
    '    or currently material addition within this bounded memory may remain pending.',
    '    Lower-priority eligible facts may be intentionally omitted for relevance or budget.',
    '    Omission for bounded-memory prioritization is not an error. Never mix NO_CHANGE with mutations.',
    '  - CURRENT MEMORY may itself contain an older overstatement: if stronger than source,',
    '    weaken or remove it now. Prior storage does not establish truth.',
    '',
    'MEMORY REPAIR PASS — before adding new material:',
    '  - Work target-first: take EACH supplied card, then each surface, including older',
    '    subjects. Locate source evidence before deciding whether to update. Memory is not proof.',
    '  - Use UPSERT_CARD with the SAME id to replace the full summary; preserve supported',
    '    details and legal links. SET_SURFACE replaces a surface. A better new entry or a review flag does not repair an old',
    '    assertion elsewhere: correct every established overstatement, not just new material.',
    '    Do not duplicate cards or change confirmation authority.',
    '  - Rebuild from source propositions, not by copying the old summary and appending.',
    '  - Attribution alone is not repair if the claim is still stronger: "says" does not',
    '    fix an unlimited promise; relaying instructions does not establish arranging events.',
    '  - Missing source coverage is not proof an older fact is false. Do not invent',
    '    attribution, delete merely for absence, or assert the opposite.',
    '',
    ARCHIVIST_FIDELITY,
    'Technical specificity is not proof of prior briefing; no known listener is not',
    'proof no witness or record exists. A residential endpoint does not prove a body',
    'is present; a VR relay does not identify its user; a disconnect does not prove',
    'power loss, injury or intent. Technical labels establish only their recorded scope.',
    '',
    '1. Event Log — current-relevance events, NOT a summary of everything that has happened.',
    '   Remove resolved/stale entries. Narrative imagery, interpretation, foreshadowing, and future possibility are',
    '   not event evidence. Record evidence at its actual strength after realization.',
    '   A realized external event does NOT need a scene boundary, second mention or',
    '   player confirmation. Observable actions, authorized disclosures and GM-established',
    '   operative facts are eligible immediately when useful. A previously unspecified world detail is not speculative after the GM makes it',
    '   operative and play relies on it; do not invent more.',
    '2. Social Context — the CURRENT interpersonal state. Rewrite it when relationships',
    '   materially change. Not a history of the relationship.',
    '3. Inventory — only if enabled below. Simple names, tiny notes.',
    '4. Cards — emergent people, places, events, objects (obj:slug). Objects store properties, not possession or resolved effects. Repair summaries, add',
    '   legal links and propose duplicate merges; see WHAT A CARD IS FOR.',
    '   link_ids connect ONLY different kinds among NPC, Location, Event and Object.',
    '   Same-kind links are illegal both ways; put event chronology/causality in summaries or Event Log.',
    '   Location containment is summary text, not a card link: "The lower archive is inside the temple."',
    '   Keep other legal links; use link_ids:[] when none apply. Do not author map connections.',
    '5. Promotions — if a card now matters more than one currently active, promote it.',
    '',
    '## WHAT A CARD IS FOR',
    '',
    'Cards are for the EMERGENT population, not scenario or published campaign definitions.',
    'Those definitions are mounted as needed; duplicating them creates two',
    'authorities for one fact.',
    '',
    'DO card:',
    '  - significant emergent entities that may matter again, even after one appearance',
    '  - entities removed from the scenario (no longer mounted = a card is now the only record)',
    '',
    'DO NOT card:',
    '  - the player or their persona. Ever. A competing characterisation narrows player freedom.',
    '  - any character, location or object currently defined in the scenario or campaign.',
    '',
    'CHANGES to a character who IS defined in the scenario or campaign:',
    '  - a discrete change -> an EVENT card; link only to existing legal card targets',
    '  - a gradual relational change -> SOCIAL CONTEXT. That is what it is for.',
    '  - never a competing character card.',
    '',
    '## HARD LIMITS',
    '',
    '- You may NOT confirm anything. review_state must be "unconfirmed". Confirmation belongs to the user.',
    '- You may NOT promote a card that is not listed below. If it is not in your',
    '  view, you have no basis to rank it.',
    '- Budgets are hard rejection limits for each candidate. Do not rely on downstream truncation.',
    '- Estimate decoded surface text with ceil(UTF8_bytes / 3), excluding JSON syntax.',
    '  Aim for 85% of each enforced ceiling; if over, omit a lower-priority whole thread',
    '  and recheck before emitting. The external validator measures actual bytes.',
    '- If nothing needs changing, return a single NO_CHANGE operation. That is a',
    '  good answer, not a failure.',
    '- If you cannot see the role-play story in this session, return NO_CHANGE.',
    '  Do NOT invent events from the memory view alone.',
    '- Prose publication alone does not establish private state, future action, or',
    '  relationship change. This guard applies to possibility and interpretation, NOT',
    '  realized external events. Do not turn a narrator possibility into a memory fact.',
    '',
    ...(authored
      ? [
          '## ALREADY IN THE SCENARIO — do not card any of these',
          '',
          authored,
          '',
        ]
      : []),
    '## BUDGETS',
    'The surface_hard_limits values below are the actual enforced ceilings,',
    'with the safety margin already applied. Never target the configured UI value.',
    JSON.stringify(b, null, 2),
    '',
    '## CURRENT MEMORY',
    '',
    v.text,
    '',
    '## REMINDER',
    'Before returning, audit both proposed operations and unchanged supplied memory:',
    'Preserve actual GM-established events; do not require a second mention.',
    'Each retained surface line must carry its own necessary qualifiers.',
    'Apply FINAL FIDELITY REVIEW to the exact output; check budget by whole-thread selection.',
    'NO_CHANGE is not appropriate when a supported correction remains.',
    'Check that the operation set actually replaces every established overstatement, not just appends.',
    'One JSON document. Nothing else.',
  ].join('\n');
}

/**
 * Turn validator errors into corrective instructions for the single retry.
 * Budget failures receive a lower retry target so estimation noise cannot
 * produce the same near-limit answer twice.
 */
export function buildArchivistRetryPrompt(prompt, previousReply, errors) {
  const corrections = [];

  for (const error of errors) {
    const match = /^SET_SURFACE ([^:]+): ~(\d+) estimated tokens exceeds enforced (\d+)$/.exec(error);
    if (!match) continue;
    const [, surface, previousCostText, hardLimitText] = match;
    const hardLimit = Number(hardLimitText);
    const retryTarget = Math.max(1, Math.floor(hardLimit * 0.85));
    corrections.push(
      `- ${surface}: replace the rejected text. It was ~${previousCostText}; hard limit ${hardLimit}. ` +
      `Target at most ~${retryTarget} estimated tokens (no more than ${retryTarget * 3} UTF-8 bytes). ` +
      'Delete the least useful entries; do not repeat the rejected wording unchanged.',
    );
  }

  const relationErrors = errors.filter((error) => / is not an allowed relation shape$/.test(error));
  if (relationErrors.length) {
    corrections.push(
      '- Remove every listed illegal link from link_ids. Reversing the arrow does not fix a same-kind link: ' +
      'Event<->Event, NPC<->NPC, and Location<->Location are forbidden in BOTH directions. ' +
      'Preserve event chronology or causality in the event summaries or Event Log text instead.',
      '- For Location<->Location containment, keep the supported relationship in a location summary, ' +
      'not in link_ids. Example: "The lower archive is inside the temple." Keep both cards and ' +
      'their other legal links; use an empty link_ids array if no legal links remain. Do not create map edges.',
    );
    for (const error of relationErrors) {
      const pair = /^(\S+) -> (\S+) is not an allowed relation shape$/.exec(error);
      if (pair) corrections.push(`- In every proposed UPSERT_CARD or SET_LINKS for ${pair[1]}, omit ${pair[2]} from link_ids.`);
    }
  }

  if (!corrections.length) {
    corrections.push('- Correct every listed validation error without changing the schema.');
  }

  return [
    prompt,
    '',
    '## YOUR PREVIOUS REPLY WAS REJECTED',
    'Produce a materially corrected replacement. Reply again with ONE JSON',
    'document and nothing else. The schema has NOT changed and will not be relaxed.',
    '',
    '### validator errors',
    ...errors.map((e) => `- ${e}`),
    '',
    '### required corrections',
    ...corrections,
    '',
    '### rejected reply — replace it; do not merely restate it',
    String(previousReply ?? ''),
  ].join('\n');
}

const SURFACE_BUDGET_ERROR = /^SET_SURFACE ([^:]+): ~(\d+) estimated tokens exceeds enforced (\d+)$/;

/**
 * Fit complete, priority-ordered surface entries to a hard budget.
 *
 * This is deliberately non-semantic. The Archivist was instructed to order
 * lines by importance, so the extension may project that ordered proposal
 * into the space it can actually store. It never cuts through a sentence. If
 * the model ignored the one-entry-per-line contract, sentence boundaries are
 * the narrowest safe fallback. A single indivisible over-budget claim is not
 * truncated into a different claim; the current surface is retained instead.
 */
export function fitSurfaceText(text, hardLimit, currentText = '') {
  const source = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  if (estimateTokens(source) <= hardLimit) {
    return { text: source, changed: false, kept: null, total: null };
  }

  const lines = source.split('\n').map((line) => line.trim()).filter(Boolean);
  const units = [];
  for (const line of lines) {
    if (estimateTokens(line) <= hardLimit) {
      units.push(line);
      continue;
    }
    const sentences = line.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean);
    if (sentences.length > 1) units.push(...sentences);
    else units.push(line);
  }

  const kept = [];
  for (const unit of units) {
    if (estimateTokens(unit) > hardLimit) continue;
    const candidate = [...kept, unit].join('\n');
    if (estimateTokens(candidate) <= hardLimit) kept.push(unit);
  }

  if (kept.length) {
    return { text: kept.join('\n'), changed: true, kept: kept.length, total: units.length };
  }

  const existing = String(currentText ?? '').trim();
  return {
    text: estimateTokens(existing) <= hardLimit ? existing : '',
    changed: true,
    kept: 0,
    total: units.length,
    retainedCurrent: true,
  };
}

/**
 * Deterministic last-mile recovery after the ONE semantic retry.
 *
 * Only an otherwise-valid reply whose remaining errors are SET_SURFACE budget
 * overruns is eligible. Unknown operations, authority failures, bad ids and
 * every other validation error remain fatal. The returned JSON is still sent
 * through the normal strict parser, atomic apply, invariants and quota check.
 */
export function fitRetrySurfaceBudgets(rawReply, ws, errors) {
  const matches = errors.map((error) => SURFACE_BUDGET_ERROR.exec(error));
  if (!matches.length || matches.some((match) => !match)) return null;

  let doc;
  try {
    doc = parseArchivistOutput(extractJSON(rawReply));
  } catch {
    return null;
  }

  const limits = new Map(matches.map((match) => [match[1], Number(match[3])]));
  const details = [];
  for (const op of doc.operations) {
    if (op.op !== 'SET_SURFACE' || !limits.has(op.surface)) continue;
    const hardLimit = limits.get(op.surface);
    const before = estimateTokens(op.text);
    const fitted = fitSurfaceText(op.text, hardLimit, ws.surfaces[op.surface]?.text ?? '');
    op.text = fitted.text;
    details.push({
      surface: op.surface,
      before,
      after: estimateTokens(op.text),
      hardLimit,
      kept: fitted.kept,
      total: fitted.total,
      retainedCurrent: Boolean(fitted.retainedCurrent),
    });
  }

  if (!details.length) return null;
  return { output: JSON.stringify(doc), details };
}

/** Rough size of a run's prompt, for Assistant-context headroom checks. */
export function promptCost(prompt) {
  return estimateTokens(prompt);
}

/**
 * Strip a lone wrapping code fence the model may add reflexively.
 * §10b already tolerates exactly this at parse time; doing it here too means a
 * fenced reply never even reaches the validator as an error.
 */
export function unfence(text) {
  const t = String(text ?? '').trim();
  const m = /^```[A-Za-z0-9_-]*\s*\n([\s\S]*?)\n```$/.exec(t);
  return m ? m[1].trim() : t;
}

/**
 * Pull the JSON document out of a reply that has prose around it.
 *
 * §10b forbids salvage for the ARCHIVIST'S content — unknown ops, coerced
 * types, partial arrays are all fatal. This is different: it is locating the
 * document, not repairing it. Whatever is extracted still goes through the
 * strict validator unchanged.
 *
 *   law: locating != repairing
 */
export function extractJSON(text) {
  const t = unfence(text);
  if (t.startsWith('{')) return t;

  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end <= start) return t; // let the validator produce the error
  return t.slice(start, end + 1);
}

/**
 * Is this reply a COMPLETE JSON document?
 *
 * Used as the completion signal for an Archivist round trip. A streamed reply
 * is only finished when what it contains actually parses — length going quiet
 * for a moment means the model paused, not that it stopped.
 *
 *   law: stalled != finished
 *
 * This is a completion test, not a validity test. Whatever it accepts still
 * goes through the strict validator, which is where unknown ops and coerced
 * types are rejected.
 */
export function looksLikeCompleteJSON(text) {
  const t = extractJSON(text);
  if (!t.startsWith('{') || !t.endsWith('}')) return false;
  try {
    const doc = JSON.parse(t);
    return Boolean(doc) && typeof doc === 'object' && Array.isArray(doc.operations);
  } catch {
    return false;
  }
}
