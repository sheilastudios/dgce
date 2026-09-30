// JSON export / import. Spec §16.
//
// What is deliberately NOT exported:
//
//   receipts — the applied-run_id set is local history. Importing someone
//              else's would let a fresh run be rejected as a replay because an
//              id happened to collide, which is a very confusing failure.
//   undo     — a preimage describes a transition in the exporting workspace.
//              Restoring it against different state is meaningless.
//
// And, from the spec: never the DreamGen transcript or HISTORY. This file backs
// up extension memory only.
//
//   law: extension_export != transcript_backup

import { SCHEMA_VERSION, createWorkspace, cloneWorkspace } from './workspace.js';
import { rebuildAliasIndex, resolveRedirect } from './aliases.js';
import { checkInvariants } from './apply.js';
import { KINDS } from './ids.js';
import { assertEditionWorkspace } from './edition.js';
import { inspectAuthoredBlock, exportAuthoredBlock } from './authored-library.js';

export const EXPORT_FORMAT = 'dgce-export';
export const EXPORT_FORMAT_VERSION = 1;

export class ImportError extends Error {
  constructor(message, errors = []) {
    super(message);
    this.errors = errors.length ? errors : [message];
  }
}

export function exportWorkspace(ws) {
  const { receipts, undo, ...portable } = cloneWorkspace(ws);
  return {
    format: EXPORT_FORMAT,
    format_version: EXPORT_FORMAT_VERSION,
    exported_at: new Date().toISOString(),
    durability_note:
      'This file backs up extension memory only. It is not a DreamGen transcript backup. ' +
      'DreamGen History and Create Sequel remain responsible for transcript continuity.',
    workspace: portable,
  };
}

export function exportToJSON(ws) {
  return JSON.stringify(exportWorkspace(ws), null, 2);
}

function validateEnvelope(doc) {
  const errors = [];
  if (!doc || typeof doc !== 'object') return ['import is not a JSON object'];
  if (doc.format !== EXPORT_FORMAT) errors.push(`unknown format: ${doc.format}`);
  if (doc.format_version !== EXPORT_FORMAT_VERSION) {
    errors.push(`unsupported format_version: ${doc.format_version}`);
  }
  const ws = doc.workspace;
  if (!ws || typeof ws !== 'object') {
    errors.push('missing workspace');
    return errors;
  }
  if (![1, 2, SCHEMA_VERSION].includes(ws.schema_version)) {
    errors.push(`unsupported schema_version: ${ws.schema_version}`);
  }
  for (const kind of KINDS) {
    if (kind === 'object' && ws.schema_version < 3 && ws.order?.object == null && ws.unconfirmed?.object == null) continue;
    if (!Array.isArray(ws.order?.[kind])) errors.push(`missing order list: ${kind}`);
    if (!Array.isArray(ws.unconfirmed?.[kind])) errors.push(`missing unconfirmed list: ${kind}`);
  }
  if (!ws.cards || typeof ws.cards !== 'object') errors.push('missing cards');
  if (ws.authored_library != null) {
    if (!Array.isArray(ws.authored_library)) errors.push('authored_library must be an array');
    else for (const entry of ws.authored_library) {
      try {
        if (inspectAuthoredBlock(exportAuthoredBlock(entry)).digest !== entry.id) errors.push('authored block digest mismatch');
      } catch (error) { errors.push(error.message); }
    }
  }
  return errors;
}

/** Read an export without applying it — for the "show target workspace" UI step. */
export function inspectImport(json) {
  const doc = typeof json === 'string' ? JSON.parse(json) : json;
  const errors = validateEnvelope(doc);
  if (errors.length) throw new ImportError('import failed validation', errors);

  const ws = doc.workspace;
  assertEditionWorkspace(ws);
  return {
    workspace_id: ws.workspace_id,
    display_name: ws.display_name,
    exported_at: doc.exported_at,
    counts: {
      cards: Object.keys(ws.cards).length,
      npc: ws.order.npc.length,
      location: ws.order.location.length,
      event: ws.order.event.length,
      object: ws.order.object?.length ?? 0,
      unconfirmed: KINDS.reduce((n, k) => n + (ws.unconfirmed[k]?.length ?? 0), 0),
      aliases: Object.keys(ws.aliases ?? {}).length,
      redirects: Object.keys(ws.redirects ?? {}).length,
    },
  };
}

/**
 * Apply an export to a target workspace.
 *
 * mode 'replace' — the imported workspace becomes the state, keeping the
 *                  target's identity and its local receipts.
 * mode 'merge'   — additive only. Imported cards the target does not have are
 *                  added; cards present in BOTH keep the target's version and
 *                  are reported as conflicts. Import never silently overwrites
 *                  something you edited locally.
 *
 *   law: import_adds != import_overwrites
 *
 * Returns { workspace, conflicts, added }.
 */
