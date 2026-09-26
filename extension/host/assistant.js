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

/** Exact Assistant tabpanel root. All automated lookups remain inside it. */
export function resolveAssistantPanel(doc = document) {
  const tab = byText(SELECTORS.tab, doc);
  const panelId = tab?.getAttribute('aria-controls');
  return panelId ? doc.getElementById(panelId) : null;
}

/** Which right-panel tab is currently showing, or null if it cannot be told. */
export function activeTabName(doc = document) {
  for (const name of TAB_NAMES) {
    const b = byText(name, doc);
    if (b?.getAttribute('aria-selected') === 'true') return name;
  }
  return null;
}

export function openAssistant(doc = document) {
  const tab = byText(SELECTORS.tab, doc);
  if (!tab) return false;
  tab.click();
  return true;
}

export function findComposer(doc = document) {
  // DreamGen gives the tab an aria-controls pointer to its panel. Use that
  // relationship rather than a screen coordinate: the extension drawer and
  // browser width both move the Assistant across the old x >= 900 boundary.
  const panel = resolveAssistantPanel(doc);
  if (!panel) return null;

  const candidates = [...panel.querySelectorAll('textarea, [contenteditable="true"]')].filter((t) => {
    const r = t.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && !t.disabled;
  });
  return candidates.length === 1 ? candidates[0] : null;
}

/** Poll for the composer, because the panel needs a moment to mount. */
async function awaitComposer({ timeoutMs = 3000, pollMs = 100, doc = document } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const el = findComposer(doc);
    if (el) return el;
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

/** Cheap fingerprint so a reply can be told apart from the prompt that caused it. */
const head = (s) => String(s).replace(/\s+/g, ' ').trim().slice(0, 60);

/** Watch the host's accessibility status, never text inside chat messages.
 * A banner left over from an earlier run is not a failure of this request. */
export function watchAssistantFailure(panel, { Observer = globalThis.MutationObserver } = {}) {
  const read = () => {
    const node = panel?.querySelector(':scope > [role="status"]');
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
  timeoutMs = 90000,
  pollMs = 400,
  stableSamples = 4,
  isComplete = null,
  getHostError = () => null,
  onPromptAcknowledged = () => {},
} = {}) {
  const promptHead = head(prompt);
  const deadline = Date.now() + timeoutMs;
  let lastLen = -1;
  let stable = 0;
  let ownedPromptIndex = -1;
  let promptAcknowledged = false;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));

    if (!panel) throw new AssistantError('Assistant panel disappeared during owned round trip');
    const nodes = messageNodes(panel);
    if (ownedPromptIndex < 0) {
      ownedPromptIndex = nodes.findIndex(
        (node, index) => index >= beforeCount && head(node.innerText) === promptHead,
      );
    }
    if (ownedPromptIndex < 0) continue;
    const hostError = getHostError();
    if (hostError) throw new AssistantError(hostError);
    if (nodes.length <= ownedPromptIndex + 1) continue;

    const text = nodes[ownedPromptIndex + 1]?.innerText ?? '';
    if (!text) continue;
    if (promptHead && head(text) === promptHead) continue; // still looking at ours
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
    if (isComplete) {
      if (isComplete(text)) return text;
      lastLen = text.length;
      continue;
    }

    if (text.length === lastLen) {
      stable += 1;
      if (stable >= stableSamples) return text;
    } else {
      stable = 0;
      lastLen = text.length;
    }
  }
  const progress = ownedPromptIndex < 0
    ? 'the submitted prompt was not observed in Assistant chat'
    : lastLen < 0
      ? 'the prompt appeared in Assistant chat, but no reply appeared'
      : 'a reply appeared, but it did not reach the required completion format';
  // Continue may mean a host generation failed or stopped; its presence alone
  // neither proves a retry is safe nor authorizes another model call.
  throw new AssistantError(`no complete reply within ${timeoutMs}ms: ${progress}; no automatic resend`);
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
  const previousTab = activeTabName(doc);
  let composer = null;
  let sent = false;
  let hostStatus = null;

  try {
    if (!openAssistant(doc)) throw new AssistantError('Assistant tab not found');

    composer = await awaitComposer({ doc, ...opts });
    if (!composer) throw new AssistantError('Assistant composer did not appear');
    if (String(composerValue(composer) ?? '').length) {
      throw new AssistantError('Assistant composer contains a user draft; automation deferred');
    }

    const panel = resolveAssistantPanel(doc);
    if (!panel) throw new AssistantError('Assistant panel not found');
    const send = panel.querySelector(SELECTORS.send);
    if (!send) throw new AssistantError('send button not found');

    const before = messageCount(panel);
    setComposerValue(composer, prompt);
    await new Promise((r) => setTimeout(r, 150));
    if (resolveAssistantPanel(doc) !== panel) throw new AssistantError('Assistant panel changed before send');
    if (composerValue(composer) !== prompt) {
      throw new AssistantError('Assistant composer changed before send; automation aborted');
    }
    if (send.disabled) throw new AssistantError('send button is disabled');

    hostStatus = watchAssistantFailure(panel);
    send.click();
    sent = true;
    return await waitForReply({ beforeCount: before, prompt, panel, ...opts, getHostError: hostStatus.getError });
  } finally {
    hostStatus?.disconnect();
    if (!sent && composer && composerValue(composer) === prompt) {
      try { setComposerValue(composer, '', { allowReplace: true }); } catch { /* fail closed */ }
    }
    assistantCallActive = false;
    if (ownsLease) assistantLease = null;
    if (previousTab && previousTab !== SELECTORS.tab) byText(previousTab, doc)?.click();
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
 * The tab button's existence is the only real precondition: `ask()` opens the
 * panel and waits for the composer itself. The send button is NOT a signal —
 * it stays in the DOM even while the Assistant panel is closed.
 */
export function probe() {
  const tab = byText(SELECTORS.tab);
  return {
    tab: Boolean(tab),
    activeTab: activeTabName(),
    composerVisibleNow: Boolean(findComposer()),
    messages: messageCount(),
    ready: Boolean(tab),
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
    if (doc.querySelector?.('[role="dialog"]')) return false;
    if (before > 0 && messageCount(panel) === 0) return true;
  }
  return false;
}

/**
 * Verify room for a run of `needTokens` without deleting or rewriting chat.
 */
export async function ensureHeadroom(
  needTokens,
  { windowTokens = 128000, reserve = 0.25, doc = document, _lease = null } = {},
  ) {
  if (assistantCallActive || (assistantLease && _lease !== assistantLease)) throw new AssistantHeadroomError('Assistant automation is already active');
  const previousTab = activeTabName(doc);
  try {
    if (!resolveAssistantPanel(doc)) {
      if (!openAssistant(doc)) throw new AssistantHeadroomError('Assistant tab not found');
      const composer = await awaitComposer({ doc });
      if (!composer) throw new AssistantHeadroomError('Assistant panel did not appear');
    }
    const panel = resolveAssistantPanel(doc);
    if (!panel) throw new AssistantHeadroomError('Assistant panel not found');
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
    if (previousTab && previousTab !== SELECTORS.tab) byText(previousTab, doc)?.click();
  }
}
