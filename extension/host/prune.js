// Pruning served injection blocks out of stored turns.
//
// GATED OFF BY DEFAULT. Read this before enabling it.
//
// The probe proved the persist endpoint accepts `upsert` AND `delete` arrays,
// so editing a stored turn is clearly possible. What it did NOT prove is that
// upserting an EXISTING interaction with modified text behaves the way we
// assume — that it edits in place, keeps its children attached, and does not
// fork the interaction tree or invalidate the consistency token.
//
// That is a write against the user's transcript, designed from a single
// observed example of the payload format. The spec's own gate applies:
//
//   law: no_evidence_no_host_integration
//
// So the logic is built and tested and the switch is off. To turn it on, prove
// on a throwaway scenario that: (a) the edited text persists across reload,
// (b) the interaction keeps its id and parentId, (c) later turns still descend
// from it, (d) the consistency token is accepted. Then flip ENABLED and record
// the evidence in the findings file.
//
// Until then the cost of not pruning is bounded anyway: a block ages out of the
// model's window with ordinary truncation. Paying some tokens is a far smaller
// failure than corrupting someone's story tree.

import { parsePayload, findTextContentNodes } from './payload.js';
import { stripRecordedInjection } from '../core/injection.js';
import { INJECTION_LIFECYCLE, injectionLifecycleStatus } from '../core/injection-lifecycle.js';

/** Deliberately not configurable from the UI. Flipping this is a code change. */
export const ENABLED = false;

export const DEFAULT_PRUNE_AFTER_TURNS = 3;
export const DEFAULT_PRUNE_BATCH = 8;

// These carriers already have lifecycle-specific cleanup. Letting the
// recurring pass race them would create two writers for one historical turn.
const SPECIALIZED_PARTS = new Set(['campaign_setup', 'floor_request']);

// Campaign play carriers are request-scoped authority, not story history.
// Once the response they governed has finished, retaining them makes a later
// DreamGen request contain several live-looking DGCE authorities with
// different revisions. The current turn always receives a fresh campaign
// carrier, so these are eligible immediately after their served response.
const EPHEMERAL_AUTHORITY_PARTS = new Set([
  'campaign_context',
  'character_state',
  'campaign_rules',
  'campaign_social_state',
  'campaign_social_contract',
  'mechanical_outcome',
  'floor_map',
]);

export function isEphemeralAuthorityCarrier(record) {
  return Boolean(record?.parts?.some((part) => EPHEMERAL_AUTHORITY_PARTS.has(part)));
}

export function authorityCarrierCleanupRequired(ws) {
  return Boolean((ws?.injections ?? []).some((record) =>
    recurringPruneEligible(record) && isEphemeralAuthorityCarrier(record)));
}

export function recurringPruneEligible(record) {
  const lifecycle = injectionLifecycleStatus(record);
  const ownedCarrierCanExist = lifecycle === INJECTION_LIFECYCLE.LEGACY
    || lifecycle === INJECTION_LIFECYCLE.OBSERVED
    || lifecycle === INJECTION_LIFECYCLE.RESPONSE_OBSERVED
    || lifecycle === INJECTION_LIFECYCLE.HOST_SAVE_VERIFIED
    || lifecycle === INJECTION_LIFECYCLE.PRUNE_REQUESTED;
  return Boolean(
    record
    && !record.pruned
    && ownedCarrierCanExist
    && record.interaction_id
    && Number.isInteger(record.turn)
    && !record.parts?.some((part) => SPECIALIZED_PARTS.has(part)),
  );
}

/**
 * A surface sent every N turns needs at least N live carrier turns. Otherwise
 * the recurring cleanup could remove the newest copy one turn before its
 * replacement is due.
 */
export function minimumSafeRetention(ws) {
  const schedules = Object.values(ws?.surfaces ?? {})
    .filter((surface) => surface?.enabled && surface?.text)
    .map((surface) => surface.injection_schedule?.every_n_turns)
    .filter((value) => Number.isInteger(value) && value > 0);
  return Math.max(DEFAULT_PRUNE_AFTER_TURNS, ...schedules);
}

