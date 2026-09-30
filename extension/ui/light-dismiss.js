// Shadow-DOM-aware dismissal. Never cancel the outside click: its target
// should still receive focus and perform its normal action.
export function installLightDismiss({ doc, isOpen, inside, dismiss }) {
  const onPointerDown = (event) => {
    if (!isOpen()) return;
    const path = event.composedPath?.() ?? [event.target];
    if (inside().some((node) => node && (path.includes(node) || node.contains?.(event.target)))) return;
    dismiss();
  };
  doc.addEventListener('pointerdown', onPointerDown, true);
  return () => doc.removeEventListener('pointerdown', onPointerDown, true);
}
