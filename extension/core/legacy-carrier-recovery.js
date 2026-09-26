// An operator's decision to proceed despite legacy uncertainty is neither a
// delivery receipt nor evidence that the host deleted an interaction/carrier.
import { canonicalSha256 } from './canonical-json.js';
import { carrierMayHaveExisted } from './injection-lifecycle.js';

export const LEGACY_ABSENCE_ASSERTION = 'I accept the unresolved delivery and removal history of these exact legacy records and choose to continue from the currently loaded carrier-free history. This does not confirm delivery, deletion, or model consumption, acknowledge outcomes, or resend or reroll anything.';
const KIND = 'USER_ACCEPTED_LEGACY_UNCERTAINTY';
const digest = value => canonicalSha256(value).hash;

export function isLegacyAbsenceEligible(record) {
  return Boolean(record?.nonce && !record.pruned && carrierMayHaveExisted(record)
    && !record.ordinary_action_id && !record.mechanical_action_id
    && !record.handoff_prepared_at && !record.native_submission && !record.native_submit_attempt_at
    && !record.release_attempt_at && !record.outgoing_text_hash && !record.outgoing_text
    && !(record.pending_texts?.length));
}

export function legacyAbsenceAccepted(workspace, record) {
  if (!workspace?.workspace_id || !isLegacyAbsenceEligible(record)) return false;
  const current = (workspace.injections ?? []).filter(item => item.nonce === record.nonce);
  if (current.length !== 1 || digest(current[0]) !== digest(record)) return false;
  return (workspace.legacy_carrier_dispositions ?? []).some(receipt => receipt.kind === KIND
    && receipt.schema_version === 1 && receipt.workspace_id === workspace.workspace_id
    && receipt.assertion === LEGACY_ABSENCE_ASSERTION
    && receipt.records?.some(item => item.nonce === record.nonce && item.record_digest === digest(record)));
}

export function buildLegacyAbsenceReview(ws, history, nonces) {
  if (!ws?.workspace_id || history?.kind !== 'SUPPORTED_HOST_CARRIER_FREE_SNAPSHOT'
    || history.workspace_id !== ws.workspace_id || history.scope !== 'supported_host_load_all_cycle'
    || !Number.isSafeInteger(history.interaction_count) || history.interaction_count < 1
    || !/^[a-f0-9]{64}$/.test(history.history_digest ?? '')) throw new Error('A current positive carrier-free history witness is required.');
  if (ws.ordinary_pending || (ws.campaign?.pending ?? []).length
    || (ws.mechanical_turns ?? []).some(turn => !['observed', 'response_observed', 'user_attested_saved'].includes(turn.status))) {
    throw new Error('Reconcile current actions and pending outcomes first; legacy recovery cannot acknowledge them.');
  }
  if (!Array.isArray(nonces) || !nonces.length || new Set(nonces).size !== nonces.length) throw new Error('Select unique legacy records.');
  const records = [...nonces].sort().map(nonce => {
    const matches = (ws.injections ?? []).filter(record => record.nonce === nonce);
    if (matches.length !== 1 || !isLegacyAbsenceEligible(matches[0]) || legacyAbsenceAccepted(ws, matches[0])) {
      throw new Error('Record is not an unresolved pre-outbox legacy carrier; review current state again.');
    }
    const record = matches[0];
    return { nonce, record_digest: digest(record), turn: record.turn ?? null,
      lifecycle_status: record.lifecycle_status ?? 'legacy_unverified', request_id: record.request_id ?? null };
  });
  const review = { schema_version: 1, workspace_id: ws.workspace_id, records, history,
    // Bind all competing action/campaign/ledger state, not only selected IDs.
    state_digest: digest({ injections: ws.injections, campaign: ws.campaign ?? null,
      current_turn: ws.current_turn ?? null, mechanical_turns: ws.mechanical_turns ?? [],
      dispositions: ws.legacy_carrier_dispositions ?? [] }) };
  return { ...review, review_snapshot_hash: digest(review) };
}

/** Run under the workspace lock with freshly captured host evidence. */
export function acceptLegacyAbsence(ws, { history, nonces, review_snapshot_hash, assertion, at = Date.now() }) {
  if (assertion !== LEGACY_ABSENCE_ASSERTION || !Number.isFinite(new Date(at).getTime())) throw new Error('Explicit acceptance of legacy uncertainty is required.');
  const review = buildLegacyAbsenceReview(ws, history, nonces);
  if (review.review_snapshot_hash !== review_snapshot_hash) throw new Error('STALE_LEGACY_REVIEW: history or reviewed state changed; review again.');
  const receipt = { ...review, kind: KIND, assertion, at: new Date(at).toISOString(),
    consequence: 'allow_absent_legacy_records_only', acknowledged_outcomes: 0,
    delivery_verified: false, removal_verified: false };
  ws.legacy_carrier_dispositions ??= [];
  ws.legacy_carrier_dispositions.push(receipt);
  return receipt;
}
