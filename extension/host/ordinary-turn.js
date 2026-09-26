// Ordinary player turns have no roll receipt, but their confirmation, deck,
// routing and command effects still need a durable handoff boundary.
import { canonicalSha256 } from '../core/canonical-json.js';
import { makeInjectionRecord } from '../core/injection.js';
import { recordInjection } from './prune.js';

const field = (ws, key) => Object.hasOwn(ws, key) ? { present: true, value: ws[key] } : { present: false };
const hash = value => canonicalSha256(value).hash;
const metadata = new Set(['revision', 'updated_at', 'writer_tab_id', 'ordinary_pending']);

// The ledger itself remains complete. A pending handoff need not duplicate
// every unchanged carrier body merely to remember how to undo its prepend.
// References are usable ONLY after the whole current field matches after_hash;
// the reconstructed preimage must also match its independently stored digest.
function injectionPreimage(before, after) {
  if (!before.present || !after.present || !Array.isArray(before.value) || !Array.isArray(after.value)) return before;
  const indexes = new Map(after.value.map((value, index) => [hash(value), index]));
  const compact = { present: true, encoding: 'injection_array_refs_v1', before_hash: hash(before),
    entries: before.value.map(value => {
      const digest = hash(value), index = indexes.get(digest);
      return index === undefined ? { value } : { index, digest };
    }) };
  return JSON.stringify(compact).length < JSON.stringify(before).length ? compact : before;
}

function restoredField(change, ws) {
  const before = change.before;
  if (!Object.hasOwn(before, 'encoding')) return structuredClone(before);
  if (change.key !== 'injections' || before.encoding !== 'injection_array_refs_v1'
      || before.present !== true || !Array.isArray(before.entries) || !Array.isArray(ws.injections)
      || !/^[a-f0-9]{64}$/.test(before.before_hash ?? '')) {
    throw new Error('Invalid ordinary ledger rollback recipe; pending turn retained.');
  }
  const value = before.entries.map(entry => {
    if (!entry || typeof entry !== 'object') throw new Error('Invalid ordinary ledger rollback entry.');
    if (Object.keys(entry).length === 1 && Object.hasOwn(entry, 'value')) return structuredClone(entry.value);
    if (Object.keys(entry).length !== 2 || !Object.hasOwn(entry, 'index') || !Object.hasOwn(entry, 'digest')
        || !Number.isSafeInteger(entry.index) || entry.index < 0 || entry.index >= ws.injections.length
        || hash(ws.injections[entry.index]) !== entry.digest) {
      throw new Error('Ordinary ledger rollback reference changed; pending turn retained.');
    }
    return structuredClone(ws.injections[entry.index]);
  });
  const restored = { present: true, value };
  if (hash(restored) !== before.before_hash) throw new Error('Ordinary ledger rollback preimage changed; pending turn retained.');
  return restored;
}

export async function commitOrdinaryTurn({ store, base, candidate, id, text, outgoingText, injection, assertCurrent = () => {} }) {
  return store.write(base.revision, current => {
    assertCurrent();
    if (current.ordinary_pending) throw new Error('Reconcile the pending ordinary turn before sending another.');
    if (hash(current) !== hash(base)) throw new Error('Workspace changed before ordinary handoff. Nothing sent.');
    let next = structuredClone(candidate);
    if (injection) {
      recordInjection(next, { ...makeInjectionRecord(injection, { turn: next.current_turn }),
        ordinary_action_id: id, handoff_prepared_at: new Date().toISOString(),
        outgoing_text_hash: hash(outgoingText),
        pending_texts: [],
      });

    }
    // Compare the exact JSON representation the workspace store persists;
    // optional audit properties may be undefined before serialization.
    next = JSON.parse(JSON.stringify(next));
    const changes = [...new Set([...Object.keys(current), ...Object.keys(next)])]
      .filter(key => !metadata.has(key) && hash(field(current, key)) !== hash(field(next, key)))
      .map(key => ({ key, before: structuredClone(key === 'injections'
        ? injectionPreimage(field(current, key), field(next, key)) : field(current, key)), after_hash: hash(field(next, key)) }));
    next.ordinary_pending = { id, status: 'delivery_unknown', created_at: new Date().toISOString(),
      draft: text, outgoing_text: outgoingText, outgoing_text_hash: hash(outgoingText),
      nonce: injection?.nonce ?? null, changes };
    return next;
  }, { requireLock: true });
}

// Call only before the native click, never after a timeout or network failure.
export async function cancelUnsentOrdinaryTurn(store, id) {
  const base = await store.read();
  if (base?.ordinary_pending?.id !== id) return base;
  return store.write(base.revision, ws => {
    const pending = ws.ordinary_pending;
    if (pending?.id !== id || pending.request_id || pending.unexpected_request_id || pending.release_attempt_at) {
      throw new Error('Ordinary delivery may have started. Inspect the saved pending turn.');
    }
    if (pending.changes.some(change => hash(field(ws, change.key)) !== change.after_hash)) {
      throw new Error('Campaign changed after handoff preparation. Pending turn retained for recovery; automatic rollback would overwrite newer work.');
    }
    // Validate every reconstruction before touching any workspace field.
    const restores = pending.changes.map(change => ({ key: change.key, before: restoredField(change, ws) }));
    for (const { key, before } of restores) {
      if (before.present) ws[key] = structuredClone(before.value);
      else delete ws[key];
    }
    delete ws.ordinary_pending;
    return ws;
  }, { requireLock: true });
}

export function bindOrdinaryRequest(ws, message) {
  const pending = ws?.ordinary_pending;
  if (!pending || pending.request_id || message?.type !== 'dgce:browser-request-v1'
      || message.sessionId !== ws.workspace_id || !message.requestId || !message.interactionId
      || message.textHash !== pending.outgoing_text_hash) return false;
  const observedAt = message.timestamp;
  if (typeof observedAt !== 'number' || !Number.isFinite(observedAt)
      || !Number.isFinite(new Date(observedAt).getTime())
      || !Number.isFinite(Date.parse(pending.created_at)) || observedAt < Date.parse(pending.created_at)) return false;
  const releasedAt = Date.parse(pending.release_attempt_at);
  if (!Number.isFinite(releasedAt) || observedAt < releasedAt + 1) {
    if (pending.unexpected_request_id) return false;
    pending.unexpected_request_id = message.requestId;
    pending.unexpected_request_at = new Date(observedAt).toISOString();
    pending.unexpected_request_reason = !Number.isFinite(releasedAt)
      ? 'release_unverified' : observedAt < releasedAt ? 'before_release' : 'same_release_clock_bucket';
    return true; // packet exposure, NOT this controller's authorized release
  }
  pending.request_id = message.requestId;
  pending.interaction_id = message.interactionId;
  // Persist independent request identity for exact plain-turn readback too.
  // Older pending actions without these facts are not retroactively upgraded.
  if (Object.hasOwn(message, 'parentId')) pending.request_parent_id = message.parentId;
  pending.network_observed_at = new Date(observedAt).toISOString();
  if (!pending.nonce) {
    ws.delivery_metrics ??= {};
    ws.delivery_metrics.normally_bound_request_count = (ws.delivery_metrics.normally_bound_request_count ?? 0) + 1;
  }
  return true; // browser evidence is an attempt, not a host-save receipt
}
