// Atomic Archivist apply. Spec §10b, §16b (C-B, C-D, C-F).
//
// The contract in one line: an Archivist run either lands whole or leaves the
// workspace byte-for-byte unchanged.
//
//   law: invalid_Archivist_output = no_state_change
//        partial_apply is prohibited
//        duplicate_run_id => reject_apply

import { cloneWorkspace, createCard, serialize } from './workspace.js';
import { kindOfId, isLegalRelation } from './ids.js';
import { promoteToActive, appendConfirmed, activityOf } from './ordering.js';
import { checkMergeLegality, checkAutoMergePolicy, mergeCards } from './merge.js';
import { rebuildAliasIndex, resolveRedirect } from './aliases.js';
import { supportCard } from './freshness.js';
import { parseArchivistOutput, ParseError } from './parse.js';
import { buildPreimage } from './undo.js';
import { checkHeadroom } from './quota.js';
import { estimateTokens, enforcementTarget } from './tokens.js';
import { protectedCardMatch } from './entity-authority.js';

const MAX_RECEIPTS = 50;

export function hasAppliedRun(ws, runId) {
  return ws.receipts.some((r) => r.run_id === runId && r.status === 'applied');
}

function receipt(runId, status, extra) {
  return { run_id: runId, timestamp: Date.now(), status, ...extra };
}

function pushReceipt(ws, r) {
  ws.receipts = [r, ...ws.receipts].slice(0, MAX_RECEIPTS);
  return ws;
}

/**
 * Apply one Archivist response.
 *
 * Returns { status, workspace, receipt, errors }.
 *   'applied'  — workspace is the new committed state
 *   'rejected' — workspace is the ORIGINAL, untouched
 *
 * The caller persists `workspace` only on 'applied'. On rejection the returned
 * workspace is the same object identity that came in, so a caller that
 * unconditionally writes it back still cannot corrupt anything.
 */
