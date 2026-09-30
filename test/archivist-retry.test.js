import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorkspace, createCard } from '../extension/core/workspace.js';
import { estimateTokens } from '../extension/core/tokens.js';
import { buildArchivistPrompt, fitSurfaceText } from '../extension/core/archivist.js';
import { runArchivist } from '../extension/host/archivist-run.js';

test('memory repair instruction checks unchanged targets and bounds negative findings without erasing unseen history', () => {
  const ws = createWorkspace({ workspace_id: 'repair-contract' });
  const before = JSON.stringify(ws);
  const prompt = buildArchivistPrompt(ws, { runId: 'r1' });
  assert.match(prompt, /MEMORY REPAIR PASS — before adding new material/);
  assert.match(prompt, /UPSERT_CARD with the SAME id/);
  assert.match(prompt, /Work target-first: take EACH supplied card/);
  assert.match(prompt, /not by copying the old summary and appending/);
  assert.match(prompt, /Attribution alone is not repair if the claim is still stronger/);
  assert.match(prompt, /dialogue establishes a\s+speaker's report, belief or commitment, not independent truth/);
  assert.match(prompt, /operation set actually replaces every established overstatement/);
  assert.match(prompt, /A better new entry or a review flag does not repair an old/);
  assert.match(prompt, /Missing source coverage is not proof an older fact is false/);
  assert.match(prompt, /Failed or inconclusive checks do not\s+establish the opposite proposition/);
  assert.match(prompt, /Preserve estimates as estimates/);
  assert.match(prompt, /Each retained surface line must carry its own necessary qualifiers/);
  assert.match(prompt, /audit both proposed operations and unchanged supplied memory/);
  assert.match(prompt, /Preserve actual GM-established events; do not require a\s+second mention/);
  assert.equal(JSON.stringify(ws), before);
});

test('budget retry can repair the original card and retain attributed lines without changing its input', async () => {
  const ws = createWorkspace({ workspace_id: 'repair-budget' });
  ws.cards['evt:convoy'] = createCard({ id: 'evt:convoy', kind: 'event', name_or_title: 'Convoy account',
    summary: 'A convoy was stripped two seasons ago.', review_state: 'unconfirmed' });
  ws.unconfirmed.event.push('evt:convoy');
  const before = JSON.stringify(ws);
  const lines = Array.from({ length: 16 }, (_, i) => `Hazelnut reports detail ${i + 1} of the convoy encounter; this remains her account, not independent corroboration.`);
  let calls = 0;
  const result = await runArchivist(ws, {
    authoredOverride: '(none)', ensureHeadroomFn: async () => ({ cleared: false }),
    askFn: async prompt => {
      calls++;
      assert.match(prompt, /MEMORY REPAIR PASS/);
      return JSON.stringify({ schema_version: 1, run_id: /run_id: (\S+)/.exec(prompt)[1], operations: [
        { op: 'UPSERT_CARD', kind: 'event', id: 'evt:convoy', name_or_title: 'Convoy account', aliases: [],
          summary: 'Hazelnut reports finding a stripped convoy two seasons ago.', link_ids: [], review_state: 'unconfirmed' },
        { op: 'SET_SURFACE', surface: 'event_log', text: lines.join('\n') },
      ] });
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.status, 'applied');
  assert.ok(result.budgetFitted);
  assert.equal(JSON.stringify(ws), before);
  assert.deepEqual(Object.keys(result.workspace.cards), ['evt:convoy']);
  assert.equal(result.workspace.cards['evt:convoy'].review_state, 'unconfirmed');
  assert.match(result.workspace.cards['evt:convoy'].summary, /^Hazelnut reports/);
  assert.ok(result.workspace.surfaces.event_log.text.split('\n').every(line => /^Hazelnut reports/.test(line)));
  assert.ok(estimateTokens(result.workspace.surfaces.event_log.text) <= 200);
  // This verifies transport/atomic repair and complete-line fitting, NOT model judgment.
});

const response = (runId, text) => JSON.stringify({
  schema_version: 1,
  run_id: runId,
  operations: [{ op: 'SET_SURFACE', surface: 'event_log', text }],
});

test('Archivist provenance applies to cards and does not count repeated testimony as corroboration', () => {
  const prompt = buildArchivistPrompt(createWorkspace({ workspace_id: 'provenance' }), { runId: 'r1', authored: '(none)' });
  assert.match(prompt, /card summaries as well as surfaces/);
  assert.match(prompt, /not independent corroboration/);
  assert.match(prompt, /Records establish contents, not necessarily events/);
  assert.match(prompt, /Preserve actual observed or GM-established events/);
  assert.match(prompt, /Do not lead a card with an unqualified event assertion/);
});

test('location link retry can preserve containment in prose; repeated illegal links still reject atomically', async () => {
  for (const correctRetry of [true, false]) {
    const ws = createWorkspace({ workspace_id: 'location-retry' });
    const before = JSON.stringify(ws);
    let calls = 0;
    const result = await runArchivist(ws, {
      authoredOverride: '(none)', ensureHeadroomFn: async () => ({ cleared: false }),
      askFn: async prompt => {
        calls++;
        if (calls === 2) {
          assert.match(prompt, /for loc:temple, omit loc:archive from link_ids/);
          assert.match(prompt, /for loc:archive, omit loc:temple from link_ids/);
        }
        const legal = calls === 2 && correctRetry;
        return JSON.stringify({ schema_version: 1, run_id: /run_id: (\S+)/.exec(prompt)[1], operations: [
          { op: 'SET_SURFACE', surface: 'event_log', text: 'The party reached the lower archive.' },
          ...['temple', 'archive'].map((name, index) => ({ op: 'UPSERT_CARD', kind: 'location', id: `loc:${name}`,
            name_or_title: name, aliases: [], review_state: 'unconfirmed',
            summary: index ? 'The lower archive is inside the temple.' : 'The temple houses the lower archive.',
            link_ids: legal ? [] : [index ? 'loc:temple' : 'loc:archive'] })),
        ] });
      },
    });
    assert.equal(calls, 2);
    assert.equal(JSON.stringify(ws), before, 'input workspace was never changed');
    assert.equal(result.status, correctRetry ? 'applied' : 'rejected');
    if (correctRetry) {
      assert.equal(result.workspace.cards['loc:archive'].summary, 'The lower archive is inside the temple.');
      assert.deepEqual(result.workspace.cards['loc:archive'].link_ids, []);
      assert.deepEqual(result.workspace.cards['loc:temple'].link_ids, []);
    } else {
      assert.equal(result.workspace, ws);
      assert.equal(result.budgetFitted, null);
    }
  }
});

test('the initial prompt states the enforced surface limit, not the larger UI budget', () => {
  const ws = createWorkspace({ workspace_id: 'retry-budget' });
  assert.equal(ws.surfaces.event_log.max_tokens, 250);

  const prompt = buildArchivistPrompt(ws, { runId: 'r1', authored: '(none)' });
  assert.match(prompt, /surface_hard_limits/);
  assert.match(prompt, /"event_log": 200/);
  assert.match(prompt, /hard limit 200 estimated tokens/);
});

test('an over-budget surface receives a materially bounded retry and can apply', async () => {
  const ws = createWorkspace({ workspace_id: 'retry-run' });
  const rejectedText = 'x'.repeat(700);
  assert.equal(estimateTokens(rejectedText), 234);

  const prompts = [];
  let calls = 0;
  const result = await runArchivist(ws, {
    authoredOverride: '(none)',
    ensureHeadroomFn: async () => ({ cleared: false }),
    askFn: async (prompt) => {
      prompts.push(prompt);
      calls += 1;
      const runId = /run_id: (\S+)/.exec(prompt)?.[1];
      return calls === 1 ? response(runId, rejectedText) : response(runId, 'One useful event remains.');
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.status, 'applied');
  assert.equal(result.retried, true);
  assert.equal(result.workspace.surfaces.event_log.text, 'One useful event remains.');
  assert.match(prompts[1], /event_log: replace the rejected text/);
  assert.match(prompts[1], /It was ~234; hard limit 200/);
  assert.match(prompts[1], /Target at most ~170 estimated tokens/);
  assert.match(prompts[1], /no more than 510 UTF-8 bytes/);
  assert.match(prompts[1], /do not merely restate it/);
  assert.ok(prompts[1].includes(rejectedText), 'the rejected reply is made explicit');
});

test('complete priority-ordered entries are fitted without cutting a sentence', () => {
  const lines = [
    'The newest and most important event remains available.',
    'The second useful event also remains available.',
    'This lower-priority event is deliberately much longer so it cannot fit beside the first two entries in the small enforced surface budget.',
  ];
  const limit = estimateTokens(lines.slice(0, 2).join('\n'));
  const fitted = fitSurfaceText(lines.join('\n'), limit);

  assert.equal(fitted.changed, true);
  assert.equal(fitted.text, lines.slice(0, 2).join('\n'));
  assert.ok(estimateTokens(fitted.text) <= limit);
  assert.equal(fitted.kept, 2);
  assert.equal(fitted.total, 3);
});

test('a second over-budget reply is deterministically fitted and atomically applied', async () => {
  const ws = createWorkspace({ workspace_id: 'retry-fit' });
  const lines = Array.from(
    { length: 14 },
    (_, i) => `Priority ${i + 1}: Clara and James preserved a consequential event with enough detail to remain useful.`,
  );
  const oversized = lines.join('\n');
  assert.ok(estimateTokens(oversized) > 200);

  let calls = 0;
  const result = await runArchivist(ws, {
    authoredOverride: '(none)',
    ensureHeadroomFn: async () => ({ cleared: false }),
    askFn: async (prompt) => {
      calls += 1;
      const runId = /run_id: (\S+)/.exec(prompt)?.[1];
      return response(runId, oversized);
    },
  });

  assert.equal(calls, 2, 'there is still only one model retry');
  assert.equal(result.status, 'applied');
  assert.equal(result.retried, true);
  assert.equal(result.budgetFitted.length, 1);
  assert.equal(result.budgetFitted[0].surface, 'event_log');
  assert.ok(estimateTokens(result.workspace.surfaces.event_log.text) <= 200);
  assert.ok(result.workspace.surfaces.event_log.text.startsWith(lines[0]));
  assert.ok(!result.workspace.surfaces.event_log.text.includes(lines.at(-1)));
  assert.deepEqual(result.receipt.budget_fit, result.budgetFitted);
});

test('all oversized surfaces are reported and fitted in the same atomic recovery', async () => {
  const ws = createWorkspace({ workspace_id: 'retry-fit-multiple' });
  const eventLines = Array.from(
    { length: 14 },
    (_, i) => `Event ${i + 1}: a current consequence remains relevant to the continuing story and its participants.`,
  );
  const socialLines = Array.from(
    { length: 14 },
    (_, i) => `Relation ${i + 1}: a current interpersonal distinction remains useful without becoming relationship history.`,
  );

  let calls = 0;
  const result = await runArchivist(ws, {
    authoredOverride: '(none)',
    ensureHeadroomFn: async () => ({ cleared: false }),
    askFn: async (prompt) => {
      calls += 1;
      const runId = /run_id: (\S+)/.exec(prompt)?.[1];
      return JSON.stringify({
        schema_version: 1,
        run_id: runId,
        operations: [
          { op: 'SET_SURFACE', surface: 'event_log', text: eventLines.join('\n') },
          { op: 'SET_SURFACE', surface: 'social_context', text: socialLines.join('\n') },
        ],
      });
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.status, 'applied');
  assert.equal(result.budgetFitted.length, 2);
  assert.deepEqual(
    result.budgetFitted.map((item) => item.surface),
    ['event_log', 'social_context'],
  );
  assert.ok(estimateTokens(result.workspace.surfaces.event_log.text) <= 200);
  assert.ok(estimateTokens(result.workspace.surfaces.social_context.text) <= 200);
  assert.ok(result.workspace.surfaces.event_log.text.startsWith(eventLines[0]));
  assert.ok(result.workspace.surfaces.social_context.text.startsWith(socialLines[0]));
});

test('deterministic fitting never salvages a non-budget validation failure', async () => {
  const ws = createWorkspace({ workspace_id: 'retry-no-salvage' });
  let calls = 0;
  const result = await runArchivist(ws, {
    authoredOverride: '(none)',
    ensureHeadroomFn: async () => ({ cleared: false }),
    askFn: async (prompt) => {
      calls += 1;
      const runId = /run_id: (\S+)/.exec(prompt)?.[1];
      return JSON.stringify({
        schema_version: 1,
        run_id: runId,
        operations: [{ op: 'SET_SURFACE', surface: 'unknown', text: 'No.' }],
      });
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.status, 'rejected');
  assert.equal(result.budgetFitted, null);
  assert.equal(result.workspace, ws);
});
