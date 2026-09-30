// Explicit first-publication cleanup for a dedicated campaign-builder session.
//
// The published snapshot already contains the admitted campaign. Once the user
// publishes, the construction dialogue is redundant input. DreamGen exposes a
// native per-interaction delete action, so this module uses that proven UI seam
// and never fabricates a host request. Cleanup is exact-count bounded and stops
// if one delete changes anything other than the selected interaction.

import { compareHostPackets } from '../core/host-packet-equivalence.js';

// Responsive duplicates can have a non-null offsetParent but no rendered box.
// Prefer actual layout evidence; the fallback supports non-DOM test adapters.
const visible = (node) => Boolean(node && (typeof node.getClientRects === 'function'
  ? node.getClientRects().length > 0 : node.offsetParent !== null));

const waitFor = async (fn, { attempts = 80, delay = 50 } = {}) => {
  for (let i = 0; i < attempts; i += 1) {
    const value = fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  return null;
};

// Shared by snapshot discovery and the trusted Cancel listener. A native
// Instruction toolbar has no Edit Interaction button while its editor is open.
function openInteractionRoot(control) {
  const root = control.closest?.('div.flex.flex-col.rounded-md');
  const editors = root?.querySelectorAll?.(editorSelector) ?? [];
  return root && editors.length === 1
    && editors[0].closest?.('div.flex.flex-col.rounded-md') === root
    && !root.querySelector?.('button[aria-label="Edit Interaction"]') ? root : null;
}

function interactionRoot(edit, doc) {
  const known = edit.closest?.('div.flex.flex-col.rounded-md.min-h-12');
  if (known) return known;
  const open = openInteractionRoot(edit);
  if (open) return open;
  let node = edit.parentElement;
  while (node && node !== doc.body) {
    const edits = node.querySelectorAll?.('button[aria-label="Edit Interaction"]') ?? [];
    if (edits.length === 1 && node.querySelector?.('p,pre,[data-slot="markdown"]')) return node;
    node = node.parentElement;
  }
  return null;
}

export function loadedInteractionRoots(doc = document) {
  if (!doc?.querySelectorAll) return [];
  const roots = [];
  const seen = new Set();
  // The edit button is replaced by an edit toolbar while an interaction is
  // open. Include those roots directly so opening the editor cannot masquerade
  // as a successful deletion.
  for (const root of doc.querySelectorAll('div.flex.flex-col.rounded-md.min-h-12')) {
    const isInteraction = root.querySelector?.(
      'button[aria-label="Edit Interaction"], [contenteditable][aria-label="Edit interaction text"], textarea[aria-label="Edit interaction text"]',
    ) || uniqueDeleteControl(root);
    if (!isInteraction || seen.has(root)) continue;
    seen.add(root);
    roots.push(root);
  }
  for (const edit of doc.querySelectorAll('button[aria-label="Edit Interaction"]')) {
    const root = interactionRoot(edit, doc);
    if (!root || seen.has(root)) continue;
    seen.add(root);
    roots.push(root);
  }
  // Instruction editors omit min-h-12 and replace their Edit button while
  // open. Keep the explicit native editor's nearest supported wrapper in the
  // same ordered snapshot. Never climb to an arbitrary transcript container.
  const editorSelector = '[contenteditable][aria-label="Edit interaction text"], textarea[aria-label="Edit interaction text"]';
  for (const editor of doc.querySelectorAll(editorSelector)) {
    const root = editor.closest?.('div.flex.flex-col.rounded-md.min-h-12')
      ?? openInteractionRoot(editor);
    if (root && seen.has(root)) continue;
    const editors = root?.querySelectorAll?.(editorSelector) ?? [];
    if (!root || editors.length !== 1 || editors[0] !== editor
        || root.querySelector?.('button[aria-label="Edit Interaction"]')) return [];
    seen.add(root);
    roots.push(root);
  }
  // Character, narrator and instruction layouts use different root shapes.
  // Collection batches above are not chronology: old fallback narration must
  // never count as a response following the newest character turn.
  // Real DOM roots are comparable; lightweight non-DOM test adapters are not.
  if (roots.some(root => root.isConnected === false || (root.ownerDocument && root.ownerDocument !== doc))) return [];
  if (roots.length > 1 && roots.every(root => typeof root.compareDocumentPosition === 'function')) {
    // Disconnected ordering is implementation-defined. Withhold the snapshot
    // rather than accidentally treating that ordering as complete history.
    if (roots.slice(1).some(root => roots[0].compareDocumentPosition(root) & 1)) return [];
    roots.sort((a, b) => {
      const relation = a.compareDocumentPosition(b);
      return relation & 4 ? -1 : relation & 2 ? 1 : 0;
    });
    // A container and its descendant are not two independent interactions.
    if (roots.slice(1).some((root, i) => roots[i].compareDocumentPosition(root) & (1 | 8 | 16))) return [];
  }
  return roots;
}

function exactVisibleButton(doc, { aria = null, text = null } = {}) {
  const buttons = [...doc.querySelectorAll('button')].filter(visible).filter((button) => {
    if (aria !== null) return button.getAttribute('aria-label') === aria;
    return (button.getAttribute?.('aria-label') || button.innerText || button.textContent || '').trim() === text;
  });
  return buttons.length === 1 ? buttons[0] : null;
}

/**
 * Ask DreamGen to materialize the complete interaction history in the DOM.
 *
 * Carrier cleanup and builder cleanup share this boundary.  Keeping it here
 * as the one implementation prevents one cleaner from silently treating a
 * paginated interaction as absent while another knows how to retrieve it.
 */
export function supportedHistoryHost(doc) {
  // This adapter is constrained to the captured English desktop roleplay UI.
  // The mounted English UI omits html.lang and uses an icon-only continuation
  // button. English accessible control names identify this captured shape;
  // an explicitly different locale or ambiguous visible controls still reject.
  const lang = doc?.documentElement?.lang ?? '';
  if (doc?.location?.origin !== 'https://v2.dreamgen.com'
      || !/^\/app\/my\/session\/[^/]+\/?$/.test(doc.location.pathname ?? '')
      || (lang && !/^en(?:-|$)/i.test(lang))) return false;
  // The same mounted composer switches from Continue to Send when a draft is
  // entered. That UI-only transition does not change the witnessed history.
  // Require exactly one rendered control across both states, not one of each.
  const submitControls = [...doc.querySelectorAll('button')].filter(visible)
    .filter(button => ['Continue conversation', 'Send interaction'].includes(
      (button.getAttribute?.('aria-label') || button.innerText || button.textContent || '').trim()));
  if (submitControls.length !== 1) return false;
  const composers = [...doc.querySelectorAll(
    'textarea[aria-label^="Message as "], [contenteditable][aria-label^="Message as "], textarea[aria-label="Instruction"], [contenteditable][aria-label="Instruction"], textarea[aria-label="Narrative"], [contenteditable][aria-label="Narrative"]',
  )].filter(visible);
  return composers.length === 1;
}

const historyWitnesses = new WeakMap();
const historyDiagnostics = new WeakMap();
// DreamGen moves this exact non-story continuation label when another turn is
// added. Ignore only its observed sibling-of-prose shape, never matching prose.
export function historyInteractionText(root) {
  const text = String(root?.textContent ?? root?.innerText ?? '');
  if (!root?.childNodes || !root.querySelectorAll) return text;
  const labels = [...root.querySelectorAll('div.text-xs.text-muted-foreground.mt-1.flex.items-center')]
    .filter(node => node.textContent === '(to be continued...)'
      && node.childNodes?.length === 1 && node.childNodes[0].nodeType === 3
      && !node.closest?.('.prose,pre,code')
      && node.parentElement?.matches?.('div.text-foreground.flex.flex-col.rounded-md.py-1')
      && node.parentElement.children.length === 2 && node.parentElement.children[1] === node
      && node.parentElement.children[0].matches?.('div.prose'));
  if (labels.length !== 1) return text;
  const read = node => node === labels[0] ? '' : node.nodeType === 3 ? node.textContent
    : [...(node.childNodes ?? [])].map(read).join('');
  return read(root);
}
const rootText = historyInteractionText;
const editorSelector = '[contenteditable][aria-label="Edit interaction text"], textarea[aria-label="Edit interaction text"]';
const historyListeners = new WeakSet();
const clock = () => globalThis.performance?.now?.() ?? Date.now();
const remountScope = 'supported_host_trusted_send_reply_batch';
const shape = root => typeof root?.className === 'string' && root.tagName
  && root.querySelectorAll?.('.prose').length === 1
  ? `${root.tagName}|${root.className.split(/\s+/).sort().join(' ')}` : null;
const classShape = node => typeof node?.className === 'string'
  ? node.className.split(/\s+/).filter(Boolean).sort().join(' ') : null;
function storedContainer(root) {
  if (root?.closest?.('div.OUTPUT')) return null;
  const group = root?.closest?.('div.group'), row = group?.parentElement, container = row?.parentElement;
  return group?.contains?.(root) && row?.tagName === 'DIV' && container?.tagName === 'DIV'
    && classShape(row) === 'flex flex-col' && classShape(container) === 'flex flex-col'
    && row.children?.length === 1 && row.children[0] === group ? container : null;
}
function generatedBatch(doc, roots, start, anchor) {
  const members = roots.slice(start), outputs = [...doc.querySelectorAll('div.OUTPUT')];
  if (!members.length || members.length > 8 || outputs.length !== 1) return null;
  const output = outputs[0], container = storedContainer(anchor);
  if (!container || output.tagName !== 'DIV'
      || classShape(output) !== 'OUTPUT flex flex-col min-h-[calc(min(23rem,47vh))] relative'
      || output.contains(anchor) || output.parentElement !== container.parentElement
      || members.some(root => root.closest?.('div.OUTPUT') !== output)
      || roots.slice(0, start).some(root => output.contains(root))) return null;
  return { start, end: roots.length, shapes: members.map(shape), storedContainer: container };
}

// This is a representation-continuity lease, never interaction identity or a
// delivery receipt. Called only by the isolated final native-release hook.
export function armHistoryLocalSend(doc, { id, visibleText, carrierText = null } = {}) {
  const witness = historyWitnesses.get(doc);
  if (!id || typeof visibleText !== 'string' || !visibleText.trim() || !witness
      || witness.send || witness.edit || witness.ownedEdit || !hasHistoryCompletenessWitness(doc)) {
    recordHistoryDiagnostic(doc, { reason: 'local_send_not_armed', witness_present: Boolean(witness),
      prior_send: Boolean(witness?.send), readonly_edit: Boolean(witness?.edit), owned_edit: Boolean(witness?.ownedEdit) });
    return false;
  }
  const composers = [...doc.querySelectorAll('textarea[aria-label^="Message as "], [contenteditable][aria-label^="Message as "], textarea[aria-label="Instruction"], [contenteditable][aria-label="Instruction"], textarea[aria-label="Narrative"], [contenteditable][aria-label="Narrative"]')].filter(visible);
  if (composers.length !== 1) {
    recordHistoryDiagnostic(doc, { reason: 'local_send_composer_count', count: composers.length }); return false;
  }
  const label = composers[0].getAttribute?.('aria-label');
  // The mounted Instruction row has a mode header, not a character identity.
  // Narrative submission is still outside this release/anchor adapter.
  const mode = label === 'Instruction' ? 'instruction' : label?.startsWith('Message as ') ? 'message' : null;
  const actor = mode === 'instruction' ? '(instructions)' : mode === 'message' ? label.slice('Message as '.length) : null;
  if (!actor) { recordHistoryDiagnostic(doc, { reason: 'local_send_mode_unsupported' }); return false; }
  witness.send = { id, visibleText: visibleText.replace(/\r\n/g, '\n').trim(), actor, mode,
    carrierText: typeof carrierText === 'string' ? carrierText : null,
    count: witness.roots.length, expires: clock() + 120_000,
    priorBatch: witness.replyBatch ? { ...witness.replyBatch } : null };
  recordHistoryDiagnostic(doc, { reason: 'local_send_armed', count: witness.roots.length,
    prior_batch: Boolean(witness.replyBatch), carrier_bound: Boolean(witness.send.carrierText) });
  return true;
}

export function invalidateHistoryContinuity(doc, reason = 'host_timeline_changed') {
  invalidateHistory(doc, reason);
}

export function historyContinuityScope(doc) {
  return historyWitnesses.get(doc)?.scope ?? 'supported_host_visible_history';
}

// Explicit clean-start user confirmation only. This is not automatic host
// completeness proof, and is deliberately not reconstructed from saved audit
// data after a reload. The isolated UI also requires an unused workspace.
export function canAttestEmptySessionHistory(doc, expectedRoute) {
  if (doc?.location?.pathname !== expectedRoute || !supportedHistoryHost(doc)
      || loadedInteractionRoots(doc).length !== 0
      || [...doc.querySelectorAll('button')].some(button => visible(button)
        && (button.innerText || button.textContent || '').trim() === 'Load all')
      || doc.querySelectorAll(editorSelector).length !== 0) return false;
  return true;
}

export function attestEmptySessionHistory(doc, expectedRoute) {
  if (!canAttestEmptySessionHistory(doc, expectedRoute)) return false;
  historyWitnesses.set(doc, { route: expectedRoute, roots: [], texts: [],
    scope: 'user_attested_empty_session' });
  watchReadOnlyHistoryEdits(doc);
  return true;
}

// Load all can finish while the last settled response still occupies OUTPUT.
// Retain that exact, bounded representation so a subsequent locally bound send
// can recognize its OUTPUT -> stored-row transition. This grants no delivery
// identity and creates no completeness evidence independently of Load all.
function loadedTerminalBatch(doc, roots) {
  const start = roots.findIndex(root => root.closest?.('div.OUTPUT'));
  if (start < 1) return null;
  return generatedBatch(doc, roots, start, roots[start - 1]);
}

// A separate user-attested origin for new sessions prefilled by a scenario.
// Never infer completeness from a button-free page or from these texts alone.
export function captureOpeningSessionHistory(doc, expectedRoute) {
  if (doc?.location?.pathname !== expectedRoute || !supportedHistoryHost(doc)
      || doc.querySelectorAll(editorSelector).length
      || [...doc.querySelectorAll('button')].some(button => visible(button)
        && (button.innerText || button.textContent || '').trim() === 'Load all')) return null;
  const roots = loadedInteractionRoots(doc), texts = roots.map(rootText);
  if (!roots.length || texts.some(text => !text.trim() || /ext_ctx|dgce-|campaignContext/i.test(text))) return null;
  return { route: expectedRoute, roots, texts };
}

export function openingSessionHistoryMatches(doc, snapshot) {
  if (!snapshot) return false;
  const current = captureOpeningSessionHistory(doc, snapshot.route);
  return Boolean(current && exactSnapshot(snapshot, current.roots));
}

export function attestOpeningSessionHistory(doc, snapshot) {
  if (!openingSessionHistoryMatches(doc, snapshot)) return false;
  historyWitnesses.set(doc, { route: snapshot.route, roots: [...snapshot.roots],
    texts: [...snapshot.texts], scope: 'user_attested_scenario_opening' });
  watchReadOnlyHistoryEdits(doc);
  return true;
}

// Display continuity only, NEVER raw-packet equivalence or delivery evidence.
// DreamGen renders dialogue delimiters as curly quotes in span.quote. Match
// only those DOM-proven edges for a locally armed send. Unknown rich markup
// stays unsupported; historical rows still require exact text and identity.
export function matchesLocalSendDisplay(prose, expected, carrierText = null) {
  if (typeof prose?.innerText !== 'string' || typeof expected !== 'string') return false;
  const normalize = text => text.replace(/\r\n/g, '\n').trim();
  const actual = normalize(prose.innerText);
  if (actual === expected) return true;
  // Markdown puts whitespace-only text nodes between block paragraphs. These
  // are not story whitespace within paragraphs and must not be concatenated.
  const paragraphs = Array.from(prose.childNodes ?? []).filter(node =>
    !(node.nodeType === 3 && /^[\r\n\t ]*$/.test(node.textContent)));
  if (!paragraphs.length) return false;
  let rendered = '';
  let visibleCount = 0;
  const concealed = [];
  const edges = new Set();
  for (const paragraph of paragraphs) {
    if (paragraph.nodeType !== 1 || paragraph.tagName !== 'P') return false;
    if (paragraph.getAttribute?.('data-dgce-concealed') === '1' && paragraph.style?.display === 'none') {
      concealed.push(paragraph.textContent); continue;
    }
    if (concealed.length) return false; // only the captured trailing carrier
    if (visibleCount++) rendered += '\n\n';
    for (const node of Array.from(paragraph.childNodes ?? [])) {
      if (node.nodeType === 3) { rendered += node.textContent; continue; }
      const children = Array.from(node.childNodes ?? []);
      if (node.nodeType !== 1 || node.tagName !== 'SPAN' || node.className !== 'quote'
          || !children.length || children.some(child => child.nodeType !== 3
            || typeof child.textContent !== 'string')) return false;
      // The host's quote component emits opening delimiter, body and closing
      // delimiter as separate adjacent Text nodes. Joining Text nodes changes
      // no characters; nested elements/comments remain unsupported.
      const text = children.map(child => child.textContent).join('');
      if (typeof text !== 'string' || text.length < 2 || !text.startsWith('“') || !text.endsWith('”')) return false;
      edges.add(rendered.length); edges.add(rendered.length + text.length - 1);
      rendered += text;
    }
  }
  // The concealment marker alone is not authority. Bind the complete suffix to
  // the exact locally recorded carrier, including its body, before excluding it.
  // This remains display matching, not permission to prune or confirm delivery.
  if (concealed.length && !matchesConcealedCarrierDisplay(carrierText, concealed)) return false;
  // Do not infer offsets through additional host whitespace transformations.
  if (rendered.includes('\r') || normalize(rendered) !== actual) return false;
  const trimOffset = rendered.length - rendered.trimStart().length;
  if (actual.length !== expected.length) return false;
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== expected[i] && !(expected[i] === '"' && edges.has(i + trimOffset))) return false;
  }
  return true;
}

