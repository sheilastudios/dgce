import { loadedInteractionRoots } from './builder-transcript.js';
import { semanticInjectionText } from '../core/injection.js';

function paragraphText(node) {
  if (node.nodeType === 3) return node.nodeValue ?? '';
  if (node.nodeType === 8) return '';
  if (node.tagName === 'BR') return '\n';
  const children = node.childNodes ? [...node.childNodes] : null;
  const text = children ? children.map((child, index) => {
    // Markdown rendering inserts source-formatting whitespace between P tags.
    // P already supplies the paragraph boundary; do not count that HTML-only
    // separator again. Whitespace INSIDE paragraphs/inline elements stays exact.
    if (child.nodeType === 3 && /^[\t\r\n ]+$/.test(child.nodeValue ?? '')
        && children[index - 1]?.tagName === 'P' && children[index + 1]?.tagName === 'P') return '';
    return paragraphText(child);
  }).join('') : node.textContent ?? '';
  return node.tagName === 'P' ? `${text}\n\n` : text;
}

function bodyText(root, { preserveParagraphs = false } = {}) {
  if (!root) return '';
  const bodies = [...root.querySelectorAll('.prose')].filter(node =>
    !node.parentElement?.closest?.('.prose'));
  return bodies.map(node => {
    const copy = node.cloneNode(true);
    for (const control of copy.querySelectorAll('button, input, select, textarea')) control.remove();
    return preserveParagraphs ? paragraphText(copy).trim() : copy.textContent ?? '';
  }).join('\n\n').trim();
}

export { bodyText as interactionBodyText };

// Check interaction boundaries BEFORE flattening a transcript. Otherwise an
// opener in one turn and an orphan closer in another could look balanced.
export function assertInteractionSourceFidelity(doc = document) {
  const roots = new Set([...loadedInteractionRoots(doc), ...doc.querySelectorAll('div.OUTPUT')]);
  for (const root of roots) semanticInjectionText(bodyText(root, { preserveParagraphs: true }));
}

// Saved interactions lose OUTPUT on reload. Recognize the observed narrative
// header explicitly, never a player's quoted markup or arbitrary page prose.
export function isSavedNarrative(root) {
  return root?.querySelector?.('.flex.justify-between.items-center')?.textContent.trim() === '(narrative)';
}

export function checkMessageRoots(doc = document) {
  return [...doc.querySelectorAll('div.OUTPUT'), ...loadedInteractionRoots(doc).filter(isSavedNarrative)];
}

export function readCheckResponse(doc = document) {
  const live = bodyText([...doc.querySelectorAll('div.OUTPUT')].at(-1));
  if (live) return live;
  const latest = loadedInteractionRoots(doc).at(-1);
  // Do not search back past a later player action or an unrecognized speaker.
  return isSavedNarrative(latest) ? bodyText(latest) : '';
}
