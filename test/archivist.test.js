import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorkspace, createCard } from '../extension/core/workspace.js';
import { appendConfirmed } from '../extension/core/ordering.js';
import { supportCard } from '../extension/core/freshness.js';
import { buildArchivistView } from '../extension/core/archivist-input.js';
import {
  buildArchivistPrompt,
  buildArchivistRetryPrompt,
  mintRunId,
  extractJSON,
  unfence,
  promptCost,
} from '../extension/core/archivist.js';
import { applyArchivistRun } from '../extension/core/apply.js';
import { parseArchivistOutput } from '../extension/core/parse.js';

function ws() {
  const w = createWorkspace({ workspace_id: 'w', settings: { npc_active_window: 2 } });
  w.current_turn = 40;
  w.surfaces.event_log.text = 'Joe freed the genie.';
  w.cards['npc:samira'] = createCard({
    id: 'npc:samira', kind: 'npc', name_or_title: 'Samira',
    summary: 'a genie; grants without refusing', review_state: 'confirmed',
  });
  appendConfirmed(w, 'npc', 'npc:samira');
  supportCard(w, 'npc:samira');
  return w;
}

// --- the prompt -----------------------------------------------------------

test('run ids are unique', () => {
  const ids = new Set(Array.from({ length: 200 }, mintRunId));
  assert.equal(ids.size, 200);
});

test('the prompt carries the run id the Archivist must echo', () => {
  const runId = mintRunId();
  const p = buildArchivistPrompt(ws(), { runId });
  assert.ok(p.includes(runId), 'C-B: the extension mints it, the model echoes it');
});

test('the prompt states the hard limits that would otherwise reject the run', () => {
  const p = buildArchivistPrompt(ws(), { runId: 'r1' });
  assert.match(p, /may NOT confirm anything/, 'confirmation is mechanical, not model judgment');
  assert.match(p, /may NOT promote a card that is not listed/, 'no ranking of unseen cards');
  assert.match(p, /ONE JSON document and NOTHING else/);
  assert.match(p, /return NO_CHANGE/, 'doing nothing is a good answer');
});

test('the prompt refuses to let the model invent events from memory alone', () => {
  const p = buildArchivistPrompt(ws(), { runId: 'r1' });
  assert.match(p, /If you cannot see the role-play story/);
  assert.match(p, /Do NOT invent events from the memory view alone/);
});

test('the prompt states legal card-link shapes and routes event chronology to text', () => {
  const p = buildArchivistPrompt(ws(), { runId: 'r1' });
  assert.match(p, /link_ids connect ONLY different kinds/);
  assert.match(p, /Same-kind links are illegal both ways/);
  assert.match(p, /event chronology\/causality in summaries or Event Log/);
});

test('the retry explains that reversing a same-kind relation remains illegal', () => {
  const initial = buildArchivistPrompt(ws(), { runId: 'r1' });
  const retry = buildArchivistRetryPrompt(initial, '{"bad":"reply"}', [
    'evt:first -> evt:second is not an allowed relation shape',
  ]);
  assert.match(retry, /Remove every listed illegal link from link_ids/);
  assert.match(retry, /forbidden in BOTH directions/);
  assert.match(retry, /event summaries or Event Log text/);
});

test('location containment has a legal textual representation and a targeted two-sided correction', () => {
  const initial = buildArchivistPrompt(ws(), { runId: 'r1' });
  assert.match(initial, /Location containment is summary text, not a card link/);
  const retry = buildArchivistRetryPrompt(initial, '{}', [
    'loc:temple -> loc:archive is not an allowed relation shape',
    'loc:archive -> loc:temple is not an allowed relation shape',
  ]);
  assert.match(retry, /for loc:temple, omit loc:archive from link_ids/);
  assert.match(retry, /for loc:archive, omit loc:temple from link_ids/);
  assert.match(retry, /Keep both cards/);
  assert.match(retry, /Do not create map edges/);
});

test('the prompt makes the story the source and memory only the maintenance target', () => {
  const p = buildArchivistPrompt(ws(), { runId: 'r1' });
  assert.match(p, /visible role-play transcript is the SOURCE/);
  assert.match(p, /CURRENT MEMORY below is only\s+the TARGET/);
  assert.match(p, /Previous Archivist prompts and replies\s+are not story evidence/);
  assert.match(p, /Before returning NO_CHANGE, compare source against target/);
  assert.match(p, /no supported repair\s+or currently material addition within this bounded memory may remain pending/);
  assert.match(p, /Lower-priority eligible facts may be intentionally omitted/);
});

