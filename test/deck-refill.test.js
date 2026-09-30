import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createWorkspace } from '../extension/core/workspace.js';
import { parseProposedCards, proposeCards } from '../extension/core/deck.js';

const source = readFileSync(new URL('../extension/ui/panel.js', import.meta.url), 'utf8');
const at = source.indexOf('async function requestDeckRefill(');
const code = source.slice(at, source.indexOf('\n}', at) + 2);
const reply = 'CARD: Rain taps the glass.\nCARD: A bell rings outside.';
function fixture({ ask, commit, mode = 'assisted_auto' } = {}) {
  const ws = createWorkspace({ workspace_id: 'refill-test' }); ws.deck.mode = mode;
  const state = { ws, epoch: 1, assistantBusy: false, archivistBusy: false, deckRefill: null };
  let asks = 0, commits = 0;
  const run = runInNewContext(`${code}\nrequestDeckRefill`, {
    state, editionWorkspaceIssue: () => null,
    deckAssisted: d => ['assisted_auto', 'assisted_review'].includes(d.mode),
    isCurrent: epoch => state.epoch === epoch, render() {},
    scheduleArchivistRecheck() { assert.equal(state.assistantBusy, false); },
    freeDeckContext: () => ({}), renderReplenishPrompt: () => 'refill prompt',
    askAssistant: async () => { asks++; return ask ? ask(state) : reply; },
    parseProposedCards, proposeCards,
    commitDeck: async fn => {
      commits++;
      if (commit) return commit(state, fn);
      try {
        if (state.ws.ordinary_pending) throw new Error('pending turn');
        fn(state.ws); return { ok: true };
      } catch (error) { return { ok: false, error }; }
    },
  });
  return { state, run, counts: () => ({ asks, commits }) };
}

test('actual refill function adopts completed cards only after successful save', async () => {
  const fx = fixture(); await fx.run();
  assert.equal(fx.state.ws.deck.cards.length, 2);
  assert.equal(fx.state.deckRefill.phase, 'applied');
  assert.equal(fx.state.deckRefill.message, '2 cards added; 0 queued for review.');
  assert.equal(fx.state.assistantBusy, false);
});

test('review mode queues proposals instead of committing them to the draw pool', async () => {
  const fx = fixture({ mode: 'assisted_review' }); await fx.run();
  assert.equal(fx.state.ws.deck.cards.length, 0);
  assert.equal(fx.state.ws.deck.pending.length, 2);
  assert.match(fx.state.deckRefill.message, /2 queued/);
});

test('failed commit return is not silently treated as successful refill', async () => {
  const fx = fixture({ commit: () => ({ ok: false, error: new Error('quota full') }) });
  await fx.run();
  assert.equal(fx.state.deckRefill.phase, 'failed');
  assert.equal(fx.state.deckRefill.reply, reply);
  assert.match(fx.state.deckRefill.message, /quota full/);
  assert.equal(fx.state.ws.deck.cards.length, 0);
  await fx.run();
  assert.equal(fx.counts().asks, 1);
});

test('pending turn appearing during generation preserves reply without bypassing guard', async () => {
  const fx = fixture({ ask: state => { state.ws.ordinary_pending = { id: 'pending' }; return reply; } });
  await fx.run();
  assert.equal(fx.state.deckRefill.reply, reply);
  assert.match(fx.state.deckRefill.message, /pending turn/);
  fx.state.ws.ordinary_pending = null;
  await fx.run();
  assert.equal(fx.counts().asks, 1);
  assert.equal(fx.state.ws.deck.cards.length, 0);
});

test('timeout is visible and suppresses automatic repeat requests', async () => {
  const fx = fixture({ ask: () => { throw new Error('Assistant idle limit reached'); } });
  await fx.run(); await fx.run();
  assert.equal(fx.counts().asks, 1);
  assert.match(fx.state.deckRefill.message, /idle limit.*late reply/);
  assert.equal(fx.state.assistantBusy, false);
});

test('unparseable response is retained for review rather than silently discarded', async () => {
  const fx = fixture({ ask: () => 'No properly formatted cards.' }); await fx.run();
  assert.equal(fx.state.deckRefill.phase, 'failed');
  assert.equal(fx.state.deckRefill.reply, 'No properly formatted cards.');
  assert.equal(fx.counts().commits, 0);
});

test('mode change while waiting cannot silently change proposal authority', async () => {
  const fx = fixture({ mode: 'assisted_review', ask: state => { state.ws.deck.mode = 'assisted_auto'; return reply; } });
  await fx.run();
  assert.equal(fx.state.deckRefill.phase, 'failed');
  assert.match(fx.state.deckRefill.message, /mode changed/);
  assert.equal(fx.state.ws.deck.cards.length, 0);
});

test('old refill cannot adopt into or clear busy state for a new workspace', async () => {
  const fx = fixture({ ask: state => {
    state.epoch++; state.deckRefill = { phase: 'waiting', message: 'new session' };
    state.assistantBusy = true; return reply;
  } });
  await fx.run();
  assert.equal(fx.counts().commits, 0);
  assert.equal(fx.state.deckRefill.message, 'new session');
  assert.equal(fx.state.assistantBusy, true);
});

test('existing pending action and active maintenance prevent a new request', async () => {
  const fx = fixture(); fx.state.ws.ordinary_pending = { id: 'pending' }; await fx.run();
  fx.state.ws.ordinary_pending = null; fx.state.archivistBusy = true; await fx.run();
  assert.equal(fx.counts().asks, 0);
});