function matchesConcealedCarrierDisplay(carrierText, paragraphs) {
  if (typeof carrierText !== 'string'
      || !/^<hidden><ext_ctx id="dgce-[0-9a-f]{6,}">\n/.test(carrierText)) return false;
  if (compareHostPackets(carrierText, paragraphs.join('\n\n')).equivalent) return true;
  // Captured host rendering drops four-space continuation indentation within a
  // paragraph (e.g. our memory support line). Project ONLY the locally bound
  // source, never trim the observed text. Preserve paragraph boundaries, every
  // body character and all other whitespace. This is not raw-packet evidence;
  // cleanup and delivery continue to use unmodified compareHostPackets.
  const sourceParagraphs = carrierText.replace(/\r\n/g, '\n').split('\n\n');
  return sourceParagraphs.length === paragraphs.length && sourceParagraphs.every((source, index) =>
    compareHostPackets(source.replace(/\n {4}(?=\S)/g, '\n'), paragraphs[index]).equivalent);
}

function localSendAnchorIssue(witness, roots) {
  const send = witness.send, root = roots[send?.count];
  if (!send) return 'send_missing';
  if (clock() > send.expires) return 'send_expired';
  if (!root) return 'anchor_missing';
  if (witness.roots.includes(root)) return 'anchor_not_new';
  if (!shape(root)) return 'anchor_shape';
  // Bind the Instruction header to its captured wrapper as well as exact text.
  // A character named "(instructions)" or a different mode is not that row.
  if (send.mode === 'instruction' && (root.tagName !== 'DIV'
      || classShape(root) !== 'flex flex-col rounded-md')) return 'instruction_shape';
  const names = root.querySelectorAll?.('div.text-sm.font-light.opacity-65') ?? [];
  const prose = root.querySelectorAll?.('.prose') ?? [];
  if (names.length !== 1 || names[0].textContent !== send.actor) return 'actor_mismatch';
  if (prose.length !== 1) return 'prose_count';
  return matchesLocalSendDisplay(prose[0], send.visibleText, send.carrierText) ? null : 'display_mismatch';
}
const newSendAnchor = (witness, roots) => localSendAnchorIssue(witness, roots) === null;

