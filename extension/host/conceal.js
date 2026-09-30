// Hide our own injected blocks from the transcript.
//
// This is presentation only. Nothing is written or deleted, and the text
// still reaches the model. A user's ordinary <hidden> block is never touched.
// Internal material is either a nonce-bearing <ext_ctx> injection or an
// explicitly allowlisted DGCE proposal packet.
//
//   law: conceal_what_we_added != conceal_what_they_hid

// DreamGen's rendering is shape-dependent. A compact body may become a
// "Reveal spoiler" chip or a <details> disclosure labelled "Show Hidden".
// Blank-line-separated campaign sections become sibling markdown blocks.
// The concealment layer therefore recognizes all three shapes explicitly.
//
//   law: matched_nothing != had_nothing_to_match

const CONCEALABLE = 'button[aria-label="Reveal spoiler"], details';
const CONTEXT = /<?ext_ctx|dgce-[0-9a-f]{6}/;
const PROPOSAL = /<dgce_(?:setup|floor|campaign|social)>/i;
const OPEN_SPLIT = /^\s*<hidden>\s*<ext_ctx\b[^>]*\bid\s*=\s*["\u201C\u201D]dgce-[0-9a-f]{6,}["\u201C\u201D][^>]*>/i;
const CLOSE_SPLIT = /<\/ext_ctx>\s*<\/hidden>\s*$/i;
const OPEN_PROPOSAL = /^\s*(?:<hidden>\s*)?<dgce_(setup|floor|campaign|social)>/i;
const MARK = 'data-dgce-concealed';

export function findInlineProposalRanges(text) {
  const re = /(?:<hidden>\s*)?<dgce_(setup|floor|campaign|social)>[\s\S]*?<\/dgce_\1>\s*(?:<\/hidden>)?/gi;
  return [...String(text ?? '').matchAll(re)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    kind: match[1].toLowerCase(),
  }));
}

function hide(el) {
  if (!el || el.hasAttribute?.(MARK)) return 0;
  el.setAttribute?.(MARK, '1');
  if (el.style) el.style.display = 'none';
  return 1;
}

// DreamGen can parse one injected block into several sibling markdown nodes.
// Hide only a complete nonce-bearing range inside one message container. If
// either exact boundary is absent, hide nothing.
function concealSiblingRange(start, closes, opens) {
  const parent = start.parentElement;
  if (!parent?.children) return 0;
  const siblings = [...parent.children];
  const at = siblings.indexOf(start);
  if (at < 0) return 0;

  const range = [];
  let complete = false;
  for (let i = at; i < siblings.length && range.length < 128; i += 1) {
    const sibling = siblings[i];
    const text = sibling.textContent || '';
    if (i > at && opens(text)) break;
    range.push(sibling);
    if (closes(text)) {
      complete = true;
      break;
    }
  }
  if (!complete) return 0;
  return range.reduce((total, el) => total + hide(el), 0);
}

function concealSplitBlocks(root) {
  let hidden = 0;
  for (const start of root.querySelectorAll?.('p') ?? []) {
    const text = start.textContent || '';
    if (OPEN_SPLIT.test(text)) {
      hidden += concealSiblingRange(
        start,
        (value) => CLOSE_SPLIT.test(value),
        (value) => OPEN_SPLIT.test(value) || OPEN_PROPOSAL.test(value),
      );
      continue;
    }
    const proposal = OPEN_PROPOSAL.exec(text);
    if (!proposal) continue;
    const close = new RegExp(`<\\/dgce_${proposal[1]}>\\s*(?:<\\/hidden>)?\\s*$`, 'i');
    hidden += concealSiblingRange(
      start,
      (value) => close.test(value),
      (value) => OPEN_SPLIT.test(value) || OPEN_PROPOSAL.test(value),
    );
  }
  return hidden;
}

function textNodesWithin(root, out = []) {
  for (const child of root?.childNodes ?? []) {
    if (child.nodeType === 3) out.push(child);
    else textNodesWithin(child, out);
  }
  return out;
}

function pointAt(nodes, offset) {
  let cursor = 0;
  for (const node of nodes) {
    const length = String(node.nodeValue ?? '').length;
    if (offset <= cursor + length) return { node, offset: offset - cursor };
    cursor += length;
  }
  return null;
}

function markedWithin(node, container) {
  for (let el = node?.parentElement; el && el !== container; el = el.parentElement) {
    if (el.hasAttribute?.(MARK)) return true;
  }
  return false;
}

// A malformed markdown response can strand an otherwise valid proposal in the
// middle of a prose paragraph. Hide only the exact transport range. DOM Range
// preserves the surrounding prose and keeps the concealed text in textContent,
// so admission and model context can still read it.
function concealInlineProposals(root, selector = 'p', findRanges = findInlineProposalRanges) {
  let hidden = 0;
  for (const container of root.querySelectorAll?.(selector) ?? []) {
    if (container.hasAttribute?.(MARK)) continue;
    const ranges = findRanges(container.textContent);
    if (ranges.length === 1 && !container.textContent.slice(0, ranges[0].start).trim()
        && !container.textContent.slice(ranges[0].end).trim()) {
      hidden += hide(container);
      continue;
    }
    const doc = container.ownerDocument;
    if (!ranges.length || !doc?.createRange || !doc?.createElement) continue;

    for (const spec of ranges.reverse()) {
      const nodes = textNodesWithin(container);
      const start = pointAt(nodes, spec.start);
      const end = pointAt(nodes, spec.end);
      if (!start || !end) continue;

      let cursor = 0;
      const touched = nodes.filter((node) => {
        const next = cursor + String(node.nodeValue ?? '').length;
        const overlaps = next > spec.start && cursor < spec.end;
        cursor = next;
        return overlaps;
      });
      if (touched.length && touched.every((node) => markedWithin(node, container))) continue;

      const range = doc.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      const span = doc.createElement('span');
      hide(span);
      span.appendChild(range.extractContents());
      range.insertNode(span);
      hidden += 1;
    }
  }
  return hidden;
}



/** Hide every host-rendered extension block and return the number hidden. */
export function concealOurBlocks(root = document) {
  let hidden = 0;
  for (const el of root.querySelectorAll?.(CONCEALABLE) ?? []) {
    if (el.hasAttribute(MARK)) continue;
    const text = el.textContent || '';
    if (!CONTEXT.test(text) && !PROPOSAL.test(text)) continue;
    hidden += hide(el);
  }
  return hidden + concealSplitBlocks(root);
}

/** Keep concealing as DreamGen re-renders and grows the transcript. */
export function watchAndConceal({ debounceMs = 200, onAfterScan = null } = {}) {
  concealOurBlocks();
  try { onAfterScan?.(); } catch { /* observation must never affect presentation */ }

  let timer = null;
  const observer = new MutationObserver(() => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      try {
        concealOurBlocks();
        onAfterScan?.();
      } catch {
        /* presentation cleanup must never break the host */
      }
    }, debounceMs);
  });

  observer.observe(document.body, { childList: true, subtree: true });
  return () => {
    if (timer) clearTimeout(timer);
    observer.disconnect();
  };
}
