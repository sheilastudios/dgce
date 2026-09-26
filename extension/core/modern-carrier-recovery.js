// Accept uncertainty about a failed cleanup, never manufacture removal evidence.
import { canonicalSha256 } from './canonical-json.js';
import { carrierHasRecoveryDependency } from './injection-lifecycle.js';
import { ATTESTATION_SCOPE, SAVED_TURN_ASSERTION } from './attestation-review.js';
import { HOST_PACKET_EQUIVALENCE, compareHostPackets, normalizeHostPacket } from './host-packet-equivalence.js';
import { augmentTurn, wrapInjection } from './injection.js';

export const MODERN_ABSENCE_ASSERTION = 'I accept that DGCE cannot determine how this exact already-reconciled carrier became absent after its failed cleanup attempt. I choose to continue from the current supported carrier-free history. This does not mark the carrier pruned, add removal evidence, change prior delivery reconciliation, acknowledge outcomes, resend, or reroll.';
const KIND = 'USER_ACCEPTED_MODERN_CLEANUP_UNCERTAINTY';
const digest = value => canonicalSha256(value).hash;
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const isTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const terminal = turn => ['observed', 'response_observed', 'user_attested_saved'].includes(turn.status);

// Historical supplied text is deliberately not retained. Validate everything
// reconstructible, but do not promote its remaining audit metadata to host proof.
function coherentRawComparison(comparison, expected) {
  const expectedDigest = digest(expected);
  const transformations = compareHostPackets(expected, expected).expected_transformations;
  if (comparison.normalized_digest !== digest(normalizeHostPacket(expected))
    || digest(comparison.expected_transformations ?? null) !== digest(transformations)
    || !Array.isArray(comparison.inspected_transformations)) return false;
  if (comparison.status === 'exact') return comparison.supplied_raw_digest === expectedDigest
    && digest(comparison.inspected_transformations) === digest(transformations);
  return comparison.supplied_raw_digest !== expectedDigest
    && transformations.length + comparison.inspected_transformations.length > 0
    && comparison.inspected_transformations.every(item => {
      if (!item || !Number.isSafeInteger(item.offset) || item.offset < 0) return false;
      if (item.stage === 'line_endings') return item.before === '\r\n' && item.after === '\n';
      if (item.stage !== 'carrier_id_quotes' || typeof item.before !== 'string') return false;
      const match = /^<ext_ctx id=[\u201c\u201d"](dgce-[0-9a-f]{6,})[\u201c\u201d"]>$/.exec(item.before);
      return Boolean(match) && item.after === `<ext_ctx id="${match[1]}">` && item.before !== item.after;
    });
}