function replyBatchRemount(witness, roots) {
  const send = witness.send, batch = send?.priorBatch;
  if (!batch || clock() > send.expires || witness.edit || witness.ownedEdit
      || batch.end !== send.count || batch.end !== witness.roots.length
      || batch.start < 1 || batch.end - batch.start < 1 || batch.end - batch.start > 8
      || roots.length <= send.count || new Set(roots).size !== roots.length || !newSendAnchor(witness, roots)) return false;
  // The observed transition is live OUTPUT -> stored history. Same-text roots
  // elsewhere, including a second OUTPUT, are not this representation change.
  if (storedContainer(roots[batch.start - 1]) !== batch.storedContainer
      || storedContainer(roots[send.count]) !== batch.storedContainer
      || roots.slice(batch.start, batch.end).some(root => storedContainer(root) !== batch.storedContainer)) return false;
  const oldTexts = witness.texts.slice(batch.start, batch.end);
  if (new Set(oldTexts).size !== oldTexts.length) return false; // no duplicate-text mapping guess
  return witness.roots.every((old, i) => i < batch.start
    ? roots[i] === old && rootText(roots[i]) === witness.texts[i]
    : old.isConnected === false && roots[i] !== old && rootText(roots[i]) === witness.texts[i]
      && batch.shapes[i - batch.start] && shape(roots[i]) === batch.shapes[i - batch.start]);
}

