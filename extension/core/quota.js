// Storage headroom. Spec §5 localStorage_headroom (C-F).
//
// The v1.2 rule said to track "approximate serialized size" and warn before the
// quota is approached. If that measures CURRENT size, the warning fires too
// late: the failure lands on the write, which is the moment the outgoing and
// incoming values are both resident.
//
//   law: headroom_check_measures_peak != current

import { serializedBytes } from './workspace.js';

/**
 * Bytes the commit would occupy: the candidate workspace, which already
 * contains its undo preimage and its receipts, plus anything else this
 * extension holds in the same origin's storage.
 */
export function projectedFootprint(candidateWs, { otherNamespaceBytes = 0 } = {}) {
  return serializedBytes(candidateWs) + otherNamespaceBytes;
}

/**
 * Preflight. Returns { ok, projected, limit, quota }.
 *
 * The limit deliberately sits below the quota. Part of that margin covers the
 * transient during which a storage engine may hold both the outgoing and
 * incoming values, which is the specific moment v1.2's check would have missed.
 */
export function checkHeadroom(candidateWs, { otherNamespaceBytes = 0 } = {}) {
  const quota = candidateWs.settings.storage_quota_bytes;
  const limit = Math.floor(quota * candidateWs.settings.storage_warn_ratio);
  const projected = projectedFootprint(candidateWs, { otherNamespaceBytes });
  return { ok: projected <= limit, projected, limit, quota };
}