export function applyArchivistRun(
  ws,
  rawOutput,
  {
    outstandingRunId,
    expectedRevision = ws.revision,
    otherNamespaceBytes = 0,
    rankable = null,
    protectedEntities = null,
  } = {},
) {
  const reject = (errors, runId = 'unknown') => ({
    status: 'rejected',
    workspace: ws,
    receipt: receipt(runId, 'failed', {
      validation_errors: errors,
      pre_revision: ws.revision,
      operation_count: 0,
    }),
    errors,
  });

  // --- parse + structural validation -------------------------------------
  let doc;
  try {
    doc = parseArchivistOutput(rawOutput);
  } catch (e) {
    if (e instanceof ParseError) return reject(e.errors);
    throw e;
  }

  // --- C-B: run_id authority and replay ----------------------------------
  if (outstandingRunId != null && doc.run_id !== outstandingRunId) {
    return reject(
      [`run_id ${doc.run_id} does not match outstanding run ${outstandingRunId}`],
      doc.run_id,
    );
  }
  if (hasAppliedRun(ws, doc.run_id)) {
    // A valid duplicate delivery is a no-op, not a second application.
    return {
      status: 'rejected',
      workspace: ws,
      receipt: receipt(doc.run_id, 'duplicate', { pre_revision: ws.revision, operation_count: 0 }),
      errors: [`run_id ${doc.run_id} has already been applied`],
    };
  }

  // --- §16b: the state must not have moved under the run -----------------
  if (ws.revision !== expectedRevision) {
    return reject(
      [`workspace revision ${ws.revision} != expected ${expectedRevision}; refresh and retry`],
      doc.run_id,
    );
  }

  // --- budget checks, before any mutation ---------------------------------
  const errors = [];
  const promotions = doc.operations.filter((o) => o.op === 'PROMOTE_TO_ACTIVE');
  const protectedUpserts = doc.operations
    .filter((op) => op.op === 'UPSERT_CARD')
    .map((op) => ({ op, match: protectedCardMatch(op, protectedEntities) }))
    .filter((item) => item.match);
  for (const { op, match } of protectedUpserts) {
    errors.push(
      `UPSERT_CARD ${op.id}: ${match.name} is already owned by ` +
      `${match.source ?? 'an authoritative definition'}`,
    );
  }
  if (promotions.length > ws.settings.max_archivist_promotions_per_run) {
    errors.push(
      `promotion budget exceeded: ${promotions.length} > ${ws.settings.max_archivist_promotions_per_run}`,
    );
  }

  // Report every oversized surface in one validation pass. Surface checks in
  // applyOther remain as defense in depth, but discovering them sequentially
  // would make a deterministic fitting pass repair one surface only to expose
  // the next one on re-apply.
  for (const op of doc.operations.filter((item) => item.op === 'SET_SURFACE')) {
    const surface = ws.surfaces[op.surface];
    const limit = enforcementTarget(surface.max_tokens);
    const cost = estimateTokens(op.text);
    if (cost > limit) {
      errors.push(
        `SET_SURFACE ${op.surface}: ~${cost} estimated tokens exceeds enforced ${limit}`,
      );
    }
  }

  // §5 rank scope. The scope is now wide, but "wide" still means "what was
  // actually in the context of this run". A proposal about a card the
  // Archivist was never shown is a claim it had no basis to make, whatever the
  // window size.
  //
  //   law: must_not_rank any card not present in the context of that run
  if (rankable) {
    for (const op of promotions) {
      if (!rankable.has(op.id)) {
        errors.push(`PROMOTE_TO_ACTIVE ${op.id}: card was not supplied in this run's context`);
      }
    }
  }

  if (errors.length) return reject(errors, doc.run_id);

  // --- apply to a clone ---------------------------------------------------
  const next = cloneWorkspace(ws);
  let autoMergesUsed = 0;

  // UPSERT first so later operations in the same run may reference cards the
  // run itself creates. Document order is preserved within each phase.
  const upserts = doc.operations.filter((o) => o.op === 'UPSERT_CARD');
  const rest = doc.operations.filter((o) => o.op !== 'UPSERT_CARD');

  try {
    for (const op of upserts) applyUpsert(next, op);
    for (const op of rest) {
      autoMergesUsed = applyOther(next, op, autoMergesUsed);
    }
  } catch (e) {
    return reject([e.message], doc.run_id);
  }

  rebuildAliasIndex(next);

  // --- deterministic invariants on the result -----------------------------
  const invariantErrors = checkInvariants(next);
  if (invariantErrors.length) return reject(invariantErrors, doc.run_id);

  // --- C-F: preimage, then quota preflight on projected peak --------------
  next.undo = buildPreimage(ws, next);
  next.revision = ws.revision + 1;
  next.updated_at = Date.now();

  const noChange = doc.operations.length === 1 && doc.operations[0].op === 'NO_CHANGE';
  const applied = receipt(doc.run_id, 'applied', {
    pre_revision: ws.revision,
    post_revision: next.revision,
    operation_count: noChange ? 0 : doc.operations.length,
    no_change: noChange,
  });
  pushReceipt(next, applied);

  const headroom = checkHeadroom(next, { otherNamespaceBytes });
  if (!headroom.ok) {
    return reject(
      [
        `projected storage ${headroom.projected}B exceeds safe headroom ${headroom.limit}B ` +
          `(quota ${headroom.quota}B); workspace preserved unchanged`,
      ],
      doc.run_id,
    );
  }

  return { status: 'applied', workspace: next, receipt: applied, errors: [] };
}

// --------------------------------------------------------------------------

function applyUpsert(ws, op) {
  if (kindOfId(op.id) !== op.kind) {
    throw new Error(`UPSERT_CARD: id ${op.id} does not match kind ${op.kind}`);
  }

  const existing = ws.cards[op.id];
  if (existing) {
    existing.name_or_title = op.name_or_title;
    existing.summary = op.summary;
    existing.aliases = [...op.aliases];
    existing.link_ids = [...new Set(op.link_ids)];
    // An Archivist revision made from current evidence is support (C-C).
    supportCard(ws, op.id);
    if (op.review_state === 'confirmed' && existing.review_state !== 'confirmed') {
      throw new Error(
        `UPSERT_CARD: ${op.id} cannot be confirmed by Archivist output; ` +
          `confirmation is mechanical only (§7b)`,
      );
    }
    return;
  }

  // New Archivist-created cards default unconfirmed regardless of what the
  // model asked for. §7b default_for_Archivist_created_one_off_card.
  const card = createCard({
    id: op.id,
    kind: op.kind,
    name_or_title: op.name_or_title,
    summary: op.summary,
    aliases: op.aliases,
    link_ids: [...new Set(op.link_ids)],
    review_state: 'unconfirmed',
  });
  card.last_supported_turn = ws.current_turn;
  card.last_touched = ws.current_turn;
  ws.cards[op.id] = card;
  ws.unconfirmed[op.kind].push(op.id);
}

