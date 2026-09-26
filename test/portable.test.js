import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorkspace, createCard } from '../extension/core/workspace.js';
import { appendConfirmed } from '../extension/core/ordering.js';
import { rebuildAliasIndex, resolveRedirect, lookupTerm } from '../extension/core/aliases.js';
import { mergeCards } from '../extension/core/merge.js';
import {
  exportWorkspace,
  exportToJSON,
  importWorkspace,
  inspectImport,
  resetWorkspace,
  ImportError,
} from '../extension/core/portable.js';

function populated() {
  const w = createWorkspace({ workspace_id: 'w1', display_name: 'Genie run' });
  w.current_turn = 42;
  w.surfaces.event_log.text = 'Joe freed the genie.';
  w.settings.max_archivist_promotions_per_run = 4;

  const add = (id, kind, name, extra = {}) => {
    w.cards[id] = createCard({ id, kind, name_or_title: name, review_state: 'confirmed', ...extra });
    appendConfirmed(w, kind, id);
  };
  add('npc:samira', 'npc', 'Samira', { aliases: ['the genie'], link_ids: ['loc:apartment'] });
  add('npc:dupe', 'npc', 'Samira the djinn');
  add('loc:apartment', 'location', 'Apartment', { link_ids: ['npc:samira'] });

  w.cards['evt:rumour'] = createCard({
    id: 'evt:rumour',
    kind: 'event',
    name_or_title: 'A rumour',
    review_state: 'unconfirmed',
  });
  w.unconfirmed.event.push('evt:rumour');

  rebuildAliasIndex(w);
  mergeCards(w, 'npc:dupe', 'npc:samira'); // creates a redirect to round-trip
  return w;
}

// T31 — full round trip
test('T31 export/import round-trips cards, order, aliases, redirects and settings', () => {
  const source = populated();
  const json = exportToJSON(source);

  const empty = createWorkspace({ workspace_id: 'w1' });
  const { workspace: restored } = importWorkspace(empty, json, { mode: 'replace' });

  assert.deepEqual(Object.keys(restored.cards).sort(), Object.keys(source.cards).sort());
  assert.deepEqual(restored.order, source.order);
  assert.deepEqual(restored.unconfirmed, source.unconfirmed);
  assert.deepEqual(restored.aliases, source.aliases);
  assert.deepEqual(restored.redirects, source.redirects);
  assert.equal(restored.settings.max_archivist_promotions_per_run, 4);
  assert.equal(restored.surfaces.event_log.text, 'Joe freed the genie.');
  assert.equal(restored.current_turn, 42);
});

test('T31b ambiguity and old-id resolution survive the round trip', () => {
  const source = populated();
  const empty = createWorkspace({ workspace_id: 'w1' });
  const { workspace: restored } = importWorkspace(empty, exportToJSON(source), { mode: 'replace' });

  assert.equal(resolveRedirect(restored, 'npc:dupe'), 'npc:samira');
  assert.deepEqual(lookupTerm(restored, 'the genie'), {
    status: 'alias-of',
    ids: ['npc:samira'],
  });
  assert.deepEqual(lookupTerm(restored, 'npc:dupe'), { status: 'alias-of', ids: ['npc:samira'] });
});

test('the export carries no local run history', () => {
  const source = populated();
  source.receipts = [{ run_id: 'r1', status: 'applied' }];
  source.undo = { revision: 0, cards: {} };

  const doc = exportWorkspace(source);
  assert.ok(!('receipts' in doc.workspace), 'importing a foreign run_id set could reject a fresh run');
  assert.ok(!('undo' in doc.workspace), 'a preimage describes a transition in another workspace');
});

test('the export states plainly that it is not a transcript backup', () => {
  assert.match(exportWorkspace(populated()).durability_note, /not a DreamGen transcript backup/);
});

