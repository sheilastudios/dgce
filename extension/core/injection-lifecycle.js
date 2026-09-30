// Provenance lifecycle for extension-owned request carriers.
//
// Release, request observation, exact host identity, user attestation and
// verified removal are distinct facts. See docs/DELIVERY-LIFECYCLE.md.
import { stripRecordedInjection } from './injection.js';
import { canonicalSha256 } from './canonical-json.js';
import { buildAttestationReview, compareAttestationPacket, ATTESTATION_SCOPE, SAVED_TURN_ASSERTION } from './attestation-review.js';
import { normalizeHostPacket } from './host-packet-equivalence.js';
export { buildAttestationReview, ATTESTATION_SCOPE, SAVED_TURN_ASSERTION } from './attestation-review.js';
export { normalizeHostPacket } from './host-packet-equivalence.js';

/** A DOM nonce (even with the right body) is not the bound host interaction.
 * Callers must supply an independently read host identity, never copy it from
 * the record into a purported witness. The current DOM adapter has no such
 * identity contract and deliberately cannot produce this stronger evidence. */
export function completionEvidenceStatus(ws, record, witness) {
  const released = Date.parse(record?.native_submit_attempt_at), requested = Date.parse(record?.network_observed_at);
  if (!record?.request_id || record.native_submission !== true || !Number.isFinite(released)
    || !Number.isFinite(requested) || requested < released + 1) return 'release_unverified';
  if (!witness || witness.kind !== 'HOST_INTERACTION_READBACK') return 'host_identity_unavailable';
  if (witness.candidate_count !== 1) return 'ambiguous_candidates';
  if (witness.workspace_id !== ws.workspace_id) return 'workspace_mismatch';
  if (!record.interaction_id || witness.interaction_id !== record.interaction_id) return 'interaction_mismatch';
  if (!Object.hasOwn(record, 'request_parent_id') || !Object.hasOwn(witness, 'parent_id')) return 'parent_identity_unavailable';
  if (witness.parent_id !== record.request_parent_id) return 'parent_mismatch';
  if (typeof witness.raw_text !== 'string' || !record.outgoing_text_hash
    || canonicalSha256(normalizeHostPacket(witness.raw_text)).hash
      !== (record.normalized_outgoing_text_hash ?? record.outgoing_text_hash)) return 'packet_mismatch';
  if (witness.nonce !== record.nonce || stripRecordedInjection(witness.raw_text, record).status !== 'matched') return 'carrier_mismatch';
  return 'exact_action_observed';
}

/** Historical acknowledgments are not retroactively upgraded. New completion
 * paths set this field only after exact evidence or explicit user attestation. */
export function carrierHasRecoveryDependency(record) {
  return Boolean((record?.mechanical_action_id || record?.ordinary_action_id)
    && !record.pending_outcomes_acknowledged_at);
}

export const INJECTION_LIFECYCLE = Object.freeze({
  PLANNED: 'planned',
  DISPATCHED: 'dispatch_acknowledged',
  OBSERVED: 'host_persisted_or_observed',
  RESPONSE_OBSERVED: 'response_observed',
  PRUNE_REQUESTED: 'prune_requested',
  HOST_SAVE_VERIFIED: 'host_save_verified',
  PRUNED: 'pruned',
  NOT_DISPATCHED: 'not_dispatched',
  LEGACY: 'legacy_unverified',
});

const iso = (value = Date.now()) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export function injectionLifecycleStatus(record) {
  if (record?.pruned) return INJECTION_LIFECYCLE.PRUNED;
  return record?.lifecycle_status ?? INJECTION_LIFECYCLE.LEGACY;
}

export function carrierMayHaveExisted(record) {
  return Boolean(record?.native_submission || record?.native_submit_attempt_at || record?.release_attempt_at
    || record?.request_id || record?.unexpected_request_id || record?.dispatch_status === 'dispatched'
    || [INJECTION_LIFECYCLE.LEGACY, INJECTION_LIFECYCLE.DISPATCHED, INJECTION_LIFECYCLE.OBSERVED,
      INJECTION_LIFECYCLE.RESPONSE_OBSERVED, INJECTION_LIFECYCLE.PRUNE_REQUESTED,
      INJECTION_LIFECYCLE.HOST_SAVE_VERIFIED].includes(injectionLifecycleStatus(record)));
}