function adoptSettledAddition(doc, witness, roots, texts, remounted) {
  const send = witness.send;
  // Only a locally submitted, exactly observed new player row can seed the
  // next terminal reply batch. Arbitrary additive history cannot do so.
  const contiguous = remounted || witness.roots.every((root, i) => roots[i] === root && rootText(root) === witness.texts[i]);
  witness.replyBatch = send && contiguous && newSendAnchor(witness, roots)
    ? generatedBatch(doc, roots, send.count + 1, roots[send.count]) : null;
  recordHistoryDiagnostic(doc, { reason: 'addition_settled', current_count: roots.length,
    prior_count: witness.roots.length, contiguous, remounted: Boolean(remounted),
    anchor_issue: localSendAnchorIssue(witness, roots), reply_batch: Boolean(witness.replyBatch),
    reply_count: send ? roots.length - send.count - 1 : null });
  // Representation continuity cannot promote a user-attested origin to proof.
  if (remounted && !['user_attested_empty_session', 'user_attested_scenario_opening'].includes(witness.scope)) witness.scope = remountScope;
  delete witness.send;
  witness.roots = roots;
  witness.texts = texts;
}

// Bounded, in-memory diagnostics only: no story text, receipts or clearance.
// Reading this export never inspects or changes the active witness.
export function historyContinuityDiagnostics(doc) {
  return (historyDiagnostics.get(doc) ?? []).map(item => ({ ...item }));
}
function recordHistoryDiagnostic(doc, entry) {
  historyDiagnostics.set(doc, [...(historyDiagnostics.get(doc) ?? []),
    { ...entry, at: new Date().toISOString() }].slice(-8));
}
function invalidateHistory(doc, reason) {
  const witness = historyWitnesses.get(doc);
  if (witness) {
    const roots = loadedInteractionRoots(doc);
    const entry = { reason, at: new Date().toISOString(), expected_count: witness.roots.length,
      current_count: roots.length, owned_edit: Boolean(witness.ownedEdit), readonly_edit: Boolean(witness.edit),
      first_identity_difference: roots.findIndex((root, i) => root !== witness.roots[i]),
      first_text_difference: roots.findIndex((root, i) => rootText(root) !== witness.texts[i]),
      send_present: Boolean(witness.send), prior_batch: Boolean(witness.send?.priorBatch),
      anchor_issue: localSendAnchorIssue(witness, roots) };
    recordHistoryDiagnostic(doc, entry);
  }
  historyWitnesses.delete(doc);
}

