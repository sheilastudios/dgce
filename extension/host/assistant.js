// DreamGen Assistant driver. Stage 2.
//
// The Assistant is a chat panel inside the session, on its own context budget:
// it does not consume RP context and (per the owner) costs no credits. So it
// is the right place to spend intelligence, and driving it is DOM automation
// rather than an integration.
//
//   law: archivist_side_is_free
//
// Every selector here is a guess about someone else's UI, so every one is
// checked and every failure is a clean throw rather than a wrong click. The
// worst outcome must be "the deck didn't refill", never "we typed into the
// wrong box".
//
// Observed live 2026-08-28:
//   tab buttons     : role="tab", aria-selected marks the active one
//   composer        : an unnamed <textarea> in the Assistant tabpanel
//   send            : button[aria-label="Send message"] — EXISTS even when the
//                     Assistant panel is closed, so it is not a readiness test
//   message unit    : div[class*="group/msg"]
//   YOUR OWN PROMPT renders as a message node too, before the reply

export class AssistantError extends Error {}
export class AssistantHeadroomError extends AssistantError {}

export const SELECTORS = {
  send: 'button[aria-label="Send message"]',
  message: '[class*="group/msg"]',
  tab: 'Assistant',
};

const TAB_NAMES = ['Scenario', 'Settings', 'Assistant'];

const byText = (text, doc = document) =>
  [...doc.querySelectorAll('button')].find((b) => b.textContent.trim() === text) ?? null;

