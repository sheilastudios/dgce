// Workspace schema, construction, and (de)serialization. Spec §4, §16b.
//
// Design decision, stated once so it is not re-litigated:
//
//   `order[kind]` is the single source of truth for durable rank.
//   `ordinal_rank` is DERIVED on read, never stored on the card.
//
// The spec lists ordinal_rank among shared_card_fields and also specifies one
// ordered list per card type. Storing both would let them disagree, and a card
// whose stored rank disagreed with its array position would be a silent
// corruption with no obvious owner. Deriving satisfies both readings and cannot
// desync.
//
//   law: one_source_of_truth_for_rank

import { KINDS, kindOfId } from './ids.js';
import { createDeck } from './deck.js';
import { createTimelineIntegrity, hydrateTimelineIntegrity } from './temporal-integrity.js';

export const SCHEMA_VERSION = 3;

export const DEFAULT_SETTINGS = Object.freeze({
  // active-window sizes — projection limits, NOT storage limits (§5)
  npc_active_window: 12,
  location_active_window: 12,
  event_active_window: 20,
  object_active_window: 12,

  // budgets, in estimated tokens
  event_log_budget: 250,
  social_context_budget: 160,
  inventory_budget: 120,
  per_card_budget: 80,
  recall_budget: 120,
  continuity_context_budget: 1200,
  campaign_budget: 4000,
  // Cards matching nothing in the recent story are not sent. Raise this to
  // force the top-N ranked cards of each kind through regardless.
  ambient_floor: 0,
  linked_result_cap: 3,
  pinned_cap: 4,

  // movement (§5)
  max_archivist_promotions_per_run: 2,

  // C-D
  automatic_merge_limit_per_run: 1,

  // Scheduled Archivist cadence, in user turns since the last applied run.
  // 0 means manual only — the button in the Memory tab always works regardless.
  archivist_cadence_turns: 5,

  // Legacy v0.7.26 cleanup preferences retained for workspace compatibility.
  // v0.7.57 makes complete-history carrier sanitation a mandatory authority
  // boundary; these values no longer permit historical DGCE carriers to
  // accumulate or bypass the clean-history gate.
  automatic_injection_pruning: false,
  injection_retention_turns: 3,

  // C-A
  origination_compare_window: 5,
  origination_overlap_threshold: 0.6,
  origination_shingle_size: 5,

  // C-C — freshness band edges, in turns
  freshness_fresh_max_turns: 30,
  freshness_aging_max_turns: 120,

  // C-F
  // chrome.storage.local default. Extension-owned, so this does not compete
  // with the host for quota and survives the user clearing site data.
  storage_quota_bytes: 10 * 1024 * 1024,
  storage_warn_ratio: 0.8,

  anticipatory_recall_enabled: false,
  RNG_enabled: false,
  RNG_visibility: 'hidden',
  RNG_slot_config: [
    { name: 'a', min: 0, max: 99 },
    { name: 'b', min: 0, max: 99 },
    { name: 'c', min: 0, max: 99 },
    { name: 'd', min: 0, max: 99 },
    { name: 'e', min: 0, max: 99 },
  ],
});

const SURFACE_BUDGET_SETTINGS = Object.freeze({
  event_log_budget: 'event_log',
  social_context_budget: 'social_context',
  inventory_budget: 'inventory',
});

/** Settings own the configured budgets; surface copies are synchronized caches. */
export function syncSurfaceBudgets(ws) {
  for (const [setting, surface] of Object.entries(SURFACE_BUDGET_SETTINGS)) {
    if (ws.surfaces?.[surface] && Number.isFinite(ws.settings?.[setting])) {
      ws.surfaces[surface].max_tokens = ws.settings[setting];
    }
  }
  return ws;
}

export function setWorkspaceSetting(ws, key, value) {
  ws.settings[key] = value;
  const surface = SURFACE_BUDGET_SETTINGS[key];
  if (surface && ws.surfaces?.[surface]) ws.surfaces[surface].max_tokens = value;
  return ws;
}

function emptySurface(budget) {
  return {
    text: '',
    max_tokens: budget,
    enabled: true,
    injection_schedule: { every_n_turns: 3 },
    last_archivist_refresh_turn: null,
  };
}

