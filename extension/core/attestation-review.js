// Human review is a proposal for one bounded reconciliation, not a live view
// whose consequences may change behind an already rendered confirmation.
import { canonicalSha256 } from './canonical-json.js';
import { stripRecordedInjection } from './injection.js';
import { HOST_PACKET_EQUIVALENCE, compareHostPackets } from './host-packet-equivalence.js';

export const ATTESTATION_SCOPE = 'exact_raw_interaction';
export const SAVED_TURN_ASSERTION = 'I copied the complete saved interaction from DreamGen\'s raw editor, including hidden DGCE context, into the comparison below. I attest that this is the saved interaction for this action, that it matches under only the displayed permitted host normalization, and I approve only the listed reconciliation consequences. Do not resend or reroll.';
const hash = value => canonicalSha256(value).hash;
const fields = ['nonce', 'lifecycle_status', 'request_id', 'interaction_id', 'request_parent_id',
  'handoff_prepared_at', 'release_attempt_at', 'native_submission', 'native_submit_attempt_at',
  'unexpected_request_id', 'unexpected_request_at', 'unexpected_request_reason', 'network_observed_at',
  'observed_in_host_history_at', 'completion_evidence', 'outgoing_text_hash', 'pending_outcomes_acknowledged_at'];
const evidence = value => Object.fromEntries(fields.filter(key => Object.hasOwn(value, key) && value[key] !== undefined)
  .map(key => [key, structuredClone(value[key])]));

export function compareAttestationPacket(review, inspectedText) {
  const comparison = compareHostPackets(review.expected_raw_saved_text, inspectedText);
  // Completion also checks the recorded carrier body, independently of the
  // whole-packet hash. Keep this guard: tag-like text inside a body is not a
  // license to normalize that body's punctuation.
  if (comparison.equivalent) {
    for (const record of review.expected_carriers) {
      if (stripRecordedInjection(inspectedText, record).status !== 'matched') {
        return { ...comparison, equivalent: false, status: 'carrier_mismatch' };
      }
    }
  }
  return comparison;
}

export function buildAttestationReview(ws, { kind, id }) {
  if (!['ordinary', 'mechanical'].includes(kind)) throw new Error('Unknown attestation action kind.');
  const pending = kind === 'ordinary' ? ws.ordinary_pending : ws.mechanical_turns?.find(turn => turn.id === id);
  if (!pending || pending.id !== id || pending.status !== (kind === 'ordinary' ? 'delivery_unknown' : 'dispatching')) {
    throw new Error('Pending turn changed; review it again.');
  }
  if (typeof pending.outgoing_text !== 'string' || !pending.outgoing_text.length) {
    throw new Error('Expected raw saved interaction is unavailable. Do not confirm.');
  }
  const outgoingHash = hash(pending.outgoing_text);
  if (pending.outgoing_text_hash && pending.outgoing_text_hash !== outgoingHash) {
    throw new Error('Saved outgoing packet does not match its digest.');
  }
  const records = (ws.injections ?? []).filter(record =>
    record[kind === 'ordinary' ? 'ordinary_action_id' : 'mechanical_action_id'] === id);
  const expectedNonce = kind === 'ordinary' ? pending.nonce : pending.injection?.nonce;
  if (records.length > 1 || (kind === 'mechanical' && records.length !== 1)
    || (expectedNonce && (records.length !== 1 || records[0].nonce !== expectedNonce))
    || (kind === 'ordinary' && !expectedNonce && records.length)) {
    throw new Error('Carrier/action identity is incomplete or ambiguous.');
  }
  let visibleText = pending.outgoing_text;
  const shipped = [];
  for (const record of records) {
    if (record.pending_outcomes_acknowledged_at || ws.injections.filter(item => item.nonce === record.nonce).length !== 1
      || (record.outgoing_text_hash && record.outgoing_text_hash !== outgoingHash)) {
      throw new Error('Carrier acknowledgment or packet identity changed.');
    }
    const stripped = stripRecordedInjection(visibleText, record);
    if (stripped.status !== 'matched') throw new Error('The full saved packet does not contain the exact recorded carrier.');
    visibleText = stripped.text;
    if (!Array.isArray(record.pending_texts) || record.pending_texts.some(text => typeof text !== 'string')) {
      throw new Error('The shipped outcome multiset is unavailable.');
    }
    shipped.push(...record.pending_texts);
  }
  const currentPending = ws.campaign?.pending ?? [];
  if (!Array.isArray(currentPending)) throw new Error('Pending outcome state is invalid.');
  const remaining = [...currentPending], acknowledged = [];
  for (const text of shipped) {
    const index = remaining.indexOf(text);
    if (index !== -1) { remaining.splice(index, 1); acknowledged.push(text); }
  }
  const changes = kind === 'ordinary' ? pending.changes : [];
  if (!Array.isArray(changes)) throw new Error('The ordinary rollback boundary is unavailable.');
  const changeSummary = changes.map(change => {
    if (typeof change.key !== 'string' || typeof change.after_hash !== 'string' || !change.before) {
      throw new Error('Invalid ordinary rollback entry.');
    }
    // The review binds the complete recipe through ordinary_changes_digest,
    // while its displayed before digest continues to identify the full field.
    const compact = change.before.encoding === 'injection_array_refs_v1';
    if (compact && (change.key !== 'injections' || !/^[a-f0-9]{64}$/.test(change.before.before_hash ?? ''))) {
      throw new Error('Invalid ordinary ledger rollback digest.');
    }
    return { key: change.key, before_hash: compact ? change.before.before_hash : hash(change.before), after_hash: change.after_hash };
  });
  const snapshot = {
    schema_version: 1, scope: ATTESTATION_SCOPE, workspace_id: ws.workspace_id,
    equivalence_policy: HOST_PACKET_EQUIVALENCE,
    action_kind: kind, action_id: id, assertion: SAVED_TURN_ASSERTION,
    expected_visible_saved_text: visibleText, expected_raw_saved_text: pending.outgoing_text,
    outgoing_text_hash: outgoingHash, carrier_nonces: records.map(record => record.nonce),
    expected_carriers: records.map(record => ({ nonce: record.nonce, body: record.body })),
    shipped_pending_texts: shipped, acknowledged_pending_texts: acknowledged,
    acknowledged_pending_digest: hash(acknowledged),
    pending_before_digest: hash(currentPending), pending_after_digest: hash(remaining),
    ordinary_changes_digest: hash(changes), ordinary_changes_summary: changeSummary,
    prior_state: { id, status: pending.status, draft: pending.draft ?? '',
      mechanical_receipt_digest: kind === 'mechanical' ? hash(pending.receipt ?? null) : null,
      outgoing_text_hash: outgoingHash, receipt_ids: [...(pending.receipt_ids ?? [])], ...evidence(pending) },
    prior_carrier_evidence: records.map(evidence),
  };
  return { ...snapshot, review_snapshot_hash: hash(snapshot) };
}
