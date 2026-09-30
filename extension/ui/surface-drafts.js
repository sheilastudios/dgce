// Drafts belong to the editor, not to the latest persisted workspace revision.
// A save acknowledges only its captured edit, never a newer edit made in flight.
export function createSurfaceDrafts() {
  const edits = new Map();
  const dirty = new Set();
  return {
    dirty,
    text(key, persisted) { return edits.get(key)?.text ?? persisted; },
    edit(key, text) { const edit = { text }; edits.set(key, edit); dirty.add(key); return edit; },
    capture(key) { return edits.get(key); },
    acknowledge(key, captured) {
      if (!captured || edits.get(key) !== captured) return false;
      edits.delete(key); dirty.delete(key); return true;
    },
    clear() { edits.clear(); dirty.clear(); },
  };
}