const visible = node => {
  const r = node?.getBoundingClientRect?.();
  return Boolean(node?.isConnected !== false && r?.width > 0 && r?.height > 0);
};
const unique = nodes => nodes.length === 1 ? nodes[0] : null;
const assistantDialogs = doc => [...doc.querySelectorAll('[role="dialog"]')].filter(node => {
  if (!visible(node)) return false;
  const ids = (node.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
  const label = node.getAttribute('aria-label') ?? ids.map(id => doc.getElementById(id)?.textContent ?? '').join(' ');
  return label.trim() === 'Assistant';
});

/** Exact visible Assistant surface. Never fall back to a page-wide composer. */
export function resolveAssistantPanel(doc = document) {
  const dialogs = assistantDialogs(doc);
  if (dialogs.length) {
    const panel = unique(dialogs);
    return panel && panel.querySelectorAll('button[aria-label="Close assistant"]').length === 1
      ? panel : null;
  }
  const tab = byText(SELECTORS.tab, doc);
  const panelId = tab?.getAttribute('aria-controls');
  const panel = panelId ? doc.getElementById(panelId) : null;
  return visible(panel) ? panel : null;
}

/** Exclude only the exact Assistant surface; nested/unrelated modals still block. */
export function assistantBlockingDialogs(doc = document, panel = resolveAssistantPanel(doc)) {
  return [...doc.querySelectorAll('[role="alertdialog"], [role="dialog"]')]
    .filter(node => node !== panel && visible(node));
}

/** Both observed layouts keep status outside message content. */
export function assistantStatus(panel) {
  return panel?.querySelector(':scope > [role="status"]')
    ?? panel?.querySelector(':scope > div > [role="status"]');
}

// Host activity, not words inside a reply or its thinking transcript. The hard
// cap below still bounds a stuck host status. Never change the user's model mode.
export function assistantGenerationActive(panel) {
  const status = String(assistantStatus(panel)?.textContent ?? '').trim();
  return /^AI is (?:thinking|responding|generating)\.?$/i.test(status)
    || [...(panel?.querySelectorAll('button[aria-label="Stop response"]') ?? [])]
      .some(button => visible(button) && !button.disabled);
}

export const ASSISTANT_IDLE_TIMEOUT_MS = 90000;
export const ASSISTANT_MAX_WAIT_MS = 600000;

/** Which right-panel tab is currently showing, or null if it cannot be told. */
export function activeTabName(doc = document) {
  if (assistantDialogs(doc).length === 1) return SELECTORS.tab;
  for (const name of TAB_NAMES) {
    const b = byText(name, doc);
    if (visible(b) && b.getAttribute('aria-selected') === 'true') return name;
  }
  return null;
}

// The native desktop tools pane may be zero-width while its tab buttons retain
// nonzero rectangles. Use the observed accessible splitter, not CSS mutation or
// a hidden composer. Enter is the host's collapse/restore keyboard action.
function toolsPaneControl(doc) {
  const tools = doc.getElementById('game-session-tools');
  if (!tools) return null;
  const handles = [...(tools.parentElement?.querySelectorAll(
    '[role="separator"][aria-label="Toggle tools panel"]') ?? [])]
    .filter(node => visible(node) && node.getAttribute('aria-controls') === 'game-session-content');
  const handle = unique(handles);
  return handle ? { tools, handle } : null;
}
function toggleTools(handle, doc) {
  const Keyboard = doc.defaultView?.KeyboardEvent;
  if (!Keyboard) return false;
  handle.dispatchEvent(new Keyboard('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
  return true;
}

export function openAssistant(doc = document, view = null) {
  if (assistantBlockingDialogs(doc).length) return false;
  const tools = toolsPaneControl(doc);
  if (tools && tools.handle.getAttribute('aria-valuenow') === '100'
      && tools.tools.getBoundingClientRect().width === 0) {
    if (!toggleTools(tools.handle, doc)) return false;
    if (view?.tools?.handle === tools.handle) view.tools.opened = true;
  }
  if (resolveAssistantPanel(doc)) return Boolean(findComposer(doc));
  const launchers = [...doc.querySelectorAll('button[aria-label="Open Writing Assistant"]')].filter(visible);
  if (launchers.length) {
    const launcher = unique(launchers);
    if (!launcher || launcher.disabled) return false;
    launcher.click();
    return true;
  }
  const tab = byText(SELECTORS.tab, doc);
  if (!visible(tab) || tab.disabled) return false;
  tab.click();
  return true;
}

export function findComposer(doc = document) {
  // Resolve the visible named dialog or legacy tab's aria-controls target.
  // Hidden duplicate editors and screen position never select a composer.
  const panel = resolveAssistantPanel(doc);
  if (!panel) return null;

  const candidates = [...panel.querySelectorAll('textarea, [contenteditable="true"]')].filter((t) => {
    const r = t.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && !t.disabled;
  });
  return candidates.length === 1 ? candidates[0] : null;
}

export function captureAssistantView(doc = document) {
  const tab = activeTabName(doc);
  const control = toolsPaneControl(doc);
  const tools = control?.handle.getAttribute('aria-valuenow') === '100'
    && control.tools.getBoundingClientRect().width === 0 ? control : null;
  return { tab, panel: tab === SELECTORS.tab ? resolveAssistantPanel(doc) : null,
    tools,
    route: String(doc.location?.href ?? '').split('#')[0] };
}

export async function restoreAssistantView(view, panel, doc = document) {
  const composer = findComposer(doc);
  const expanded = view?.tools?.opened;
  if (!view || (!expanded && (view.tab === SELECTORS.tab || view.panel === panel))
    || String(doc.location?.href ?? '').split('#')[0] !== view.route
    || !panel || resolveAssistantPanel(doc) !== panel
    || assistantBlockingDialogs(doc, panel).length
    || !composer || String(composerValue(composer) ?? '').length) return;
  if (assistantDialogs(doc).includes(panel)) {
    const close = unique([...panel.querySelectorAll('button[aria-label="Close assistant"]')].filter(visible));
    if (close && !close.disabled) {
      close.click();
      // React/host exit animation is asynchronous. A following ask must not
      // adopt this still-visible but closing panel and type into a dying node.
      // Long transcripts can keep the host's closing dialog mounted beyond
      // two seconds. Wait for actual teardown, not an assumed animation time.
      // This is still bounded and never promotes a visible panel to closed.
      const deadline = Date.now() + 10000;
      while (visible(panel) && panel.isConnected !== false) {
        if (Date.now() >= deadline) throw new AssistantError('Assistant close did not settle; next request deferred');
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
  } else if (view.tab && view.tab !== SELECTORS.tab) {
    const tab = byText(view.tab, doc);
    if (visible(tab)) tab.click();
  }
  const tools = toolsPaneControl(doc);
  if (expanded && tools?.handle === view.tools.handle
      && view.tools.expandedValue && view.tools.expandedValue !== '100'
      && tools.handle.getAttribute('aria-valuenow') === view.tools.expandedValue) {
    toggleTools(tools.handle, doc);
  }
}

/** Poll for the composer, because the panel needs a moment to mount. */
export async function awaitComposer({ timeoutMs = 3000, pollMs = 100, doc = document, view = null } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const el = findComposer(doc);
    if (el) {
      if (view?.tools?.opened) view.tools.expandedValue = view.tools.handle.getAttribute('aria-valuenow');
      return el;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return null;
}

/**
 * Set a React-controlled textarea. Assigning `.value` updates the DOM but not
 * React's state, so the app would send an EMPTY message. The native setter
 * plus a bubbling input event is what React's onChange listens for.
 */
export function composerValue(el) {
  return el?.matches?.('[contenteditable="true"]') ? el.textContent : el?.value;
}

const chatSnapshot = panel => JSON.stringify(messageNodes(panel).map(node => String(node.innerText ?? '')));

/** Bounded UI-settlement mitigation, not proof of server history completeness.
 * A composer can mount before saved Assistant messages hydrate. Do not type
 * into that initial empty render or measure its apparent zero-token history.
 * The per-send marker remains mandatory if hydration happens still later. */
export async function awaitAssistantSettled(panel, { doc = document,
  quietMs = 1000, emptyGraceMs = 5000, timeoutMs = 10000, pollMs = 100,
  now = () => Date.now(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  const route = String(doc.location?.href ?? '').split('#')[0];
  const started = now();
  let stableSince = started;
  let previous = null;
  let previousComposer = null;
  while (now() - started < timeoutMs) {
    if (String(doc.location?.href ?? '').split('#')[0] !== route
      || resolveAssistantPanel(doc) !== panel || assistantBlockingDialogs(doc, panel).length) {
      throw new AssistantError('Assistant surface changed during readiness; no request sent');
    }
    const composer = findComposer(doc);
    if (!composer) throw new AssistantError('Assistant composer disappeared during readiness; no request sent');
    if (String(composerValue(composer) ?? '').length) throw new AssistantError('Assistant composer contains a user draft; automation deferred');
    if (assistantGenerationActive(panel)) throw new AssistantError('Assistant is still generating; no request sent');
    const current = chatSnapshot(panel);
    if (current !== previous || composer !== previousComposer) {
      previous = current; previousComposer = composer; stableSince = now();
    }
    if (now() - stableSince >= quietMs && (current !== '[]' || now() - started >= emptyGraceMs)) {
      return { composer, snapshot: current };
    }
    await sleep(pollMs);
  }
  throw new AssistantError('Assistant history did not settle before preparation; no request sent');
}

export function setComposerValue(el, text, { allowReplace = false } = {}) {
  const existing = String(composerValue(el) ?? '');
  if (existing && existing !== text && !allowReplace) {
    throw new AssistantError('Assistant composer contains a user draft; automation deferred');
  }
  el.focus?.();

  // DreamGen's current controlled textarea rejects a prototype-set value on
  // its next render. `insertText` travels through the browser's editing path,
  // which is the same path as actual typing and therefore updates the host's
  // state. Automated callers may select only an empty field or their own
  // exact prompt; replacing a person's unsent draft is forbidden.
  try {
    if (el.matches?.('[contenteditable="true"]')) {
      const selection = window.getSelection?.();
      const range = document.createRange?.();
      if (selection && range) {
        range.selectNodeContents(el);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    } else {
      el.setSelectionRange?.(0, String(el.value ?? '').length);
    }
    if (document.execCommand?.('insertText', false, text) && composerValue(el) === text) return;
  } catch {
    // Fall through to the older React-compatible path below.
  }

  if (el.matches?.('[contenteditable="true"]')) {
    el.textContent = text;
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      inputType: 'insertText',
      data: text,
    }));
    return;
  }

  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  if (!setter) throw new AssistantError('cannot access native textarea setter');
  setter.call(el, text);
  const Input = globalThis.InputEvent ?? Event;
  el.dispatchEvent(new Input('input', {
    bubbles: true,
    composed: true,
    inputType: 'insertText',
    data: text,
  }));
}

export const messageNodes = (panel = resolveAssistantPanel()) =>
  panel ? [...panel.querySelectorAll(SELECTORS.message)] : [];
export const messageCount = (panel = resolveAssistantPanel()) => messageNodes(panel).length;

export function lastMessageText(panel = resolveAssistantPanel()) {
  const nodes = messageNodes(panel);
  return nodes.length ? nodes[nodes.length - 1].innerText : '';
}

/** Display comparison, not request identity. Production asks use a fresh marker. */
const head = (s) => String(s).replace(/\s+/g, ' ').trim().slice(0, 60);
const normalizedDisplay = s => String(s).replace(/\s+/g, ' ').trim();

/** Watch the host's accessibility status, never text inside chat messages.
 * A banner left over from an earlier run is not a failure of this request. */
export function watchAssistantFailure(panel, { Observer = globalThis.MutationObserver } = {}) {
  const read = () => {
    const node = assistantStatus(panel);
    return { node, text: String(node?.textContent ?? '').trim() };
  };
  let previous = read();
  let failure = null;
  const sample = () => {
    const current = read();
    if ((current.node !== previous.node || current.text !== previous.text)
      && /^Generation stopped because of an error\.?$/i.test(current.text)) {
      failure = 'DreamGen reported a generation error for the Assistant request; no automatic resend. Check the Assistant error and context capacity before retrying.';
    }
    previous = current;
    return failure;
  };
  const observer = Observer ? new Observer(sample) : null;
  observer?.observe(panel, { subtree: true, childList: true, characterData: true });
  return { getError: sample, disconnect: () => observer?.disconnect() };
}

/**
 * Wait for the ASSISTANT's reply.
 *
 * The prompt you send renders as a message node too, and it renders FIRST. An
 * earlier version watched only for the count to rise, sampled the newest node,
 * found our own prompt sitting there perfectly stable, and returned it — so
 * the parser was handed the instructions instead of the answer.
 *
 *   law: our_own_message_is_not_a_reply
 *
 * The transaction first locates its own prompt among messages added after the
 * snapshot, then accepts only the immediately following message as its reply.
 * Unrelated earlier panel traffic cannot satisfy that ownership check.
 */
export async function waitForReply({
  panel = resolveAssistantPanel(),
  beforeCount,
  prompt = '',
  requestMarker = null,
  timeoutMs = ASSISTANT_IDLE_TIMEOUT_MS,
  maxWaitMs = ASSISTANT_MAX_WAIT_MS,
  pollMs = 400,
  stableSamples = 4,
  isComplete = null,
  getHostError = () => null,
  onPromptAcknowledged = () => {},
  now = () => Date.now(),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  const promptHead = head(prompt);
  const started = now();
  let lastActivity = started;
  let lastText = null;
  let stable = 0;
  let ownedPromptIndex = -1;
  let promptAcknowledged = false;
  let expired = 'hard limit';

  while (now() - started < maxWaitMs) {
    await sleep(pollMs);
    if (now() - started >= maxWaitMs) break;

    if (!panel || panel.isConnected === false) throw new AssistantError('Assistant panel disappeared during owned round trip');
    const hostError = getHostError();
    if (hostError) throw new AssistantError(hostError);
    const nodes = messageNodes(panel);
    const matches = nodes.flatMap((node, index) => {
      const text = String(node.innerText ?? '');
      const matchesPrompt = requestMarker
        ? head(text) === promptHead && text.split(/\r?\n/).filter(line => line.trim() === requestMarker).length === 1
        : normalizedDisplay(text) === normalizedDisplay(prompt);
      return index >= beforeCount && matchesPrompt ? [index] : [];
    });
    if (matches.length > 1) throw new AssistantError('Assistant prompt identity is ambiguous; no automatic resend');
    // History can hydrate or remount after submission. Never keep an index
    // pointing at an unrelated old exchange after its contents have changed.
    if (ownedPromptIndex >= 0 && matches[0] !== ownedPromptIndex) {
      throw new AssistantError('Assistant prompt identity changed during reply; no automatic resend');
    }
    ownedPromptIndex = matches[0] ?? -1;
    const busy = assistantGenerationActive(panel);
    const candidate = ownedPromptIndex >= 0 ? nodes[ownedPromptIndex + 1]?.innerText ?? '' : '';
    const text = promptHead && head(candidate) === promptHead ? '' : candidate;
    const changed = Boolean(text) && text !== lastText;
    if (changed) { lastText = text; stable = 0; lastActivity = now(); }
    // A busy status can extend only an acknowledged request, not an absent prompt.
    if (busy && ownedPromptIndex >= 0) lastActivity = now();
    if (now() - lastActivity >= timeoutMs) { expired = 'idle limit'; break; }
    if (!text) { stable = 0; continue; }
    // Pin the displayed prompt once a response begins. The host may replace
    // its optimistic plain-text prompt with Markdown before generation starts.
    if (!promptAcknowledged) {
      onPromptAcknowledged(nodes[ownedPromptIndex].innerText);
      promptAcknowledged = true;
    }

    // When the caller knows what a finished reply looks like, ASK — do not
    // infer. Length-stability alone returns a half-written document whenever a
    // reasoning model pauses longer than the sampling window, and a truncated
    // JSON document is indistinguishable from a malformed one at the parser.
    //
    //   law: stalled != finished
    // A complete-looking JSON or a stable partial card list can still be streaming.
    if (busy) { stable = 0; continue; }
    if (isComplete) {
      if (isComplete(text)) return text;
      continue;
    }

    if (!changed) {
      stable += 1;
      if (stable >= stableSamples) return text;
    }
  }
  const progress = ownedPromptIndex < 0
    ? 'the submitted prompt was not observed in Assistant chat'
    : lastText === null
      ? 'the prompt appeared in Assistant chat, but no reply appeared'
      : 'a reply appeared, but it did not reach the required completion format';
  // Continue may mean a host generation failed or stopped; its presence alone
  // neither proves a retry is safe nor authorizes another model call.
  throw new AssistantError(`Assistant ${expired} reached (${now() - started}ms elapsed; ${timeoutMs}ms idle / ${maxWaitMs}ms maximum): ${progress}; inspect the saved chat for a late reply; no automatic resend`);
}

/**
 * Full round trip. Returns the reply text.
 *
 * Restores whichever panel tab was showing before, because this runs
 * unattended after a turn and yanking the panel away mid-play is worse than a
 * short deck.
 */
let assistantLease = null;
let assistantCallActive = false;
let transactionSequence = 0;

export function assistantLeaseActive() {
  return assistantLease != null;
}

export async function ask(prompt, opts = {}) {
  if (opts._lease && opts._lease !== assistantLease) throw new AssistantError('Assistant task lease has expired');
  if (assistantCallActive || (assistantLease && opts._lease !== assistantLease)) throw new AssistantError('Assistant automation is already active; request deferred');
  const ownsLease = !assistantLease;
  if (ownsLease) assistantLease = `assistant-${Date.now()}-${++transactionSequence}`;
  assistantCallActive = true;
  const doc = opts.doc ?? document;
  const previousView = captureAssistantView(doc);
  let panel = null;
  let composer = null;
  let sent = false;
  let hostStatus = null;
  // The dialog may initially render empty and hydrate OLD messages later.
  // A count plus a shared instruction prefix cannot identify this send.
  // Keep the caller's opening intact (temporary mode pins it for cleanup),
  // and append an opaque per-attempt line that survives Markdown rendering.
  const requestMarker = `DGCE request identity ${crypto.randomUUID()}`;
  const sentPrompt = `${prompt}\n\n${requestMarker}`;

  try {
    if (!openAssistant(doc, previousView)) throw new AssistantError('Assistant tab not found');

    composer = await awaitComposer({ doc, ...opts, view: previousView });
    if (!composer) throw new AssistantError('Assistant composer did not appear');
    if (String(composerValue(composer) ?? '').length) {
      throw new AssistantError('Assistant composer contains a user draft; automation deferred');
    }

    panel = resolveAssistantPanel(doc);
    if (!panel) throw new AssistantError('Assistant panel not found');
    const readiness = await awaitAssistantSettled(panel, { ...opts.readinessOptions, doc });
    composer = readiness.composer;
    if (assistantGenerationActive(panel)) throw new AssistantError('Assistant is still generating; wait for its saved reply before starting another request');
    if (assistantBlockingDialogs(doc, panel).length) throw new AssistantError('Another dialog is open; Assistant request deferred');
    const send = unique([...panel.querySelectorAll(SELECTORS.send)].filter(visible));
    if (!send) throw new AssistantError('send button not found');

    const before = messageCount(panel);
    setComposerValue(composer, sentPrompt);
    await new Promise((r) => setTimeout(r, 150));
    if (resolveAssistantPanel(doc) !== panel) throw new AssistantError('Assistant panel changed before send');
    if (findComposer(doc) !== composer || chatSnapshot(panel) !== readiness.snapshot) {
      throw new AssistantError('Assistant history or composer changed during preparation; no request sent');
    }
    if (assistantBlockingDialogs(doc, panel).length) throw new AssistantError('Another dialog opened before send');
    if (composerValue(composer) !== sentPrompt) {
      throw new AssistantError('Assistant composer changed before send; automation aborted');
    }
    if (assistantGenerationActive(panel)) throw new AssistantError('Assistant began generating before send; request deferred');
    if (send.disabled) throw new AssistantError('send button is disabled');

    hostStatus = watchAssistantFailure(panel);
    send.click();
    sent = true;
    return await waitForReply({ ...opts, beforeCount: before, prompt: sentPrompt, requestMarker, panel, getHostError: () => {
      if (String(doc.location?.href ?? '').split('#')[0] !== previousView.route
        || resolveAssistantPanel(doc) !== panel) return 'Assistant surface or session changed during the request; no automatic resend';
      return hostStatus.getError();
    } });
  } finally {
    hostStatus?.disconnect();
    if (!sent && composer && composerValue(composer) === sentPrompt) {
      try { setComposerValue(composer, '', { allowReplace: true }); } catch { /* fail closed */ }
    }
    try { await restoreAssistantView(previousView, panel, doc); }
    finally {
      assistantCallActive = false;
      if (ownsLease) assistantLease = null;
    }
  }
}

/** Reserve the shared driver across a multi-stage task, including cleanup gaps.
 * The opaque token is confined to these bound functions, never exposed to UI. */
export async function withAssistantLease(task, { doc = document } = {}) {
  if (assistantLease || assistantCallActive) throw new AssistantError('Assistant automation is already active; request deferred');
  const token = Symbol('Assistant task');
  assistantLease = token;
  let closed = false;
  const pending = new Set();
  const invoke = (fn, ...args) => {
    if (closed) return Promise.reject(new AssistantError('Assistant task lease has expired'));
    const promise = fn(...args);
    pending.add(promise);
    promise.then(() => pending.delete(promise), () => pending.delete(promise));
    return promise;
  };
  try {
    return await task({
      askFn: (prompt, opts = {}) => invoke(ask, prompt, { ...opts, doc, _lease: token }),
      ensureHeadroomFn: (need, opts = {}) => invoke(ensureHeadroom, need, { ...opts, doc, _lease: token }),
    });
  } finally {
    closed = true;
    await Promise.allSettled([...pending]);
    assistantLease = null;
  }
}

/**
 * Non-mutating readiness check.
 *
 * An earlier version CLICKED the Assistant tab and then looked for the
 * composer in the same tick — so it always reported not-ready, and it stole
 * the user's panel on every render. A probe that changes what it measures is
 * not a probe.
 *
 *   law: observation != interaction
 *
 * A visible exact launcher or supported Assistant surface is the precondition.
 * The send button alone is not a signal: hidden legacy panels retain it.
 */
export function probe() {
  const tab = byText(SELECTORS.tab);
  const available = Boolean(resolveAssistantPanel() || unique([...document.querySelectorAll('button[aria-label="Open Writing Assistant"]')].filter(visible)) || visible(tab));
  return {
    tab: Boolean(tab),
    activeTab: activeTabName(),
    composerVisibleNow: Boolean(findComposer()),
    messages: messageCount(),
    ready: available,
  };
}

// --------------------------------------------------------------------------
// Assistant context management
//
// The Assistant chat has NO COMPACTION. It accumulates until it is full and
// then hard-errors, which would take the Archivist down with it.
//
// The user owns this chat. Automated maintenance may measure it, but never
// clear it. Insufficient room is an explicit refusal and can be retried after
// the user chooses what to remove.
//
//   law: extension_can_operate_Assistant != extension_owns_user_chat

const CLEAR_LABEL = 'Clear chat';

/** Estimated tokens currently sitting in the Assistant chat. */
export function chatSizeTokens(panel = resolveAssistantPanel()) {
  const chars = messageNodes(panel).reduce((n, m) => n + (m.innerText || '').length, 0);
  return Math.ceil(chars / 3); // same conservative heuristic as core/tokens.js
}

/**
 * Clear the Assistant chat. Returns false if the button is absent or the host
 * asks for a confirmation we are not going to click on the user's behalf.
 */
export async function clearChat({ explicit = false, doc = document, timeoutMs = 1500 } = {}) {
  if (!explicit) return false;
  const panel = resolveAssistantPanel(doc);
  if (!panel) return false;
  const btn = [...panel.querySelectorAll('button')]
    .find((b) => String(b.textContent ?? b.innerText ?? '').trim() === CLEAR_LABEL);
  if (!btn || btn.disabled) return false;
  const before = messageCount(panel);
  btn.click();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
    if (assistantBlockingDialogs(doc, panel).length) return false;
    if (before > 0 && messageCount(panel) === 0) return true;
  }
  return false;
}

/**
 * Verify room for a run of `needTokens` without deleting or rewriting chat.
 */
export async function ensureHeadroom(
  needTokens,
  { windowTokens = 128000, reserve = 0.25, doc = document, _lease = null, readinessOptions = {} } = {},
  ) {
  if (assistantCallActive || (assistantLease && _lease !== assistantLease)) throw new AssistantHeadroomError('Assistant automation is already active');
  const previousView = captureAssistantView(doc);
  let panel = null;
  try {
    if (!resolveAssistantPanel(doc)) {
      if (!openAssistant(doc, previousView)) throw new AssistantHeadroomError('Assistant tab not found');
      const composer = await awaitComposer({ doc, view: previousView });
      if (!composer) throw new AssistantHeadroomError('Assistant panel did not appear');
    }
    panel = resolveAssistantPanel(doc);
    if (!panel) throw new AssistantHeadroomError('Assistant panel not found');
    await awaitAssistantSettled(panel, { ...readinessOptions, doc });
    const usable = Math.floor(windowTokens * (1 - reserve));
    const before = chatSizeTokens(panel);
    const headroom = usable - before - needTokens;
    if (headroom < 0) {
      throw new AssistantHeadroomError(
        `Assistant needs ${-headroom} more estimated tokens; clear or start a fresh Assistant chat manually`,
      );
    }
    return { cleared: false, before, after: before, headroom };
  } finally {
    await restoreAssistantView(previousView, panel, doc);
  }
}
