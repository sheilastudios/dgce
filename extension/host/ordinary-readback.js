// A context-free ordinary turn has no carrier. Verify its saved request, not
// a DOM resemblance, and retire only its already-committed recovery record.
import { canonicalSha256 } from '../core/canonical-json.js';

const hash = value => canonicalSha256(value).hash;
const parent = value => value === null || (typeof value === 'string' && value.length > 0);
const lf = value => value.replace(/\r\n/g, '\n');

export function plainOrdinaryBinding(ws) {
  const p = ws?.ordinary_pending;
  if (!p || p.nonce !== null || !p.id || !p.request_id || !p.interaction_id
      || p.unexpected_request_id || ws.timeline_integrity?.desynchronized
      || typeof p.outgoing_text !== 'string' || hash(p.outgoing_text) !== p.outgoing_text_hash
      || /<\/?ext_ctx\b/i.test(p.outgoing_text)
      || !Object.hasOwn(p, 'request_parent_id') || !parent(p.request_parent_id)
      || (ws.injections ?? []).some(r => r.ordinary_action_id === p.id)) return null;
  const created = Date.parse(p.created_at), released = Date.parse(p.release_attempt_at);
  const requested = Date.parse(p.network_observed_at);
  if (![created, released, requested].every(Number.isFinite)
      || released < created || requested < released + 1) return null;
  return { workspaceId: ws.workspace_id, id: p.id, requestId: p.request_id,
    interactionId: p.interaction_id, pendingHash: hash(p) };
}

export function matchesPlainOrdinaryBinding(ws, binding) {
  const live = plainOrdinaryBinding(ws);
  return Boolean(live && binding && hash(live) === hash(binding));
}

export function completePlainOrdinaryReadback(ws, binding, witness, now = Date.now()) {
  if (!matchesPlainOrdinaryBinding(ws, binding)) return false;
  const p = ws.ordinary_pending;
  if (witness?.source !== 'extension_authenticated_session_get_v1'
      || witness.candidate_count !== 1 || witness.workspace_id !== ws.workspace_id
      || witness.interaction_id !== p.interaction_id
      || !Object.hasOwn(witness, 'parent_id') || witness.parent_id !== p.request_parent_id
      || typeof witness.raw_text !== 'string' || lf(witness.raw_text) !== lf(p.outgoing_text)) return false;
  // No replay of admission/turn/deck effects, outcome acknowledgement, history
  // clearance, or carrier cleanup. Keep the exact evidence separate from user
  // testimony and retain a digest binding the retired rollback record.
  ws.last_ordinary_delivery = { ...binding, source: witness.source, verified_at: now,
    request_parent_id: p.request_parent_id, release_attempt_at: p.release_attempt_at,
    network_observed_at: p.network_observed_at, outgoing_text_hash: p.outgoing_text_hash,
    saved_text_hash: hash(witness.raw_text), equivalence: 'crlf_to_lf_only',
    kind: 'context_free_saved_interaction', model_consumption_verified: false };
  delete ws.ordinary_pending;
  return true;
}