// V1 intentionally admits only existing consequence-bound raw-editor testimony.
// A timestamp alone, an old attestation, or DOM/request observation cannot qualify.
function reconciliationBasis(ws, record) {
  if (!ws?.workspace_id || !record?.nonce || record.pruned || record.pruned_at
    || record.removal_evidence || record.host_save_verified_at
    || record.lifecycle_status !== 'prune_requested' || record.failure_reason !== 'save_uncertain'
    || !isTime(record.prune_requested_at) || carrierHasRecoveryDependency(record)
    || !isTime(record.user_attested_saved_at)
    || record.pending_outcomes_acknowledged_at !== record.user_attested_saved_at
    || Date.parse(record.prune_requested_at) < Date.parse(record.user_attested_saved_at)
    || Boolean(record.ordinary_action_id) === Boolean(record.mechanical_action_id)
    || !isHash(record.outgoing_text_hash) || typeof record.body !== 'string'
    || !Array.isArray(record.pending_texts) || record.pending_texts.some(text => typeof text !== 'string')) return null;
  const kind = record.ordinary_action_id ? 'ordinary' : 'mechanical';
  const id = record.ordinary_action_id || record.mechanical_action_id;
  if ((ws.injections ?? []).filter(item => item.nonce === record.nonce).length !== 1
    || (ws.injections ?? []).filter(item => item[`${kind}_action_id`] === id).length !== 1) return null;
  if (kind === 'mechanical') {
    const turns = (ws.mechanical_turns ?? []).filter(turn => turn.id === id);
    if (turns.length !== 1 || !terminal(turns[0]) || turns[0].user_attested_saved_at !== record.user_attested_saved_at) return null;
  }
  const receipts = (ws.delivery_reconciliations ?? []).filter(receipt =>
    receipt.kind === 'USER_ATTESTATION' && receipt.action_kind === kind && receipt.id === id);
  if (receipts.length !== 1) return null;
  const receipt = receipts[0];
  if (receipt.workspace_id !== ws.workspace_id || receipt.outcome !== 'user_attested_saved'
    || receipt.at !== record.user_attested_saved_at || receipt.scope !== ATTESTATION_SCOPE
    || receipt.assertion !== SAVED_TURN_ASSERTION || receipt.raw_interaction_inspected !== true
    || !isHash(receipt.review_snapshot_hash) || receipt.outgoing_text_hash !== record.outgoing_text_hash
    || digest(receipt.carrier_nonces ?? null) !== digest([record.nonce])
    || digest(receipt.shipped_pending_texts ?? null) !== digest(record.pending_texts)
    || !Array.isArray(receipt.acknowledged_pending_texts)
    || receipt.acknowledged_pending_digest !== digest(receipt.acknowledged_pending_texts)
    || !isHash(receipt.pending_before_digest) || !isHash(receipt.pending_after_digest)
    || !isHash(receipt.ordinary_changes_digest)
    || receipt.raw_comparison?.policy !== HOST_PACKET_EQUIVALENCE
    || !['exact', 'normalized_equivalent'].includes(receipt.raw_comparison?.status)
    || !isHash(receipt.raw_comparison?.supplied_raw_digest)
    || !isHash(receipt.raw_comparison?.normalized_digest)) return null;
  // Reconstruct the recorded packet from the attested visible text and exact
  // local carrier. A changed body cannot borrow an earlier packet's receipt.
  if (typeof receipt.expected_visible_saved_text !== 'string'
    || digest(augmentTurn(receipt.expected_visible_saved_text, wrapInjection(record.body, record.nonce))) !== record.outgoing_text_hash) return null;
  if (!coherentRawComparison(receipt.raw_comparison,
    augmentTurn(receipt.expected_visible_saved_text, wrapInjection(record.body, record.nonce)))) return null;
  const unspent = [...record.pending_texts];
  for (const text of receipt.acknowledged_pending_texts) {
    const index = unspent.indexOf(text);
    if (index < 0) return null;
    unspent.splice(index, 1);
  }
  if (kind === 'mechanical' && receipt.prior_state?.mechanical_receipt_digest
    !== digest(ws.mechanical_turns.find(turn => turn.id === id).receipt ?? null)) return null;
  // Rebind every durable field to the actual original review, not merely to
  // hash-shaped claims about consequences. The original pending turn is gone.
  const priorReview = { schema_version: 1, scope: receipt.scope, workspace_id: receipt.workspace_id,
    equivalence_policy: HOST_PACKET_EQUIVALENCE, action_kind: receipt.action_kind, action_id: receipt.id,
    assertion: receipt.assertion, expected_visible_saved_text: receipt.expected_visible_saved_text,
    expected_raw_saved_text: augmentTurn(receipt.expected_visible_saved_text, wrapInjection(record.body, record.nonce)),
    outgoing_text_hash: receipt.outgoing_text_hash, carrier_nonces: receipt.carrier_nonces,
    expected_carriers: [{ nonce: record.nonce, body: record.body }],
    shipped_pending_texts: receipt.shipped_pending_texts, acknowledged_pending_texts: receipt.acknowledged_pending_texts,
    acknowledged_pending_digest: receipt.acknowledged_pending_digest,
    pending_before_digest: receipt.pending_before_digest, pending_after_digest: receipt.pending_after_digest,
    ordinary_changes_digest: receipt.ordinary_changes_digest, ordinary_changes_summary: receipt.ordinary_changes_summary,
    prior_state: receipt.prior_state, prior_carrier_evidence: receipt.prior_carrier_evidence };
  if (digest(priorReview) !== receipt.review_snapshot_hash) return null;
  return { kind, id, receipt_digest: digest(receipt) };
}