function exactSnapshot(witness, roots) {
  return roots.length === witness.roots.length
    && roots.every((root, i) => root === witness.roots[i] && rootText(root) === witness.texts[i]);
}

// Completeness can survive additions, not disappearance, recycling, reordering,
// or changes to an existing member. This says nothing about who authored a new
// interaction or whether the host persisted it. Admission still needs settling.
function additiveSnapshot(witness, roots) {
  if (roots.length <= witness.roots.length || new Set(roots).size !== roots.length) return false;
  let next = 0;
  for (const root of roots) {
    if (root === witness.roots[next]) {
      if (rootText(root) !== witness.texts[next]) return false;
      next += 1;
    }
  }
  return next === witness.roots.length;
}

function isolatedSlot(witness, roots, index) {
  return roots.length === witness.roots.length && roots.every((root, i) => i === index
    || (root === witness.roots[i] && rootText(root) === witness.texts[i]));
}

// Cancel is asynchronous: settle it while the existing five-second lease is
// live, not only when a later consumer happens to ask for history clearance.
// This observes DOM only, and stops if another transition replaces the lease.
async function settleReadOnlyCancellation(doc, witness, edit) {
  try {
    await waitFor(() => {
      if (historyWitnesses.get(doc) !== witness || witness.edit !== edit) return true;
      hasHistoryCompletenessWitness(doc); // existing exact, isolated, deadline-bound predicate
      return historyWitnesses.get(doc) !== witness || witness.edit !== edit;
    }, { attempts: 101, delay: 50 });
  } finally {
    if (historyWitnesses.get(doc) === witness && witness.edit === edit)
      invalidateHistory(doc, 'readonly_cancel_did_not_settle');
  }
}

