import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace } from '../extension/core/workspace.js';
import { buildArchivistSourceContext } from '../extension/core/archivist-source-context.js';
import { runArchivist } from '../extension/host/archivist-run.js';
import { runSourceGroundedArchivistRepair } from '../extension/host/archivist-budget-adapters.js';

const source = buildArchivistSourceContext([
  { speakerLabel: '(narrative)', text: 'The case remained on the table.' },
  { speakerLabel: 'Uma', text: 'I cannot authorize opening the case.' },
  { speakerLabel: '(narrative)', text: 'A lamp burned in the hall.' },
]);
const proposal = (id, text) => JSON.stringify({ schema_version: 1, run_id: id,
  operations: [{ op: 'SET_SURFACE', surface: 'event_log', text }] });

test('opt-in Archivist repairs a budget failure through exactly four bounded calls', async () => {
  const ws = createWorkspace({ workspace_id: 'temporary-integration' });
  const before = JSON.stringify(ws);
  let calls = 0;
  let runId;
  const result = await runArchivist(ws, {
    authoredOverride: '(none)', getWorkspace: () => ws, ensureHeadroomFn: async () => {},
    askFn: async prompt => {
      calls++;
      if (calls <= 2) {
        runId = /run_id: (\S+)/.exec(prompt)[1];
        return proposal(runId, 'Too much material. '.repeat(100));
      }
      if (calls === 3) return JSON.stringify({ schema_version: 1, run_id: runId,
        surfaces: [{ surface: 'event_log', retainCount: 2, threads: [1, 2, 3].map(i => ({
          id: `t${i}`, topic: `Subject ${i}`, spanIds: [`s${i}.p1`], reason: 'Scene relevance',
        })) }] });
      assert.equal(calls, 4);
      return JSON.stringify({ schema_version: 1, run_id: runId, surfaces: [{ surface: 'event_log', threads: [
        { id: 't1', text: 'The case remained on the table.' },
        { id: 't2', text: 'Uma reported that Uma cannot authorize opening the case.' },
      ] }] });
    },
    budgetRepairFn: (state, raw, opts) => runSourceGroundedArchivistRepair(state, raw, {
      ...opts, captureSources: () => source, selectionMode: 'ranked-spans',
    }),
  });
  assert.equal(calls, 4);
  assert.equal(result.status, 'applied');
  assert.equal(result.budgetRepaired, true);
  assert.equal(result.stagedRepairAttempted, true);
  assert.equal(JSON.stringify(ws), before);
});

test('staged rejection never falls back to mechanical text fitting', async () => {
  const ws = createWorkspace({ workspace_id: 'temporary-reject' });
  let calls = 0;
  const result = await runArchivist(ws, {
    authoredOverride: '(none)', ensureHeadroomFn: async () => {},
    askFn: async prompt => {
      calls++;
      return proposal(/run_id: (\S+)/.exec(prompt)[1], 'A bounded observation.\n'.repeat(100));
    },
    budgetRepairFn: async () => ({ status: 'rejected', workspace: ws, receipt: null,
      errors: ['source unavailable'], phase: 'selection' }),
  });
  assert.equal(calls, 2);
  assert.equal(result.status, 'rejected');
  assert.equal(result.receipt, null);
});

test('disappeared workspace rejects rather than falling back to the original snapshot', async () => {
  const ws = createWorkspace({ workspace_id: 'temporary-route' });
  const result = await runArchivist(ws, {
    authoredOverride: '(none)', ensureHeadroomFn: async () => {}, getWorkspace: () => null,
    askFn: async prompt => proposal(/run_id: (\S+)/.exec(prompt)[1], 'The case stayed closed.'),
  });
  assert.equal(result.status, 'stale_workspace');
  assert.equal(result.receipt, null);
  assert.match(result.errors[0], /unavailable/);
});