test('the prompt carries the relational view, not a flat dump', () => {
  const w = ws();
  const p = buildArchivistPrompt(w, { runId: 'r1', view: buildArchivistView(w) });
  assert.match(p, /Samira/);
  assert.match(p, /last supported turn 40 of 40/, 'support age travels with the card');
  assert.match(p, /active \(projected into the story right now\)/);
});

test('the prompt is small enough to be affordable every turn', () => {
  const cost = promptCost(buildArchivistPrompt(ws(), { runId: 'r1' }));
  // Clause-level provenance protection is worth a small fixed increase; the
  // Assistant lane is not the scarce RP context window.
  assert.ok(cost < 4500, `Archivist prompt is ${cost} est tokens on a small workspace`);
});

// --- locating the JSON ----------------------------------------------------

test('a fenced reply is unwrapped', () => {
  assert.equal(unfence('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(unfence('{"a":1}'), '{"a":1}');
});

test('a document wrapped in prose is located, not repaired', () => {
  const doc = '{"schema_version":1,"run_id":"r1","operations":[{"op":"NO_CHANGE"}]}';
  const found = extractJSON(`Sure! Here you go:\n${doc}\nLet me know if you need more.`);
  assert.equal(found, doc);

  // and it still goes through the strict validator unchanged
  assert.equal(parseArchivistOutput(found).run_id, 'r1');
});

test('locating never rescues a malformed document', () => {
  // §10b forbids salvage of CONTENT. Extraction only finds the braces.
  const bad = extractJSON('here: {"schema_version":1,"run_id":"r1","operations":[{"op":"NOPE"}]}');
  assert.throws(
    () => parseArchivistOutput(bad),
    (e) => e.errors.some((x) => /unknown op/.test(x)),
    'the document was located, and then rejected on its merits',
  );
});

// --- end to end -----------------------------------------------------------

test('a well-formed run from the prompt applies', () => {
  const w = ws();
  const runId = mintRunId();
  const view = buildArchivistView(w);

  const reply = '```json\n' + JSON.stringify({
    schema_version: 1,
    run_id: runId,
    operations: [
      { op: 'SET_SURFACE', surface: 'event_log', text: 'Joe freed the genie. He wished for her freedom.' },
      {
        op: 'UPSERT_CARD', kind: 'event', id: 'evt:first_wish',
        name_or_title: 'The first wish', aliases: [], summary: 'Joe wished for Samira to have agency.',
        link_ids: ['npc:samira'], review_state: 'unconfirmed',
      },
    ],
  }) + '\n```';

  const out = applyArchivistRun(w, extractJSON(reply), {
    outstandingRunId: runId,
    rankable: view.rankable,
  });

  assert.equal(out.status, 'applied');
  assert.match(out.workspace.surfaces.event_log.text, /wished for her freedom/);
  assert.equal(out.workspace.cards['evt:first_wish'].review_state, 'unconfirmed');
  assert.ok(!out.workspace.order.event.includes('evt:first_wish'), 'new cards are not projected');
});

test('an Archivist that tries to confirm an unconfirmed card is rejected whole', () => {
  const w = ws();
  w.cards['npc:candidate'] = createCard({
    id: 'npc:candidate', kind: 'npc', name_or_title: 'Candidate', review_state: 'unconfirmed',
  });
  w.unconfirmed.npc.push('npc:candidate');

  const runId = mintRunId();
  const before = JSON.stringify(w);

  const reply = JSON.stringify({
    schema_version: 1,
    run_id: runId,
    operations: [
      { op: 'SET_SURFACE', surface: 'event_log', text: 'Something legitimate.' },
      {
        op: 'UPSERT_CARD', kind: 'npc', id: 'npc:candidate',
        name_or_title: 'Candidate', aliases: [], summary: 'x', link_ids: [],
        review_state: 'confirmed',
      },
    ],
  });

  const out = applyArchivistRun(w, reply, { outstandingRunId: runId });
  assert.equal(out.status, 'rejected');
  assert.match(out.errors.join(' '), /confirmation is mechanical only/);
  assert.equal(JSON.stringify(w), before, 'the legitimate operation did not sneak through');
});

test('a NEW card asserting confirmed is silently created unconfirmed', () => {
  // Not a rejection: the model cannot confirm, so its claim is simply not
  // honoured. Rejecting the whole run for a field on a card that does not
  // exist yet would make the Archivist brittle for no protective gain.
  const w = ws();
  const runId = mintRunId();
  const out = applyArchivistRun(w, JSON.stringify({
    schema_version: 1,
    run_id: runId,
    operations: [{
      op: 'UPSERT_CARD', kind: 'npc', id: 'npc:newcomer',
      name_or_title: 'Newcomer', aliases: [], summary: 'appeared once', link_ids: [],
      review_state: 'confirmed',
    }],
  }), { outstandingRunId: runId });

  assert.equal(out.status, 'applied');
  assert.equal(out.workspace.cards['npc:newcomer'].review_state, 'unconfirmed');
  assert.ok(!out.workspace.order.npc.includes('npc:newcomer'));
});

test('a promotion for a card outside the supplied view is rejected', () => {
  const w = ws();
  const runId = mintRunId();
  const view = buildArchivistView(w);

  w.cards['npc:ghost'] = createCard({
    id: 'npc:ghost', kind: 'npc', name_or_title: 'Ghost', review_state: 'confirmed',
  });
  appendConfirmed(w, 'npc', 'npc:ghost');

  const reply = JSON.stringify({
    schema_version: 1,
    run_id: runId,
    operations: [{ op: 'PROMOTE_TO_ACTIVE', kind: 'npc', id: 'npc:ghost', active_position: 1 }],
  });

  const out = applyArchivistRun(w, reply, { outstandingRunId: runId, rankable: view.rankable });
  assert.equal(out.status, 'rejected');
  assert.match(out.errors.join(' '), /not supplied in this run's context/);
});

// --- completion detection -------------------------------------------------

test('a truncated document is not treated as finished', async () => {
  const { looksLikeCompleteJSON } = await import('../extension/core/archivist.js');

  // This is the real failure: waitForReply sampled a streaming reply during a
  // pause, saw the length hold still, and returned half a document. A
  // truncated JSON document is indistinguishable from a malformed one at the
  // parser, so a good run was discarded as invalid — twice.
  //
  //   law: stalled != finished
  const partial =
    '{"schema_version":1,"run_id":"r1","operations":[{"op":"SET_SURFACE",' +
    '"surface":"event_log","text":"Joe freed Samira from a brass lamp in Grandma';

  assert.equal(looksLikeCompleteJSON(partial), false, 'mid-string is not complete');
  assert.equal(looksLikeCompleteJSON('{"schema_version":1,"operations":['), false);
  assert.equal(looksLikeCompleteJSON(''), false);
  assert.equal(looksLikeCompleteJSON('Thinking...'), false);
});

test('a finished document is recognised, fenced or bare', async () => {
  const { looksLikeCompleteJSON } = await import('../extension/core/archivist.js');
  const doc = '{"schema_version":1,"run_id":"r1","operations":[{"op":"NO_CHANGE"}]}';

  assert.equal(looksLikeCompleteJSON(doc), true);
  assert.equal(looksLikeCompleteJSON('```json\n' + doc + '\n```'), true);
  assert.equal(looksLikeCompleteJSON('Here:\n' + doc + '\nDone.'), true);
});

test('completion is not validity — a complete but illegal run still parses as complete', async () => {
  const { looksLikeCompleteJSON } = await import('../extension/core/archivist.js');
  const illegal = '{"schema_version":1,"run_id":"r1","operations":[{"op":"NOPE"}]}';

  assert.equal(looksLikeCompleteJSON(illegal), true, 'it finished writing');
  assert.throws(() => parseArchivistOutput(illegal), (e) =>
    e.errors.some((x) => /unknown op/.test(x)), 'and is then rejected on its merits');
});

// --- what a card is for ---------------------------------------------------

test('the prompt scopes cards to the emergent population', async () => {
  const { buildArchivistPrompt } = await import('../extension/core/archivist.js');
  const p = buildArchivistPrompt(ws(), { runId: 'r1' });

  // Guide §8.3 — scenario bible is author-defined substrate; cards are emergent
  // continuity. Carding what is already in a slot duplicates always-sent
  // material and can contradict the user's own canon.
  assert.match(p, /EMERGENT population/);
  assert.match(p, /DO NOT card/);
  assert.match(p, /the player or their persona\. Ever\./);
  assert.match(p, /currently defined in the scenario/);
});

test('the prompt keeps the un-mounting case open', async () => {
  const { buildArchivistPrompt } = await import('../extension/core/archivist.js');
  const p = buildArchivistPrompt(ws(), { runId: 'r1' });

  // Guide §10 says "recurring but currently INACTIVE NPC" — so the test is not
  // "never authored", it is "not currently mounted". Strip a character out of
  // the scenario and a card becomes the only record of them.
  assert.match(p, /entities removed from the scenario \(no longer mounted = a card is now the only record\)/);
});

test('the prompt routes character change away from competing cards', async () => {
  const { buildArchivistPrompt } = await import('../extension/core/archivist.js');
  const p = buildArchivistPrompt(ws(), { runId: 'r1' });

  assert.match(p, /a discrete change -> an EVENT card/);
  assert.match(p, /a gradual relational change -> SOCIAL CONTEXT/);
  assert.match(p, /two\n?\s*authorities for one fact/, 'one_datum => one_authority');
});

test('the prompt keeps narrative possibilities out of durable memory', async () => {
  const { buildArchivistPrompt } = await import('../extension/core/archivist.js');
  const p = buildArchivistPrompt(ws(), { runId: 'r1' });

  assert.match(p, /Narrative imagery, interpretation, foreshadowing, and future possibility are/);
  assert.match(p, /not event evidence/);
  assert.match(p, /A realized external event does NOT need a scene boundary/);
  assert.match(p, /previously unspecified world detail is not speculative after the GM makes it/);
  assert.match(p, /Record evidence at its actual strength/);
  assert.match(p, /Prose publication alone does not establish private state, future action, or/);
  assert.match(p, /This guard applies to possibility and interpretation, NOT/);
  assert.match(p, /Do not turn a narrator possibility/);
});

test('the prompt preserves clause-level provenance and repairs older overstatement', () => {
  const p = buildArchivistPrompt(ws(), { runId: 'r1' });
  assert.match(p, /CURRENT MEMORY may itself contain an older overstatement/);
  assert.match(p, /weaken or remove it now/);
  assert.match(p, /CLAUSE CONSTRUCTION/);
  assert.match(p, /Every reported clause, including later\s+sentences, must remain explicitly governed by its reporting verb/);
  assert.match(p, /specificity is not proof of prior briefing/);
  assert.match(p, /no known listener is not\s+proof no witness or record exists/);
});

test('the prompt does not convert endpoint labels or editorial narration into world fact', () => {
  const p = buildArchivistPrompt(ws(), { runId: 'r1' });
  assert.match(p, /residential endpoint does not prove a body\s+is present/);
  assert.match(p, /VR relay does not identify its user/);
  assert.match(p, /editorial motives, jokes and metaphors are not external events/);
  assert.match(p, /Narrator-visible events are not\s+automatically character knowledge/);
});

// --- Stage 4: authored entities -------------------------------------------

test('the authored list is handed over as an explicit boundary', async () => {
  const { buildArchivistPrompt } = await import('../extension/core/archivist.js');
  const p = buildArchivistPrompt(ws(), {
    runId: 'r1',
    authored: 'Player persona: Joe\nCharacters: Samira\nLocations: The apartment\nObjects: The Lamp',
  });
  assert.match(p, /ALREADY IN THE SCENARIO — do not card any of these/);
  assert.match(p, /Player persona: Joe/);
  assert.match(p, /Characters: Samira/);
});

test('omitting the authored list leaves the section out entirely', async () => {
  const { buildArchivistPrompt } = await import('../extension/core/archivist.js');
  assert.ok(!buildArchivistPrompt(ws(), { runId: 'r1' }).includes('ALREADY IN THE SCENARIO'));
});

test('an authored entity resolves as authored, not unknown', async () => {
  const { resolveEntity } = await import('../extension/core/recall.js');
  const { lookupTerm } = await import('../extension/core/aliases.js');
  const w = createWorkspace({ workspace_id: 'w' });

  const authored = (t) =>
    t.trim().toLowerCase() === 'samira' ? { name: 'Samira', kind: 'npc', description: 'a genie' } : null;

  // Without the scenario, a character the user authored reads as unknown —
  // which is wrong, and would invite the model to invent a second one.
  //
  //   law: uncarded != unknown
  assert.equal(resolveEntity(w, 'Samira', lookupTerm).status, 'unknown');

  const out = resolveEntity(w, 'Samira', lookupTerm, { authored });
  assert.equal(out.status, 'authored');
  assert.equal(out.canonical_name, 'Samira');
  assert.equal(out.activity, 'always_present');
});

test('a genuinely unknown term is still unknown', async () => {
  const { resolveEntity } = await import('../extension/core/recall.js');
  const { lookupTerm } = await import('../extension/core/aliases.js');
  const w = createWorkspace({ workspace_id: 'w' });
  assert.equal(resolveEntity(w, 'nobody', lookupTerm, { authored: () => null }).status, 'unknown');
});