function applyOther(ws, op, autoMergesUsed) {
  switch (op.op) {
    case 'NO_CHANGE':
      return autoMergesUsed;

    case 'SET_SURFACE': {
      const surface = ws.surfaces[op.surface];
      const limit = enforcementTarget(surface.max_tokens);
      const cost = estimateTokens(op.text);
      if (cost > limit) {
        throw new Error(
          `SET_SURFACE ${op.surface}: ~${cost} estimated tokens exceeds enforced ${limit}`,
        );
      }
      surface.text = op.text;
      surface.last_archivist_refresh_turn = ws.current_turn;
      return autoMergesUsed;
    }

    case 'SET_LINKS': {
      const card = ws.cards[op.id];
      if (!card) throw new Error(`SET_LINKS: no such card ${op.id}`);
      card.link_ids = [...new Set(op.link_ids)];
      return autoMergesUsed;
    }

    case 'PROMOTE_TO_ACTIVE':
      promoteToActive(ws, op.kind, op.id, op.active_position);
      return autoMergesUsed;

    case 'REVIEW_SIGNAL': {
      const card = ws.cards[op.id];
      if (!card) throw new Error(`REVIEW_SIGNAL: no such card ${op.id}`);
      card.review_signals = [
        ...card.review_signals.filter((s) => s.reason_code !== op.reason_code),
        { reason_code: op.reason_code, detail: op.detail ?? null, turn: ws.current_turn },
      ];
      return autoMergesUsed;
    }

    case 'MERGE_CARD': {
      const legality = checkMergeLegality(ws, op.duplicate_id, op.canonical_id);
      if (!legality.legal) throw new Error(`MERGE_CARD illegal: ${legality.reason}`);

      const policy = checkAutoMergePolicy(ws, op.duplicate_id, op.canonical_id, { autoMergesUsed });
      if (!policy.allowed) throw new Error(`MERGE_CARD refused: ${policy.reason}`);

      mergeCards(ws, op.duplicate_id, op.canonical_id);
      return autoMergesUsed + 1;
    }

    default:
      throw new Error(`unreachable op ${op.op}`);
  }
}

/** Deterministic invariants over the resulting clone. §10b step 4. */
export function checkInvariants(ws) {
  const errors = [];

  for (const [kind, list] of Object.entries(ws.order)) {
    const seen = new Set();
    for (const id of list) {
      if (seen.has(id)) errors.push(`order.${kind} contains ${id} twice`);
      seen.add(id);
      const card = ws.cards[id];
      if (!card) { errors.push(`order.${kind} references missing card ${id}`); continue; }
      if (card.review_state !== 'confirmed') errors.push(`order.${kind} contains unconfirmed ${id}`);
      if (kindOfId(id) !== kind) errors.push(`order.${kind} contains wrong-kind ${id}`);
      if (ws.unconfirmed[kind].includes(id)) errors.push(`${id} is both ranked and unconfirmed`);
    }
  }

  for (const card of Object.values(ws.cards)) {
    for (const link of card.link_ids) {
      if (link === card.id) errors.push(`${card.id} links to itself`);
      if (!isLegalRelation(card.id, link)) {
        errors.push(`${card.id} -> ${link} is not an allowed relation shape`);
      }
      const target = ws.cards[link] ? link : ws.redirects[link] ? resolveRedirect(ws, link) : null;
      if (!target || !ws.cards[target]) errors.push(`${card.id} links to missing card ${link}`);
    }
  }

  for (const [oldId, canonical] of Object.entries(ws.redirects)) {
    if (!ws.cards[canonical]) errors.push(`redirect ${oldId} -> missing ${canonical}`);
  }

  for (const kind of Object.keys(ws.order)) {
    const pinned = ws.order[kind].filter((id) => ws.cards[id]?.pinned);
    if (pinned.length > ws.settings.pinned_cap) {
      errors.push(`pinned_cap exceeded for ${kind}: ${pinned.length} > ${ws.settings.pinned_cap}`);
    }
  }

  for (const [name, surface] of Object.entries(ws.surfaces)) {
    const limit = enforcementTarget(surface.max_tokens);
    if (estimateTokens(surface.text) > limit) {
      errors.push(`surface ${name} exceeds enforced budget of ${limit} estimated tokens`);
    }
  }

  return errors;
}

export { serialize, activityOf, appendConfirmed };
