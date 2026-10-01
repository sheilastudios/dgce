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