// Native read-only inspection remounts its interaction even on Cancel. Observe
// trusted UI intent; never accept arbitrary same-text replacements as continuity.
// No click is synthesized, no save is performed, and this creates no receipt.
function watchReadOnlyHistoryEdits(doc) {
  if (!doc.addEventListener || historyListeners.has(doc)) return;
  historyListeners.add(doc);
  doc.addEventListener('click', event => {
    if (!event.isTrusted) return;
    const button = event.target?.closest?.('button');
    const label = button?.getAttribute?.('aria-label');
    const witness = historyWitnesses.get(doc);
    if (!witness || !button) return;
    if (label === 'Rewrite Interaction' || (witness.send
        && ['Edit Interaction', 'Save interaction', 'Delete interaction'].includes(label))) {
      invalidateHistory(doc, 'manual_history_action_during_continuity'); return;
    }
    if (witness.ownedEdit && ['Edit Interaction', 'Cancel editing', 'Save interaction', 'Delete interaction'].includes(label)) {
      invalidateHistory(doc, 'trusted_edit_during_owned_cleanup'); return;
    }
    if (label === 'Edit Interaction' && !witness.edit) {
      if (!hasHistoryCompletenessWitness(doc)) return;
      const index = witness.roots.indexOf(interactionRoot(button, doc));
      if (index >= 0 && !loadedInteractionRoots(doc).some(root => root.querySelector?.(editorSelector))) {
        witness.edit = { index, expires: Date.now() + 300_000, cancel: false };
      }
      return;
    }
    const edit = witness.edit;
    if (!edit) return;
    const roots = loadedInteractionRoots(doc);
    if (label === 'Cancel editing' && witness.route === doc.location.pathname
        && isolatedSlot(witness, roots, edit.index)
        && interactionRoot(button, doc) === roots[edit.index]
        && roots[edit.index].querySelector?.(editorSelector)) {
      if (edit.cancel) return; // first trusted Cancel owns one fixed deadline/observer
      edit.cancel = true;
      edit.expires = Date.now() + 5_000;
      void settleReadOnlyCancellation(doc, witness, edit).catch(() => {});
    } else if (['Save interaction', 'Delete interaction', 'Edit Interaction'].includes(label)) {
      invalidateHistory(doc, 'readonly_edit_saved_deleted_or_reentered');
    }
  }, true);
}

