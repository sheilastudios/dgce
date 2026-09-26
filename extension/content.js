// Content script entry point.
//
// A classic script, because MV3 content scripts are not modules. It resolves
// the real entry point through dynamic import so everything downstream can stay
// plain ES modules with no build step — the most forkable shape for something
// meant to be handed to a community.
//
// This script reads the host page. It never writes it. See spec §0b.

(async () => {
  const HOST = 'v2.dreamgen.com';
  if (location.hostname !== HOST) return;

  try {
    const { mountPanel } = await import(chrome.runtime.getURL('ui/panel.js'));
    mountPanel();
  } catch (err) {
    // Never take the host page down with us. A broken extension should be an
    // absent extension, not a broken DreamGen.
    console.error('[dgce] failed to mount panel:', err);
  }
})();