export function applyDispatchAcknowledgement(ws, acknowledgement) {
  const requestId = String(acknowledgement?.request_id ?? '');
  const nonce = String(acknowledgement?.injection_nonce ?? '');
  // Correlation is not authentication. Require the complete pair even for
  // trusted callers; the shared-page transport still needs replacement.
  if (!requestId || !nonce) return { status: 'missing_identity', changed: false };
  const record = (ws?.injections ?? []).find((item) =>
    item.request_id === requestId);
  if (!record) return { status: 'unknown_request', changed: false };
  if (nonce && nonce !== record.nonce) return { status: 'nonce_mismatch', changed: false };
  if (record.lifecycle_status === INJECTION_LIFECYCLE.PRUNED) {
    return { status: INJECTION_LIFECYCLE.PRUNED, changed: false };
  }

  const selected = acknowledgement?.replacement_selected === true;
  if (acknowledgement?.bridge_transport === 'sync_event_v1') {
    record.bridge_transport = acknowledgement.bridge_transport;
    if (Number.isFinite(acknowledgement.bridge_elapsed_ms) && acknowledgement.bridge_elapsed_ms >= 0) {
      record.bridge_elapsed_ms = acknowledgement.bridge_elapsed_ms;
    }
  }
  record.dispatch_ack_at = iso(acknowledgement?.timestamp);
  if (selected) {
    record.dispatch_status = 'dispatched';
    if (![INJECTION_LIFECYCLE.OBSERVED, INJECTION_LIFECYCLE.RESPONSE_OBSERVED,
      INJECTION_LIFECYCLE.PRUNE_REQUESTED, INJECTION_LIFECYCLE.HOST_SAVE_VERIFIED]
      .includes(record.lifecycle_status)) {
      record.lifecycle_status = INJECTION_LIFECYCLE.DISPATCHED;
    }
    record.failure_reason = null;
  } else if (record.observed_in_host_history_at) {
    // Direct host observation is later, stronger evidence than a missing or
    // timed-out bridge ACK. Preserve both facts instead of rewinding the
    // lifecycle to a claim that the carrier cannot have existed.
    record.dispatch_status = 'ack_failed_but_host_observed';
    if (![INJECTION_LIFECYCLE.RESPONSE_OBSERVED, INJECTION_LIFECYCLE.PRUNE_REQUESTED,
      INJECTION_LIFECYCLE.HOST_SAVE_VERIFIED].includes(record.lifecycle_status)) {
      record.lifecycle_status = INJECTION_LIFECYCLE.OBSERVED;
    }
    record.failure_reason = String(
      acknowledgement?.failure_reason ?? 'MAIN world did not acknowledge replacement selection',
    );
  } else {
    record.dispatch_status = 'not_dispatched';
    record.lifecycle_status = INJECTION_LIFECYCLE.NOT_DISPATCHED;
    record.failure_reason = String(
      acknowledgement?.failure_reason ?? 'MAIN world did not select the replacement',
    );
  }
  return { status: record.lifecycle_status, changed: true, nonce: record.nonce };
}

export function markInjectionObserved(ws, nonce, observedAt = Date.now(), witness = null) {
  const record = (ws?.injections ?? []).find((item) => item.nonce === nonce);
  if (!record) return { status: 'unknown_nonce', changed: false };
  if (ws.injections.filter(item => item.nonce === nonce).length !== 1) return { status: 'ambiguous_ledger', changed: false };
  if (record.handoff_prepared_at && (!record.request_id || !record.native_submission || !record.native_submit_attempt_at)) {
    return { status: 'release_unverified', changed: false };
  }
  const evidenceStatus = completionEvidenceStatus(ws, record, witness);
  if (evidenceStatus !== 'exact_action_observed') return { status: evidenceStatus, changed: false };
  if (![INJECTION_LIFECYCLE.PLANNED, INJECTION_LIFECYCLE.DISPATCHED, INJECTION_LIFECYCLE.OBSERVED,
    INJECTION_LIFECYCLE.NOT_DISPATCHED]
    .includes(record.lifecycle_status)) {
    return { status: record.lifecycle_status ?? INJECTION_LIFECYCLE.LEGACY, changed: false };
  }
  if (record.observed_in_host_history_at) {
    return { status: INJECTION_LIFECYCLE.OBSERVED, changed: false };
  }
  record.observed_in_host_history_at = iso(observedAt);
  record.dispatch_status = 'dispatched';
  record.lifecycle_status = INJECTION_LIFECYCLE.OBSERVED;
  record.completion_evidence = { kind: witness.kind, workspace_id: witness.workspace_id,
    interaction_id: witness.interaction_id, parent_id: witness.parent_id,
    packet_hash: record.outgoing_text_hash, nonce, candidate_count: 1, at: iso(observedAt) };
  acknowledgeOutcomes(ws, record, observedAt);
  return { status: record.lifecycle_status, changed: true, nonce };
}

