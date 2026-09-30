import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const panel = readFileSync(new URL('../extension/ui/panel.js', import.meta.url), 'utf8');
function extract(name) {
  const at = panel.indexOf(`function ${name}(`);
  assert.ok(at >= 0, name);
  return panel.slice(at, panel.indexOf('\n}', at) + 2);
}
function harness() {
  const state = { epoch: 1, ws: { workspace_id: 'test', injections: [] }, store: {},
    carrierHygieneStatus: 'clean', lastUserInputAt: 0 };
  let calls = 0, idle = true, due = true, authorized = true, route = 'test';
  const run = runInNewContext(`${extract('maybeScheduledArchivist')}\nmaybeScheduledArchivist`, {
    state, document: {}, archivistDue: () => due, workspaceIdFromLocation: () => route,
    roleplayEditorIdle: () => idle, authoritativeInjectionAllowed: () => authorized,
    refreshWithArchivist: options => { assert.equal(options.scheduled, true); state.archivistBusy = true; calls++; },
  });
  return { state, run, calls: () => calls, idle: v => { idle = v; }, due: v => { due = v; }, authorized: v => { authorized = v; }, route: v => { route = v; } };
}

for (const blocker of ['ordinary_pending', 'freeReadback', 'injectionPruneBusy', 'assistantBusy', 'archivistBusy', 'unpruned', 'dirty', 'generation']) {
  test(`scheduled Archivist waits for ${blocker}, without spending its cadence`, () => {
    const h = harness();
    if (blocker === 'unpruned') h.state.ws.injections.push({ pruned: false });
    else if (blocker === 'dirty') h.state.carrierHygieneStatus = 'dirty';
    else if (blocker === 'generation') h.idle(false);
    else h.state[blocker] = blocker.includes('Readback') ? { busy: true } : true;
    if (blocker === 'ordinary_pending') { delete h.state[blocker]; h.state.ws.ordinary_pending = { id: 'pending' }; }
    h.run();
    assert.equal(h.calls(), 0);
    assert.equal(h.state.ws.last_archivist_attempt_turn, undefined);
    delete h.state.ws.ordinary_pending;
    h.state.ws.injections = [];
    h.state.carrierHygieneStatus = 'clean'; h.idle(true);
    h.state[blocker] = false;
    h.run(); h.run();
    assert.equal(h.calls(), 1, 'settlement recheck starts once; busy blocks duplicate callbacks');
  });
}

test('scheduled check retains cadence and route guards', () => {
  const h = harness(); h.due(false); h.run(); assert.equal(h.calls(), 0);
  h.due(true); h.route('other'); h.run(); assert.equal(h.calls(), 0);
  h.route('test'); h.authorized(false); h.run(); assert.equal(h.calls(), 0);
});

test('observer rechecks scheduling after continuity settles, including no-carrier turns', async () => {
  const state = { epoch: 1, ws: { injections: [] }, store: {} };
  let settle, starts = 0;
  const settled = new Promise(resolve => { settle = resolve; });
  const observe = runInNewContext(`${extract('observeOwnedCarriersInHost')}\nobserveOwnedCarriersInHost`, {
    state, document: { body: {} }, editionWorkspaceIssue: () => null,
    discoverOwnedInjectionCarriers: () => [], verifyFreeOrdinaryReadback: () => {},
    refreshFreeHistoryContinuity: () => settled,
    isCurrent: epoch => epoch === state.epoch,
    scheduleArchivistRecheck: () => starts++,
  });
  observe(); assert.equal(starts, 0);
  settle(true); await settled; await Promise.resolve(); assert.equal(starts, 1);
  observe(); state.epoch++; await Promise.resolve();
  assert.equal(starts, 1, 'an old observer must not trigger a new-session run');
});

function wakeHarness() {
  const state = { epoch: 1, ws: { workspace_id: 'test', injections: [] }, store: {},
    carrierHygieneStatus: 'clean', lastUserInputAt: 0 };
  let time = 0, calls = 0, id = 0, due = true;
  const timers = new Map();
  const queue = runInNewContext(`${extract('scheduleArchivistRecheck')}\n${extract('maybeScheduledArchivist')}\nscheduleArchivistRecheck`, {
    state, document: {}, isCurrent: epoch => epoch === state.epoch,
    scheduleFreeHistoryRecovery() {},
    setTimeout: (fn, delay) => { const key = ++id; timers.set(key, { fn, at: time + delay }); return key; },
    clearTimeout: key => timers.delete(key),
    archivistDue: () => due, authoritativeInjectionAllowed: () => true,
    workspaceIdFromLocation: () => 'test',
    roleplayEditorIdle: () => time - state.lastUserInputAt >= 750,
    refreshWithArchivist: () => { calls++; state.archivistBusy = true; },
  });
  return { state, queue, timers, calls: () => calls, due: value => { due = value; },
    advance(ms) {
      time += ms;
      for (const [key, task] of [...timers]) if (task.at <= time) { timers.delete(key); task.fn(); }
    } };
}

test('trailing wake coalesces bursts and waits beyond the input guard', () => {
  const h = wakeHarness(); h.queue(); h.advance(500); h.state.lastUserInputAt = 500;
  h.queue(); h.queue(); assert.equal(h.timers.size, 1);
  h.advance(999); assert.equal(h.calls(), 0);
  h.advance(1); assert.equal(h.calls(), 1); assert.equal(h.timers.size, 0);
  h.queue(); h.advance(1000); assert.equal(h.calls(), 1, 'busy still gates duplicate start');
});

test('settlement wake runs after busy clears with no further DOM mutation', () => {
  const h = wakeHarness(); h.state.injectionPruneBusy = true;
  h.queue(); h.advance(1000); assert.equal(h.calls(), 0);
  h.state.injectionPruneBusy = false; h.queue(); h.advance(1000);
  assert.equal(h.calls(), 1);
});

test('old-session wake never starts work and can be superseded', () => {
  const h = wakeHarness(); h.queue(); h.state.epoch++; h.advance(1000);
  assert.equal(h.calls(), 0);
  h.queue(); h.state.epoch++; h.queue(); assert.equal(h.timers.size, 1);
  h.advance(1000); assert.equal(h.calls(), 1);
});

test('wake neither polls nor spends cadence when a gate remains closed', () => {
  const h = wakeHarness(); h.state.ws.ordinary_pending = { id: 'pending' };
  h.queue(); h.advance(1000); h.advance(60000);
  assert.equal(h.calls(), 0); assert.equal(h.timers.size, 0);
  assert.equal(h.state.ws.last_archivist_attempt_turn, undefined);
  delete h.state.ws.ordinary_pending; h.due(false); h.queue(); h.advance(1000);
  assert.equal(h.calls(), 0);
});

test('wake is wired to cleanup, readback, deck completion and input activity', () => {
  assert.match(panel, /state\.injectionPruneBusy = false;\s*state\.injectionPruneStatus = null;\s*render\(\);\s*scheduleArchivistRecheck\(\)/);
  assert.match(extract('requestDeckRefill'), /state\.assistantBusy = false;\s*render\(\);\s*scheduleArchivistRecheck\(\)/);
  for (const name of ['verifyFreeOrdinaryReadback', 'verifyFreePlainOrdinaryReadback']) {
    assert.match(extract(name), /attempt\.busy = false;\s*if \(current\(\)\) scheduleArchivistRecheck\(\)/);
  }
  assert.match(panel, /state\.lastUserInputAt = Date\.now\(\);\s*scheduleArchivistRecheck\(\)/);
});