export function hasHistoryCompletenessWitness(doc) {
  const witness = historyWitnesses.get(doc);
  if (!witness) return false;
  if (witness.route !== doc.location.pathname) { invalidateHistory(doc, 'route_changed'); return false; }
  const roots = loadedInteractionRoots(doc);
  if (witness.ownedEdit) {
    const lease = witness.ownedEdit;
    if (Date.now() > lease.expires || !isolatedSlot(witness, roots, lease.index))
      invalidateHistory(doc, Date.now() > lease.expires ? 'owned_edit_expired' : 'owned_edit_surroundings_changed');
    return false; // inspection during an owned write is not clean-history proof
  }
  if (witness.edit) {
    const edit = witness.edit;
    if (Date.now() > edit.expires || !isolatedSlot(witness, roots, edit.index)) {
      invalidateHistory(doc, Date.now() > edit.expires ? 'readonly_edit_expired' : 'readonly_edit_surroundings_changed'); return false;
    }
    if (!edit.cancel || roots[edit.index].querySelector?.(editorSelector)) return false;
    if (!supportedHistoryHost(doc)) return false;
    if (rootText(roots[edit.index]) !== witness.texts[edit.index]) {
      invalidateHistory(doc, 'readonly_cancel_text_changed'); return false;
    }
    witness.roots[edit.index] = roots[edit.index];
    delete witness.edit;
  }
  if (!supportedHistoryHost(doc)) return false;
  if (exactSnapshot(witness, roots)) return true;
  // Preserve the old anchors while additions settle, but do not grant clearance
  // synchronously to a streaming or merely appended interaction.
  if (!additiveSnapshot(witness, roots) && !replyBatchRemount(witness, roots)) invalidateHistory(doc, 'non_additive_snapshot_change');
  return false;
}

// Keep one bounded cleanup transaction suspended across asynchronous UI work.
// A synchronous status reader must not destroy its anchors merely by looking
// while the editor is open. The caller must finish exact readback or invalidate
// the lease in finally. No pre-existing witness means no continuity to preserve.
export function beginHistoryReadback(doc, editedRoot, priorText) {
  if (!hasHistoryCompletenessWitness(doc)) return () => {};
  const witness = historyWitnesses.get(doc), index = witness.roots.indexOf(editedRoot);
  if (index < 0 || witness.texts[index] !== priorText) return () => {};
  const lease = { index, expires: Date.now() + 60_000 };
  witness.ownedEdit = lease;
  return () => {
    if (historyWitnesses.get(doc) === witness && witness.ownedEdit === lease) invalidateHistory(doc, 'owned_readback_unacknowledged');
  };
}

// A verified, isolated native edit may remount exactly one member of the
// witnessed snapshot. The caller has checked its raw readback and unchanged
// surrounding history. Unrelated remounts, recycled roots or edits invalidate it.
export function acknowledgeHistoryReadback(doc, editedRoot, priorText, replacementRoot = editedRoot) {
  const witness = historyWitnesses.get(doc), roots = loadedInteractionRoots(doc);
  const index = witness?.roots.indexOf(editedRoot) ?? -1;
  if (index < 0 || witness.edit || witness.route !== doc.location.pathname || witness.texts[index] !== priorText
      || (witness.ownedEdit && (witness.ownedEdit.index !== index || Date.now() > witness.ownedEdit.expires))
      || roots.length !== witness.roots.length || !roots.every((root, i) => root === (i === index ? replacementRoot : witness.roots[i])
        && (i === index || rootText(root) === witness.texts[i]))) {
    invalidateHistory(doc, 'owned_readback_continuity_mismatch'); return;
  }
  witness.roots[index] = replacementRoot;
  witness.texts[index] = rootText(replacementRoot);
  delete witness.ownedEdit;
}

