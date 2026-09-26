import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace, createCard, serialize, deserialize, SCHEMA_VERSION } from '../extension/core/workspace.js';
import { rebuildAliasIndex } from '../extension/core/aliases.js';
import { stageForNextTurn, namedRetiredCards } from '../extension/core/archivist-input.js';
import { recallCard } from '../extension/core/recall.js';
import { applyArchivistRun } from '../extension/core/apply.js';
import { exportWorkspace, importWorkspace, inspectImport } from '../extension/core/portable.js';
import { canonicalSha256 } from '../extension/core/canonical-json.js';
import { buildContinuityTransfer, inspectContinuityTransfer, applyContinuityTransfer } from '../extension/core/continuity-transfer.js';
import { inspectAuthoredBlock, saveAuthoredBlock, authoredRevisionPrompt } from '../extension/core/authored-library.js';
import { continuityTools } from '../extension/ui/continuity-tools.js';

const fresh = id => createWorkspace({ workspace_id: id, settings: { npc_active_window: 0, recall_budget: 2000 } });
function add(ws, id, name, aliases = [], kind = 'npc', review_state = 'confirmed') {
  ws.cards[id] = createCard({ id, kind, name_or_title: name, aliases, review_state, summary: 'Previously met at the archive.' });
  (review_state === 'confirmed' ? ws.order : ws.unconfirmed)[kind].push(id); rebuildAliasIndex(ws);
}
test('named retired recall is automatic, bounded and read-only', () => {
  const ws = fresh('source'); add(ws, 'npc:kit', 'Kit', ['the keeper']);
  const before = serialize(ws);
  for (const text of ['I ask Kit.', 'Return to the keeper.']) assert.deepEqual(stageForNextTurn(ws, { recentText: text }).staged, ['npc:kit']);
  assert.deepEqual(stageForNextTurn(ws, { recentText: 'Kit', budgetTokens: 1 }).staged, []);
  assert.equal(serialize(ws), before);
});
test('retired lookup refuses substrings, ambiguous aliases and unconfirmed or conflicting identities', () => {
  const ws = fresh('source'); add(ws, 'npc:kit', 'Kit', ['keeper']); add(ws, 'npc:lee', 'Lee', ['keeper']);
  assert.deepEqual(namedRetiredCards(ws, 'The kitchen is empty.'), []);
  assert.deepEqual(namedRetiredCards(ws, 'Ask the keeper.'), []);
  ws.cards['npc:kit'].authority_conflict = { name: 'Kit' };
  assert.deepEqual(namedRetiredCards(ws, 'Kit'), []);
  add(ws, 'npc:rumor', 'Rumor', [], 'npc', 'unconfirmed');
  assert.deepEqual(namedRetiredCards(ws, 'Rumor'), []);
});
test('explicit recall makes a retired card eligible without rank or support changes', () => {
  const ws = fresh('source'); add(ws, 'npc:kit', 'Kit');
  const order = structuredClone(ws.order);
  recallCard(ws, 'npc:kit');
  assert.deepEqual(stageForNextTurn(ws, { recentText: 'Continue.' }).staged, ['npc:kit']);
  assert.deepEqual(ws.order, order); assert.equal(ws.cards['npc:kit'].last_supported_turn, null);
});
test('schema 1 and 2 memory loads/imports add Objects without altering old data', () => {
  for (const version of [1, 2]) {
    const ws = fresh('old'); ws.schema_version = version; delete ws.order.object; delete ws.unconfirmed.object;
    const before = serialize(ws), loaded = deserialize(before);
    assert.equal(loaded.schema_version, SCHEMA_VERSION); assert.deepEqual(loaded.order.object, []);
    const doc = exportWorkspace(ws);
    assert.equal(inspectImport(doc).counts.object, 0);
    const restored = importWorkspace(fresh('target'), doc, { mode: 'replace' }).workspace;
    assert.deepEqual(restored.unconfirmed.object, []); assert.equal(serialize(ws), before);
  }
});
test('Archivist can retain objects without adding inventory or mechanical authority', () => {
  const ws = fresh('source');
  const raw = JSON.stringify({ schema_version: 1, run_id: 'objects', operations: [{ op: 'UPSERT_CARD',
    kind: 'object', id: 'obj:lantern', name_or_title: 'Brass lantern', aliases: ['lamp'],
    summary: 'The brass lantern has a cracked lens.', link_ids: [], review_state: 'unconfirmed' }] });
  const result = applyArchivistRun(ws, raw, { outstandingRunId: 'objects' });
  assert.equal(result.status, 'applied'); assert.equal(result.workspace.cards['obj:lantern'].kind, 'object');
  assert.deepEqual(result.workspace.surfaces.inventory, ws.surfaces.inventory);
  assert.deepEqual(result.workspace.campaign, ws.campaign);
  assert.deepEqual(stageForNextTurn(result.workspace, { recentText: 'lantern' }).staged, []);
});
test('Object properties and cross-kind links survive backup and recall', () => {
  const ws = fresh('source'); add(ws, 'obj:lamp', 'Lamp', [], 'object'); add(ws, 'loc:shop', 'Shop', [], 'location');
  ws.cards['obj:lamp'].summary = 'Brass housing, cracked lens; no ownership established.';
  ws.cards['obj:lamp'].link_ids = ['loc:shop'];
  const restored = importWorkspace(fresh('target'), exportWorkspace(ws), { mode: 'replace' }).workspace;
  assert.deepEqual(restored.cards['obj:lamp'], ws.cards['obj:lamp']);
  assert.equal(recallCard(restored, 'obj:lamp').linked[0].id, 'loc:shop');
});
function transferFixture() {
  const source = fresh('previous-part'); source.current_turn = 91; add(source, 'npc:kit', 'Kit');
  source.surfaces.event_log.text = 'Kit left the archive.';
  source.cards['npc:kit'].session_touched = true; source.cards['npc:kit'].last_supported_turn = 80;
  source.injections.push({ nonce: 'must-not-travel', parts: ['event_log'] });
  const target = fresh('next-part'), raw = JSON.stringify(buildContinuityTransfer(source));
  return { source, target, raw, review: { ...inspectContinuityTransfer(raw), targetDigest: canonicalSha256(target).hash } };
}
test('sequel transfer moves only continuity; target mechanics, deck, clock and delivery evidence remain intact', () => {
  const { source, target, raw, review } = transferFixture();
  const before = serialize(source), next = applyContinuityTransfer(target, raw, review);
  for (const key of ['campaign', 'deck', 'current_turn', 'injections', 'mechanical_turns', 'settings', 'timeline_integrity']) assert.deepEqual(next[key], target[key], key);
  assert.equal(next.cards['npc:kit'].session_touched, false);
  assert.equal(next.cards['npc:kit'].last_supported_turn, null);
  assert.equal(next.continuity_transfer_origin.turn, 91);
  assert.equal(next.workspace_id, target.workspace_id); assert.equal(serialize(source), before);
  assert.doesNotMatch(raw, /must-not-travel/);
  const edited = JSON.parse(raw);
  edited.memory.cards['npc:kit'].last_supported_turn = 80;
  edited.memory.cards['npc:kit'].session_touched = true;
  const imported = applyContinuityTransfer(target, edited, { ...inspectContinuityTransfer(edited), targetDigest: review.targetDigest });
  assert.equal(imported.cards['npc:kit'].last_supported_turn, null);
  assert.equal(imported.cards['npc:kit'].session_touched, false);
});
for (const failure of ['same-session', 'target-changed', 'packet-changed', 'existing-memory', 'pending', 'over-budget']) {
  test(`sequel transfer refuses ${failure} without mutation`, () => {
    const f = transferFixture(); let raw = f.raw;
    if (failure === 'same-session') { f.target.workspace_id = f.source.workspace_id; f.review.targetDigest = canonicalSha256(f.target).hash; }
    if (failure === 'target-changed') f.target.current_turn++;
    if (failure === 'packet-changed') raw = raw.replace('Kit left', 'Kit entered');
    if (failure === 'existing-memory') { f.target.surfaces.social_context.text = 'Keep this.'; f.review.targetDigest = canonicalSha256(f.target).hash; }
    if (failure === 'pending') f.target.ordinary_pending = { id: 'unsettled' };
    if (failure === 'over-budget') { f.target.surfaces.event_log.max_tokens = 1; f.review.targetDigest = canonicalSha256(f.target).hash; }
    const before = serialize(f.target); assert.throws(() => applyContinuityTransfer(f.target, raw, f.review)); assert.equal(serialize(f.target), before);
  });
}
test('transfer rejects extra executable/state fields and pending mechanical effects', () => {
  const { source, raw } = transferFixture(); const forged = JSON.parse(raw); forged.memory.campaign = { enabled: true };
  assert.throws(() => inspectContinuityTransfer(forged), /Unexpected/);
  source.mechanical_turns.push({ status: 'dispatching' });
  assert.throws(() => buildContinuityTransfer(source), /pending delivery/);
  source.mechanical_turns[0].status = 'user_attested_saved';
  assert.doesNotThrow(() => buildContinuityTransfer(source));
});
test('authored library review preserves exact text and versions without affecting model memory', () => {
  const ws = fresh('source'), before = structuredClone(ws.surfaces);
  const block = { kind: 'npc', name: 'Kit', text: 'Kit is the caretaker.\nKeep this paragraph exactly.' };
  const review = inspectAuthoredBlock(block); saveAuthoredBlock(ws, block, review.digest); saveAuthoredBlock(ws, block, review.digest);
  assert.equal(ws.authored_library.length, 1); assert.equal(ws.authored_library[0].text, block.text);
  const revised = { ...block, text: `${block.text}\nKit now works at the library.` };
  assert.throws(() => saveAuthoredBlock(ws, revised, review.digest), /changed/);
  saveAuthoredBlock(ws, revised, inspectAuthoredBlock(revised).digest);
  assert.equal(ws.authored_library.length, 2); assert.deepEqual(ws.surfaces, before); assert.deepEqual(ws.cards, {});
  const restored = importWorkspace(fresh('new'), exportWorkspace(ws), { mode: 'replace' }).workspace;
  assert.deepEqual(restored.authored_library, ws.authored_library);
  const merged = importWorkspace(restored, exportWorkspace(ws), { mode: 'merge' }).workspace;
  assert.equal(merged.authored_library.length, 2);
});
test('library refuses malformed blocks and digest tampering; revision prompt is a proposal only', () => {
  for (const value of [{}, { kind: 'engine', name: 'X', text: 'x' }, { kind: 'npc', name: 'X', text: 'x', execute: true }]) assert.throws(() => inspectAuthoredBlock(value));
  const ws = fresh('source'), block = { kind: 'object', name: 'Lamp', text: 'Cracked lens.' };
  saveAuthoredBlock(ws, block, inspectAuthoredBlock(block).digest);
  const prompt = authoredRevisionPrompt(ws.authored_library[0], 'The lens was repaired.');
  assert.match(prompt, /nothing will be applied automatically/);
  const doc = exportWorkspace(ws); doc.workspace.authored_library[0].text = 'Changed without review';
  assert.throws(() => inspectImport(doc), error => error.errors.some(message => /digest/.test(message)));
});
test('both-edition continuity tools render actual transfer and library controls without a Full dependency', () => {
  const ws = fresh('source');
  const el = (tag, props = {}, ...children) => ({ tag, ...props, children: children.flat(), append(...rows) { this.children.push(...rows); } });
  const node = continuityTools({ el, ws, draft: {}, mutate() {}, notify() {}, render() {}, readAuthored: () => ({ npc: [{ name: 'Kit', description: 'Caretaker.' }] }), copy() {}, download() {} });
  const text = JSON.stringify(node);
  assert.match(text, /Download continuity transfer/); assert.match(text, /Read selected visible block/); assert.match(text, /Inspect block/);
});
