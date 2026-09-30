// Non-blocking, ordered persistence for state produced by outgoing turns.
// Each mutation rereads the durable workspace and uses CAS. A deleted record
// is an error, never permission for a stale tab to recreate it.

import { writeWithConflictRetry } from '../storage.js';

export class WorkspaceMutationQueue {
  constructor(store, { retries = 2 } = {}) {
    this.store = store;
    this.retries = retries;
    this.tail = Promise.resolve();
  }

  enqueue(mutate) {
    const run = async () => {
      const current = await this.store.read();
      if (!current) throw new Error('workspace disappeared before queued turn persistence');
      return writeWithConflictRetry(this.store, current, mutate, { retries: this.retries });
    };
    const result = this.tail.then(run, run);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  /**
   * Resolve only when every mutation queued up to and during this wait has
   * settled. New turn and injection-audit writes may join the queue while a
   * caller is awaiting an earlier tail, so a single captured Promise is not a
   * sufficient drain barrier.
   */
  async whenIdle() {
    while (true) {
      const observed = this.tail;
      await observed;
      if (observed === this.tail) return;
    }
  }
}

// Only the projection selectors belong to the turn planner. Never copy the
// whole runtime: rules, combat, progression and other owners can change while
// this queued write waits for storage.
const ROUTING_FIELDS = [
  'active_player_embodiment', 'active_player_reality', 'player_embodiment_context_turn',
  'player_presences',
  'actor_leases', 'actor_context_turn', 'domain_leases',
  'combat_marker_signature', 'combat_lease_source',
];

const publicationBinding = (campaign) => JSON.stringify([
  campaign?.lifecycle?.mode,
  campaign?.publication?.active?.campaign_id,
  campaign?.publication?.active?.version,
  campaign?.publication?.active?.source_revision,
]);

export function persistTurnAdvance(queue, turn, campaign = null) {
  if (!queue || !Number.isInteger(turn) || turn < 0) {
    return Promise.reject(new Error('invalid turn persistence request'));
  }
  // Capture before enqueue; the caller can plan another turn immediately.
  const binding = publicationBinding(campaign);
  const routing = campaign?.runtime ? structuredClone(Object.fromEntries(
    ROUTING_FIELDS.filter((key) => Object.hasOwn(campaign.runtime, key))
      .map((key) => [key, campaign.runtime[key]]),
  )) : null;
  return queue.enqueue((workspace) => {
    workspace.current_turn = Math.max(workspace.current_turn ?? 0, turn);
    const runtime = workspace.campaign?.runtime;
    const routedTurn = Math.max(runtime?.actor_context_turn ?? 0,
      runtime?.player_embodiment_context_turn ?? 0);
    if (routing && runtime && routedTurn < turn
        && !workspace.timeline_integrity?.desynchronized
        && publicationBinding(workspace.campaign) === binding) {
      Object.assign(runtime, structuredClone(routing));
    }
    return workspace;
  });
}
