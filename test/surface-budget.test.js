import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createWorkspace,
  deserialize,
  serialize,
  setWorkspaceSetting,
} from '../extension/core/workspace.js';

test('changing a configured surface budget updates the live surface immediately', () => {
  const ws = createWorkspace({ workspace_id: 'budget-live' });
  setWorkspaceSetting(ws, 'event_log_budget', 350);

  assert.equal(ws.settings.event_log_budget, 350);
  assert.equal(ws.surfaces.event_log.max_tokens, 350);
});

test('loading an older split budget reconciles the surface to the stored setting', () => {
  const ws = createWorkspace({ workspace_id: 'budget-reload' });
  ws.settings.event_log_budget = 350;
  ws.surfaces.event_log.max_tokens = 250;

  const loaded = deserialize(serialize(ws));
  assert.equal(loaded.settings.event_log_budget, 350);
  assert.equal(loaded.surfaces.event_log.max_tokens, 350);
});

test('unrelated settings do not change surface budgets', () => {
  const ws = createWorkspace({ workspace_id: 'budget-unrelated' });
  setWorkspaceSetting(ws, 'recall_budget', 777);

  assert.equal(ws.settings.recall_budget, 777);
  assert.equal(ws.surfaces.event_log.max_tokens, 250);
});
