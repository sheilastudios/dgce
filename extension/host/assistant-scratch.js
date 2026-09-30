// Explicit, temporary Assistant ownership. Never adopts an existing chat.
import {
  AssistantError, openAssistant, findComposer, composerValue,
  resolveAssistantPanel, messageNodes, withAssistantLease,
  assistantBlockingDialogs, assistantStatus,
  captureAssistantView, restoreAssistantView, awaitComposer, awaitAssistantSettled,
} from './assistant.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const text = node => String(node?.innerText ?? node?.textContent ?? '').trim();
const buttons = root => [...root.querySelectorAll('button')];
const dialog = (doc, panel) => assistantBlockingDialogs(doc, panel)[0] ?? null;
const snapshot = panel => messageNodes(panel).map(node => node.innerText);
const equal = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);

function idle(panel) {
  if (buttons(panel).some(b => /^(Stop|Cancel|Abort) (response|generation|generating)$/i.test(b.getAttribute?.('aria-label') ?? ''))) return false;
  const status = text(assistantStatus(panel));
  return !status || status === 'The response is ready.'
    || /^(Generation|Response) (complete[ds]?|finished)[.!]?$/i.test(status);
}

/** Exposed for deterministic ownership tests; deletion remains a native UI action.
 * Visible-state checks cannot provide a server-side compare-and-swap guarantee
 * against another browser client. This mode requires exclusive use of the chat. */
export async function clearOwnedAssistantExchange({ doc, panel, expected, assertOwned,
  timeoutMs = 3000, pollMs = 100 }) {
  const check = () => {
    assertOwned();
    if (!equal(snapshot(panel), expected)) throw new AssistantError('Assistant chat changed; scratch cleanup stopped without deleting it');
    if (!idle(panel)) throw new AssistantError('Assistant is not idle; scratch cleanup stopped');
  };
  check();
  if (dialog(doc, panel)) throw new AssistantError('A dialog is already open; scratch cleanup deferred');
  const clear = buttons(panel).filter(b => text(b) === 'Clear chat');
  if (clear.length !== 1 || clear[0].disabled) throw new AssistantError('Assistant clear control unavailable');
  clear[0].click();
  const deadline = Date.now() + timeoutMs;
  let confirmation = null;
  try {
    while (Date.now() < deadline) {
      await sleep(pollMs);
      const modal = dialog(doc, panel);
      const copy = text(modal);
      if (copy.startsWith('Clear Assistant Chat')
        && copy.includes('Are you sure you want to clear the assistant chat? This action cannot be undone.')) confirmation = modal;
      assertOwned();
      // Hosts without a confirmation may clear immediately. Still verify empty.
      if (!snapshot(panel).length && !modal) return;
      check();
      if (!modal) continue;
      if (!copy.startsWith('Clear Assistant Chat')
        || !copy.includes('Are you sure you want to clear the assistant chat? This action cannot be undone.')) {
        throw new AssistantError('Unexpected confirmation; scratch cleanup stopped');
      }
      confirmation = modal;
      const confirms = buttons(modal).filter(b => text(b) === 'Clear chat');
      if (confirms.length !== 1 || confirms[0].disabled) throw new AssistantError('Assistant clear confirmation unavailable');
      check(); // no await between the final ownership check and confirmation
      confirms[0].click();
      while (Date.now() < deadline) {
        await sleep(pollMs);
        assertOwned();
        if (!snapshot(panel).length && !dialog(doc, panel)) return;
        if (snapshot(panel).length && !equal(snapshot(panel), expected)) throw new AssistantError('Assistant chat changed during cleanup; run stopped');
      }
      break;
    }
    throw new AssistantError('Assistant cleanup was not confirmed; run stopped');
  } catch (error) {
    // Cancel only the exact confirmation opened by us, never another dialog.
    if (confirmation && dialog(doc, panel) === confirmation) {
      buttons(confirmation).find(b => text(b) === 'Cancel')?.click();
    }
    throw error;
  }
}

/** Manual opt-in only. Starts empty; clears each successful owned exchange.
 * Failed/unfinished requests are left for inspection, not erased in finally. */
