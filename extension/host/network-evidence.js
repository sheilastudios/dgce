// Browser-observed traffic is evidence of an attempted request, NOT user intent,
// successful delivery, storage, or model consumption. This module never plans a turn.
import { describeShape, parsePayload, findSessionId, findUpsertIds, readTurnText, isAppendShapedTurnWrite } from './payload.js';
import { stripInjections } from '../core/injection.js';
import { canonicalSha256 } from '../core/canonical-json.js';
import { normalizeHostPacket } from '../core/injection-lifecycle.js';

export const NETWORK_EVIDENCE = 'dgce:browser-request-v1';
export const OBSERVER_READY = 'dgce:observer-ready-v1';
const ORIGIN = 'https://v2.dreamgen.com';

export function requestEvidence(details) {
  if (details?.method !== 'POST' || details.frameId !== 0 || details.tabId < 0
      || !details.documentId || details.initiator !== ORIGIN) return null;
  let url;
  try { url = new URL(details.url); } catch { return null; }
  if (url.origin !== ORIGIN || !url.pathname.startsWith('/_serverFn/')) return null;
  const raw = details.requestBody?.raw;
  if (!Array.isArray(raw) || !raw.length || raw.some(part => !part.bytes || part.file)) return null;
  const length = raw.reduce((n, part) => n + part.bytes.byteLength, 0);
  if (!length || length > 8 * 1024 * 1024) return null;
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of raw) { bytes.set(new Uint8Array(part.bytes), offset); offset += part.bytes.byteLength; }
  let body;
  try { body = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return null; }
  const parsed = parsePayload(body), sessionId = findSessionId(parsed);
  if (!sessionId) return null;
  // Narrative and generated replies share a role. Authorship is NOT inferred
  // here: the isolated trusted-input handoff plus exact hash/nonce owns that
  // decision in bindNativeRequest. Traffic observation must cover either role.
  const text = isAppendShapedTurnWrite(body) ? readTurnText(body) : null;
  const parsedText = text === null ? null : stripInjections(text);
  if (parsedText?.status === 'ambiguous') return null;
  const ids = findUpsertIds(parsed);
  return { type: NETWORK_EVIDENCE, sessionId, requestId: String(details.requestId),
    timestamp: details.timeStamp, shape: describeShape(body),
    interactionId: text !== null && ids.length === 1 ? ids[0].id : null,
    ...(text !== null && ids.length === 1 ? { parentId: ids[0].parentId } : {}),
    normalizedTextHash: text === null ? null : canonicalSha256(normalizeHostPacket(text)).hash,
    nonces: parsedText?.nonces ?? [],
    textHash: text === null ? null : canonicalSha256(text).hash };
}

export function bindNativeRequest(ws, message) {
  if (message?.type !== NETWORK_EVIDENCE || message.sessionId !== ws?.workspace_id
      || !message.requestId || !message.interactionId || message.nonces?.length !== 1) return false;
  if (typeof message.timestamp !== 'number') return false;
  const observedAt = new Date(message.timestamp);
  if (!Number.isFinite(observedAt.getTime())) return false;
  const record = ws.injections?.find(item => item.nonce === message.nonces[0]);
  if (!record?.handoff_prepared_at || record.request_id
      || !record.outgoing_text_hash || record.outgoing_text_hash !== message.textHash) return false;
  const preparedAt = Date.parse(record.handoff_prepared_at);
  if (!Number.isFinite(preparedAt) || message.timestamp < preparedAt) return false;
  const releasedAt = Date.parse(record.native_submit_attempt_at);
  if (!record.native_submission || !Number.isFinite(releasedAt) || message.timestamp < releasedAt + 1) {
    if (record.unexpected_request_id) return false;
    record.unexpected_request_id = message.requestId;
    record.unexpected_request_at = observedAt.toISOString();
    record.unexpected_request_reason = !record.native_submission || !Number.isFinite(releasedAt)
      ? 'release_unverified' : message.timestamp < releasedAt ? 'before_release' : 'same_release_clock_bucket';
    return true; // matching traffic exists, but no authorized-release receipt
  }
  record.request_id = message.requestId;
  record.interaction_id = message.interactionId;
  if (Object.hasOwn(message, 'parentId')) record.request_parent_id = message.parentId;
  if (message.normalizedTextHash) record.normalized_outgoing_text_hash = message.normalizedTextHash;
  record.network_observed_at = observedAt.toISOString();
  record.bridge_transport = 'browser_observation_v1';
  ws.delivery_metrics ??= {};
  ws.delivery_metrics.normally_bound_request_count = (ws.delivery_metrics.normally_bound_request_count ?? 0) + 1;
  // Do not promote lifecycle here: host-history observation owns that boundary.
  return true;
}

// Called synchronously only after the controller's FINAL validation, directly
// before invoking click. It proves release attempt, never host delivery. Queue
// persistence separately: awaiting a write here would reopen the pre-click gap.
export function recordNativeRelease(ws, { ordinaryId = null, nonce = null, textHash, at }) {
  const pending = ordinaryId ? ws?.ordinary_pending : null;
  const record = nonce ? ws?.injections?.find(item => item.nonce === nonce) : null;
  if ((!ordinaryId && !nonce) || !Number.isFinite(Date.parse(at))
      || (ordinaryId && (pending?.id !== ordinaryId || pending.outgoing_text_hash !== textHash))
      || (nonce && (!record?.handoff_prepared_at || record.outgoing_text_hash !== textHash))) {
    throw new Error('Prepared handoff changed before native release.');
  }
  if (pending?.unexpected_request_id || record?.unexpected_request_id) {
    throw new Error('Packet observation has unresolved release ordering. Inspect pending delivery; no second click.');
  }
  if (pending) pending.release_attempt_at = at;
  if (record) { record.native_submission = true; record.native_submit_attempt_at = at; }
}

export function installNetworkEvidence({ runtime = chrome.runtime, receive }) {
  let available = false;
  const listener = (message, sender) => {
    // Chrome authenticates internal runtime messages. There is deliberately no
    // window/DOM transport and no externally_connectable manifest entry.
    if (sender?.id !== runtime.id || sender.tab || message?.type !== NETWORK_EVIDENCE) return;
    receive(message);
  };
  runtime.onMessage.addListener(listener);
  const ready = Promise.resolve().then(() => runtime.sendMessage({ type: OBSERVER_READY })).then(reply => {
    available = reply?.ready === true; return available;
  }).catch(() => false);
  return { ready, available: () => available, close: () => runtime.onMessage.removeListener(listener) };
}
