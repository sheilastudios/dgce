// Runs only against the standalone Free artifact, not a simulated edition flag.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as edition from '../extension/core/edition.js';
import * as deck from '../extension/core/deck.js';
import { createWorkspace, serialize, deserialize } from '../extension/core/workspace.js';
import { buildInjection, buildInjectionBody } from '../extension/core/injection.js';
import { exportToJSON, importWorkspace } from '../extension/core/portable.js';
import { WorkspaceStore } from '../extension/storage.js';
import { commitOrdinaryTurn, cancelUnsentOrdinaryTurn } from '../extension/host/ordinary-turn.js';
import { campaignDeckContext } from '../extension/core/entity-authority.js';
const panel = readFileSync(new URL('../extension/ui/panel.js', import.meta.url), 'utf8');
const extract = name => { const at = panel.indexOf(`function ${name}(`); assert.ok(at >= 0, name); return panel.slice(panel.slice(at - 6, at) === 'async ' ? at - 6 : at, panel.indexOf('\n}', at) + 2); };
function fixture() {
  const ws = createWorkspace({ workspace_id: 'free-deck' });
  deck.setMode(ws.deck, 'manual');
  deck.addCards(ws.deck, 'A delivery cart rattles past the library window.', { anchored: true, scope: 'npc:porter' });
  return ws;
}
function planner(ws, extras = {}) {
  return runInNewContext(`${extract('planInjection')}\nplanInjection`, {
    ...edition, state: { store: {} }, workspaceIdFromLocation: () => ws.workspace_id,
    authoritativeInjectionAllowed: () => true, hasCurrentHistoryClearance: () => true,
    recentModelTurns: () => [], stageForNextTurn: () => ({ staged: [] }), buildInjection,
    deckEnabled: deck.isEnabled, drawCard: value => deck.drawCard(value, () => 0), structuredClone, ...extras,
  });
}
test('Free old null deck migrates to off; current pool and review queue survive reload', () => {
  const old = fixture(); old.deck = null;
  assert.deepEqual(deserialize(serialize(old)).deck, deck.createDeck());
  const ws = fixture(); deck.setMode(ws.deck, 'assisted_review'); deck.proposeCards(ws.deck, 'The porter checks a parcel.');
  assert.deepEqual(deserialize(serialize(ws)).deck, ws.deck);
});
test('Free deck sends a single consumed optional seed, not a memory update or RNG vector', () => {
  const ws = fixture(), before = serialize(ws.cards), plan = planner(ws);
  const injection = plan('I keep reading.', ws);
  assert.deepEqual(injection.parts, ['deck']);
  assert.match(injection.body, /delivery cart/);
  assert.ok(injection.body.includes(deck.IGNORE_LICENSE));
  assert.equal(ws.deck.cards.length, 0);
  assert.equal(serialize(ws.cards), before);
  assert.equal(plan('Continue reading.', ws), null);
  assert.equal(ws.deck.current_draw, null);
});
test('Free deck off, history gate, and budget exclusion never consume an unsent card', () => {
  for (const mode of ['off', 'history', 'budget', 'dropped']) {
    const ws = fixture();
    if (mode === 'off') deck.setMode(ws.deck, 'off');
    if (mode === 'budget') ws.settings.continuity_context_budget = 1;
    if (mode === 'dropped') {
      ws.settings.continuity_context_budget = 35;
      ws.surfaces.event_log.text = 'The library is quiet.';
      ws.surfaces.event_log.injection_schedule.every_n_turns = 1;
    }
    const before = structuredClone(ws.deck);
    const result = planner(ws, { hasCurrentHistoryClearance: () => mode !== 'history' })('Read.', ws);
    assert.ok(!result?.parts.includes('deck'), mode);
    assert.deepEqual(ws.deck, before, mode);
  }
});
test('Free disabled deck never projects an earlier current draw', () => {
  const ws = fixture(); deck.drawCard(ws.deck); deck.setMode(ws.deck, 'off');
  assert.equal(buildInjectionBody(ws).body, null);
});
test('Free replacement backup restores pool, anchors, scope, mode, queue and draw; additive keeps target deck', () => {
  const ws = fixture(); deck.setMode(ws.deck, 'assisted_review');
  deck.proposeCards(ws.deck, 'A clerk sorts the unopened mail.');
  const json = exportToJSON(ws), target = createWorkspace({ workspace_id: 'target' });
  assert.deepEqual(importWorkspace(target, json, { mode: 'replace' }).workspace.deck, ws.deck);
  assert.deepEqual(importWorkspace(target, json, { mode: 'merge' }).workspace.deck, target.deck);
  deck.drawCard(ws.deck);
  assert.deepEqual(importWorkspace(target, exportToJSON(ws), { mode: 'replace' }).workspace.deck, ws.deck);
});
test('Free committed deck draw rolls back exactly before release; a pending send cannot draw twice', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis.navigator, 'locks');
  Object.defineProperty(globalThis.navigator, 'locks', { configurable: true, value: { request: (_key, fn) => fn() } });
  t.after(() => previous ? Object.defineProperty(globalThis.navigator, 'locks', previous) : delete globalThis.navigator.locks);
  const initial = fixture(), values = new Map([['dgce:free-deck:workspace', serialize(initial)]]);
  const store = new WorkspaceStore({ workspaceId: initial.workspace_id, backend: {
    get: async key => values.get(key), set: async (key, value) => values.set(key, value), keys: async () => [...values.keys()],
  } });
  const base = await store.read(), candidate = structuredClone(base);
  const injection = planner(candidate)('Read.', candidate);
  const saved = await commitOrdinaryTurn({ store, base, candidate, id: 'deck-turn', text: 'Read.', outgoingText: injection.block, injection });
  assert.equal(saved.deck.cards.length, 0);
  assert.ok(saved.ordinary_pending.changes.some(effect => effect.key === 'deck'));
  assert.equal(edition.editionWorkspaceIssue(saved), null);
  await assert.rejects(commitOrdinaryTurn({ store, base: saved, candidate: saved, id: 'twice', text: 'Read.', outgoingText: 'Read.' }), /pending ordinary/);
  await cancelUnsentOrdinaryTurn(store, 'deck-turn');
  assert.deepEqual((await store.read()).deck, base.deck);
});
test('Free assembled Deck tab is active and Assistant refill waits for other work or recovery', () => {
  assert.match(panel, /Deck: deckTab/);
  assert.match(panel, /setTimeout\(maybeReplenishDeck, 2000\)/);
  assert.match(extract('deckTab'), /Ask the Assistant/);
  for (const flag of ['assistantBusy', 'archivistBusy', 'ordinary_pending']) {
    const ws = fixture(); deck.setMode(ws.deck, 'assisted_auto');
    const state = { ws, [flag]: true };
    if (flag === 'ordinary_pending') ws.ordinary_pending = { id: 'pending' };
    runInNewContext(`${extract('requestDeckRefill')}\n${extract('maybeReplenishDeck')}\nmaybeReplenishDeck()`, {
      ...edition, state, deckAssisted: deck.isAssisted, needsReplenish: deck.needsReplenish,
      probeAssistant: () => assert.fail('Must not reach Assistant while busy or pending'),
    });
  }
});
test('Free Deck controls render all four modes and manual add, anchor and review use real deck operations', async () => {
  const ws = fixture(), state = { ws }, ids = new Map();
  const el = (tag, props = {}, ...children) => {
    const node = { tag, ...props, children: children.flat(), value: props.value ?? '',
      append(...items) { this.children.push(...items); },
      setAttribute(key, value) { this[key] = value; },
      addEventListener(key, fn) { this[key] = fn; } };
    if (props.id) ids.set(props.id, node);
    return node;
  };
  const controls = nodes => nodes.flatMap(node => typeof node === 'object' && node ? [node, ...controls(node.children ?? [])] : []);
  const ctx = { state, el, DECK_MODES: deck.MODES,
    DECK_MODE_LABELS: { off: 'Off', manual: 'Manual', assisted_review: 'Review', assisted_auto: 'Auto' },
    deckEnabled: deck.isEnabled, deckAssisted: deck.isAssisted, needsReplenish: deck.needsReplenish,
    replenishTarget: deck.replenishTarget, setDeckMode: deck.setMode, addDeckCards: deck.addCards,
    setDeckAnchored: deck.setAnchored, removeDeckCard: deck.removeCard, acceptDeckCard: deck.acceptPending,
    rejectDeckCard: deck.rejectPending, parseProposedCards: deck.parseProposedCards,
    freeDeckContext: () => ({ knownNames: [], establishedActors: [] }), probeAssistant: () => ({ ready: false }),
    commitDeck: fn => fn(ws), root: { getElementById: id => ids.get(id) }, render() {},
  };
  const render = runInNewContext(`${extract('deckTab')}\ndeckTab`, ctx);
  for (const mode of deck.MODES) {
    deck.setMode(ws.deck, mode);
    const rows = controls(render());
    assert.equal(rows.filter(node => node.tag === 'option').length, 4);
    assert.ok(rows.some(node => node.children.includes('Chaos deck')));
    if (mode !== 'off') assert.ok(ids.get('deck-new'));
  }
  deck.setMode(ws.deck, 'manual');
  let rows = controls(render()); ids.get('deck-new').value = 'A kettle whistles in the next room.';
  assert.ok(rows.some(node => node.children.some(child => typeof child === 'string' && child.startsWith('Anchor keeps a card'))));
  rows.find(node => node.children.includes('Add')).onclick();
  rows = controls(render());
  const anchor = rows.find(node => node.children.includes('Anchor'));
  assert.match(anchor.title, /not from being drawn and consumed/);
  anchor.onclick();
  assert.equal(ws.deck.cards.find(card => card.text.startsWith('A kettle')).anchored, true);
  deck.setMode(ws.deck, 'assisted_review'); deck.proposeCards(ws.deck, 'The clerk opens a ledger.');
  rows = controls(render()); rows.find(node => node.children.includes('Accept')).onclick();
  assert.equal(ws.deck.pending.length, 0);
  assert.ok(ws.deck.cards.some(card => card.text === 'The clerk opens a ledger.'));
});
test('Free deck edits recheck pending state inside the write, not only before a request', () => {
  const ws = fixture(), before = serialize(ws.deck);
  const commitDeck = runInNewContext(`${extract('commitDeck')}\ncommitDeck`, {
    commit: fn => { ws.ordinary_pending = { id: 'raced' }; return fn(ws); },
  });
  assert.throws(() => commitDeck(value => deck.addCards(value.deck, 'Should not arrive.')), /pending turn/);
  assert.equal(serialize(ws.deck), before);
});
test('Free background refill admits only in the original session and respects review mode', async () => {
  for (const stale of [false, true]) {
    const ws = fixture(); deck.setMode(ws.deck, 'assisted_review');
    const state = { ws, epoch: 1 };
    let answer;
    runInNewContext(`${extract('requestDeckRefill')}\n${extract('maybeReplenishDeck')}\nmaybeReplenishDeck()`, {
      ...edition, state, deckAssisted: deck.isAssisted, needsReplenish: deck.needsReplenish,
      probeAssistant: () => ({ ready: true }), freeDeckContext: () => ({ knownNames: ['Porter'] }),
      renderReplenishPrompt: deck.renderReplenishPrompt,
      askAssistant: () => new Promise(resolve => { answer = resolve; }), isCurrent: epoch => epoch === state.epoch,
      render() {}, parseProposedCards: deck.parseProposedCards, proposeCards: deck.proposeCards,
      scheduleArchivistRecheck() { assert.equal(state.assistantBusy, false); },
      commitDeck: fn => { fn(ws); return { ok: true }; },
    });
    if (stale) { state.epoch++; state.assistantBusy = false; }
    answer('CARD: The porter checks the loading-bay bell.');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ws.deck.pending.length, stale ? 0 : 1);
    assert.equal(ws.deck.cards.length, 1, 'review proposals are not drawn before approval');
    assert.equal(state.assistantBusy, false);
  }
});
test('Free refill reuses authored NPC names without treating the player persona as an off-screen NPC', () => {
  const ws = fixture();
  const context = runInNewContext(`${extract('freeDeckContext')}\nfreeDeckContext`, {
    campaignDeckContext, readAuthoredEntities: () => ({ persona: [{ name: 'Rowan' }],
      npc: [{ name: 'Kit' }, { name: 'Rowan' }], location: [{ name: 'Storehouse' }], object: [] }),
  })(ws);
  assert.ok(context.knownNames.includes('Storehouse'));
  assert.ok(context.establishedActors.includes('Kit'));
  assert.ok(!context.establishedActors.includes('Rowan'));
  assert.ok(Object.values(context.genreProfile).every(values => values.length === 0));
});