function coherentDisposition(receipt) {
  if (receipt.consequence !== 'allow_absent_reconciled_modern_record_only'
    || receipt.acknowledged_outcomes !== 0 || !isTime(receipt.at)
    || ['delivery_verified', 'removal_verified', 'server_durability_verified', 'model_consumption_verified',
      'resend', 'reroll', 'cleanup_retry'].some(key => receipt[key] !== false)) return false;
  const review = { schema_version: receipt.schema_version, workspace_id: receipt.workspace_id,
    record: receipt.record, action: receipt.action, history: receipt.history, state_digest: receipt.state_digest };
  return isHash(receipt.review_snapshot_hash) && digest(review) === receipt.review_snapshot_hash;
}

export function modernAbsenceAccepted(ws, record) {
  const basis = reconciliationBasis(ws, record);
  if (!basis) return false;
  const current = ws.injections.find(item => item.nonce === record.nonce);
  if (digest(current) !== digest(record)) return false;
  return (ws.modern_carrier_dispositions ?? []).some(receipt => receipt.kind === KIND
    && receipt.schema_version === 1 && receipt.workspace_id === ws.workspace_id
    && receipt.assertion === MODERN_ABSENCE_ASSERTION
    && coherentDisposition(receipt)
    && receipt.record?.nonce === record.nonce && receipt.record.record_digest === digest(record)
    && digest(receipt.action) === digest(basis));
}

export function buildModernAbsenceReview(ws, history, nonce) {
  if (!ws?.workspace_id || history?.kind !== 'SUPPORTED_HOST_CARRIER_FREE_SNAPSHOT'
    || history.workspace_id !== ws.workspace_id || history.scope !== 'supported_host_load_all_cycle'
    || !Number.isSafeInteger(history.interaction_count) || history.interaction_count < 1
    || !isHash(history.history_digest)) throw new Error('A current positive carrier-free history witness is required.');
  if (ws.ordinary_pending || (ws.campaign?.pending ?? []).length
    || (ws.mechanical_turns ?? []).some(turn => !terminal(turn))) {
    throw new Error('Reconcile current actions and pending outcomes first; cleanup uncertainty cannot acknowledge them.');
  }
  const matches = (ws.injections ?? []).filter(record => record.nonce === nonce);
  const record = matches.length === 1 ? matches[0] : null;
  const basis = reconciliationBasis(ws, record);
  if (!basis || modernAbsenceAccepted(ws, record)) {
    throw new Error('Requires one unpruned modern carrier with failed cleanup and matching consequence-bound raw-editor attestation.');
  }
  const review = { schema_version: 1, workspace_id: ws.workspace_id,
    record: { nonce, record_digest: digest(record), prune_requested_at: record.prune_requested_at,
      failure_reason: record.failure_reason, failure_detail: record.failure_detail ?? null },
    action: basis, history,
    state_digest: digest({ injections: ws.injections, campaign: ws.campaign ?? null,
      current_turn: ws.current_turn ?? null, mechanical_turns: ws.mechanical_turns ?? [],
      delivery_reconciliations: ws.delivery_reconciliations ?? [],
      legacy_dispositions: ws.legacy_carrier_dispositions ?? [], dispositions: ws.modern_carrier_dispositions ?? [] }) };
  return { ...review, review_snapshot_hash: digest(review) };
}

/** Under the workspace lock, with freshly captured host evidence and a render-pinned hash. */
export function acceptModernAbsence(ws, { history, nonce, review_snapshot_hash, assertion, at = Date.now() }) {
  if (assertion !== MODERN_ABSENCE_ASSERTION || !Number.isFinite(new Date(at).getTime())) throw new Error('Explicit acceptance of cleanup uncertainty is required.');
  let review;
  try { review = buildModernAbsenceReview(ws, history, nonce); }
  catch (error) { throw new Error(`STALE_MODERN_ABSENCE_REVIEW: ${error.message}`); }
  if (review.review_snapshot_hash !== review_snapshot_hash) throw new Error('STALE_MODERN_ABSENCE_REVIEW: history or reviewed state changed; review again.');
  const receipt = { ...review, kind: KIND, assertion, at: new Date(at).toISOString(),
    consequence: 'allow_absent_reconciled_modern_record_only', acknowledged_outcomes: 0,
    delivery_verified: false, removal_verified: false, server_durability_verified: false,
    model_consumption_verified: false, resend: false, reroll: false, cleanup_retry: false };
  ws.modern_carrier_dispositions ??= [];
  ws.modern_carrier_dispositions.push(receipt);
  return receipt;
}