function acknowledgeOutcomes(ws, record, at, response = false) {
    if (record.ordinary_action_id && ws.ordinary_pending?.id === record.ordinary_action_id && record.request_id) {
      delete ws.ordinary_pending;
    }
  if (!record.pending_outcomes_acknowledged_at) {
    const remaining = [...(ws.campaign?.pending ?? [])];
    for (const text of record.pending_texts ?? []) {
      const index = remaining.indexOf(text);
      if (index !== -1) remaining.splice(index, 1);
    }
    if (ws.campaign) ws.campaign.pending = remaining;
    record.pending_outcomes_acknowledged_at = iso(at);
  }
  const turn = ws.mechanical_turns?.find(item => item.id === record.mechanical_action_id);
  if (turn) {
    turn.status = response ? 'response_observed' : 'observed';
    turn.observed_at ??= iso(at);
  }
}

export function markInjectionPruneRequested(ws, nonces, requestedAt = Date.now()) {
  const wanted = new Set(nonces ?? []);
  let changed = 0;
  for (const record of ws?.injections ?? []) {
    if (!wanted.has(record.nonce) || record.pruned || carrierHasRecoveryDependency(record)) continue;
    record.prune_requested_at = iso(requestedAt);
    record.lifecycle_status = INJECTION_LIFECYCLE.PRUNE_REQUESTED;
    changed += 1;
  }
  return changed;
}

/** A later row alone is NOT a response. This accepts typed causal witnesses. */
export function markInjectionResponseObserved(ws, witnesses, observedAt = Date.now()) {
  let changed = 0;
  for (const record of ws?.injections ?? []) {
    const witness = witnesses?.find(item => item?.nonce === record.nonce);
    if (record.pruned || !record.completion_evidence || witness?.kind !== 'HOST_RESPONSE_READBACK'
      || witness.workspace_id !== ws.workspace_id || witness.parent_id !== record.interaction_id
      || !witness.interaction_id || witness.interaction_id === record.interaction_id
      || witness.candidate_count !== 1 || witness.author !== 'model' || witness.completed !== true) continue;
    if (record.handoff_prepared_at && (!record.request_id || !record.native_submission || !record.native_submit_attempt_at)) continue;
    if (![INJECTION_LIFECYCLE.OBSERVED, INJECTION_LIFECYCLE.DISPATCHED,
      INJECTION_LIFECYCLE.RESPONSE_OBSERVED].includes(record.lifecycle_status)) continue;
    if (!record.response_observed_at) record.response_observed_at = iso(observedAt);
    record.response_evidence = structuredClone(witness);
    record.lifecycle_status = INJECTION_LIFECYCLE.RESPONSE_OBSERVED;
    acknowledgeOutcomes(ws, record, observedAt, true);
    changed += 1;
  }
  return changed;
}

export const REMOVAL_READBACK_KIND = 'isolated_history_slot_editor_readback';

/** Compatibility name: this records native-editor readback, NOT server durability.
 * The live caller supplies the adapter's evidence kind. Omitted qualification
 * stays unknown; neither old records nor old callers gain inferred evidence.
 * A later, stronger observation must be recorded separately, not overwrite this. */
export function markInjectionHostSaveVerified(ws, nonces, verifiedAt = Date.now(), evidenceKind = null) {
  if (evidenceKind !== null && evidenceKind !== REMOVAL_READBACK_KIND) {
    throw new Error('Unsupported removal readback evidence');
  }
  const observedAt = iso(verifiedAt);
  if (!observedAt) throw new Error('Invalid removal observation time');
  const wanted = new Set(nonces ?? []);
  let changed = 0;
  for (const record of ws?.injections ?? []) {
    if (!wanted.has(record.nonce) || record.pruned || carrierHasRecoveryDependency(record)) continue;
    if (ws.injections.filter(item => item.nonce === record.nonce).length !== 1) continue;
    // First qualified observation is immutable, including on retry. Do not
    // replace an existing qualification (even an unfamiliar future kind).
    if (record.removal_evidence != null) continue;
    if (evidenceKind !== null) {
      record.removal_evidence = {
        kind: evidenceKind,
        scope: 'bounded_in_page',
        observed_at: observedAt,
        server_durability: 'unverified',
      };
    }
    record.host_save_verified_at = observedAt;
    record.lifecycle_status = INJECTION_LIFECYCLE.HOST_SAVE_VERIFIED;
    changed += 1;
  }
  return changed;
}

