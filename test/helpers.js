import { createWorkspace, createCard } from '../extension/core/workspace.js';
import { appendConfirmed } from '../extension/core/ordering.js';

/**
 * Build a workspace with `names` as confirmed NPCs in the given order.
 * Window defaults small so boundary behaviour is easy to exercise.
 */
export function wsWithNpcs(names, { window = 3, settings = {} } = {}) {
  const ws = createWorkspace({
    workspace_id: 'test',
    settings: { npc_active_window: window, ...settings },
  });
  for (const name of names) {
    const id = `npc:${name}`;
    ws.cards[id] = createCard({
      id,
      kind: 'npc',
      name_or_title: name,
      review_state: 'confirmed',
    });
    appendConfirmed(ws, 'npc', id);
  }
  return ws;
}

export const ids = (names) => names.map((n) => `npc:${n}`);