async function settleHistoryAdditions(doc, waitOptions) {
  const witness = historyWitnesses.get(doc);
  if (!witness || witness.edit || witness.ownedEdit || witness.route !== doc.location.pathname
      || !(additiveSnapshot(witness, loadedInteractionRoots(doc)) || replyBatchRemount(witness, loadedInteractionRoots(doc)))) return false;
  let prior = null, stable = 0;
  const complete = await waitFor(() => {
    if (historyWitnesses.get(doc) !== witness || witness.edit || witness.ownedEdit) return false;
    const roots = loadedInteractionRoots(doc);
    const remounted = replyBatchRemount(witness, roots);
    if (witness.route !== doc.location.pathname || !(additiveSnapshot(witness, roots) || remounted)) {
      invalidateHistory(doc, 'addition_anchors_changed'); return false;
    }
    if (!supportedHistoryHost(doc) || exactVisibleButton(doc, { text: 'Load all' })
        || roots.some(root => root.querySelector?.(editorSelector))) { prior = null; stable = 0; return false; }
    stable = prior && exactSnapshot(prior, roots) ? stable + 1 : 0;
    prior = { roots, texts: roots.map(rootText) };
    if (stable < 3) return false;
    adoptSettledAddition(doc, witness, roots, prior.texts, remounted);
    return true;
  }, waitOptions ?? { attempts: 120, delay: 100 });
  return Boolean(complete);
}

// A supported DOM is not a completeness witness. Cache a completed Load all
// cycle, plus explicitly checked continuity transitions. A button-free page or
// additive DOM alone never creates a genesis witness. An explicit clean-start
// attestation is a separate, labeled basis accepted only by the isolated UI.
// Only extend an existing page-local witness. Never click Load all or create
// a genesis/completeness claim from a bare DOM, saved receipt, or attestation.
export async function settleHistoryContinuity(doc, waitOptions = undefined) {
  return hasHistoryCompletenessWitness(doc) || await settleHistoryAdditions(doc, waitOptions);
}

// Discovery only: a load control is an opportunity to obtain evidence, not
// evidence itself. The existing Load all cycle must still complete positively.
export function historyLoadControl(doc) {
  if (!supportedHistoryHost(doc)) return null;
  const buttons = [...doc.querySelectorAll('button')].filter(visible)
    .filter(button => (button.innerText || button.textContent || '').trim() === 'Load all');
  return buttons.length === 1 ? buttons[0] : null;
}

export async function inspectHistoryLoad(doc, waitOptions = undefined) {
  const unknown = { supported: false, complete: false, scope: 'unverified' };
  if (!supportedHistoryHost(doc)) return unknown;
  const loadButtons = [...doc.querySelectorAll('button')].filter(visible)
    .filter(button => (button.innerText || button.textContent || '').trim() === 'Load all');
  if (loadButtons.length > 1) return unknown;
  const load = exactVisibleButton(doc, { text: 'Load all' });
  if (!load) {
    const complete = hasHistoryCompletenessWitness(doc) || await settleHistoryAdditions(doc, waitOptions);
    return { supported: true, complete: Boolean(complete),
      scope: complete ? historyContinuityScope(doc) : 'supported_host_visible_history' };
  }
  historyWitnesses.delete(doc);
  const initialCount = loadedInteractionRoots(doc).length;
  load.click();
  let prior = -1;
  let stable = 0;
  const complete = await waitFor(() => {
    const count = loadedInteractionRoots(doc).length;
    stable = count === prior ? stable + 1 : 0;
    prior = count;
    // A disappearing button is not proof that its asynchronous retrieval
    // succeeded. Require at least one newly materialized interaction before
    // allowing a stable, button-free DOM to certify complete history.
    return supportedHistoryHost(doc) && count > initialCount && stable >= 3
      && !exactVisibleButton(doc, { text: 'Load all' });
  }, waitOptions ?? { attempts: 120, delay: 100 });
  if (!complete) return unknown;
  const roots = loadedInteractionRoots(doc);
  historyWitnesses.set(doc, { route: doc.location.pathname, roots, texts: roots.map(rootText),
    replyBatch: loadedTerminalBatch(doc, roots), scope: 'supported_host_load_all_cycle' });
  watchReadOnlyHistoryEdits(doc);
  return { supported: true, complete: true, scope: 'supported_host_load_all_cycle' };
}

export async function loadAllInteractions(doc, waitOptions = undefined) {
  return (await inspectHistoryLoad(doc, waitOptions)).complete;
}


export function isDeleteInteractionControl(button) {
  if (!button) return false;
  const label = `${button.getAttribute?.('aria-label') || ''} ${button.getAttribute?.('title') || ''}`.trim();
  if (/^delete interaction$/i.test(label)) return true;
  const icon = button.querySelector?.(
    'svg[data-lucide="trash"],svg[data-lucide="trash-2"],svg.lucide-trash,svg.lucide-trash-2',
  );
  return Boolean(icon);
}
function uniqueDeleteControl(root) {
  const controls = [...(root?.querySelectorAll?.('button') ?? [])]
    .filter(visible)
    .filter(isDeleteInteractionControl);
  return controls.length === 1 ? controls[0] : null;
}
