// Read-only request observation. No page data can request an injection, roll,
// guard transition or acknowledgement through this worker.
import { requestEvidence, OBSERVER_READY } from './host/network-evidence.js';
import { installSessionReadback } from './host/session-readback.js';

// An authenticated internal caller may read only its own session, never an
// arbitrary URL. Returned host data grants no effects until lifecycle checks.
installSessionReadback();

chrome.webRequest.onBeforeRequest.addListener(details => {
  const message = requestEvidence(details);
  if (!message) return;
  // Exact document targeting excludes old pages and sibling frames. No raw
  // request text is forwarded or retained; only shape, identity and a digest.
  chrome.tabs.sendMessage(details.tabId, message, { documentId: details.documentId }).catch(() => {});
}, { urls: ['https://v2.dreamgen.com/*'] }, ['requestBody']);

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type !== OBSERVER_READY || sender.id !== chrome.runtime.id
      || !sender.tab || sender.frameId !== 0 || !sender.url?.startsWith('https://v2.dreamgen.com/')) return;
  reply({ ready: true });
});