export function createWorkspace({ workspace_id, display_name = '', settings = {} } = {}) {
  if (!workspace_id) throw new Error('workspace_id is required');
  const s = { ...DEFAULT_SETTINGS, ...settings };
  return {
    schema_version: SCHEMA_VERSION,
    workspace_id,
    display_name,
    revision: 0,
    updated_at: null,
    writer_tab_id: null,
    session_refs: [],

    // Turn counter drives freshness (§5b). Advanced by the host adapter.
    current_turn: 0,

    // Cadence is measured from the last APPLIED run, not `current_turn % n`.
    // Modulo would silently skip a window whenever a manual run, an undo, or a
    // rejected run moved the counter past the multiple.
    last_archivist_run_turn: 0,
    last_archivist_attempt_turn: null,
    last_archivist_attempt_result: null,
    last_archivist_applied_turn: null,
    last_archivist_failure_reason: null,
    timeline_integrity: createTimelineIntegrity(),

    surfaces: {
      event_log: emptySurface(s.event_log_budget),
      social_context: emptySurface(s.social_context_budget),
      inventory: { ...emptySurface(s.inventory_budget), enabled: false },
    },

    // Chaos deck — entropy, not retrieval. Separate from cards on purpose:
    // different lifetime (consumed on draw) and different job.
    deck: createDeck(),
    campaign: null,

    cards: {},                                   // id -> card
    order: { npc: [], location: [], event: [], object: [] }, // confirmed, ordinal truth
    unconfirmed: { npc: [], location: [], event: [], object: [] },

    aliases: {},    // normalized alias -> [card ids]   (multi-value by design)
    redirects: {},  // absorbed id -> canonical id

    settings: s,
    // User-authored RNG rule packs (§13). Empty means the RNG behaves exactly
    // as it always has: entropy pushed, meaning left to the scenario text.
    rule_packs: [],
    // What we injected, keyed to the turn and interaction it rode with. The
    // audit trail for anything the extension added to a turn.
    injections: [],
    mechanical_turns: [], // local receipts with explicit delivery progress
    receipts: [],   // most recent 50; also the applied-run_id set (C-B)
    undo: null,     // preimage of the last Archivist run (C-F)
  };
}

/**
 * Is a scheduled Archivist run due?
 *
 * Deliberately a pure predicate on the workspace: the panel owns WHEN to ask
 * and whether the Assistant is free, this owns only the arithmetic. A run that
 * is due but cannot start (Assistant busy, story switched) is simply still due
 * on the next turn — the threshold is `>=`, not equality, so a skipped window
 * heals itself instead of waiting a full cadence for the next multiple.
 */
export function archivistDue(ws) {
  const every = ws?.settings?.archivist_cadence_turns;
  if (!Number.isInteger(every) || every <= 0) return false; // manual only
  const last = Number.isInteger(ws.last_archivist_run_turn) ? ws.last_archivist_run_turn : 0;
  return ws.current_turn - last >= every;
}

export function createCard({
  id,
  kind,
  name_or_title,
  summary = '',
  aliases = [],
  link_ids = [],
  review_state = 'unconfirmed',
  pinned = false,
  manually_locked = false,
  last_touched = null,
  last_supported_turn = null,
}) {
  return {
    id,
    kind,
    name_or_title,
    summary,
    aliases: [...aliases],
    link_ids: [...link_ids],
    review_state,
    pinned,
    manually_locked,
    last_touched,
    last_supported_turn,
    session_touched: false,
    merged_into: null,
    review_signals: [],
  };
}

/** Derived, never stored. 1-based position within the card's kind list. */
export function ordinalRank(ws, cardId) {
  const kind = kindOfId(cardId);
  if (!kind) return null;
  const i = ws.order[kind].indexOf(cardId);
  return i === -1 ? null : i + 1;
}

/** Public view of a card, with derived fields materialized for display/export. */
export function cardView(ws, cardId) {
  const card = ws.cards[cardId];
  if (!card) return null;
  return { ...card, ordinal_rank: ordinalRank(ws, cardId) };
}

export function serialize(ws) {
  return JSON.stringify(ws);
}

export function deserialize(text) {
  const ws = JSON.parse(text);
  if (![1, 2, SCHEMA_VERSION].includes(ws.schema_version)) {
    throw new Error(`unsupported schema_version: ${ws.schema_version}`);
  }
  if (ws.schema_version < 3) {
    ws.order.object ??= [];
    ws.unconfirmed.object ??= [];
  }
  for (const kind of KINDS) {
    if (!Array.isArray(ws.order?.[kind])) throw new Error(`missing order list: ${kind}`);
  }

  // Forward-fill settings introduced after this workspace was last written.
  // Gaps only — a value the user has stored is never overridden. Without this,
  // every role-play saved before a release carries the new setting as
  // `undefined`: features read it as off, and the Schedules tab renders a
  // number input whose value is the string "undefined".
  ws.settings = { ...DEFAULT_SETTINGS, ...ws.settings };
  syncSurfaceBudgets(ws);
  if (!Number.isInteger(ws.last_archivist_run_turn)) ws.last_archivist_run_turn = 0;
  if (!Number.isInteger(ws.last_archivist_attempt_turn)) ws.last_archivist_attempt_turn = null;
  if (typeof ws.last_archivist_attempt_result !== 'string') ws.last_archivist_attempt_result = null;
  if (!Number.isInteger(ws.last_archivist_applied_turn)) ws.last_archivist_applied_turn = null;
  if (typeof ws.last_archivist_failure_reason !== 'string') ws.last_archivist_failure_reason = null;
  ws.timeline_integrity = hydrateTimelineIntegrity(ws.timeline_integrity);
  if (!Array.isArray(ws.rule_packs)) ws.rule_packs = [];
  ws.deck ??= createDeck();
  // Unknown Full data is preserved, never normalized or activated here.
  ws.schema_version = SCHEMA_VERSION;

  return ws;
}

/** Byte size of the serialized workspace, for quota accounting (§5, C-F). */
export function serializedBytes(ws) {
  return new TextEncoder().encode(serialize(ws)).length;
}

/** Structural clone. Used by the atomic apply path (§10b). */
export function cloneWorkspace(ws) {
  return structuredClone(ws);
}