test('inspectImport summarizes without applying anything', () => {
  const source = populated();
  const target = createWorkspace({ workspace_id: 'other' });
  const before = JSON.stringify(target);

  const info = inspectImport(exportToJSON(source));
  assert.equal(info.workspace_id, 'w1');
  assert.equal(info.display_name, 'Genie run');
  assert.equal(info.counts.unconfirmed, 1);
  assert.equal(JSON.stringify(target), before, 'inspection is read-only');
});

// --- merge mode -----------------------------------------------------------

test('merge mode adds what is missing and never overwrites what you have', () => {
  const source = populated();

  const target = createWorkspace({ workspace_id: 'w2' });
  target.cards['npc:samira'] = createCard({
    id: 'npc:samira',
    kind: 'npc',
    name_or_title: 'Samira',
    summary: 'MY local edit',
    review_state: 'confirmed',
  });
  appendConfirmed(target, 'npc', 'npc:samira');
  rebuildAliasIndex(target);

  const { workspace, conflicts, added } = importWorkspace(target, exportToJSON(source));

  assert.ok(conflicts.includes('npc:samira'));
  assert.equal(workspace.cards['npc:samira'].summary, 'MY local edit', 'local version wins');
  assert.ok(added.includes('loc:apartment'), 'genuinely new cards are added');
});

test('an imported card joins the bottom of the order rather than taking rank', () => {
  const source = populated();
  const target = createWorkspace({ workspace_id: 'w2' });
  target.cards['loc:home'] = createCard({
    id: 'loc:home',
    kind: 'location',
    name_or_title: 'Home',
    review_state: 'confirmed',
  });
  appendConfirmed(target, 'location', 'loc:home');

  const { workspace } = importWorkspace(target, exportToJSON(source));
  assert.equal(workspace.order.location[0], 'loc:home', 'the existing card keeps its position');
  assert.equal(workspace.order.location.at(-1), 'loc:apartment');
});

test('links to cards that did not come along are dropped, not left dangling', () => {
  const source = createWorkspace({ workspace_id: 'w1' });
  source.cards['npc:tomas'] = createCard({
    id: 'npc:tomas',
    kind: 'npc',
    name_or_title: 'Tomas',
    link_ids: ['loc:missing'],
    review_state: 'confirmed',
  });
  appendConfirmed(source, 'npc', 'npc:tomas');

  const target = createWorkspace({ workspace_id: 'w2' });
  const { workspace } = importWorkspace(target, exportToJSON(source));
  assert.deepEqual(workspace.cards['npc:tomas'].link_ids, []);
});

// --- validation -----------------------------------------------------------

test('a foreign or corrupt file is refused with reasons', () => {
  const target = createWorkspace({ workspace_id: 'w2' });

  assert.throws(
    () => importWorkspace(target, JSON.stringify({ format: 'something-else' })),
    ImportError,
  );

  const bad = exportWorkspace(populated());
  bad.workspace.schema_version = 99;
  assert.throws(() => importWorkspace(target, JSON.stringify(bad)), ImportError);
});

test('an import that would break invariants is refused whole', () => {
  const doc = exportWorkspace(populated());
  doc.workspace.order.npc.push('npc:does_not_exist');

  const target = createWorkspace({ workspace_id: 'w2' });
  assert.throws(
    () => importWorkspace(target, JSON.stringify(doc), { mode: 'replace' }),
    /invariants/,
  );
});

test('import bumps the revision so other tabs see a change', () => {
  const source = populated();
  const target = createWorkspace({ workspace_id: 'w2' });
  target.revision = 5;
  const { workspace } = importWorkspace(target, exportToJSON(source));
  assert.equal(workspace.revision, 6);
  assert.equal(workspace.undo, null, 'an import is not an undoable Archivist run');
});

test('reset keeps identity and settings but clears memory', () => {
  const source = populated();
  const fresh = resetWorkspace(source);
  assert.equal(fresh.workspace_id, 'w1');
  assert.equal(fresh.settings.max_archivist_promotions_per_run, 4);
  assert.deepEqual(fresh.cards, {});
  assert.equal(fresh.surfaces.event_log.text, '');
});

