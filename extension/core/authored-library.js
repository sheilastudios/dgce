// User-reviewed authored text, separate from Archivist facts and campaign state.
// No host writes and no generation authority: exports are pasted by the owner.
import { canonicalSha256 } from './canonical-json.js';
const TYPES = ['persona', 'npc', 'location', 'object', 'history', 'plot', 'style', 'setting'];
export function inspectAuthoredBlock(raw) {
  const value = typeof raw === 'string' ? JSON.parse(raw) : structuredClone(raw);
  if (!value || !TYPES.includes(value.kind) || typeof value.name !== 'string' || !value.name.trim()
      || typeof value.text !== 'string' || !value.text.trim() || value.name.length > 300 || value.text.length > 100000) throw new Error('A block needs a supported kind, name, and nonempty text (up to 100,000 characters).');
  if (Object.keys(value).some(key => !['kind', 'name', 'text'].includes(key))) throw new Error('Unexpected block fields; import only kind, name and text.');
  return { block: value, digest: canonicalSha256(value).hash };
}
export function saveAuthoredBlock(ws, raw, digest) {
  if (ws.ordinary_pending) throw new Error('Reconcile delivery before editing the library.');
  const review = inspectAuthoredBlock(raw);
  if (review.digest !== digest) throw new Error('Block changed after review. Inspect it again.');
  ws.authored_library ??= [];
  if (!ws.authored_library.some(entry => entry.id === digest)) ws.authored_library.push({ id: digest, ...review.block });
  return ws;
}
export function exportAuthoredBlock(entry) {
  return inspectAuthoredBlock({ kind: entry.kind, name: entry.name, text: entry.text }).block;
}
export function authoredRevisionPrompt(entry, notes) {
  const block = exportAuthoredBlock(entry);
  return 'Draft a proposed revision of this authored DreamGen block. Do not continue roleplay.\n'
    + 'Preserve unaffected text and all qualifiers. Use ONLY the supplied established changes.\n'
    + 'Do not invent persona actions, beliefs, feelings, item possession or mechanics. If evidence conflicts, list the conflict instead of deciding.\n'
    + 'Return the proposed complete block and a concise change list for the owner to review; nothing will be applied automatically.\n'
    + JSON.stringify({ original: block, established_changes: String(notes) }, null, 2);
}
