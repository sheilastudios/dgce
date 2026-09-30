import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorkspace } from '../extension/core/workspace.js';
import { WorkspaceStore, ConflictError } from '../extension/storage.js';
import { WorkspaceMutationQueue, persistTurnAdvance } from '../extension/host/turn-persistence.js';

function memoryBackend() {
  const map = new Map();
  return {
    get: async (key) => map.get(key) ?? null,
    set: async (key, value) => map.set(key, value),
    remove: async (key) => map.delete(key),
    keys: async () => [...map.keys()],
  };
}

async function setup() {
  const store = new WorkspaceStore({ workspaceId: 'w1', backend: memoryBackend(), tabId: 'turns' });
  await store.write(0, () => createWorkspace({ workspace_id: 'w1' }));
  return store;
}

test('a no-injection turn persists current_turn independently', async () => {
  const store = await setup();
  const queue = new WorkspaceMutationQueue(store);
  await persistTurnAdvance(queue, 1);
  assert.equal((await store.read()).current_turn, 1);
});

test('reload after a no-injection turn keeps the increment', async () => {
  const store = await setup();
  await persistTurnAdvance(new WorkspaceMutationQueue(store), 4);
  const reloaded = await store.read();
  assert.equal(reloaded.current_turn, 4);
});

test('an injection turn increments exactly once when audit queues behind it', async () => {
  const store = await setup();
  const queue = new WorkspaceMutationQueue(store);
  const turnWrite = persistTurnAdvance(queue, 1);
  const auditWrite = queue.enqueue((ws) => {
    ws.injections.unshift({ nonce: 'dgce-audit', turn: 1 });
    return ws;
  });
  await Promise.all([turnWrite, auditWrite]);
  const saved = await store.read();
  assert.equal(saved.current_turn, 1);
  assert.equal(saved.injections.length, 1);
});

test('rapid turns serialize without losing or double-counting a turn', async () => {
  const store = await setup();
  const queue = new WorkspaceMutationQueue(store);
  await Promise.all([
    persistTurnAdvance(queue, 1),
    persistTurnAdvance(queue, 2),
    persistTurnAdvance(queue, 3),
  ]);
  assert.equal((await store.read()).current_turn, 3);
});

test('whenIdle drains mutations that join while an earlier write is settling', async () => {
  const store = await setup();
  const queue = new WorkspaceMutationQueue(store);
  let releaseFirst;
  const gate = new Promise((resolve) => { releaseFirst = resolve; });

  const first = queue.enqueue(async (ws) => {
    await gate;
    ws.current_turn = 1;
    return ws;
  });
  const drained = queue.whenIdle();
  const second = queue.enqueue((ws) => {
    ws.current_turn = 2;
    return ws;
  });

  releaseFirst();
  await drained;
  await Promise.all([first, second]);
  assert.equal((await store.read()).current_turn, 2);
});

test('a CAS race retries against fresh state without rewinding the counter', async () => {
  const underlying = await setup();
  const other = new WorkspaceStore({
    workspaceId: 'w1', backend: underlying.backend, tabId: 'other',
  });
  let raced = false;
  const racingStore = {
    read: () => underlying.read(),
    async write(expected, mutate) {
      if (!raced) {
        raced = true;
        const current = await other.read();
        await other.write(current.revision, (ws) => {
          ws.display_name = 'concurrent edit';
          return ws;
        });
      }
      return underlying.write(expected, mutate);
    },
  };
  const queue = new WorkspaceMutationQueue(racingStore);
  await persistTurnAdvance(queue, 2);
  const saved = await underlying.read();
  assert.equal(saved.current_turn, 2);
  assert.equal(saved.display_name, 'concurrent edit');
});

test('a deleted workspace is reported and never resurrected', async () => {
  const store = await setup();
  await store.backend.remove(store.key);
  const queue = new WorkspaceMutationQueue(store);
  await assert.rejects(() => persistTurnAdvance(queue, 1), /workspace disappeared/);
  assert.equal(await store.read(), null);
});

test('turn count feeds Archivist cadence and pruning retention after persistence', async () => {
  const store = await setup();
  const queue = new WorkspaceMutationQueue(store);
  await persistTurnAdvance(queue, 9);
  const saved = await store.read();
  assert.equal(saved.current_turn, 9, 'durable consumers observe the advanced turn');
});