export function markInjectionPruned(ws, nonces, prunedAt = Date.now()) {
  const wanted = new Set(nonces ?? []);
  let changed = 0;
  for (const record of ws?.injections ?? []) {
    if (!wanted.has(record.nonce) || record.pruned || carrierHasRecoveryDependency(record)) continue;
    record.pruned = true;
    record.pruned_at = iso(prunedAt);
    record.host_save_verified_at ??= record.pruned_at;
    record.failure_reason = null;
    record.lifecycle_status = INJECTION_LIFECYCLE.PRUNED;
    changed += 1;
  }
  return changed;
}

/** Must run inside the workspace's locked transaction. It adjudicates delivery,
 * not fiction, RNG or host persistence. Prior machine uncertainty is retained. */
export function attestSavedTurn(ws, { kind, id, assertion, review_snapshot_hash, scope,
  raw_interaction_inspected = false, inspected_raw_text, at = Date.now() }) {
  if (!['ordinary', 'mechanical'].includes(kind) || assertion !== SAVED_TURN_ASSERTION || !iso(at)
    || scope !== ATTESTATION_SCOPE || raw_interaction_inspected !== true) {
    throw new Error('Explicit raw-interaction inspection and consequence approval are required; visible-turn confirmation is insufficient.');
  }
  let review;
  try { review = buildAttestationReview(ws, { kind, id }); } catch (cause) {
    throw Object.assign(new Error(`STALE_ATTESTATION_REVIEW: Pending turn changed; review it again. ${cause.message}`), { code: 'STALE_ATTESTATION_REVIEW' });
  }
  if (!review_snapshot_hash || review_snapshot_hash !== review.review_snapshot_hash) {
    throw Object.assign(new Error('STALE_ATTESTATION_REVIEW: reviewed state changed; reopen and compare the current review.'), { code: 'STALE_ATTESTATION_REVIEW' });
  }
  const comparison = compareAttestationPacket(review, inspected_raw_text);
  if (!comparison.equivalent) {
    throw Object.assign(new Error('RAW_INTERACTION_MISMATCH: supplied editor text is missing or differs outside the permitted host normalization. Nothing reconciled.'), { code: 'RAW_INTERACTION_MISMATCH' });
  }
  // Nothing above this line mutates state. The caller recomputes this under its
  // lock, with the hash pinned when the human review was rendered, not on click.
  const pending = kind === 'ordinary' ? ws.ordinary_pending : ws.mechanical_turns.find(turn => turn.id === id);
  const records = (ws.injections ?? []).filter(record =>
    record[kind === 'ordinary' ? 'ordinary_action_id' : 'mechanical_action_id'] === id);
  const receipt = { kind: 'USER_ATTESTATION', outcome: 'user_attested_saved', action_kind: kind, id,
    at: iso(at), assertion, scope, raw_interaction_inspected: true, workspace_id: ws.workspace_id,
    review_snapshot_hash, expected_visible_saved_text: review.expected_visible_saved_text,
    raw_comparison: { policy: comparison.policy, status: comparison.status,
      supplied_raw_digest: canonicalSha256(inspected_raw_text).hash,
      normalized_digest: canonicalSha256(normalizeHostPacket(inspected_raw_text)).hash,
      expected_transformations: comparison.expected_transformations,
      inspected_transformations: comparison.inspected_transformations },
    outgoing_text_hash: review.outgoing_text_hash, carrier_nonces: review.carrier_nonces,
    shipped_pending_texts: review.shipped_pending_texts,
    acknowledged_pending_texts: review.acknowledged_pending_texts,
    acknowledged_pending_digest: review.acknowledged_pending_digest,
    pending_before_digest: review.pending_before_digest, pending_after_digest: review.pending_after_digest,
    ordinary_changes_digest: review.ordinary_changes_digest, ordinary_changes_summary: review.ordinary_changes_summary,
    prior_state: review.prior_state, prior_carrier_evidence: review.prior_carrier_evidence };
  // Append before mutation; no prior receipt is overwritten or reclassified.
  ws.delivery_reconciliations ??= [];
  ws.delivery_reconciliations.push(receipt);
  ws.delivery_metrics ??= {};
  ws.delivery_metrics.user_attestation_count = (ws.delivery_metrics.user_attestation_count ?? 0) + 1;
  for (const record of records) {
    acknowledgeOutcomes(ws, record, at);
    record.user_attested_saved_at = receipt.at;
  }
  if (kind === 'ordinary') {
    ws.last_ordinary_reconciliation = structuredClone(receipt);
    delete ws.ordinary_pending;
  } else {
    pending.status = 'user_attested_saved';
    delete pending.observed_at; // testimony must not manufacture observation
    pending.user_attested_saved_at = receipt.at;
  }
  return receipt;
}
