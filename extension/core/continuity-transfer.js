// Deliberately narrower than backup/restore: no campaign, turn counter, carriers,
// pending actions or delivery attestations cross a host-session boundary.
import { createWorkspace, SCHEMA_VERSION } from './workspace.js';
import { KINDS } from './ids.js';
import { exportWorkspace, importWorkspace } from './portable.js';
import { canonicalSha256 } from './canonical-json.js';
import { checkInvariants } from './apply.js';

export const TRANSFER_FORMAT = 'dgce-continuity-transfer';
export function assertContinuityIdle(ws) {
  if (ws.ordinary_pending || (ws.mechanical_turns ?? []).some(turn => !['observed', 'response_observed', 'user_attested_saved'].includes(turn.status))) throw new Error('Resolve pending delivery before transferring continuity.');
}
export function buildContinuityTransfer(ws) {
  assertContinuityIdle(ws);
  const memory = {};
  for (const key of ['surfaces', 'cards', 'order', 'unconfirmed', 'aliases', 'redirects']) memory[key] = structuredClone(ws[key]);
  // Per-source turn numbers must not masquerade as dates in the new session.
  for (const card of Object.values(memory.cards)) {
    card.last_touched = null; card.last_supported_turn = null; card.session_touched = false;
  }
  for (const surface of Object.values(memory.surfaces)) {
    surface.last_archivist_refresh_turn = null;
    delete surface.provenance;
  }
  return { format: TRANSFER_FORMAT, version: 1, source: {
    workspace_id: ws.workspace_id, display_name: ws.display_name, turn: ws.current_turn,
  }, memory, note: 'Continuity only. No campaign mechanics, inventory authority, deck, host history or delivery proof.' };
}
export function inspectContinuityTransfer(raw) {
  const packet = typeof raw === 'string' ? JSON.parse(raw) : structuredClone(raw);
  if (packet?.format !== TRANSFER_FORMAT || packet.version !== 1 || typeof packet.source?.workspace_id !== 'string') throw new Error('Not a continuity-transfer file.');
  const expected = ['surfaces', 'cards', 'order', 'unconfirmed', 'aliases', 'redirects'];
  if (!packet.memory || Object.keys(packet.memory).some(key => !expected.includes(key)) || expected.some(key => !Object.hasOwn(packet.memory, key))) throw new Error('Unexpected or missing transfer fields.');
  const probe = createWorkspace({ workspace_id: 'transfer-validation' });
  const doc = exportWorkspace(probe);
  Object.assign(doc.workspace, packet.memory, { schema_version: SCHEMA_VERSION });
  // Use normal memory validation. Do not accept arbitrary state via Object.assign.
  importWorkspace(probe, doc, { mode: 'replace' });
  return { packet, digest: canonicalSha256(packet).hash,
    counts: Object.fromEntries(KINDS.map(kind => [kind, Object.values(packet.memory.cards).filter(card => card.kind === kind).length])) };
}
export function applyContinuityTransfer(target, raw, { digest, targetDigest } = {}) {
  assertContinuityIdle(target);
  const review = inspectContinuityTransfer(raw);
  if (review.digest !== digest || canonicalSha256(target).hash !== targetDigest) throw new Error('Transfer or target changed after review. Inspect again.');
  if (review.packet.source.workspace_id === target.workspace_id) throw new Error('Choose the new sequel session, not the source session.');
  if (Object.keys(target.cards).length || Object.values(target.surfaces).some(surface => surface.text.trim())) throw new Error('Target already contains continuity. Use reviewed normal backup merge/restore instead.');
  const doc = exportWorkspace(createWorkspace({ workspace_id: review.packet.source.workspace_id }));
  Object.assign(doc.workspace, review.packet.memory, { schema_version: SCHEMA_VERSION });
  // Strip all defaults unrelated to the transferred memory before ordinary import.
  doc.workspace = { ...review.packet.memory, schema_version: SCHEMA_VERSION, workspace_id: review.packet.source.workspace_id };
  const restored = importWorkspace(target, doc, { mode: 'replace' }).workspace;
  // Normal backup import hydrates campaign defaults. A continuity handoff must
  // not even normalize those unrelated fields, so copy only the reviewed memory.
  const next = structuredClone(target);
  for (const key of Object.keys(review.packet.memory)) next[key] = restored[key];
  next.schema_version = SCHEMA_VERSION;
  // Enforce the new-session boundary even for hand-authored transfer packets.
  for (const card of Object.values(next.cards)) {
    card.last_touched = null; card.last_supported_turn = null; card.session_touched = false;
  }
  // Preserve target surface budgets/schedules and do not create inventory provenance.
  for (const [name, surface] of Object.entries(next.surfaces)) {
    // Normal import has already validated the transferred surface limits. The
    // target's own configured limits also have to admit the complete text.
    surface.max_tokens = target.surfaces[name].max_tokens;
    surface.injection_schedule = structuredClone(target.surfaces[name].injection_schedule);
    surface.last_archivist_refresh_turn = null;
    delete surface.provenance;
  }
  next.continuity_transfer_origin = { ...review.packet.source, digest: review.digest };
  const errors = checkInvariants(next);
  if (errors.length) throw new Error(`Transfer would exceed target limits: ${errors.join('; ')}`);
  return next;
}
