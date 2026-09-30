// Fail-closed timeline state for host-native history rewinds.
// Full arbitrary rollback requires committed per-turn preimages and is outside
// this slice. Detection therefore suspends authoritative projection until the
// user explicitly reconciles or rebuilds the extension workspace.

export function createTimelineIntegrity() {
  return {
    desynchronized: false,
    detected_at: null,
    detected_turn: null,
    reason: null,
    reconciled_at: null,
  };
}

export function hydrateTimelineIntegrity(value) {
  return { ...createTimelineIntegrity(), ...(value && typeof value === 'object' ? value : {}) };
}

export function captureWorkspaceFence(workspace, mutationGeneration = 0) {
  return {
    workspace,
    revision: workspace?.revision ?? null,
    turn: workspace?.current_turn ?? null,
    mutationGeneration,
  };
}

export function workspaceFenceMatches(fence, workspace, mutationGeneration = 0) {
  return Boolean(
    fence
    && workspace === fence.workspace
    && workspace?.revision === fence.revision
    && workspace?.current_turn === fence.turn
    && mutationGeneration === fence.mutationGeneration,
  );
}

export function detectUnsupportedHostRewind(
  ws,
  shape,
  { ownedHistoryMutation = false, now = Date.now() } = {},
) {
  if (!ws || ownedHistoryMutation || !Number.isInteger(shape?.deleteIds) || shape.deleteIds <= 0) {
    return { detected: false, changed: false };
  }
  ws.timeline_integrity = hydrateTimelineIntegrity(ws.timeline_integrity);
  if (ws.timeline_integrity.desynchronized) return { detected: true, changed: false };
  ws.timeline_integrity = {
    desynchronized: true,
    detected_at: new Date(now).toISOString(),
    detected_turn: ws.current_turn ?? null,
    reason: `DreamGen removed ${shape.deleteIds} interaction${shape.deleteIds === 1 ? '' : 's'} outside DGCE ownership`,
    reconciled_at: null,
  };
  return { detected: true, changed: true };
}

export function authoritativeInjectionAllowed(ws) {
  return !hydrateTimelineIntegrity(ws?.timeline_integrity).desynchronized;
}

export function reconcileTimelineIntegrity(ws, now = Date.now()) {
  ws.timeline_integrity = {
    ...createTimelineIntegrity(),
    reconciled_at: new Date(now).toISOString(),
  };
  return ws.timeline_integrity;
}