export function importWorkspace(target, json, { mode = 'merge' } = {}) {
  const doc = typeof json === 'string' ? JSON.parse(json) : json;
  const errors = validateEnvelope(doc);
  if (errors.length) throw new ImportError('import failed validation', errors);

  const incoming = structuredClone(doc.workspace);
  if (incoming.schema_version < 3) {
    incoming.order.object ??= [];
    incoming.unconfirmed.object ??= [];
  }
  assertEditionWorkspace(target);
  assertEditionWorkspace(incoming);
  const next = cloneWorkspace(target);
  const conflicts = [];
  const added = [];
  const packConflicts = [];
  const packsAdded = [];

  if (mode === 'replace') {
    // Only keys the file actually carries. A partial export is a legitimate
    // shape — a pack set shipped alongside a scenario has no surfaces and no
    // settings — and copying an absent key wrote `undefined` over live state,
    // which then failed the invariant check with "Cannot convert undefined or
    // null to object". Replace what the file has; keep what it does not.
    //
    //   law: replace_what_is_carried != erase_what_is_absent
    for (const key of ['surfaces', 'cards', 'order', 'unconfirmed', 'aliases', 'redirects', 'settings', 'authored_library', 'rule_packs', 'deck', 'campaign', 'current_turn', 'last_archivist_run_turn']) {
      if (incoming[key] === undefined || incoming[key] === null) continue;
      // An empty settings object means "carries no settings", not "wipe them".
      if (key === 'settings' && Object.keys(incoming[key]).length === 0) continue;
      next[key] = structuredClone(incoming[key]);
    }
    next.display_name = incoming.display_name || next.display_name;
  } else if (mode === 'merge') {
    if (incoming.authored_library?.length) {
      next.authored_library ??= [];
      for (const entry of incoming.authored_library) if (!next.authored_library.some(current => current.id === entry.id)) next.authored_library.push(structuredClone(entry));
    }
    for (const [id, card] of Object.entries(incoming.cards ?? {})) {
      if (next.cards[id]) {
        conflicts.push(id);
        continue; // target wins; local edits are never clobbered
      }
      next.cards[id] = structuredClone(card);
      added.push(id);
    }

    for (const kind of KINDS) {
      // imported-only cards join the END of the list: an import does not grant rank
      for (const id of incoming.order?.[kind] ?? []) {
        if (added.includes(id) && !next.order[kind].includes(id)) next.order[kind].push(id);
      }
      for (const id of incoming.unconfirmed?.[kind] ?? []) {
        if (added.includes(id) && !next.unconfirmed[kind].includes(id)) {
          next.unconfirmed[kind].push(id);
        }
      }
    }

    for (const [oldId, canonical] of Object.entries(incoming.redirects ?? {})) {
      if (!next.redirects[oldId] && !next.cards[oldId]) next.redirects[oldId] = canonical;
    }

    // Rule packs merge on the same law as cards: additive, id-keyed, target
    // wins. Without this a shared pack set could only arrive through 'replace',
    // which would take the recipient's cards and settings with it — so packs
    // would not be shareable at all, and a scenario author could never ship
    // rules alongside a scenario.
    if (!Array.isArray(next.rule_packs)) next.rule_packs = [];
    for (const pack of incoming.rule_packs ?? []) {
      if (next.rule_packs.some((p) => p.id === pack.id)) {
        packConflicts.push(pack.id);
        continue;
      }
      next.rule_packs.push(structuredClone(pack));
      packsAdded.push(pack.id);
    }
  } else {
    throw new ImportError(`unknown import mode: ${mode}`);
  }

  // Drop redirects whose target did not come along — a dangling redirect is
  // worse than a missing one, because it resolves to nothing at recall time.
  if (!next.redirects) next.redirects = {};
  for (const [oldId, canonical] of Object.entries(next.redirects)) {
    try {
      if (!next.cards[resolveRedirect(next, oldId)]) delete next.redirects[oldId];
    } catch {
      delete next.redirects[oldId]; // cycle
    }
    void canonical;
  }

  // Drop links to cards that did not come along.
  for (const card of Object.values(next.cards)) {
    card.link_ids = card.link_ids.filter((id) => {
      if (next.cards[id]) return true;
      try {
        return Boolean(next.cards[resolveRedirect(next, id)]);
      } catch {
        return false;
      }
    });
  }

  rebuildAliasIndex(next);
  assertEditionWorkspace(next);
  next.schema_version = SCHEMA_VERSION;

  const invariantErrors = checkInvariants(next);
  if (invariantErrors.length) throw new ImportError('import would break invariants', invariantErrors);

  next.revision = target.revision + 1;
  next.updated_at = Date.now();
  next.undo = null; // an import is not an Archivist run; it is not undoable at depth 1

  return { workspace: next, conflicts, added, packConflicts, packsAdded };
}

/** §16 reset. Caller is responsible for the confirmation prompt. */
export function resetWorkspace(ws) {
  return createWorkspace({
    workspace_id: ws.workspace_id,
    display_name: ws.display_name,
    settings: ws.settings,
  });
}
