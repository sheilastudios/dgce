// Native composer helpers only; no command palette.
export const COMPOSER_SELECTOR = ['textarea[aria-label^="Message as "]', '[contenteditable][aria-label^="Message as "]'].join(',');
export function composerText(node) {
  return node?.matches?.('[contenteditable]') ? node.textContent : node?.value;
}
export function setComposerText(node, value) {
  if (!node) return false;
  const win = node.ownerDocument?.defaultView;
  if (node.matches?.('[contenteditable]')) {
    node.textContent = value;
    node.dispatchEvent(new win.InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    return node.textContent === value;
  }
  const proto = node.tagName === 'TEXTAREA'
    ? win?.HTMLTextAreaElement?.prototype : win?.HTMLInputElement?.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (!setter) return false;
  setter.call(node, value);
  node.dispatchEvent(new win.InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
  return node.value === value;
}
