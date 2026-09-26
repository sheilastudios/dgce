// Read-only capture of loaded roleplay interactions. No Load All, edit, save,
// delete, Assistant-history read, or inference of narrative authority.
import { loadedInteractionRoots } from './builder-transcript.js';
import { semanticInjectionText } from '../core/injection.js';
import { buildArchivistSourceContext } from '../core/archivist-source-context.js';

export function captureArchivistSources({ doc = document, maxBytes } = {}) {
  const busy = [...doc.querySelectorAll('button')].some(button => {
    if (button.closest?.('[role="tabpanel"]') || !button.getClientRects?.().length) return false;
    return [button.getAttribute?.('aria-label'), button.textContent].some(label =>
      /stop (generating|generation)|cancel generation|abort generation/i.test(label ?? ''));
  });
  if (busy) throw new Error('roleplay generation is active; source capture deferred');
  // The shared discovery helper groups known roots before fallback roots.
  // Re-establish document order locally; do not change deletion/cleanup order.
  const roots = loadedInteractionRoots(doc).sort((a, b) => {
    const position = a.compareDocumentPosition?.(b) ?? 0;
    if (position & 1) throw new Error('disconnected roleplay sources; capture deferred');
    return position & 4 ? -1 : position & 2 ? 1 : 0;
  });
  const records = [];
  for (const root of roots) {
    if (root.querySelector('[contenteditable][aria-label="Edit interaction text"], textarea[aria-label="Edit interaction text"]')) {
      throw new Error('roleplay interaction is being edited; source capture deferred');
    }
    const bodies = [...root.querySelectorAll('.prose')].filter(node =>
      !node.parentElement?.closest?.('.prose') && (!node.getClientRects || node.getClientRects().length));
    // A hidden element's innerText can expose textContent. Exclude hidden
    // containers first and never fall back to textContent for missing prose.
    const visible = bodies.map(node => typeof node.innerText === 'string' ? node.innerText : '').join('\n\n');
    const text = semanticInjectionText(visible).trim();
    if (!text) continue;
    const header = root.querySelector('.flex.justify-between.items-center');
    const speakerLabel = typeof header?.innerText === 'string' ? header.innerText.trim() : '';
    records.push({ speakerLabel, text });
  }
  return buildArchivistSourceContext(records, { maxBytes });
}
