import { canonicalSha256 } from '../core/canonical-json.js';
import { buildContinuityTransfer, inspectContinuityTransfer, applyContinuityTransfer } from '../core/continuity-transfer.js';
import { inspectAuthoredBlock, saveAuthoredBlock, exportAuthoredBlock, authoredRevisionPrompt } from '../core/authored-library.js';

// Every write is delegated to the panel's epoch/route/storage guarded commit.
// Preview inputs survive rerenders, but the panel discards them on route changes.
export function continuityTools({ el, ws, draft, mutate, notify, render, readAuthored, copy, download }) {
  const action = fn => async () => { try { await fn(); } catch (error) { notify(error.message); } };
  const button = (label, fn) => el('button', { class: 'act', onclick: action(fn) }, label);
  const transfer = el('textarea', { rows: 5, 'aria-label': 'Continuity transfer JSON', placeholder: 'Paste the continuity-transfer JSON from the previous part.' });
  transfer.value = draft.transfer ?? '';
  transfer.oninput = () => { draft.transfer = transfer.value; delete draft.transferReview; };
  const block = el('textarea', { rows: 7, 'aria-label': 'Authored block JSON', placeholder: '{"kind":"npc","name":"Kit","text":"Complete authored definition…"}' });
  block.value = draft.block ?? '';
  block.oninput = () => { draft.block = block.value; delete draft.blockReview; };
  const changes = el('textarea', { rows: 3, 'aria-label': 'Established changes for proposed revision', placeholder: 'Paste established changes/evidence for a proposed revision. Nothing is inferred automatically.' });
  changes.value = draft.changes ?? '';
  changes.oninput = () => { draft.changes = changes.value; };
  const source = el('select', { 'aria-label': 'Visible authored block' });
  const entries = Object.entries(readAuthored()).flatMap(([kind, values]) => values.map(value => ({ kind, name: value.name, text: value.description })));
  entries.forEach((entry, i) => source.append(el('option', { value: String(i) }, `${entry.kind}: ${entry.name}`)));
  return el('section', {}, el('h2', {}, 'Continuity handoff and authored library'),
    el('h3', {}, 'Continue in a sequel / another session'),
    el('p', {}, 'First use DreamGen Create Sequel and review its HISTORY. Export continuity here, then inspect and import it in the new session. This transfers local facts only—not game mechanics, deck cards, turn counters, saved delivery proof, or host history. Target continuity must be empty.'),
    button('Download continuity transfer', () => download('dgce-continuity-transfer.json', JSON.stringify(buildContinuityTransfer(ws), null, 2))),
    transfer,
    button('Inspect transfer', () => {
      draft.transferReview = { ...inspectContinuityTransfer(draft.transfer ?? ''), targetDigest: canonicalSha256(ws).hash };
      render();
    }),
    draft.transferReview ? el('div', {},
      el('pre', {}, JSON.stringify({ source: draft.transferReview.packet.source, counts: draft.transferReview.counts,
        cards: draft.transferReview.packet.memory.cards,
        surfaces: draft.transferReview.packet.memory.surfaces }, null, 2)),
      button('Import reviewed continuity into this session', async () => {
        const review = draft.transferReview;
        if (!review) throw new Error('Inspect the transfer first.');
        const result = await mutate(current => Object.assign(current, applyContinuityTransfer(current, draft.transfer ?? '', review)));
        if (result.ok) { delete draft.transferReview; notify('Continuity imported. Host history clearance and campaign state were not changed.'); }
      })) : null,
    el('h3', {}, 'Authored blocks — review, archive and copy'),
    el('p', {}, 'Keep complete native definitions locally before swapping Building Blocks. Archived text is not injected and never edits DreamGen. Copy the reviewed replacement into the host yourself; archive the outgoing definition before removing it there. Do not mount competing versions in both places.'),
    source, button('Read selected visible block into draft', () => {
      const entry = entries[Number(source.value)];
      if (!entry) throw new Error('No authored fields are visible. Open the scenario settings or paste a block manually.');
      draft.block = JSON.stringify(entry, null, 2); delete draft.blockReview; render();
    }), block,
    button('Inspect block', () => { draft.blockReview = inspectAuthoredBlock(draft.block ?? ''); render(); }),
    draft.blockReview ? el('div', {}, el('pre', {}, JSON.stringify(draft.blockReview.block, null, 2)),
      button('Save reviewed block to local library', async () => {
        const review = draft.blockReview;
        if (!review) throw new Error('Inspect the block first.');
        const result = await mutate(current => saveAuthoredBlock(current, draft.block ?? '', review.digest));
        if (result.ok) { delete draft.blockReview; notify('Archived locally. No scenario text or model context changed.'); }
      })) : null,
    changes,
    ...(ws.authored_library ?? []).map(entry => el('details', {},
      el('summary', {}, `${entry.kind}: ${entry.name}`), el('pre', {}, entry.text),
      button('Copy complete text for DreamGen', () => copy(exportAuthoredBlock(entry).text)),
      button('Download block JSON', () => download('dgce-authored-block.json', JSON.stringify(exportAuthoredBlock(entry), null, 2))),
      button('Edit as a new reviewed version', () => { draft.block = JSON.stringify(exportAuthoredBlock(entry), null, 2); delete draft.blockReview; render(); }),
      button('Copy revision-review prompt for Assistant', () => copy(authoredRevisionPrompt(entry, draft.changes ?? ''))))),
    el('p', {}, 'Library versions remain separate from remembered events. Full library data is included in ordinary backups; individual JSON blocks can be reviewed/imported in either edition. Host speaker/portrait repairs and native sequel creation remain DreamGen controls.'));
}