export async function withAssistantScratch(task, { enabled = false, doc = document,
  onStatus = () => {}, timeoutMs = 5000, pollMs = 100, leaseFn = withAssistantLease,
  readinessOptions = {} } = {}) {
  if (enabled !== true) throw new AssistantError('Temporary Assistant use requires explicit opt-in');
  return leaseFn(async transport => {
    const previous = captureAssistantView(doc);
    if (!openAssistant(doc, previous)) throw new AssistantError('Assistant tab not found');
    await awaitComposer({ doc, timeoutMs, pollMs, view: previous });
    const panel = resolveAssistantPanel(doc);
    const location = doc.location?.href;
    let touched = false;
    let busy = false;
    let closed = false;
    const touch = event => { if (event.isTrusted) touched = true; };
    const events = ['pointerdown', 'keydown', 'paste', 'drop'];
    const assertOwned = () => {
      if (closed || touched || !panel || panel.isConnected === false || resolveAssistantPanel(doc) !== panel
        || doc.location?.href !== location) throw new AssistantError('Assistant ownership changed; temporary run stopped');
      const composer = findComposer(doc);
      if (!composer || String(composerValue(composer) ?? '').length) throw new AssistantError('Assistant contains a draft; temporary run stopped');
    };
    try {
      assertOwned();
      if (snapshot(panel).length) throw new AssistantError('Temporary mode requires an empty Assistant chat. Clear or save it yourself first; nothing was deleted.');
      if (!idle(panel) || dialog(doc, panel)) throw new AssistantError('Assistant is not ready for temporary use');
      for (const event of events) panel.addEventListener(event, touch, true);
      // A visible empty composer is not evidence that saved chat has finished
      // hydrating. Observe the same bounded readiness window as normal asks,
      // then require the chat to remain empty before granting scratch ownership.
      // Watch user input during that wait as well as during the request itself.
      await awaitAssistantSettled(panel, { ...readinessOptions, doc });
      assertOwned();
      if (snapshot(panel).length) throw new AssistantError('Temporary mode requires an empty Assistant chat. Clear or save it yourself first; nothing was deleted.');
      let sequence = 0;
      const result = await task({
        ensureHeadroomFn: async (...args) => { assertOwned(); return transport.ensureHeadroomFn(...args); },
        askFn: async (prompt, opts = {}) => {
          if (busy) throw new AssistantError('Temporary Assistant calls must be sequential');
          assertOwned();
          if (snapshot(panel).length) throw new AssistantError('Assistant chat is no longer empty; temporary run stopped');
          busy = true;
          try {
            const marker = `DGCE temporary request ${++sequence} ${crypto.randomUUID()}`;
            const sentPrompt = `${marker}\n${prompt}`;
            let acknowledgedPrompt = null;
            const reply = await transport.askFn(sentPrompt, { ...opts, onPromptAcknowledged: value => {
              assertOwned();
              if (!value.startsWith(`${marker}\n`)) throw new AssistantError('Assistant prompt identity mismatch');
              acknowledgedPrompt = value;
            } });
            assertOwned();
            // Complete JSON may arrive before the host closes its stream.
            const idleBy = Date.now() + timeoutMs;
            while (!idle(panel) && Date.now() < idleBy) { await sleep(pollMs); assertOwned(); }
            const owned = snapshot(panel);
            // Host Markdown can unescape displayed prompt text. Compare to the
            // first acknowledged display, not raw submission bytes. No fuzzy
            // matching or adoption of a preexisting transcript is permitted.
            if (owned.length !== 2 || acknowledgedPrompt === null || owned[0] !== acknowledgedPrompt
              || owned[1].trimEnd() !== reply.trimEnd()) {
              const reason = owned.length !== 2 ? 'message count changed'
                : acknowledgedPrompt === null ? 'prompt acknowledgment missing'
                : owned[0] !== acknowledgedPrompt ? 'displayed prompt changed after acknowledgment'
                : 'reply changed after completion';
              throw new AssistantError(`Assistant exchange ownership could not be verified (${reason}); nothing was deleted`);
            }
            onStatus('clearing this run’s temporary Assistant exchange');
            await clearOwnedAssistantExchange({ doc, panel, expected: owned, assertOwned, timeoutMs, pollMs });
            return owned[1];
          } finally { busy = false; }
        },
      });
      assertOwned();
      return result;
    } finally {
      closed = true;
      for (const event of events) panel?.removeEventListener(event, touch, true);
      if (!touched) await restoreAssistantView(previous, panel, doc);
    }
  }, { doc });
}