export function effectiveRetention(ws) {
  const configured = ws?.settings?.injection_retention_turns;
  return Math.max(
    minimumSafeRetention(ws),
    Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_PRUNE_AFTER_TURNS,
  );
}

/**
 * Records whose block has done its job and can be removed.
 * A block is useful for the turn it rides with and a short tail after, since
 * the model may still be referring back to it.
 */
export function findPrunable(
  injections,
  currentTurn,
  {
    afterTurns = DEFAULT_PRUNE_AFTER_TURNS,
    limit = Number.POSITIVE_INFINITY,
    ephemeralOnly = false,
  } = {},
) {
  if (!Number.isInteger(currentTurn) || currentTurn < 0) return [];
  const horizon = Number.isInteger(afterTurns) && afterTurns > 0
    ? afterTurns : DEFAULT_PRUNE_AFTER_TURNS;
  const cap = Number.isInteger(limit) && limit >= 0 ? limit : Number.POSITIVE_INFINITY;
  return (injections ?? [])
    .filter((record) => recurringPruneEligible(record))
    .filter((record) => !ephemeralOnly || isEphemeralAuthorityCarrier(record))
    .filter((record) => currentTurn - record.turn >= (isEphemeralAuthorityCarrier(record) ? 0 : horizon))
    // Newest obsolete carriers are most likely to remain in DreamGen's selected
    // context and rendered DOM. Cleaning them buys context first and prevents
    // an unloaded ancient record from starving a useful candidate.
    .sort((a, b) => b.turn - a.turn)
    .slice(0, cap);
}

/**
 * Given a stored turn's text and the record of what we put in it, produce the
 * cleaned text — or null if there is nothing of ours to remove.
 *
 * Verifies the nonce we expect is actually present. If the text has been edited
 * by the user since, or our block is already gone, we do nothing rather than
 * rewrite a turn we no longer recognise.
 */
export function cleanTurnText(storedText, record) {
  if (typeof storedText !== 'string') return null;
  const { text, nonces } = stripRecordedInjection(storedText, record);
  if (!nonces.includes(record.nonce)) return null; // not ours, or already gone
  if (text === storedText) return null;
  return text;
}

/**
 * Plan the prune for one outgoing payload we are already modifying.
 *
 * Cloning the upsert node that is ALREADY in the request is deliberately
 * chosen over synthesising one: we have a correct example of the shape in
 * hand, and copy-then-modify cannot invent a field the host does not expect.
 *
 * Returns a description only — nothing is sent. The caller decides, and while
 * ENABLED is false nobody calls it.
 */
export function planPrune(body, records) {
  if (!ENABLED) return { enabled: false, planned: [] };

  const doc = parsePayload(body);
  if (!doc) return { enabled: true, planned: [] };

  const textNodes = findTextContentNodes(doc);
  if (textNodes.length !== 1) return { enabled: true, planned: [] };

  return {
    enabled: true,
    planned: records.map((r) => ({ interaction_id: r.interaction_id, nonce: r.nonce })),
  };
}

/** Mark records as pruned once a prune has actually been confirmed. */
export function markPruned(injections, nonces) {
  const done = new Set(nonces);
  return injections.map((r) => (done.has(r.nonce) ? { ...r, pruned: true } : r));
}

/**
 * What the extension does INSTEAD while pruning is off: keep the log bounded so
 * the audit trail cannot grow without limit even though the blocks themselves
 * stay in the transcript.
 */
export const MAX_INJECTION_RECORDS = 100;

export function recordInjection(ws, record) {
  const records = [record, ...(ws.injections ?? []).filter(item => item.nonce !== record.nonce)];
  const outstanding = records.filter(item => !item.pruned);
  if (outstanding.length > MAX_INJECTION_RECORDS) {
    throw new Error('Injection ledger is full of unresolved carriers. Reconcile history before sending; ownership records were not discarded.');
  }
  let historicalSlots = MAX_INJECTION_RECORDS - outstanding.length;
  ws.injections = records.filter(item => !item.pruned || historicalSlots-- > 0);
  return ws;
}
