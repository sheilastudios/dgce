// Undo preimage. Spec §10b undo (C-F).
//
// v1.2 undid by keeping the prior committed workspace. That means two full
// copies resident against a fixed ~5MB per-origin quota, and the failure lands
// on the write — the exact moment both are present. Storing only what the run
// actually touched keeps undo cheap enough that it never competes with the
// retained population it exists to protect.
//
//   law: undo_stores_what_changed != undo_stores_everything

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Pre-change values of everything the run altered.
 *
 * Aliases and redirects are stored whole rather than diffed. They are small
 * derived-ish maps and the alias index is rebuilt wholesale after merges
 * anyway; diffing them would add a code path whose only benefit is bytes we
 * are not short of.
 */
export function buildPreimage(before, after) {
  const pre = {
    revision: before.revision,
    surfaces: {},
    cards: {},
    order: {},
    unconfirmed: {},
    aliases: null,
    redirects: null,
    current_turn: before.current_turn,
  };

  for (const key of Object.keys(before.surfaces)) {
    if (!eq(before.surfaces[key], after.surfaces[key])) {
      pre.surfaces[key] = structuredClone(before.surfaces[key]);
    }
  }

  const cardIds = new Set([...Object.keys(before.cards), ...Object.keys(after.cards)]);
  for (const id of cardIds) {
    const b = before.cards[id];
    const a = after.cards[id];
    if (eq(b, a)) continue;
    // `null` means "did not exist before" — undo must delete it again
    pre.cards[id] = b === undefined ? null : structuredClone(b);
  }

  for (const kind of Object.keys(before.order)) {
    if (!eq(before.order[kind], after.order[kind])) {
      pre.order[kind] = [...before.order[kind]];
    }
    if (!eq(before.unconfirmed[kind], after.unconfirmed[kind])) {
      pre.unconfirmed[kind] = [...before.unconfirmed[kind]];
    }
  }

  if (!eq(before.aliases, after.aliases)) pre.aliases = structuredClone(before.aliases);
  if (!eq(before.redirects, after.redirects)) pre.redirects = structuredClone(before.redirects);

  return pre;
}

/**
 * Restore a preimage onto a workspace. Mutates `ws` (caller holds a clone).
 *
 * Undo is itself a committed write that increments the revision — it is not a
 * rollback to an earlier revision number. Two tabs must never be able to see
 * the same revision number describing two different states.
 */
export function applyPreimage(ws, pre) {
  for (const [key, value] of Object.entries(pre.surfaces)) {
    ws.surfaces[key] = structuredClone(value);
  }

  for (const [id, value] of Object.entries(pre.cards)) {
    if (value === null) delete ws.cards[id];
    else ws.cards[id] = structuredClone(value);
  }

  for (const [kind, list] of Object.entries(pre.order)) ws.order[kind] = [...list];
  for (const [kind, list] of Object.entries(pre.unconfirmed)) ws.unconfirmed[kind] = [...list];

  if (pre.aliases) ws.aliases = structuredClone(pre.aliases);
  if (pre.redirects) ws.redirects = structuredClone(pre.redirects);
  if (pre.current_turn != null) ws.current_turn = pre.current_turn;

  ws.undo = null; // depth 1: undoing consumes the preimage
  return ws;
}

/** Rough serialized cost of a preimage, for the quota preflight. */
export function preimageBytes(pre) {
  return new TextEncoder().encode(JSON.stringify(pre)).length;
}
