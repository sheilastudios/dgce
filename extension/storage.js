// Persistence and multi-tab concurrency. Spec §4 namespace, §16b write protocol.
//
// STORAGE DECISION (supersedes §4 "primary: localStorage"):
//
// The spec chose localStorage before it was established that the store would
// sit inside the HOST's origin. localStorage is partitioned per origin, so a
// workspace kept there lives in v2.dreamgen.com's storage: clearing DreamGen's
// site data would destroy a user's campaign memory, and the quota is the
// standard ~5MB shared with whatever the host itself stores.
//
// chrome.storage.local is extension-owned. It survives the user clearing site
// data, does not compete with the host for quota, and is ~10MB by default.
// Same locality, same "no remote backend", strictly better durability.
//
//   law: local_to_the_user != local_to_the_host
//
// The backend is injected, so localStorage remains available as a fallback and
// the whole protocol stays testable without a browser.

import { serialize, deserialize, serializedBytes } from './core/workspace.js';
import { assertEditionWorkspace, editionWorkspaceIssue } from './core/edition.js';

export const NS = 'dgce';
export const keyFor = (workspaceId) => `${NS}:${workspaceId}:workspace`;

/** chrome.storage.local default, in bytes. */
export const EXTENSION_QUOTA_BYTES = 10 * 1024 * 1024;

export class ConflictError extends Error {
  constructor(expected, actual) {
    super(`workspace changed in another tab (expected revision ${expected}, found ${actual})`);
    this.expected = expected;
    this.actual = actual;
  }
}

export class QuotaError extends Error {}

/** Extension-owned storage. The default. */
export const extensionBackend = {
  async get(k) {
    const bag = await chrome.storage.local.get(k);
    return bag[k] ?? null;
  },
  async set(k, v) {
    await chrome.storage.local.set({ [k]: v });
  },
  async remove(k) {
    await chrome.storage.local.remove(k);
  },
  async keys() {
    return Object.keys(await chrome.storage.local.get(null));
  },
};

/** Origin-scoped fallback. Kept for environments without the extension API. */
export const localStorageBackend = {
  async get(k) {
    return globalThis.localStorage.getItem(k);
  },
  async set(k, v) {
    globalThis.localStorage.setItem(k, v);
  },
  async remove(k) {
    globalThis.localStorage.removeItem(k);
  },
  async keys() {
    return Object.keys(globalThis.localStorage);
  },
};

export function defaultBackend() {
  return globalThis.chrome?.storage?.local ? extensionBackend : localStorageBackend;
}

/** Web Locks when available; a pass-through otherwise (§16b fallback). */
async function withLock(name, fn) {
  const locks = globalThis.navigator?.locks;
  if (!locks?.request) return fn();
  return locks.request(name, fn);
}

export class WorkspaceStore {
  constructor({ workspaceId, backend, tabId = randomTabId() } = {}) {
    this.workspaceId = workspaceId;
    this.backend = backend ?? defaultBackend();
    this.tabId = tabId;
    this.key = keyFor(workspaceId);
  }

  async read() {
    const raw = await this.backend.get(this.key);
    if (raw == null) return null;
    const stored = JSON.parse(raw);
    // Free must preserve unfamiliar Full fields even in its export-only view.
    // Do not let hydration normalize them before the edition fence sees them.
    return editionWorkspaceIssue(stored) ? stored : deserialize(raw);
  }

  /** Bytes this extension holds for OTHER workspaces, for the quota preflight. */
  async otherNamespaceBytes() {
    let total = 0;
    for (const k of await this.backend.keys()) {
      if (!k.startsWith(`${NS}:`) || k === this.key) continue;
      total += new TextEncoder().encode((await this.backend.get(k)) ?? '').length;
    }
    return total;
  }

  /**
   * §16b write protocol. Re-reads inside the lock, compares the revision the
   * caller was working from, and refuses rather than choosing a winner.
   */
  async write(expectedRevision, mutate, { requireLock = false } = {}) {
    if (requireLock && !globalThis.navigator?.locks?.request) {
      throw new Error('Exclusive workspace locking is unavailable. Mechanical turn was not committed.');
    }
    return withLock(`${NS}:${this.workspaceId}:write`, async () => {
      const current = await this.read();
      const actual = current?.revision ?? 0;
      if (actual !== expectedRevision) throw new ConflictError(expectedRevision, actual);

      assertEditionWorkspace(current);
      const next = await mutate(current);
      assertEditionWorkspace(next);
      next.revision = actual + 1;
      next.updated_at = Date.now();
      next.writer_tab_id = this.tabId;

      const payload = serialize(next);
      const projected =
        new TextEncoder().encode(payload).length + (await this.otherNamespaceBytes());
      const limit = Math.floor(next.settings.storage_quota_bytes * next.settings.storage_warn_ratio);
      if (projected > limit) {
        throw new QuotaError(
          `projected ${projected}B exceeds safe headroom ${limit}B; nothing was written`,
        );
      }

      try {
        await this.backend.set(this.key, payload);
      } catch (e) {
        // A lost write that reports success is the one failure mode §4 forbids.
        throw new QuotaError(`write rejected by storage engine: ${e.message}`);
      }
      return next;
    });
  }

  async usage(ws) {
    const bytes = serializedBytes(ws) + (await this.otherNamespaceBytes());
    const quota = ws.settings.storage_quota_bytes;
    const limit = Math.floor(quota * ws.settings.storage_warn_ratio);
    return { bytes, quota, limit, warn: bytes > limit, ratio: bytes / quota };
  }
}

/**
 * Retry one compare-and-swap conflict against a freshly read workspace.
 * WorkspaceStore rejects a stale revision before invoking `mutate`, so this
 * cannot apply the same mutation twice. Other failures remain final.
 */
export async function writeWithConflictRetry(store, base, mutate, { retries = 1 } = {}) {
  let candidate = base;
  let remaining = Math.max(0, Number.isInteger(retries) ? retries : 0);
  while (candidate) {
    try {
      return await store.write(candidate.revision, (current) => mutate(current ?? candidate));
    } catch (error) {
      if (!(error instanceof ConflictError) || remaining === 0) throw error;
      remaining -= 1;
      candidate = await store.read();
      if (!candidate) throw error;
    }
  }
  throw new Error('workspace is unavailable');
}

/**
 * §16b storage_event_listener. A clean tab reloads; a dirty tab is BLOCKED and
 * told, because auto-saving over a newer revision is the silent overwrite the
 * section exists to prevent.
 *
 * Handles both backends: chrome.storage fires onChanged, localStorage fires a
 * window 'storage' event.
 */
export function watchExternalWrites({ store, hasUnsavedEdits, onReload, onConflict }) {
  const handleIncoming = (rawValue) => {
    const incoming = rawValue ? deserialize(rawValue) : null;
    if (incoming?.writer_tab_id === store.tabId) return; // our own write
    if (hasUnsavedEdits()) onConflict(incoming);
    else onReload(incoming);
  };

  if (globalThis.chrome?.storage?.onChanged) {
    const listener = (changes, area) => {
      if (area !== 'local' || !changes[store.key]) return;
      handleIncoming(changes[store.key].newValue);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }

  const listener = (event) => {
    if (event.key !== store.key) return;
    handleIncoming(event.newValue);
  };
  globalThis.addEventListener?.('storage', listener);
  return () => globalThis.removeEventListener?.('storage', listener);
}

function randomTabId() {
  return `tab-${Math.random().toString(36).slice(2, 10)}`;
}
