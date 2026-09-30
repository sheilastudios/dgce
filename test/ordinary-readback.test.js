import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalSha256 } from '../extension/core/canonical-json.js';
import { bindOrdinaryRequest } from '../extension/host/ordinary-turn.js';
import { plainOrdinaryBinding, matchesPlainOrdinaryBinding, completePlainOrdinaryReadback } from '../extension/host/ordinary-readback.js';

export function plainFixture() {
  const raw = 'Inspect the lantern.\r\nDo not dismantle it.';
  const ws = { workspace_id: 'session', current_turn: 4, injections: [],
    history_hygiene: 'history_unverified', cards: { lantern: { summary: 'On the bench.' } },
    ordinary_pending: { id: 'plain-action', nonce: null, created_at: '2026-09-24T00:00:00.000Z',
      release_attempt_at: '2026-09-24T00:00:00.010Z', outgoing_text: raw,
      outgoing_text_hash: canonicalSha256(raw).hash, changes: [{ key: 'current_turn', before: 3 }] } };
  const message = { type: 'dgce:browser-request-v1', sessionId: ws.workspace_id,
    requestId: 'request', interactionId: 'interaction', parentId: null,
    timestamp: Date.parse('2026-09-24T00:00:00.020Z'), textHash: ws.ordinary_pending.outgoing_text_hash };
  const witness = { source: 'extension_authenticated_session_get_v1', candidate_count: 1,
    workspace_id: ws.workspace_id, interaction_id: 'interaction', parent_id: null, raw_text: raw };
  return { ws, message, witness };
}

test('plain request persists parent and clock; exact readback retires only the recovery record', () => {
  const { ws, message, witness } = plainFixture();
  assert.equal(bindOrdinaryRequest(ws, message), true);
  assert.equal(ws.ordinary_pending.request_parent_id, null);
  assert.equal(ws.ordinary_pending.network_observed_at, new Date(message.timestamp).toISOString());
  const binding = plainOrdinaryBinding(ws), before = structuredClone(ws);
  assert.ok(binding);
  assert.equal(completePlainOrdinaryReadback(ws, binding, witness, 100), true);
  delete before.ordinary_pending;
  const { last_ordinary_delivery: receipt, ...after } = ws;
  assert.deepEqual(after, before);
  assert.equal(receipt.pendingHash, binding.pendingHash);
  assert.equal(receipt.model_consumption_verified, false);
  assert.equal(completePlainOrdinaryReadback(ws, binding, witness), false);
});

for (const mode of ['legacy', 'before_release', 'same_bucket', 'unexpected', 'nonce', 'carrier', 'desync',
  'raw_hash', 'parent_missing', 'parent_invalid', 'release_missing', 'created_missing']) {
  test(`plain binding rejects ${mode}`, () => {
    const { ws, message } = plainFixture(); bindOrdinaryRequest(ws, message);
    const p = ws.ordinary_pending;
    if (mode === 'legacy') delete p.network_observed_at;
    if (mode === 'before_release') p.network_observed_at = p.created_at;
    if (mode === 'same_bucket') p.network_observed_at = p.release_attempt_at;
    if (mode === 'unexpected') p.unexpected_request_id = 'race';
    if (mode === 'nonce') p.nonce = 'dgce-owned';
    if (mode === 'carrier') ws.injections.push({ ordinary_action_id: p.id });
    if (mode === 'desync') ws.timeline_integrity = { desynchronized: true };
    if (mode === 'raw_hash') p.outgoing_text += ' altered';
    if (mode === 'parent_missing') delete p.request_parent_id;
    if (mode === 'parent_invalid') p.request_parent_id = undefined;
    if (mode === 'release_missing') delete p.release_attempt_at;
    if (mode === 'created_missing') delete p.created_at;
    assert.equal(plainOrdinaryBinding(ws), null);
  });
}

for (const mode of ['source', 'workspace', 'interaction', 'parent', 'parent_missing', 'duplicate', 'missing', 'space', 'punctuation', 'wrapper', 'scope']) {
  test(`plain readback rejects ${mode} without mutation`, () => {
    const { ws, message, witness } = plainFixture(); bindOrdinaryRequest(ws, message);
    const binding = plainOrdinaryBinding(ws);
    if (mode === 'source') witness.source = 'page-message';
    if (mode === 'workspace') witness.workspace_id = 'other';
    if (mode === 'interaction') witness.interaction_id = 'other';
    if (mode === 'parent') witness.parent_id = 'other';
    if (mode === 'parent_missing') delete witness.parent_id;
    if (mode === 'duplicate') witness.candidate_count = 2;
    if (mode === 'missing') delete witness.raw_text;
    if (mode === 'space') witness.raw_text += ' ';
    if (mode === 'punctuation') witness.raw_text = witness.raw_text.replace('.', '!');
    if (mode === 'wrapper') witness.raw_text += '<ext_ctx id="dgce-x">hidden</ext_ctx>';
    if (mode === 'scope') witness.raw_text = 'Inspect the lantern.';
    const before = structuredClone(ws);
    assert.equal(completePlainOrdinaryReadback(ws, binding, witness), false);
    assert.deepEqual(ws, before);
  });
}

test('plain equivalence allows only CRLF/LF and fences every saved pending field', () => {
  const { ws, message, witness } = plainFixture(); bindOrdinaryRequest(ws, message);
  const binding = plainOrdinaryBinding(ws);
  for (const key of ['id', 'request_id', 'interaction_id', 'request_parent_id', 'release_attempt_at', 'network_observed_at', 'changes']) {
    const altered = structuredClone(ws); altered.ordinary_pending[key] = 'changed';
    assert.equal(matchesPlainOrdinaryBinding(altered, binding), false, key);
  }
  witness.raw_text = witness.raw_text.replace(/\r\n/g, '\n');
  assert.equal(completePlainOrdinaryReadback(ws, binding, witness), true);
});

test('old identical-text observations cannot acquire a new action; pre-release uncertainty stays pending', () => {
  for (const delta of [-1, 0, 10]) {
    const { ws, message, witness } = plainFixture();
    message.timestamp = Date.parse(ws.ordinary_pending.created_at) + delta;
    bindOrdinaryRequest(ws, message);
    assert.equal(plainOrdinaryBinding(ws), null);
    assert.equal(completePlainOrdinaryReadback(ws, null, witness), false);
    assert.ok(ws.ordinary_pending);
  }
});
