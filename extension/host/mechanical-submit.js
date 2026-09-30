import { COMPOSER_SELECTOR, composerText, setComposerText } from './command-palette.js';
// Recognize unavailable commands only to block them; no engine is included.
const isMechanicalTurn = text => /^\s*\/(check|attack|initiative)\b/i.test(String(text ?? ''));

// All user-authored RP modes need campaign context, including the opening-scene
// Instruction. Skill proposal/autocomplete keep their narrower Message selector.
export const TURN_COMPOSER_SELECTOR = [COMPOSER_SELECTOR,
  'textarea[aria-label="Instruction"]', '[contenteditable][aria-label="Instruction"]',
  'textarea[aria-label="Narrative"]', '[contenteditable][aria-label="Narrative"]'].join(',');

const visible = node => !node.hidden && (node.getBoundingClientRect?.().width ?? 1) > 0;
const label = node => String(node?.getAttribute?.('aria-label') || node?.innerText || node?.textContent || '').trim();
const isSendButton = node => /^send (?:message|interaction)$/i.test(label(node));
const stop = event => { event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation?.(); };

// The Assistant has its own "Send message". Find the nearest local container
// joining this RP composer to its send control; never widen to the whole page.
function composerSendButtons(composer, doc) {
  for (let scope = composer.parentElement; scope && scope !== doc.body
      && scope !== doc.documentElement; scope = scope.parentElement) {
    const composers = [...scope.querySelectorAll(TURN_COMPOSER_SELECTOR)].filter(visible);
    if (composers.length !== 1 || composers[0] !== composer) return [];
    // Do not climb into a sibling editor (Assistant or interaction edit) if
    // this composer has no send control, e.g. it was cleared during settlement.
    const editors = [...scope.querySelectorAll('textarea,[contenteditable]')].filter(visible);
    if (editors.some(editor => editor !== composer)) return [];
    const buttons = [...scope.querySelectorAll('button')].filter(item => visible(item) && isSendButton(item));
    if (buttons.length) return buttons;
  }
  return [];
}

// Pause BEFORE DreamGen's handlers. Releasing a click uses the same composer
// and persisted packet, never a reconstructed host request or a synthetic fetch.
export function installMechanicalSubmit({ doc = document, prepare, prepareOrdinary = null, shouldHold = () => false, notice = () => {},
  writeComposer = setComposerText, settleComposer = () => new Promise(resolve => setTimeout(resolve, 0)) }) {
  let busy = false;
  let releaseButton = null;
  const run = async (composer, sendButton, prepareTurn) => {
    if (busy) return;
    busy = true;
    let prepared;
    let clicked = false;
    let presented = false;
    const text = String(composerText(composer) ?? '');
    const unchanged = () => composer.isConnected !== false && String(composerText(composer) ?? '') === text;
    try {
      if (!sendButton || sendButton.disabled) throw new Error('Send button unavailable. Draft preserved.');
      prepared = await prepareTurn(text, unchanged);
      if (!unchanged()) throw new Error('Draft changed during preparation. Saved result retained; nothing sent.');
      if (typeof prepared?.outgoingText === 'string') {
        // Let the host own the SAME text it persists, renders and sends. A
        // wire-only rewrite leaves its optimistic transcript on the old draft.
        presented = true;
        if (!writeComposer(composer, prepared.outgoingText)) throw new Error('Could not present the saved packet to DreamGen. Nothing sent.');
        await settleComposer();
        if (composer.isConnected === false || composerText(composer) !== prepared.outgoingText) {
          throw new Error('Composer changed before delivery. Saved result retained; nothing sent.');
        }
        prepared.assertReadyToSend?.();
        const buttons = composerSendButtons(composer, doc);
        if (buttons.length !== 1) throw new Error('Send button is ambiguous. Saved result retained; nothing sent.');
        sendButton = buttons[0];
      }
      if (sendButton.isConnected === false || sendButton.disabled) throw new Error('Send button changed. Saved result retained; nothing sent.');
      await prepared?.beforeClick?.();
      if (composer.isConnected === false || (presented && composerText(composer) !== prepared.outgoingText)) {
        throw new Error('Composer changed before native submission. Nothing clicked.');
      }
      prepared?.assertReadyToSend?.();
      const finalButtons = composerSendButtons(composer, doc);
      if (sendButton.isConnected === false || sendButton.disabled || finalButtons.length !== 1 || finalButtons[0] !== sendButton) {
        throw new Error('Send button changed during handoff. Nothing clicked.');
      }
      releaseButton = sendButton;
      // The synchronous release hook cannot await storage or yield to the
      // page between final validation and invoking the selected native button.
      prepared?.releaseAttempt?.();
      clicked = true;
      sendButton.click();
      prepared?.afterClick?.();
    } catch (error) {
      if (!clicked && presented && composer.isConnected !== false && composerText(composer) === prepared.outgoingText) {
        writeComposer(composer, text); // never overwrite a user's intervening edit
      }
      if (!clicked) {
        try { await prepared?.cancelBeforeClick?.(); }
        catch (rollbackError) { notice(`Pending turn needs recovery: ${rollbackError.message}`); }
      }
      notice(error.message);
    } finally {
      releaseButton = null;
      busy = false;
    }
  };
  const handler = event => {
    // Exactly one matching native-composer release, not an open reentrant window.
    if (releaseButton && event.type === 'click' && event.target?.closest?.('button') === releaseButton) {
      releaseButton = null;
      return;
    }
    let composer, button;
    if (event.type === 'keydown') {
      if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.isComposing) return;
      if (!event.target?.matches?.(TURN_COMPOSER_SELECTOR)) return;
      composer = event.target;
      const buttons = composerSendButtons(composer, doc);
      button = buttons.length === 1 ? buttons[0] : null;
    } else {
      button = event.target?.closest?.('button');
      if (!isSendButton(button)) return;
      const composers = [...doc.querySelectorAll(TURN_COMPOSER_SELECTOR)].filter(visible);
      if (composers.length !== 1) return;
      composer = composers[0];
      if (!composerSendButtons(composer, doc).includes(button)) return;
    }
    const text = String(composerText(composer) ?? '');
    const mechanical = isMechanicalTurn(text) || shouldHold();
    if (!mechanical && !prepareOrdinary) return;
    stop(event);
    // Page script can call click()/dispatchEvent(), but cannot manufacture a
    // trusted browser input event. Our own prepared release is handled above.
    // There is no page-to-extension wire bridge in the mounted path.
    if (event.isTrusted !== true) return;
    void run(composer, button, mechanical ? prepare : prepareOrdinary);
  };
  doc.addEventListener('keydown', handler, true);
  doc.addEventListener('click', handler, true);
  return () => {
    doc.removeEventListener('keydown', handler, true);
    doc.removeEventListener('click', handler, true);
  };
}
