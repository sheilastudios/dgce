// DGCE public build: continuity-only controller. In-development campaign
// engine surfaces are not shipped here.
import { CSS } from './styles.js';
import { IS_FREE_EDITION, FREE_TABS, editionWorkspaceIssue, assertEditionWorkspace, assertEditionCommand, requireFullEdition } from '../core/edition.js';
import { HOST_PACKET_EQUIVALENCE_NOTICE } from '../core/host-packet-equivalence.js';
import { compareAttestationPacket } from '../core/attestation-review.js';
import { LEGACY_ABSENCE_ASSERTION, buildLegacyAbsenceReview, acceptLegacyAbsence } from '../core/legacy-carrier-recovery.js';
import { captureLegacyAbsenceHistory } from '../host/legacy-carrier-recovery.js';
import { MODERN_ABSENCE_ASSERTION, buildModernAbsenceReview, acceptModernAbsence } from '../core/modern-carrier-recovery.js';
import { createSurfaceDrafts } from './surface-drafts.js';
import { commitOrdinaryTurn, cancelUnsentOrdinaryTurn, bindOrdinaryRequest } from '../host/ordinary-turn.js';
import { withAssistantScratch } from '../host/assistant-scratch.js';
import { runSourceGroundedArchivistRepair } from '../host/archivist-budget-adapters.js';
import { installLightDismiss } from './light-dismiss.js';
import {
  createWorkspace,
  createCard,
  ordinalRank,
  archivistDue,
  setWorkspaceSetting,
} from '../core/workspace.js';
import { KINDS, makeCardId, kindOfId } from '../core/ids.js';
import { estimateTokens, enforcementTarget } from '../core/tokens.js';
import { activeIds, retiredIds, activityOf, userReorder, removeFromOrder } from '../core/ordering.js';
import { lookupTerm, rebuildAliasIndex } from '../core/aliases.js';
import { checkMergeLegality, mergeCards } from '../core/merge.js';
import { freshnessBand } from '../core/freshness.js';
import { resolveEntity, recallCard } from '../core/recall.js';
import { continuityTools } from './continuity-tools.js';
import { assertContinuityIdle } from '../core/continuity-transfer.js';
import { confirmByUser, unconfirmByUser, considerUserTurn } from '../core/confirmation.js';
import { applyPreimage } from '../core/undo.js';
import { exportToJSON, importWorkspace, inspectImport, resetWorkspace } from '../core/portable.js';
import {
  MODES as DECK_MODES,
  setMode as setDeckMode,
  addCards as addDeckCards,
  removeCard as removeDeckCard,
  setAnchored as setDeckAnchored,
  acceptPending as acceptDeckCard,
  rejectPending as rejectDeckCard,
  needsReplenish,
  replenishTarget,
  renderReplenishPrompt,
  parseProposedCards,
  proposeCards,
  isEnabled as deckEnabled,
  isAssisted as deckAssisted,
  DeckError,
} from '../core/deck.js';
import {
  WorkspaceStore,
  ConflictError,
  QuotaError,
  watchExternalWrites,
  writeWithConflictRetry,
} from '../storage.js';
import { buildInjection, stripInjections, stripRecordedInjection, semanticInjectionText, augmentTurn, makeInjectionRecord, wrapInjection } from '../core/injection.js';
import { canonicalSha256 } from '../core/canonical-json.js';
import { stageForNextTurn } from '../core/archivist-input.js';
import { drawCard } from '../core/deck.js';
import { installNetworkEvidence, bindNativeRequest, recordNativeRelease } from '../host/network-evidence.js';
import { installMechanicalSubmit } from '../host/mechanical-submit.js';
import { assertInteractionSourceFidelity } from '../host/check-source.js';
import {
  recordInjection,
} from '../host/prune.js';
import {
  INJECTION_LIFECYCLE,
  REMOVAL_READBACK_KIND,
  injectionLifecycleStatus,
  markInjectionHostSaveVerified,
  markInjectionObserved,
  markInjectionPruneRequested,
  markInjectionPruned,
  attestSavedTurn,
  SAVED_TURN_ASSERTION,
  buildAttestationReview,
  ATTESTATION_SCOPE,
} from '../core/injection-lifecycle.js';
import {
  authoritativeInjectionAllowed,
  captureWorkspaceFence,
  detectUnsupportedHostRewind,
  reconcileTimelineIntegrity,
  workspaceFenceMatches,
} from '../core/temporal-integrity.js';
import {
  roleplayEditorIdle,
  inspectOwnedInjectionHistory,
  sweepOwnedInjectionHistory,
  discoverOwnedInjectionCarriers,
} from '../host/injection-prune.js';
import { ask as askAssistant, probe as probeAssistant, AssistantError } from '../host/assistant.js';
import { watchAndConceal } from '../host/conceal.js';
import { runArchivist } from '../host/archivist-run.js';
import { WorkspaceMutationQueue } from '../host/turn-persistence.js';
import {
  campaignEntityGroups,
  campaignDeckContext,
  mergeEntityGroups,
  protectedCardMatch,
  reconcileCardAuthority,
} from '../core/entity-authority.js';
import { COMPOSER_SELECTOR, setComposerText } from '../host/command-palette.js';
import { readAuthoredEntities, findAuthored, authoredNames } from '../host/scenario.js';
import { loadedInteractionRoots, hasHistoryCompletenessWitness, armHistoryLocalSend, invalidateHistoryContinuity, attestEmptySessionHistory, canAttestEmptySessionHistory } from '../host/builder-transcript.js';
import { captureOpeningSessionHistory, openingSessionHistoryMatches, attestOpeningSessionHistory } from '../host/builder-transcript.js';
import { settleHistoryContinuity, historyContinuityScope, historyContinuityDiagnostics, historyLoadControl } from '../host/builder-transcript.js';
import { SESSION_READBACK } from '../host/session-readback.js';
import { plainOrdinaryBinding, matchesPlainOrdinaryBinding, completePlainOrdinaryReadback } from '../host/ordinary-readback.js';

const KIND_TABS = { npc: 'People', location: 'Places', event: 'Events', object: 'Objects' };
const TABS = IS_FREE_EDITION ? FREE_TABS : ['Campaign', 'Memory', 'People', 'Places', 'Events', 'Objects', 'Resolve', 'Deck', 'Schedules', 'RNG', 'Log', 'Debug', 'Data'];
const SURFACES = [
  ['event_log', 'Event Log'],
  ['social_context', 'Social Context'],
  ['inventory', 'Inventory'],
];

const surfaceDrafts = createSurfaceDrafts();
const state = {
  ws: null,
  store: null,
  tab: 'Memory',
  banner: null,
  dirty: surfaceDrafts.dirty,
  mergeFrom: null,
  resolveResult: null,
  usage: null,
  rng: null,
  // In-progress rule pack edit, plus the last validation and sample for it.
  // Unsaved by design: a half-typed condition must not reach the workspace.
  packDraft: null,
  packErrors: null,
  packSample: null,
  assistantBusy: false,
  deckRefill: null,
  archivistBusy: false,
  archivistStatus: null,
  injectionPruneBusy: false,
  injectionPruneStatus: null,
  injectionPruneTimer: null,
  carrierHygieneStatus: 'unchecked',
  carrierHygieneReason: 'Complete DreamGen history has not been inspected yet.',
  carrierHygieneCount: null,
  carrierHygieneVerifiedAt: null,
  persistenceQueue: null,
  lastUserInputAt: 0,
  hostHistoryMutationOwner: null,
  debugAttempt: null,
  mutationGeneration: 0,
  mechanicalPreparing: false,
  mechanicalPermit: null,

  // Bumped on every session load. Async work started under one session must
  // not land under another: DreamGen is an SPA, so switching role-plays is a
  // route change, not a page load, and anything already in flight — a
  // storage write, an Assistant round trip — is still holding the OLD
  // workspace when it resolves.
  //
  //   law: started_here != finishes_here
  epoch: 0,
};

/** True while the session that started a piece of async work is still open. */
const isCurrent = (epoch) => state.epoch === epoch;
const markLocalMutation = () => { state.mutationGeneration += 1; };


let root, networkEvidence, drawerResizer, dismissedDrawer = null, stopWatchingExternal = null;
const AUTOMATIC_PRUNE_DELAY_MS = 1000, INITIAL_HISTORY_SCAN_DELAY_MS = 300,
  AUTOMATIC_PRUNE_RETRY_MS = 2500, AUTOMATIC_PRUNE_IDLE_RETRIES = 18;
const DECK_MODE_LABELS = {
  off: 'Off — nothing is injected',
  manual: 'Manual — you write the cards',
  assisted_review: 'Assisted — Assistant proposes, you approve',
  assisted_auto: 'Assisted — Assistant proposes, added automatically',
};


function adoptQueuedWrite(saved, epoch) {
  if (!isCurrent(epoch) || !state.ws || saved.workspace_id !== state.ws.workspace_id) return;
  // Local state may already contain a later planned turn. Adopt durable
  // metadata without rewinding that in-memory work.
  const revision = state.ws.revision ?? 0;
  if (!Number.isSafeInteger(saved.revision) || saved.revision < revision) return;
  if (saved.revision > revision) {
    state.ws.updated_at = Math.max(state.ws.updated_at ?? 0, saved.updated_at ?? 0);
    state.ws.writer_tab_id = saved.writer_tab_id;
  }
  state.ws.revision = saved.revision;
  state.ws.current_turn = Math.max(state.ws.current_turn ?? 0, saved.current_turn ?? 0);
}

function reportQueuedWriteFailure(error, epoch, label) {
  if (!isCurrent(epoch)) return;
  state.banner = { kind: 'warn', text: `${label} failed safely: ${error.message}` };
  render();
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

function workspaceIdFromLocation() {
  const m = location.pathname.match(/\/app\/my\/session\/([0-9a-f-]{36})/i);
  return m ? m[1] : null;
}

function showPruneNotice(text = 'Continuity is removing superseded extension context...') {
  if (!root) return () => {};
  root.getElementById('dgce-prune-notice')?.remove();
  const notice = el('div', {
    id: 'dgce-prune-notice',
    role: 'status',
    'aria-live': 'polite',
    style: [
      'position:fixed', 'right:18px', 'bottom:18px', 'z-index:2147483647',
      'max-width:360px', 'padding:10px 14px', 'border-radius:8px',
      'background:#171923', 'color:#f3f4f6', 'border:1px solid #4b5563',
      'box-shadow:0 8px 24px rgba(0,0,0,.35)', 'font:13px/1.4 system-ui,sans-serif',
    ].join(';'),
  }, text);
  root.append(notice);
  return () => notice.remove();
}

function clampDrawerWidth(width) {
  const maximum = Math.max(240, window.innerWidth * 0.92);
  const minimum = Math.min(340, maximum);
  return Math.max(minimum, Math.min(width, maximum));
}

function showContextWarning(text) {
  if (!root) return;
  root.getElementById('dgce-context-warning')?.remove();
  const notice = el('div', {
    id: 'dgce-context-warning', role: 'alert',
    style: 'position:fixed;right:18px;top:18px;z-index:2147483647;max-width:420px;padding:14px;border-radius:8px;background:#241b12;color:#fff;border:1px solid #eab308;font:13px/1.4 system-ui,sans-serif',
  }, el('p', {}, text),
  el('button', { onclick: () => {
    state.tab = 'Debug';
    if (root.getElementById('drawer')?.hidden) toggle(); else render();
  } }, 'Open Debug'),
  el('button', { onclick: () => notice.remove() }, 'Dismiss'));
  root.append(notice);
}

function installDrawerResize(drawer, handle) {
  const setWidth = (width) => { drawer.style.width = `${Math.round(clampDrawerWidth(width))}px`; };
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const startX = event.clientX;
    const startWidth = drawer.getBoundingClientRect().width;
    handle.classList.add('dragging');
    handle.setPointerCapture(event.pointerId);
    const move = (next) => setWidth(startWidth + startX - next.clientX);
    const finish = () => {
      handle.classList.remove('dragging');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', finish);
      handle.removeEventListener('pointercancel', finish);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  });
  handle.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const delta = event.key === 'ArrowLeft' ? 32 : -32;
    setWidth(drawer.getBoundingClientRect().width + delta);
  });
}

export function mountPanel() {
  if (document.getElementById('dgce-root')) return;

  // One capture-phase activity clock for the lifetime of this content script.
  // Installing these from planInjection stacked three listeners every turn.
  const noteUserActivity = () => {
    state.lastUserInputAt = Date.now();
    scheduleArchivistRecheck();
  };
  document.addEventListener('keydown', noteUserActivity, true);
  document.addEventListener('input', noteUserActivity, true);
  document.addEventListener('pointerdown', noteUserActivity, true);

  const host = el('div', { id: 'dgce-root' });
  // Shared-world deployment receipt. Chrome can leave an old content script
  // alive after an unpacked-extension reload; without a build marker, every
  // functional probe can pass against stale code. The page and outside tools
  // can both read this dataset value without exposing any user content.
  host.dataset.dgceBuild = chrome.runtime.getManifest().version;
  document.documentElement.append(host);
  root = host.attachShadow({ mode: 'closed' });
  root.append(el('style', { html: CSS }));

  const launcher = el('button', { class: 'launcher', onclick: toggle }, 'Continuity');
  const drawer = el('div', { class: 'drawer', hidden: true, id: 'drawer' });
  drawerResizer = el('div', {
    class: 'drawer-resizer',
    role: 'separator',
    tabindex: '0',
    'aria-label': 'Resize continuity panel',
    'aria-orientation': 'vertical',
  });
  installDrawerResize(drawer, drawerResizer);
  root.append(launcher, drawer);
  installLightDismiss({
    doc: document,
    isOpen: () => !drawer.hidden,
    inside: () => [host],
    dismiss: () => {
      dismissedDrawer = { epoch: state.epoch, tab: state.tab };
      drawer.hidden = true;
    },
  });

  load().then(render);
  observeRoute();
  networkEvidence = installNetworkEvidence({ receive: observeBrowserRequest });
  installMechanicalSubmit({ prepare: () => requireFullEdition('Mechanical actions'),
    prepareOrdinary: prepareOrdinarySubmission, shouldHold: () => false, notice: mechanicalNotice });
  watchAndConceal({ onAfterScan: observeOwnedCarriersInHost });
}

function mechanicalNotice(text) {
  state.banner = { kind: 'warn', text };
  render();
  showContextWarning(text);
}

function hasCurrentHistoryClearance() {
  if (state.carrierHygieneStatus !== 'clean') return false;
  if (hasHistoryCompletenessWitness(document)) return true;
  state.carrierHygieneStatus = 'history_unverified';
  state.carrierHygieneVerifiedAt = null;
  state.carrierHygieneReason = 'The witnessed history snapshot changed. Completeness must be checked again.';
  return false;
}

async function prepareOrdinarySubmission(text, unchanged) {
  assertEditionWorkspace(state.ws);
  assertEditionCommand(text);
  await networkEvidence?.ready;
  const epoch = state.epoch, store = state.store;
  if (state.ws?.ordinary_pending) throw new Error('Review the pending ordinary turn before sending again.');
  const current = () => {
    if (!isCurrent(epoch) || store !== state.store || workspaceIdFromLocation() !== state.ws?.workspace_id) {
      throw new Error('Campaign changed before submission. Draft preserved.');
    }
  };
  if (!networkEvidence?.available()) {
    mechanicalNotice('DGCE browser observer unavailable. This ordinary story message will be sent without new DGCE context.');
    return {};
  }
  await state.persistenceQueue?.whenIdle();
  current();
  if (!unchanged()) throw new Error('Draft changed before preparation. Nothing sent.');
  if (state.dirty.size) throw new Error('Save or discard campaign edits before sending.');
  if (state.ws.ordinary_pending) throw new Error('An ordinary turn has uncertain delivery. Review the pending-turn notice before sending again.');
  if (!authoritativeInjectionAllowed(state.ws)) {
    mechanicalNotice('Timeline suspended. Ordinary message continues without new DGCE context.');
    return {};
  }
  const base = await store.read();
  current();
  if (!base || mechanicalBasis(base) !== mechanicalBasis(state.ws)) throw new Error('Workspace changed before preparation. Reload before sending.');
  const generation = state.mutationGeneration;
  await refreshFreeHistoryContinuity();
  current();
  if (!unchanged() || state.mutationGeneration !== generation) throw new Error('Turn changed during history settlement. Draft preserved.');
  const candidate = structuredClone(base);
  const priorBanner = state.banner;
  let result, injection, preparedBanner;
  try {
    result = onUserTurn(text, candidate);
    injection = planInjection(text, candidate);
    preparedBanner = state.banner;
  } finally { state.banner = priorBanner; }
  const action = typeof result?.replacementText === 'string' && result.replacementText.trim()
    ? result.replacementText.trim() : text;
  const outgoingText = injection ? augmentTurn(action, injection.block) : action;
  await state.persistenceQueue?.whenIdle();
  current();
  if (!unchanged()) throw new Error('Draft changed while preparing context. Nothing committed or sent.');
  const id = crypto.randomUUID();
  let committed = false;
  let committedBasis = null;
  const assertReady = () => {
    current();
    if (state.dirty.size) throw new Error('Campaign editor changed during preparation. Nothing clicked.');
    if (!committed && state.mutationGeneration !== generation) throw new Error('Campaign changed during preparation. Nothing committed or sent.');
    if (committed && mechanicalBasis(state.ws) !== committedBasis) throw new Error('Campaign changed after handoff preparation. Nothing clicked.');
  };
  return { outgoingText, assertReadyToSend: assertReady,
    releaseAttempt: () => noteNativeRelease({ ordinaryId: id, nonce: injection?.nonce, outgoingText }),
    beforeClick: async () => {
      await state.persistenceQueue?.whenIdle();
      assertReady();
      const saved = await commitOrdinaryTurn({ store, base, candidate, id, text, outgoingText, injection, assertCurrent: assertReady });
      committed = true;
      committedBasis = mechanicalBasis(saved);
      current();
      state.ws = saved;
    },
    cancelBeforeClick: async () => {
      if (!committed) return;
      await state.persistenceQueue?.whenIdle();
      if (state.ws?.ordinary_pending?.id === id && state.ws.ordinary_pending.unexpected_request_id) {
        throw new Error('Prepared packet exposure requires pending recovery.');
      }
      const restored = await cancelUnsentOrdinaryTurn(store, id);
      if (isCurrent(epoch) && state.store === store) { state.ws = restored; render(); }
    },
    afterClick: () => {
      state.banner = preparedBanner;
      if (!injection && preparedBanner?.kind === 'warn') {
        const warningText = preparedBanner.text;
        showContextWarning(warningText);
      } else if (injection) root?.getElementById('dgce-context-warning')?.remove();
      if (injection) markNativeSubmissionAttempt();
      setTimeout(maybeScheduledArchivist, 4000);
      setTimeout(maybeReplenishDeck, 2000);
      render();
    },
  };
}

function noteNativeRelease({ ordinaryId = null, nonce = null, outgoingText }) {
  const record = nonce ? state.ws.injections?.find(item => item.nonce === nonce) : null;
  const visible = record ? stripRecordedInjection(outgoingText, record) : { status: 'matched', text: outgoingText };
  const receipt = { ordinaryId, nonce, textHash: canonicalSha256(outgoingText).hash, at: new Date().toISOString() };
  const epoch = state.epoch;
  recordNativeRelease(state.ws, receipt);
  // Rejected release evidence must not arm a history lease for an unclicked turn.
  if (visible.status === 'matched') armHistoryLocalSend(document, { id: ordinaryId ?? nonce, visibleText: visible.text,
    carrierText: record ? wrapInjection(record.body, record.nonce) : null });
  markLocalMutation();
  state.persistenceQueue.enqueue(ws => { recordNativeRelease(ws, receipt); return ws; })
    .then(saved => adoptQueuedWrite(saved, epoch))
    .catch(error => reportQueuedWriteFailure(error, epoch, 'Native release attempt'));
}

function observeBrowserRequest(message) {
  if (editionWorkspaceIssue(state.ws)) return;
  if (!state.ws || !state.store || message.sessionId !== state.ws.workspace_id
      || workspaceIdFromLocation() !== state.ws.workspace_id) return;
  observeHostTimelineMutation(message.shape);
  const ordinary = bindOrdinaryRequest(state.ws, message);
  const injected = bindNativeRequest(state.ws, message);
  if (!ordinary && !injected) return;
  markLocalMutation();
  const epoch = state.epoch;
  state.persistenceQueue.enqueue(ws => { bindOrdinaryRequest(ws, message); bindNativeRequest(ws, message); return ws; })
    .then(saved => { adoptQueuedWrite(saved, epoch); if (isCurrent(epoch)) { observeOwnedCarriersInHost(); render(); } })
    .catch(error => reportQueuedWriteFailure(error, epoch, 'Browser request observation'));
}

// One trailing wake per activity/settlement burst, not a polling or retry loop.
// The last DOM mutation may precede our cleanup/readback busy flag clearing.
// Recheck after the input guard too; otherwise a due run can remain stranded.
function scheduleArchivistRecheck(delayMs = 1000) {
  if (!state.ws || !state.store) return;
  if (state.archivistWake) clearTimeout(state.archivistWake.timer);
  const wake = { epoch: state.epoch, timer: null };
  state.archivistWake = wake;
  wake.timer = setTimeout(() => {
    if (state.archivistWake !== wake) return;
    state.archivistWake = null;
    if (isCurrent(wake.epoch)) {
      scheduleFreeHistoryRecovery();
      maybeScheduledArchivist();
    }
  }, delayMs);
}

function maybeScheduledArchivist() {
  if (!state.ws || !state.store) return;
  if (!archivistDue(state.ws) || !authoritativeInjectionAllowed(state.ws)) return;

  // One Assistant, two callers. Deck replenish fires 2s behind the same turn
  // and takes 10-20s; starting the Archivist on top of it would interleave two
  // conversations in one chat.
  if (state.archivistBusy || state.assistantBusy || state.injectionPruneBusy) return;

  // A four-second timer is not a settled turn. Readback can still retire the
  // pending action, and cleanup can still commit a revision after that timer.
  // Wait rather than building a prompt that our own delivery writes invalidate.
  // The history observer rechecks this gate after settlement; no cadence is
  // spent while deferred, and runArchivist keeps its exact freshness checks.
  if (state.ws.ordinary_pending || state.freeReadback?.busy
      || state.carrierHygieneStatus !== 'clean'
      || (state.ws.injections ?? []).some(record => !record.pruned)) return;
  if (!roleplayEditorIdle(document, { lastUserInputAt: state.lastUserInputAt,
    guardWindowMs: 750, allowFocusedEmptyComposer: true })) return;

  // Never archive a story we have already left.
  if (workspaceIdFromLocation() !== state.ws.workspace_id) return;

  refreshWithArchivist({ scheduled: true });
}

function recentModelTurns(limit = 5) {
  assertInteractionSourceFidelity(document);
  const scroller = [...document.querySelectorAll('div')].find((d) => {
    const r = d.getBoundingClientRect();
    return r.x < 900 && r.width > 400 && d.scrollHeight > d.clientHeight + 200;
  });
  if (!scroller) return [];
  // Our own blocks are IN this text — they ride inside the user's turn, and a
  // host whose scenario also uses <hidden> can get the model echoing ours back
  // into its own output. Feeding that to trigger matching and card staging
  // closes a loop where the extension re-reads what it just wrote: a card
  // restages because our injection named it, a pack fires because our RULE
  // line said "combat". §7b already strips before the confirmation pass for
  // exactly this reason; the same law governs staging and triggers.
  //
  //   law: our_own_injection != evidence_about_the_scene
  const text = semanticInjectionText(scroller.innerText || '');
  // turns are separated by the speaker chip; splitting on blank lines is crude
  // but this only feeds an overlap check, which degrades gracefully.
  return text
    .split(/\n{2,}/)
    .map((t) => t.trim())
    // A terse system line such as "COMBAT CONCLUDED" is routing evidence even
    // though it is too short for confirmation-overlap comparison.
    .filter((t) => t.length > 80)
    .slice(-limit)
    .reverse();
}

function recentModelInteractions(limit = 3) {
  assertInteractionSourceFidelity(document);
  const outputs = [...document.querySelectorAll('div.OUTPUT')]
    .map((element) => semanticInjectionText(element.innerText || '').trim())
    .filter(Boolean)
    .slice(-limit)
    .reverse();
  if (outputs.length) return outputs;
  return recentModelTurns(Math.max(3, limit * 4));
}

function transcriptText({ includeHidden = false } = {}) {
  assertInteractionSourceFidelity(document);
  const scroller = [...document.querySelectorAll('div')].find((d) => {
    const r = d.getBoundingClientRect();
    return r.x < 900 && r.width > 400 && d.scrollHeight > d.clientHeight + 200;
  });
  const source = includeHidden ? scroller?.textContent : scroller?.innerText;
  return semanticInjectionText(source || '');
}

function markNativeSubmissionAttempt() {
  state.carrierHygieneStatus = 'dirty';
  state.carrierHygieneReason = 'A native submission was attempted; checking for its carrier, response and exact removal.';
  state.carrierHygieneCount = 1;
  state.carrierHygieneVerifiedAt = null;
  scheduleRecurringInjectionPrune(state.epoch);
}

function observeOwnedCarriersInHost() {
  if (editionWorkspaceIssue(state.ws)) return;
  if (!state.ws || !state.store || !document.body) return;
  // Composer text is not host history. Only actual interaction roots count.
  const presentNonces = new Set(discoverOwnedInjectionCarriers(document)
    .filter(carrier => !carrier.ambiguous).map(carrier => carrier.nonce));
  const present = (state.ws.injections ?? [])
    .filter((record) => !record.pruned && presentNonces.has(record.nonce)
      && (!(record.mechanical_action_id || record.ordinary_action_id) || record.request_id));
  void verifyFreeOrdinaryReadback();
  const observedEpoch = state.epoch;
  void refreshFreeHistoryContinuity().then(() => {
    if (isCurrent(observedEpoch)) scheduleArchivistRecheck();
  });
  if (!present.length) return;

  // Mutation scans continue while DreamGen streams a response. Re-arm the
  // cleanup timer on every scan that still sees an owned carrier so a long
  // generation cannot outlive the bounded idle-retry window and strand it.
  // A post-Save uncertainty is the exception: no observer callback may turn
  // that epistemic state into an automatic retry.
  if (state.carrierHygieneStatus !== 'save_uncertain') {
    state.carrierHygieneStatus = 'dirty';
    state.carrierHygieneReason = 'Extension-owned context is present in DreamGen history.';
    state.carrierHygieneCount = present.length;
    state.carrierHygieneVerifiedAt = null;
    scheduleRecurringInjectionPrune(state.epoch, 0, true);
  }

  // This DOM adapter exposes carrier presence, not bound interaction/parent
  // identity. The lifecycle gate deliberately refuses nonce-only completion.
  const observed = present.filter(record => !record.observed_in_host_history_at
    && markInjectionObserved(state.ws, record.nonce).changed).map(record => record.nonce);
  if (!observed.length) return;
  markLocalMutation();
  const epoch = state.epoch;
  state.persistenceQueue.enqueue((ws) => {
    for (const nonce of observed) markInjectionObserved(ws, nonce);
    return ws;
  }).then((saved) => {
    adoptQueuedWrite(saved, epoch);
    if (isCurrent(epoch)) render();
  }).catch((error) => reportQueuedWriteFailure(error, epoch, 'Injection host-observation persistence'));
}

function observeHostTimelineMutation(shape) {
  if (!state.ws || !state.store) return;
  const result = detectUnsupportedHostRewind(state.ws, shape, {
    ownedHistoryMutation: Boolean(state.hostHistoryMutationOwner),
  });
  if (!result.changed) return;
  invalidateHistoryContinuity(document, 'observed_host_timeline_rewind');
  markLocalMutation();
  const epoch = state.epoch;
  const snapshot = structuredClone(state.ws.timeline_integrity);
  state.persistenceQueue.enqueue((ws) => {
    ws.timeline_integrity = snapshot;
    return ws;
  }).then((saved) => {
    adoptQueuedWrite(saved, epoch);
    if (!isCurrent(epoch)) return;
    state.banner = {
      kind: 'bad',
      text: 'DreamGen history moved backward outside DGCE. Authoritative injection is suspended until the timeline is explicitly reconciled.',
    };
    render();
  }).catch((error) => reportQueuedWriteFailure(error, epoch, 'Timeline desynchronization persistence'));
}

function clearInjectionPruneTimer() {
  if (state.injectionPruneTimer != null) clearTimeout(state.injectionPruneTimer);
  state.injectionPruneTimer = null;
}

function scheduleRecurringInjectionPrune(epoch, idleRetries = 0, initial = false) {
  clearInjectionPruneTimer();
  if (!isCurrent(epoch) || !state.ws || state.carrierHygieneStatus === 'clean'
      || state.carrierHygieneStatus === 'save_uncertain') return;
  const delay = idleRetries ? AUTOMATIC_PRUNE_RETRY_MS
    : initial ? INITIAL_HISTORY_SCAN_DELAY_MS : AUTOMATIC_PRUNE_DELAY_MS;
  state.injectionPruneTimer = setTimeout(() => {
    state.injectionPruneTimer = null;
    if (!isCurrent(epoch) || state.injectionPruneBusy) return;
    // Pruning commits a workspace revision. Let an Archivist result finish
    // against the exact revision it observed instead of making our own
    // background maintenance invalidate it mid-call.
    if (state.archivistBusy) {
      if (idleRetries < AUTOMATIC_PRUNE_IDLE_RETRIES) {
        scheduleRecurringInjectionPrune(epoch, idleRetries + 1, initial);
      }
      return;
    }
    if (!roleplayEditorIdle(document, { lastUserInputAt: state.lastUserInputAt })) {
      if (idleRetries < AUTOMATIC_PRUNE_IDLE_RETRIES) {
        scheduleRecurringInjectionPrune(epoch, idleRetries + 1, initial);
      }
      return;
    }
    runRecurringInjectionPrune({ automatic: true });
  }, delay);
}

async function runRecurringInjectionPrune({ automatic = false } = {}) {
  if (editionWorkspaceIssue(state.ws)) return;
  if (!state.ws || !state.store || state.injectionPruneBusy) return;
  if (automatic && state.carrierHygieneStatus === 'save_uncertain') return;
  const epoch = state.epoch;
  if (workspaceIdFromLocation() !== state.ws.workspace_id) return;
  if (state.archivistBusy) {
    if (automatic) scheduleRecurringInjectionPrune(epoch, 1);
    else {
      state.banner = { kind: 'warn', text: 'Context cleanup waits for the Archivist to finish.' };
      render();
    }
    return;
  }
  if (!roleplayEditorIdle(document, {
    lastUserInputAt: state.lastUserInputAt,
    guardWindowMs: automatic ? 750 : 0,
    allowFocusedEmptyComposer: !automatic,
  })) {
    if (automatic) scheduleRecurringInjectionPrune(epoch, 1);
    else {
      state.banner = { kind: 'warn', text: 'Context cleanup waits until DreamGen finishes the current response.' };
      render();
    }
    return;
  }

  state.injectionPruneBusy = true;
  state.hostHistoryMutationOwner = 'carrier_cleanup';
  state.carrierHygieneStatus = 'checking';
  state.carrierHygieneReason = 'Loading complete DreamGen history and checking extension-owned carriers.';
  state.injectionPruneStatus = 'loading and verifying complete history';
  render();
  const closeNotice = showPruneNotice('Continuity is loading and sanitizing extension-owned context...');
  let hostEditMayHaveOccurred = false;
  const cleanupDiagnostic = { operation_id: globalThis.crypto?.randomUUID?.() ?? null, tab_id: state.store.tabId ?? null,
    workspace_revision: state.ws.revision, idle_gate_passed_at: new Date().toISOString() };
  try {
    const sweep = await sweepOwnedInjectionHistory({ doc: document, records: state.ws.injections, workspace: state.ws });
    if (!isCurrent(epoch) || workspaceIdFromLocation() !== state.ws?.workspace_id) return;
    const results = sweep.results ?? [];
    hostEditMayHaveOccurred = results.some(result => result.changed || result.status === 'save_uncertain');
    const requested = results.map((result) => result.nonce);
    // Only positive per-interaction read-back retires a carrier. Neither a
    // visible scan nor a Load all cycle proves an unobserved record was erased.
    const verifiedRemoved = [...new Set(results.filter(result => result.changed === true
      && result.evidence === REMOVAL_READBACK_KIND).map(result => result.nonce))];

    if (requested.length || verifiedRemoved.length
        || results.some((result) => !result.changed)) {
      await state.persistenceQueue?.whenIdle();
      if (!isCurrent(epoch)) return;
      const audit = await commit((ws) => {
        markInjectionPruneRequested(ws, requested);
        markInjectionHostSaveVerified(ws, verifiedRemoved, Date.now(), REMOVAL_READBACK_KIND);
        markInjectionPruned(ws, verifiedRemoved);
        for (const result of results) {
          if (result.changed) continue;
          const record = (ws.injections ?? []).find((item) => item.nonce === result.nonce);
          if (record) {
            record.failure_reason = result.status;
            record.failure_detail = result.reason ?? null;
            record.failure_diagnostic = result.diagnostic ? { ...cleanupDiagnostic, ...result.diagnostic,
              observed_writer_tab_id_at_finish: state.ws.writer_tab_id ?? null } : null;
          }
        }
      }, {
        retryConflict: true,
        note: automatic ? null
          : `Removed ${verifiedRemoved.length} extension context block${verifiedRemoved.length === 1 ? '' : 's'}; story text was preserved.`,
      });
      if (!audit.ok) throw new Error('History was inspected, but its cleanup audit could not be saved. Verify history again; no roll should be repeated.');
    }

    state.carrierHygieneStatus = sweep.status;
    state.legacyRecoveryNonces = sweep.unverified_record_nonces ?? [];
    state.carrierHygieneCount = (sweep.remaining ?? []).length;
    state.carrierHygieneVerifiedAt = sweep.status === 'clean' ? new Date().toISOString() : null;
    state.carrierHygieneReason = sweep.status === 'clean'
      ? `${sweep.history?.scope === 'user_attested_scenario_opening' ? 'User-attested scenario-opening origin (not automatic completeness proof); subsequent mounted continuity checked' : sweep.history?.scope === 'user_attested_empty_session' ? 'User-attested empty-session origin (not automatic completeness proof); subsequent mounted continuity checked' : 'Supported-host history checked'}: ${sweep.interaction_count ?? 0} mounted interactions contain no context carriers.${sweep.accepted_legacy_nonces?.length ? ` User accepted unresolved history for ${sweep.accepted_legacy_nonces.length} legacy records; their delivery and removal remain unverified.` : ''}${sweep.accepted_modern_cleanup_nonces?.length ? ` User accepted unresolved cleanup for ${sweep.accepted_modern_cleanup_nonces.length} already-reconciled modern records; removal remains unverified.` : ''}`
      : sweep.status === 'history_unverified'
        ? sweep.history_issue === 'carrier_retirement_unverified'
          ? `Supported-host Load all cycle checked ${sweep.interaction_count ?? 0} interactions, but ${sweep.unverified_record_nonces?.length ?? 0} potentially sent carrier record(s) lack verified removal evidence. History absence alone cannot retire them. New DGCE context remains blocked.`
          : `Visible history checked (${sweep.interaction_count ?? 0} interactions), but completeness is unverified. New DGCE context remains blocked.`
      : sweep.status === 'recovery_required'
        ? 'Context retained because delivery is unresolved. Inspect the saved turn and use the explicit attestation control; nothing will be resent or rerolled.'
      : sweep.status === 'awaiting_response'
        ? 'The newest carrier is still awaiting a later completed interaction.'
        : sweep.status === 'save_uncertain'
          ? 'DreamGen may have saved an edit but did not provide enough evidence to claim success.'
          : sweep.status === 'manual_review'
            ? sweep.source_fidelity === 'ambiguous'
              ? 'Rendered history contains ambiguous context-carrier boundaries. Automatic cleanup cannot use that view; inspect the saved raw interaction.'
              : sweep.unknown_nonces?.length
                ? 'History contains context carriers without saved ownership records. Those blocks were not edited; review them manually.'
                : 'A carrier could not be matched to its exact saved record. Inspect the raw interaction and cleanup details; unmatched text was not edited.'
          : sweep.status === 'load_incomplete'
            ? 'DreamGen did not confirm that all interactions were loaded.'
            : 'At least one extension-owned carrier could not be removed safely.';

    if (!automatic || sweep.status !== 'clean' || verifiedRemoved.length) {
      state.banner = sweep.status === 'clean'
        ? {
            kind: 'info',
            text: `Context cleanup read-back verified: ${verifiedRemoved.length} carrier${verifiedRemoved.length === 1 ? '' : 's'} removed; story text preserved.`,
          }
        : {
            kind: 'warn',
            text: `Context cleanup ${sweep.status.replaceAll('_', ' ')}: ${state.carrierHygieneReason} DGCE injection remains suspended.`,
          };
    }
    if (automatic && ['awaiting_response', 'dirty', 'load_incomplete'].includes(sweep.status)) {
      scheduleRecurringInjectionPrune(epoch, 1);
    }
  } catch (error) {
    if (isCurrent(epoch)) {
      state.carrierHygieneStatus = hostEditMayHaveOccurred ? 'save_uncertain' : 'dirty';
      state.carrierHygieneReason = error.message;
      state.carrierHygieneVerifiedAt = null;
      state.banner = { kind: 'warn', text: `Context cleanup stopped safely: ${error.message}` };
    }
  } finally {
    closeNotice();
    state.hostHistoryMutationOwner = null;
    if (isCurrent(epoch)) {
      state.injectionPruneBusy = false;
      state.injectionPruneStatus = null;
      render();
      scheduleArchivistRecheck();
    }
  }
}

async function refreshWithArchivist({ scheduled = false, temporaryAssistant = false } = {}) {
  if (editionWorkspaceIssue(state.ws)) return;
  if (scheduled && temporaryAssistant) throw new Error('Temporary Assistant mode is manual only');
  if (state.archivistBusy || state.injectionPruneBusy || !state.ws || !state.store) return;
  if (!authoritativeInjectionAllowed(state.ws)) {
    state.banner = {
      kind: 'warn',
      text: 'Archivist maintenance is suspended while the DreamGen and DGCE timelines are desynchronized.',
    };
    render();
    return;
  }
  const epoch = state.epoch;
  const store = state.store;
  state.archivistBusy = true;
  state.archivistStatus = scheduled ? 'scheduled run starting' : 'starting';
  render();

  try {
    // planInjection mutates the in-memory turn immediately and persists the
    // turn counter and carrier audit behind the send path. On a large
    // workspace those writes can still be queued when the four-second
    // Archivist timer fires. Drain them, then bind the prompt to the durable
    // revision; otherwise our own write can make the model reply stale.
    await state.persistenceQueue?.whenIdle();
    if (!isCurrent(epoch)) return;
    const readFence = captureWorkspaceFence(state.ws, state.mutationGeneration);
    const settled = await store.read();
    if (!settled) throw new Error('workspace disappeared before Archivist snapshot');
    assertEditionWorkspace(settled);
    if (!workspaceFenceMatches(readFence, state.ws, state.mutationGeneration)) {
      state.banner = {
        kind: 'info',
        text: 'Archivist preparation deferred because the workspace advanced during its storage reread.',
      };
      return;
    }
    state.ws = settled;
    const boundFence = captureWorkspaceFence(settled, state.mutationGeneration);

    const otherNamespaceBytes = await store.otherNamespaceBytes();
    if (!isCurrent(epoch)) return;
    if (!workspaceFenceMatches(boundFence, state.ws, state.mutationGeneration)) {
      state.banner = {
        kind: 'info',
        text: 'Archivist preparation deferred because a turn arrived before its snapshot was bound.',
      };
      return;
    }

    const runOptions = {
      otherNamespaceBytes,
      // The result may land only if this exact workspace remains current.
      // Route changes and intervening mutations make its judgment stale.
      getWorkspace: () => (isCurrent(epoch) ? state.ws : null),
      onStatus: (msg) => {
        if (!isCurrent(epoch)) return;
        state.archivistStatus = msg;
        render();
      },
    };
    const result = temporaryAssistant
      ? await withAssistantScratch(transport => runArchivist(state.ws, {
        ...runOptions, ...transport,
        budgetRepairFn: (ws, raw, opts) => runSourceGroundedArchivistRepair(ws, raw, { ...opts, selectionMode: 'ranked-spans' }),
      }), { enabled: true, onStatus: runOptions.onStatus })
      : await runArchivist(state.ws, runOptions);
    if (!isCurrent(epoch)) return; // switched role-play mid-run

    if (result.status !== 'applied') {
      if (result.stagedRepairAttempted) result.errors.unshift(`Source-grounded budget repair stopped at ${result.phase}.`);
      state.banner = {
        kind: 'warn',
        text:
          `Archivist run rejected${result.stagedRepairAttempted ? ' after staged repair' : result.retried ? ' after one retry' : ''} — nothing changed. ` +
          result.errors.slice(0, 2).join('; '),
      };
      await markArchivistAttempt(epoch, {
        result: result.status,
        failure: result.errors.slice(0, 2).join('; '),
      });
      return;
    }

    // The apply already produced the next workspace; persist it as one write.
    const next = result.workspace;
    next.last_archivist_run_turn = next.current_turn; // spend the cadence slot
    next.last_archivist_attempt_turn = next.current_turn;
    next.last_archivist_attempt_result = result.receipt.no_change ? 'applied_no_change' : 'applied';
    next.last_archivist_applied_turn = next.current_turn;
    next.last_archivist_failure_reason = null;

    // The apply is derived from the prompt revision. CAS also protects the few
    // milliseconds between the freshness check and this write.
    //
    //   law: cas_on_the_revision_the_payload_was_built_from
    const derivedFrom = next.revision - 1;
    next.revision = derivedFrom; // store.write re-increments from its own read
    state.ws = await store.write(derivedFrom, () => next);
    if (!isCurrent(epoch)) return;
    state.usage = await store.usage(state.ws);

    const bits = [result.receipt.no_change
      ? 'No memory changes'
      : `${result.receipt.operation_count} operations applied`];
    if (result.retried) bits.push('after one retry');
    if (result.budgetRepaired) bits.push('source-grounded budget repair');
    if (temporaryAssistant) bits.push('temporary Assistant exchanges cleared');
    if (result.budgetFitted?.length) {
      const fitted = result.budgetFitted
        .map((item) => `${item.surface} ${item.before}→${item.after}/${item.hardLimit}`)
        .join(', ');
      bits.push(`oversized surface fitted safely (${fitted})`);
    }
    state.banner = { kind: 'info', text: bits.join(' · ') + '.' };
  } catch (e) {
    if (!isCurrent(epoch)) return;
    state.banner =
      e instanceof ConflictError
        ? {
            kind: 'warn',
            // Expected, not broken: you played while it was thinking. The run
            // is discarded rather than allowed to overwrite those turns.
            text:
              'Archivist run discarded — you played a turn while it was thinking, ' +
              'and its result no longer matched. Nothing was lost; it will run again.',
          }
        : { kind: 'bad', text: `Archivist could not run: ${e.message}` };
    await markArchivistAttempt(epoch, {
      result: e instanceof ConflictError ? 'stale_workspace' : 'error',
      failure: e.message,
    });
  } finally {
    if (isCurrent(epoch)) {
      state.archivistBusy = false;
      state.archivistStatus = null;
      render();
    }
  }
}

async function markArchivistAttempt(epoch, { result = 'rejected', failure = null } = {}) {
  try {
    const saved = await state.persistenceQueue.enqueue((base) => {
      base.last_archivist_run_turn = base.current_turn;
      base.last_archivist_attempt_turn = base.current_turn;
      base.last_archivist_attempt_result = result;
      base.last_archivist_failure_reason = failure || null;
      return base;
    });
    adoptQueuedWrite(saved, epoch);
    if (isCurrent(epoch)) {
      state.ws.last_archivist_run_turn = saved.last_archivist_run_turn;
      state.ws.last_archivist_attempt_turn = saved.last_archivist_attempt_turn;
      state.ws.last_archivist_attempt_result = saved.last_archivist_attempt_result;
      state.ws.last_archivist_failure_reason = saved.last_archivist_failure_reason;
    }
  } catch {
    // Another tab moved first. This marker is a cost guard, not story state —
    // losing it costs one extra scheduled attempt and nothing else.
  }
}

function toggle() {
  const drawer = root.getElementById('drawer');
  drawer.hidden = !drawer.hidden;
  if (!drawer.hidden) {
    const preserve = dismissedDrawer?.epoch === state.epoch && dismissedDrawer?.tab === state.tab;
    dismissedDrawer = null;
    if (!preserve) render();
  }
}

function observeRoute() {
  let last = location.pathname;
  setInterval(() => {
    if (location.pathname === last) return;
    last = location.pathname;
    load().then(render);
  }, 1000);
}

async function load() {
  const epoch = ++state.epoch;

  // Stop listening for the session we are leaving. Left stacked, each stale
  // listener still fires for ITS key — so a change to the previous role-play
  // would load that workspace into this panel, and the next save would write
  // it under this session's key.
  if (stopWatchingExternal) {
    stopWatchingExternal();
    stopWatchingExternal = null;
  }

  // Per-session UI state. None of this belongs to the next role-play.
  surfaceDrafts.clear();
  state.attestationReviewViews?.clear();
  state.legacyRecoveryNonces = [];
  state.rng = null;
  // A draft belongs to the role-play it was started in, not the next one.
  state.packDraft = null;
  state.packErrors = null;
  state.packSample = null;
  state.mergeFrom = null;
  state.resolveResult = null;
  state.banner = null;
  state.assistantBusy = false;
  state.deckRefill = null;
  state.archivistBusy = false;
  state.archivistStatus = null;
  state.injectionPruneBusy = false;
  state.injectionPruneStatus = null;
  state.carrierHygieneStatus = 'unchecked';
  state.carrierHygieneReason = 'Complete DreamGen history has not been inspected yet.';
  state.carrierHygieneCount = null;
  state.carrierHygieneVerifiedAt = null;
  state.hostHistoryMutationOwner = null;
  state.debugAttempt = null;
  root?.getElementById('dgce-context-warning')?.remove();
  state.mutationGeneration = 0;
  state.persistenceQueue = null;
  clearInjectionPruneTimer();
  state.usage = null;

  const id = workspaceIdFromLocation();
  if (!id) {
    state.ws = null;
    state.store = null;
    state.persistenceQueue = null;
    return;
  }
  const store = new WorkspaceStore({ workspaceId: id });
  state.store = store;
  state.persistenceQueue = new WorkspaceMutationQueue(store);

  let ws;
  try {
    ws = await store.read();
    if (!ws) {
      const created = createWorkspace({ workspace_id: id, display_name: document.title });
      try {
        ws = await store.write(0, () => created);
      } catch (error) {
        if (!(error instanceof ConflictError)) throw error;
        ws = await store.read();
        if (!ws) throw error;
      }
    }
  } catch (e) {
    if (!isCurrent(epoch)) return;
    state.ws = null;
    state.banner = { kind: 'bad', text: `Stored data could not be read: ${e.message}` };
    return;
  }
  if (!isCurrent(epoch)) return; // navigated away while reading

  if (editionWorkspaceIssue(ws)) {
    state.ws = ws;
    state.banner = { kind: 'warn', text: editionWorkspaceIssue(ws) };
    return; // no reconciliation, carrier cleanup, or automatic writes
  }

  // A legacy Archivist run may have carded a player persona or a character
  // already owned by the now-published campaign. Quarantine rather than delete:
  // the duplicate loses all projection authority, while its notes remain
  // visible and recoverable to the user.
  const reconciled = structuredClone(ws);
  const authorityChanges = reconcileCardAuthority(
    reconciled,
    mergeEntityGroups(readAuthoredEntities(), campaignEntityGroups(reconciled.campaign)),
  );
  if (authorityChanges.length) {
    try {
      ws = await store.write(ws.revision, () => reconciled);
      if (!isCurrent(epoch)) return;
      const quarantined = authorityChanges.filter((item) => !item.released).map((item) => item.name);
      const released = authorityChanges.filter((item) => item.released).map((item) => item.name);
      const notes = [];
      if (quarantined.length) notes.push(`Removed duplicate card authority from: ${quarantined.join(', ')}`);
      if (released.length) notes.push(`Definition no longer mounted; card remains unconfirmed: ${released.join(', ')}`);
      state.banner = { kind: 'info', text: notes.join('. ') + '.' };
    } catch (e) {
      if (!isCurrent(epoch)) return;
      state.banner = { kind: 'warn', text: `Entity authority reconciliation deferred: ${e.message}` };
    }
  }

  state.ws = ws;
  if (state.ws.timeline_integrity?.desynchronized) {
    state.banner = {
      kind: 'bad',
      text: 'DreamGen history and DGCE state are on different timelines. Authoritative injection remains suspended until you explicitly reconcile them.',
    };
  }
  const usage = await store.usage(ws);
  if (!isCurrent(epoch)) return;
  state.usage = usage;

  stopWatchingExternal = watchExternalWrites({
    store,
    hasUnsavedEdits: () => state.dirty.size > 0,
    onReload: (incoming) => {
      if (!isCurrent(epoch)) return; // belongs to a session we have left
      markLocalMutation();
      state.ws = incoming;
      render();
    },
    onConflict: () => {
      if (!isCurrent(epoch)) return;
      state.banner = {
        kind: 'warn',
        text: 'This workspace changed in another tab. Reload or review before saving.',
      };
      render();
    },
  });

  // A reloaded tab may already contain obsolete campaign authority carriers
  // from prior turns. Queue their exact nonce-owned cleanup before the player
  // sends again; otherwise the first request after reload still receives
  // several live-looking DGCE revisions.
  void verifyFreeOrdinaryReadback();
  scheduleRecurringInjectionPrune(epoch, 0, true);
}

async function commit(mutator, { note, retryConflict = false, requireLock = false } = {}) {
  if (!state.store) return { ok: false, error: new Error('workspace store is unavailable') };
  markLocalMutation();
  const epoch = state.epoch;
  const store = state.store;   // pinned: state.store may re-point mid-write
  const base0 = state.ws;
  const mutate = (base) => {
    assertEditionWorkspace(base);
    mutator(base);
    assertEditionWorkspace(base);
    return base;
  };
  try {
    const saved = retryConflict
      ? await writeWithConflictRetry(store, base0, mutate)
      : await store.write(base0.revision, mutate, { requireLock });
    if (!isCurrent(epoch)) return { ok: false, stale: true }; // wrote it; do not adopt across routes
    state.ws = saved;
    state.usage = await store.usage(saved);
    if (!isCurrent(epoch)) return { ok: false, stale: true };
    if (note) state.banner = { kind: 'info', text: note };
    render();
    return { ok: true, workspace: saved };
  } catch (e) {
    if (!isCurrent(epoch)) return { ok: false, stale: true, error: e };
    if (e instanceof ConflictError) {
      state.banner = { kind: 'warn', text: e.message + ' — reload before saving.' };
    } else if (e instanceof QuotaError) {
      state.banner = { kind: 'bad', text: e.message };
    } else {
      state.banner = { kind: 'bad', text: e.message };
    }
    render();
    return { ok: false, error: e };
  }
}

function render() {
  const drawer = root.getElementById('drawer');
  if (!drawer) return;
  // An update while dismissed invalidates the preserved DOM. Reopening must
  // show current delivery/history state, not an earlier successful snapshot.
  if (drawer.hidden) { dismissedDrawer = null; return; }
  dismissedDrawer = null;
  const focused = root.activeElement;
  const reviewInput = drawer.querySelector('textarea[data-dgce-attestation]');
  const reviewScroll = reviewInput ? { id: reviewInput.id, top: drawer.querySelector('main')?.scrollTop ?? 0 } : null;
  const selection = focused?.id?.startsWith('s-')
    ? { id: focused.id, start: focused.selectionStart, end: focused.selectionEnd, scroll: focused.scrollTop } : null;
  drawer.replaceChildren(drawerResizer, header(), nav(), body());
  if (reviewScroll && root.getElementById(reviewScroll.id)) drawer.querySelector('main').scrollTop = reviewScroll.top;
  const restored = selection && root.getElementById(selection.id);
  if (restored) {
    restored.focus({ preventScroll: true });
    restored.setSelectionRange(selection.start, selection.end);
    restored.scrollTop = selection.scroll;
  }
}

function nav() {
  return el(
    'nav',
    {},
    TABS.map((t) =>
      el(
        'button',
        {
          'aria-selected': String(state.tab === t),
          onclick: () => {
            state.tab = t;
            render();
          },
        },
        t,
      ),
    ),
  );
}

function memoryTab() {
  const out = [];
  const cadence = state.ws.settings.archivist_cadence_turns;
  const nextScheduled = cadence > 0
    ? (state.ws.last_archivist_run_turn ?? 0) + cadence : null;

  out.push(
    el(
      'section',
      {},
      el(
        'h2',
        {},
        'Archivist',
        el('span', { class: 'meta' }, state.archivistStatus ?? 'idle'),
      ),
      el(
        'p',
        { class: 'empty' },
        'Maintains the surfaces below and the card index from the story so far. ' +
          'Runs on the Assistant, so it costs no role-play context.' +
          (state.ws.settings.archivist_cadence_turns > 0
            ? ` Also runs on its own every ${state.ws.settings.archivist_cadence_turns} turns.`
            : ''),
      ),
      el(
        'p',
        { class: 'empty' },
        `Last attempt: ${state.ws.last_archivist_attempt_turn == null
          ? 'none'
          : `turn ${state.ws.last_archivist_attempt_turn} (${state.ws.last_archivist_attempt_result ?? 'unknown'})`}. ` +
          `Last applied: ${state.ws.last_archivist_applied_turn == null
            ? 'none'
            : `turn ${state.ws.last_archivist_applied_turn}`}. ` +
          `Next scheduled: ${nextScheduled == null ? 'manual only' : `turn ${nextScheduled}`}.` +
          (state.ws.last_archivist_failure_reason
            ? ` Last failure: ${state.ws.last_archivist_failure_reason}`
            : ''),
      ),
      el(
        'div',
        { class: 'row' },
        el(
          'button',
          {
            class: 'act shrink',
            disabled: Boolean(state.archivistBusy),
            onclick: () => refreshWithArchivist(),
          },
          state.archivistBusy ? 'Running…' : 'Refresh with Archivist',
        ),
        el('button', {
          class: 'act shrink', disabled: Boolean(state.archivistBusy),
          onclick: () => {
            if (!window.confirm('Use an empty Assistant chat temporarily? DGCE sends maintenance requests and clears each completed exchange. Save or clear existing chat yourself first. Do not use this session’s Assistant in another tab during the run. Errors or user activity stop cleanup; campaign changes apply only after validation.')) return;
            refreshWithArchivist({ temporaryAssistant: true });
          },
        }, 'Refresh with temporary Assistant…'),
      ),
    ),
  );

  if (state.ws.timeline_integrity?.desynchronized) {
    out.push(
      el(
        'div',
        { class: 'banner bad' },
        `Timeline desynchronized${state.ws.timeline_integrity.detected_turn == null
          ? ''
          : ` at workspace turn ${state.ws.timeline_integrity.detected_turn}`}: ` +
          `${state.ws.timeline_integrity.reason ?? 'DreamGen history moved backward outside DGCE.'} ` +
          'Authoritative injection is suspended. ',
        el(
          'button',
          {
            class: 'act shrink',
            onclick: async () => {
              const confirmed = window.confirm(
                'DGCE cannot reconstruct an arbitrary DreamGen Undo. Continue only after you have manually reconciled or rebuilt DGCE state to match the visible transcript. Mark this timeline reconciled?',
              );
              if (!confirmed) return;
              await commit((ws) => reconcileTimelineIntegrity(ws), {
                note: 'Timeline marked reconciled. Complete-history verification is required before authoritative injection resumes.',
              });
              state.carrierHygieneStatus = 'unchecked';
              state.carrierHygieneReason = 'Timeline reconciliation invalidated the prior history certificate.';
              state.carrierHygieneVerifiedAt = null;
              scheduleRecurringInjectionPrune(state.epoch, 0, true);
            },
          },
          'Mark Timeline Reconciled',
        ),
      ),
    );
  }

  if (state.ws.undo) {
    out.push(
      el(
        'div',
        { class: 'banner info' },
        'An Archivist run can be undone. ',
        el(
          'button',
          {
            class: 'act shrink',
            onclick: () => commit((ws) => applyPreimage(ws, ws.undo), { note: 'Archivist run undone.' }),
          },
          'Undo Last Archivist Run',
        ),
      ),
    );
  }

  for (const [key, label] of SURFACES) {
    const surface = state.ws.surfaces[key];
    const draftText = surfaceDrafts.text(key, surface.text);
    const used = estimateTokens(draftText);
    const limit = enforcementTarget(surface.max_tokens);
    const entries = (t) => t.split(/\r?\n/).filter((l) => l.trim()).length;

    const area = el('textarea', { id: `s-${key}`, class: 'surface' });
    area.value = draftText;
    area.addEventListener('input', () => {
      surfaceDrafts.edit(key, area.value);
      const c = root.getElementById(`count-${key}`);
      const now = estimateTokens(area.value);
      const n = entries(area.value);
      c.textContent = `${n} ${n === 1 ? 'entry' : 'entries'} · ~${now} / ${limit} estimated tokens`;
      c.className = `meta ${now > limit ? 'over' : ''}`;
    });

    out.push(
      el(
        'section',
        {},
        el(
          'h2',
          {},
          label,
          el(
            'span',
            { id: `count-${key}`, class: `meta ${used > limit ? 'over' : ''}` },
            `${entries(draftText)} ${entries(draftText) === 1 ? 'entry' : 'entries'} · ` +
              `~${used} / ${limit} estimated tokens`,
          ),
        ),
        area,
        el(
          'div',
          { class: 'row', style: 'margin-top:6px' },
          el(
            'button',
            {
              class: 'act shrink',
              onclick: async () => {
                const text = root.getElementById(`s-${key}`).value;
                const captured = surfaceDrafts.capture(key);
                const epoch = state.epoch;
                if (estimateTokens(text) > limit) {
                  state.banner = { kind: 'warn', text: `${label} is over its enforced budget.` };
                  render();
                  return;
                }
                const result = await commit((ws) => {
                  ws.surfaces[key].text = text;
                }, { note: `${label} saved.` });
                if (result.ok && isCurrent(epoch)) {
                  surfaceDrafts.acknowledge(key, captured);
                  render();
                }
              },
            },
            'Save',
          ),
          el(
            'label',
            { class: 'shrink' },
            'enabled ',
            (() => {
              const box = el('input', { type: 'checkbox' });
              box.checked = surface.enabled;
              box.addEventListener('change', () =>
                commit((ws) => {
                  ws.surfaces[key].enabled = box.checked;
                }),
              );
              return box;
            })(),
          ),
        ),
      ),
    );
  }
  return out;
}

function cardsTab(kind) {
  const out = [];
  const active = activeIds(state.ws, kind);
  const retired = retiredIds(state.ws, kind);
  const unconfirmed = state.ws.unconfirmed[kind];

  out.push(
    el(
      'section',
      {},
      el('h2', {}, KIND_TABS[kind], el('span', { class: 'meta' }, `${active.length + retired.length + unconfirmed.length} retained`)),
      el(
        'div',
        { class: 'row' },
        el('input', { type: 'text', id: `new-${kind}`, placeholder: `New ${kind} name` }),
        el(
          'button',
          {
            class: 'act shrink',
            onclick: () => {
              const input = root.getElementById(`new-${kind}`);
              const name = input.value.trim();
              if (!name) return;
              const id = makeCardId(kind, name);
              const protectedMatch = protectedCardMatch(
                { kind, name_or_title: name, aliases: [] },
                definedEntityGroups(),
              );
              if (protectedMatch) {
                state.banner = {
                  kind: 'warn',
                  text: `${protectedMatch.name} is already defined by ${protectedMatch.source}; a card would duplicate its authority.`,
                };
                render();
                return;
              }
              if (state.ws.cards[id]) {
                state.banner = { kind: 'warn', text: `${name} already exists.` };
                render();
                return;
              }
              commit((ws) => {
                ws.cards[id] = createCard({ id, kind, name_or_title: name, review_state: 'confirmed' });
                ws.order[kind].push(id);
                ws.cards[id].last_supported_turn = ws.current_turn;
                rebuildAliasIndex(ws);
              });
            },
          },
          'Add',
        ),
      ),
    ),
  );

  out.push(el('div', { class: 'group-label' }, 'Active — projected into context'));
  out.push(...(active.length ? active.map((id) => cardRow(id)) : [el('p', { class: 'empty' }, 'None.')]));

  out.push(el('div', { class: 'boundary' }, el('span', {}, 'active window')));

  out.push(el('div', { class: 'group-label' }, 'Retired — known and recallable, zero ambient cost'));
  out.push(...(retired.length ? retired.map((id) => cardRow(id)) : [el('p', { class: 'empty' }, 'None.')]));

  out.push(el('div', { class: 'group-label' }, 'Unconfirmed — retained, never projected'));
  out.push(
    ...(unconfirmed.length ? unconfirmed.map((id) => cardRow(id)) : [el('p', { class: 'empty' }, 'None.')]),
  );

  return out;
}

function cardRow(id) {
  const card = state.ws.cards[id];
  if (!card) return el('div', { class: 'card' }, `missing card ${id}`);

  const activity = activityOf(state.ws, id);
  const band = freshnessBand(state.ws, id);
  const rank = ordinalRank(state.ws, id);
  const merging = state.mergeFrom && state.mergeFrom !== id;

  const pills = [
    rank ? el('span', { class: 'pill rank' }, `#${rank}`) : null,
    el('span', { class: `pill ${band}` }, band),
    card.pinned ? el('span', { class: 'pill pinned' }, 'pinned') : null,
    card.authority_conflict ? el('span', { class: 'pill' }, 'defined elsewhere') : null,
  ];

  const actions = [
    card.review_state === 'confirmed' && !card.authority_conflict
      ? el('button', { class: 'act', onclick: () => commit(ws => {
        if (ws.ordinary_pending) throw new Error('Reconcile the pending turn before changing recall.');
        const current = ws.cards[id];
        if (!current || current.review_state !== 'confirmed' || current.authority_conflict) throw new Error('Card is no longer eligible for recall.');
        recallCard(ws, id);
      }, { note: 'Recalled for this session, within the context budget. No durable rank or fact confirmation changed.' }) }, 'Recall for this session') : null,
    el(
      'button',
      { class: 'act', onclick: () => commit((ws) => { ws.cards[id].pinned = !ws.cards[id].pinned; }) },
      card.pinned ? 'Unpin' : 'Pin',
    ),
    activity === 'unconfirmed'
      ? el('button', {
          class: 'act',
          disabled: Boolean(card.authority_conflict),
          title: card.authority_conflict ? `Defined by ${card.authority_conflict.source}` : null,
          onclick: () => commit((ws) => confirmByUser(ws, id)),
        }, card.authority_conflict ? 'Defined elsewhere' : 'Confirm')
      : el('button', { class: 'act', onclick: () => commit((ws) => unconfirmByUser(ws, id)) }, 'Unconfirm'),
    rank && rank > 1
      ? el(
          'button',
          { class: 'act', onclick: () => commit((ws) => userReorder(ws, card.kind, id, rank - 1)) },
          'Up',
        )
      : null,
    merging
      ? el('button', { class: 'act', onclick: () => previewMerge(state.mergeFrom, id) }, 'Merge into this')
      : el(
          'button',
          {
            class: 'act',
            onclick: () => {
              state.mergeFrom = state.mergeFrom === id ? null : id;
              render();
            },
          },
          state.mergeFrom === id ? 'Cancel merge' : 'Merge…',
        ),
    el(
      'button',
      {
        class: 'act danger',
        onclick: () => {
          if (!confirm(`Delete "${card.name_or_title}" permanently? This cannot be undone.`)) return;
          commit((ws) => {
            removeFromOrder(ws, card.kind, id);
            delete ws.cards[id];
            for (const other of Object.values(ws.cards)) {
              other.link_ids = other.link_ids.filter((l) => l !== id);
            }
            rebuildAliasIndex(ws);
          });
        },
      },
      'Delete',
    ),
  ];

  const summary = el('textarea', { style: 'min-height:48px' });
  summary.value = card.summary;
  summary.addEventListener('change', () =>
    commit((ws) => {
      ws.cards[id].summary = summary.value;
      ws.cards[id].last_supported_turn = ws.current_turn; // a user edit IS support
    }),
  );

  const aliases = el('input', { type: 'text' });
  aliases.value = card.aliases.join(', ');
  aliases.addEventListener('change', () =>
    commit((ws) => {
      ws.cards[id].aliases = aliases.value.split(',').map((s) => s.trim()).filter(Boolean);
      rebuildAliasIndex(ws);
    }),
  );

  return el(
    'div',
    { class: 'card' },
    el('div', { class: 'title' }, el('strong', {}, card.name_or_title), ...pills),
    ...card.review_signals.map((s) =>
      el('div', { class: 'signal' }, `⚑ ${s.reason_code}${s.detail ? ` — ${s.detail}` : ''}`),
    ),
    el('label', {}, 'Summary'),
    summary,
    el('label', {}, 'Aliases (comma separated)'),
    aliases,
    card.link_ids.length
      ? el(
          'div',
          { class: 'summary' },
          'Links: ',
          card.link_ids.map((l) => state.ws.cards[l]?.name_or_title ?? l).join(', '),
        )
      : null,
    el('div', { class: 'actions' }, ...actions.filter(Boolean)),
  );
}

function previewMerge(duplicateId, canonicalId) {
  const legality = checkMergeLegality(state.ws, duplicateId, canonicalId);
  if (!legality.legal) {
    state.banner = { kind: 'bad', text: `Cannot merge: ${legality.reason}` };
    state.mergeFrom = null;
    render();
    return;
  }
  const dup = state.ws.cards[duplicateId];
  const can = state.ws.cards[canonicalId];
  const ok = confirm(
    `Merge "${dup.name_or_title}" into "${can.name_or_title}"?\n\n` +
      `Surviving card: ${can.name_or_title}\n` +
      `Aliases gained: ${[dup.name_or_title, ...dup.aliases].join(', ')}\n` +
      `Old id ${duplicateId} will still resolve.\n` +
      `Links will be rewired to ${canonicalId}.`,
  );
  state.mergeFrom = null;
  if (!ok) return render();
  commit((ws) => mergeCards(ws, duplicateId, canonicalId), { note: 'Cards merged.' });
}

function resolveTab() {
  const input = el('input', { type: 'text', id: 'resolve-q', placeholder: 'Resolve entity…' });
  input.value = state.resolveResult?.term ?? '';

  const run = () => {
    const term = root.getElementById('resolve-q').value.trim();
    const groups = definedEntityGroups();
    state.resolveResult = term
      ? { term, result: resolveEntity(state.ws, term, lookupTerm, { authored: (t) => findAuthored(t, groups) }) }
      : null;
    render();
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && run());

  const out = [
    el(
      'section',
      {},
      el('h2', {}, 'Search / Resolve'),
      el('div', { class: 'row' }, input, el('button', { class: 'act shrink', onclick: run }, 'Resolve')),
    ),
  ];

  const r = state.resolveResult?.result;
  if (!r) return out;

  if (r.status === 'authored') {
    out.push(
      el(
        'div',
        { class: 'banner info' },
        `${r.canonical_name} is defined by the scenario or published campaign as a ${r.kind}. ` +
          'It has no card on purpose — the scenario is sent to the model every turn, ' +
          'so an active card would duplicate its authority.',
      ),
    );
    return out;
  }

  if (r.status === 'unknown') {
    out.push(
      el(
        'div',
        { class: 'banner info' },
        'Not present in the retained index. That is not proof the entity never existed.',
      ),
    );
  } else if (r.status === 'ambiguous') {
    // §14 ambiguity_UI: show all, never preselect
    out.push(el('div', { class: 'banner warn' }, `${r.count} matches — no selection is made for you.`));
    out.push(...r.matches.map((m) => cardRow(m.id)));
  } else {
    out.push(
      el(
        'div',
        { class: 'banner info' },
        `${r.status} → ${r.canonical_name} (${r.activity}, ${r.freshness})`,
      ),
    );
    out.push(cardRow(r.id));
  }
  return out;
}

function numberSetting(key, label, { min = 0, max = 999 } = {}) {
  const input = el('input', { type: 'number', min, max, value: String(state.ws.settings[key]) });
  input.addEventListener('change', () =>
    commit((ws) => {
      setWorkspaceSetting(ws, key, Number(input.value));
    }),
  );
  return el('div', {}, el('label', {}, label), input);
}

function checkboxSetting(key, label) {
  const input = el('input', { type: 'checkbox' });
  input.checked = Boolean(state.ws.settings[key]);
  input.addEventListener('change', () =>
    commit((ws) => {
      setWorkspaceSetting(ws, key, input.checked);
    }),
  );

  return el('label', { class: 'checkline' }, input, label);
}

function schedulesTab() {
  const budget = state.ws.settings.max_archivist_promotions_per_run;
  const cadence = state.ws.settings.archivist_cadence_turns;
  const since = state.ws.current_turn - (state.ws.last_archivist_run_turn ?? 0);
  return [
    el(
      'section',
      {},
      el('h2', {}, 'Scheduled Archivist'),
      numberSetting('archivist_cadence_turns', 'Run every N turns (0 = manual only)', { max: 100 }),
      el(
        'p',
        { class: 'empty' },
        cadence > 0
          ? `${since} turn${since === 1 ? '' : 's'} since the last run. ` +
            'Skipped whenever the Assistant is busy, and still due on the next turn if so.'
          : 'Off. The Refresh button in the Memory tab is the only trigger.',
      ),
    ),
    el(
      'section',
      {},
      el('h2', {}, 'Context carrier cleanup'),
      el('div', { class: state.carrierHygieneStatus === 'clean' ? 'banner info' : 'banner warn' },
        `History hygiene: ${carrierHygieneSummary()}. ${state.carrierHygieneReason}`),
      el(
        'p',
        { class: 'empty' },
        'Cleanup is mandatory and automatic. DGCE loads complete DreamGen history, removes only nonce-owned extension context through the native editor, and verifies zero historical carriers before injecting another. Story prose is preserved.',
      ),
      el('button', {
        class: 'act shrink',
        disabled: Boolean(state.injectionPruneBusy),
        onclick: () => runRecurringInjectionPrune(),
      }, state.injectionPruneBusy ? 'Checking…' : 'Verify now'),
    ),
    el(
      'section',
      {},
      el('h2', {}, 'Movement budget'),
      numberSetting('max_archivist_promotions_per_run', 'Max Archivist promotions per run (0–5)', { max: 5 }),
      budget === 0
        ? el('p', { class: 'empty' }, 'Maintain memory, do not auto-reorder.')
        : null,
    ),
    el(
      'section',
      {},
      el('h2', {}, 'Active windows', el('span', { class: 'meta' }, 'projection limits, not storage limits')),
      ...KINDS.map((k) => numberSetting(`${k}_active_window`, `${KIND_TABS[k]} active window`)),
    ),
    el(
      'section',
      {},
      el('h2', {}, 'Budgets', el('span', { class: 'meta' }, 'estimated tokens')),
      numberSetting('event_log_budget', 'Event Log'),
      numberSetting('social_context_budget', 'Social Context'),
      numberSetting('inventory_budget', 'Inventory'),
      numberSetting('recall_budget', 'Recall result'),
      numberSetting('continuity_context_budget', 'Total continuity context (including Chaos Deck)', { min: 0, max: 20000 }),
      el('p', { class: 'empty' }, IS_FREE_EDITION
        ? 'Recall result limits selected cards. Total continuity context separately limits all surfaces, recalled cards and the optional Chaos Deck seed, with 20% tokenizer headroom. Whole parts that do not fit are omitted; an omitted deck card is not consumed. Raising either allowance does not increase DreamGen’s model context window.'
        : 'Campaign injection enforces 80% of the configured budget for tokenizer headroom. Debug shows the measured requirement. Raising this value increases prompt usage; it does not increase DreamGen’s model context window.'),
      numberSetting('linked_result_cap', 'Linked results per recall', { max: 10 }),
    ),
    el(
      'section',
      {},
      el('h2', {}, 'Confirmation'),
      numberSetting('origination_compare_window', 'Model turns compared for paste detection', { max: 20 }),
      el(
        'p',
        { class: 'empty' },
        'A mention that closely repeats recent AI text will not confirm a card.',
      ),
    ),
  ];
}

function requestObservationWarning(record) {
  const reason = record.unexpected_request_reason === 'same_release_clock_bucket'
    ? 'same millisecond as release; ordering unresolved'
    : record.unexpected_request_reason === 'before_release'
      ? 'browser timestamp precedes release' : 'release ordering unverified';
  return `Earlier non-authoritative request observation: ${record.unexpected_request_id} at ${record.unexpected_request_at ?? 'unknown time'} (${reason}).`
    + (record.unexpected_request_reason === 'same_release_clock_bucket'
      ? ' Timing alone does not prove an improper release. Do not automatically resend.' : '')
    + (record.request_id ? ' Later request linkage does not erase this warning.' : ' This is not a positive delivery receipt.');
}

function injectionRecordedAtLabel(value) {
  if (!value) return 'time unavailable';
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return 'time unavailable';
  return timestamp.toLocaleString();
}

function injectionLifecycleLabel(record) {
  return injectionLifecycleStatus(record).replaceAll('_', ' ');
}

function carrierHygieneSummary() {
  const count = Number.isInteger(state.carrierHygieneCount)
    ? ` · ${state.carrierHygieneCount} carrier${state.carrierHygieneCount === 1 ? '' : 's'} remain`
    : '';
  return `${state.carrierHygieneStatus.replaceAll('_', ' ')}${count}`;
}

function legacyCarrierRecoverySection(nonces = [...state.legacyRecoveryNonces]) {
  let review;
  try { review = buildLegacyAbsenceReview(state.ws, captureLegacyAbsenceHistory(document), nonces); }
  catch (error) { return el('section', { class: 'banner warn' },
    el('h3', {}, 'Legacy carrier recovery unavailable'), el('p', {}, error.message)); }
  let approved = false;
  const button = el('button', { class: 'act', disabled: true, onclick: async event => {
    if (!event.isTrusted || !approved) return;
    approved = false; button.disabled = true;
    const result = await commit(ws => acceptLegacyAbsence(ws, {
      history: captureLegacyAbsenceHistory(document), nonces,
      review_snapshot_hash: review.review_snapshot_hash, assertion: LEGACY_ABSENCE_ASSERTION,
    }), { requireLock: true, note: 'Legacy uncertainty accepted. No delivery, removal or outcome acknowledgment was claimed.' });
    if (result.ok) {
      state.legacyRecoveryNonces = [];
      state.carrierHygieneStatus = 'unchecked';
      scheduleRecurringInjectionPrune(state.epoch, 0, true);
    }
  } }, 'Accept legacy uncertainty and recheck history');
  const checkbox = el('input', { type: 'checkbox', onchange: event => {
    if (!event.isTrusted) return;
    approved = event.target.checked === true; button.disabled = !approved;
  } });
  return el('section', { class: 'card' }, el('h3', {}, 'Review unresolved legacy carrier history'),
    el('p', {}, `${review.history.interaction_count} interactions were loaded through the supported Load all cycle. No carrier is currently present. This does not prove that these old packets were delivered or removed.`),
    el('ul', {}, ...review.records.map(record => el('li', {},
      `Turn ${record.turn ?? '?'} · ${record.nonce} · ${record.lifecycle_status}`))),
    el('p', {}, 'This decision permits only these unchanged, absent pre-outbox records to stop blocking future context. It keeps their original evidence and status, changes no campaign state, acknowledges no outcomes, and never resends or rerolls. Current actions cannot use this path. A later carrier still requires normal exact-owner handling.'),
    el('details', {}, el('summary', {}, 'Pinned review identity'), el('code', {}, review.review_snapshot_hash)),
    el('label', {}, checkbox, LEGACY_ABSENCE_ASSERTION), button);
}

function modernCarrierRecoverySection(nonce) {
  let review;
  try { review = buildModernAbsenceReview(state.ws, captureLegacyAbsenceHistory(document), nonce); }
  catch (error) { return el('section', { class: 'banner warn' },
    el('h3', {}, 'Modern cleanup uncertainty review unavailable'), el('p', {}, `${nonce}: ${error.message}`)); }
  let approved = false;
  const button = el('button', { class: 'act', disabled: true, onclick: async event => {
    if (!event.isTrusted || !approved) return;
    approved = false; button.disabled = true;
    const result = await commit(ws => acceptModernAbsence(ws, {
      history: captureLegacyAbsenceHistory(document), nonce,
      review_snapshot_hash: review.review_snapshot_hash, assertion: MODERN_ABSENCE_ASSERTION,
    }), { requireLock: true, note: 'Cleanup uncertainty accepted. Original failure retained; no removal or delivery evidence added.' });
    if (result.ok) {
      state.carrierHygieneStatus = 'unchecked';
      scheduleRecurringInjectionPrune(state.epoch, 0, true);
    }
  } }, 'Accept cleanup uncertainty and recheck history');
  const checkbox = el('input', { type: 'checkbox', onchange: event => {
    if (!event.isTrusted) return;
    approved = event.target.checked === true; button.disabled = !approved;
  } });
  return el('section', { class: 'card' }, el('h3', {}, 'Accept unresolved modern carrier cleanup'),
    el('p', {}, `${nonce} · ${review.action.kind} action ${review.action.id}`),
    el('p', {}, `Prior cleanup: ${review.record.failure_reason} / ${review.record.failure_detail ?? 'unspecified'}. Delivery was already reconciled through consequence-bound raw-editor testimony, not machine verification.`),
    el('p', {}, `${review.history.interaction_count} currently mounted interactions have a positive supported-history witness and contain no context carriers. How this carrier became absent remains unresolved.`),
    el('p', {}, 'The original failed-cleanup record remains unpruned and unchanged. This appends only your decision about its past uncertainty. A separate history sweep must still establish current clearance. A reappearing carrier is never hidden by this decision.'),
    el('details', {}, el('summary', {}, 'Pinned review identity'), el('code', {}, review.review_snapshot_hash)),
    el('label', {}, checkbox, MODERN_ABSENCE_ASSERTION), button);
}

function savedTurnAttestationButton(kind, id) {
  // At most one ephemeral view per action kind; never persisted or shared
  // across sessions. Background renders must not erase a still-valid review.
  state.attestationReviewViews ??= new Map();
  const views = state.attestationReviewViews;
  let review;
  try { review = buildAttestationReview(state.ws, { kind, id }); } catch (error) {
    views.delete(kind);
    return el('p', { class: 'banner warn' }, `Attestation review unavailable: ${error.message} Nothing was reconciled. Do not resend or reroll.`);
  }
  // Pin the reviewed object here. Never rebuild its hash from fresh state in
  // the click handler; the locked transaction compares against this snapshot.
  const reviewHash = review.review_snapshot_hash;
  const viewKey = `${state.epoch}:${state.ws.workspace_id}:${kind}:${id}:${reviewHash}`;
  if (views.get(kind)?.key === viewKey) return views.get(kind).node;
  let inspected = false;
  let inspectedText;
  let comparison = compareAttestationPacket(review, inspectedText);
  const comparisonStatus = el('p', { role: 'status' }, 'Paste the complete raw editor text to compare locally. Nothing is sent to DreamGen.');
  const comparisonDetails = el('pre', {});
  const button = el('button', { class: 'act', disabled: true, onclick: async event => {
    if (!event.isTrusted || !inspected || !comparison.equivalent) return;
    const result = await commit(ws => attestSavedTurn(ws, { kind, id, assertion: SAVED_TURN_ASSERTION,
      scope: ATTESTATION_SCOPE, raw_interaction_inspected: inspected, inspected_raw_text: inspectedText,
      review_snapshot_hash: reviewHash }),
      { requireLock: true, note: 'User attestation recorded. Prior uncertainty retained; no resend or reroll.' });
    if (result.ok) { setTimeout(maybeReplenishDeck, 2000); views.delete(kind); scheduleRecurringInjectionPrune(state.epoch, 0, true); }
  } }, 'Record my raw-interaction attestation');
  const checkbox = el('input', { type: 'checkbox', onchange: event => {
    if (!event.isTrusted) return;
    inspected = event.target.checked === true;
    button.disabled = !inspected || !comparison.equivalent;
  } });
  const rawInput = el('textarea', { id: `s-attestation-${kind}-${reviewHash}`, 'data-dgce-attestation': '', rows: 8, spellcheck: 'false', 'aria-label': 'Raw saved interaction copied from DreamGen', oninput: event => {
    if (!event.isTrusted) return;
    inspectedText = event.target.value;
    inspected = false; checkbox.checked = false; button.disabled = true;
    comparison = compareAttestationPacket(review, inspectedText);
    comparisonStatus.textContent = comparison.status === 'exact' ? 'Exact text match. Confirm the saved-interaction origin and listed consequences below.'
      : comparison.equivalent ? 'Equivalent under the permitted host normalization only. Review the transformations and confirm the saved-interaction origin below.'
      : 'Text mismatch. Confirmation blocked; inspect the first remaining difference below. Do not edit the saved interaction to force a match.';
    comparisonDetails.textContent = JSON.stringify(comparison, null, 2);
  } });
  const view = el('section', { class: 'card' },
    el('h3', {}, 'Review this exact saved action'),
    el('p', {}, 'Compare the text below with the saved interaction, not the original slash command.'),
    el('strong', {}, 'Expected host-facing player text'), el('pre', {}, review.expected_visible_saved_text),
    el('details', {}, el('summary', {}, 'Expected full raw interaction — include hidden context in your comparison'),
      el('pre', {}, review.expected_raw_saved_text)),
    el('p', {}, 'Open Edit Interaction in DreamGen and copy the complete raw text without saving changes. Paste it below, then close the host editor without saving. Do not copy the expected text from this review. If the editor omits hidden context, leave recovery pending.'),
    el('p', {}, HOST_PACKET_EQUIVALENCE_NOTICE), rawInput, comparisonStatus,
    el('details', {}, el('summary', {}, 'Local text comparison: transformations and first remaining difference'), comparisonDetails),
    el('p', {}, 'Offsets are zero-based UTF-16 positions: line-ending edits refer to the original text, quote edits to LF-normalized text, and remaining differences to normalized text. This comparison checks supplied text, not its origin or server persistence.'),
    el('strong', {}, 'What this confirmation will do'),
    el('p', {}, 'End the delivery hold for this action without resending or rerolling it. This remains user testimony, not system verification or proof of model consumption.'),
    el('p', {}, `Acknowledge ${review.acknowledged_pending_texts.length} pending outcome occurrence(s), exactly as listed:`),
    review.acknowledged_pending_texts.length ? el('ol', {}, ...review.acknowledged_pending_texts.map(text => el('li', {}, text)))
      : el('p', {}, 'No pending outcomes will be removed.'),
    kind === 'ordinary' ? el('div', {},
      el('p', {}, 'Retire the automatic rollback record for the already-committed ordinary effects below. This does not apply those effects again. Exact before-state data and after-state hashes are bound by the rollback digest.'),
      el('ul', {}, ...review.ordinary_changes_summary.map(change => el('li', {}, change.key))),
      el('details', {}, el('summary', {}, 'Rollback boundary fingerprints'),
        el('pre', {}, review.ordinary_changes_summary.map(change => `${change.key}\nbefore: ${change.before_hash}\nafter: ${change.after_hash}`).join('\n\n')),
        el('p', {}, `Complete rollback digest: ${review.ordinary_changes_digest}`))) : null,
    el('p', {}, 'Earlier request/release uncertainty remains in the audit.'),
    ...[review.prior_state, ...review.prior_carrier_evidence].filter(item => item.unexpected_request_id)
      .map(item => el('p', {}, requestObservationWarning(item))),
    el('details', {}, el('summary', {}, 'Review identity'),
      el('p', {}, `Review: ${reviewHash}`), el('p', {}, `Outgoing packet: ${review.outgoing_text_hash}`),
      el('p', {}, `Carrier: ${review.carrier_nonces.join(', ') || 'none'}`)),
    el('label', {}, checkbox, SAVED_TURN_ASSERTION), button);
  views.set(kind, { key: viewKey, node: view });
  return view;
}

function deliveryReconciliationsSection() {
  const metrics = state.ws.delivery_metrics ?? {};
  return el('section', {}, el('h2', {}, 'Delivery attestations'),
    ...(state.ws.legacy_carrier_dispositions ?? []).slice(-10).reverse().map(receipt =>
      el('div', { class: 'card' }, el('strong', {}, 'Legacy uncertainty accepted — not delivery or removal proof'),
        el('p', {}, `${receipt.at} · ${receipt.records.length} unchanged legacy records`),
        el('p', {}, receipt.assertion), el('code', {}, receipt.review_snapshot_hash))),
    el('p', {}, 'These are human assertions, not browser verification of host persistence.'),
    el('p', {}, `Since lifecycle counters began: ${metrics.user_attestation_count ?? 0} attestations / ${metrics.normally_bound_request_count ?? 0} normally bound requests. This is not a delivery success rate.`),
    ...(state.ws.delivery_reconciliations ?? []).slice(-10).reverse().map(receipt => el('div', { class: 'card' },
      el('strong', {}, `${receipt.kind} · ${receipt.action_kind} · ${receipt.id}`),
      el('p', {}, `${receipt.at}: ${receipt.assertion}`),
      receipt.review_snapshot_hash ? el('details', {}, el('summary', {}, 'Reviewed consequences'),
        el('p', {}, `Scope: ${receipt.scope}. Review: ${receipt.review_snapshot_hash}`),
        el('p', {}, receipt.raw_comparison ? `Supplied raw text: ${receipt.raw_comparison.status}; policy: ${receipt.raw_comparison.policy}. Origin remains user testimony.` : 'Legacy attestation: no supplied-text comparison recorded.'),
        el('p', {}, 'Acknowledged pending outcomes (duplicate entries are separate occurrences):'),
        el('ol', {}, ...(receipt.acknowledged_pending_texts ?? []).map(text => el('li', {}, text))),
        el('p', {}, `Finalized ordinary rollback digest: ${receipt.ordinary_changes_digest}`))
        : el('p', {}, 'Legacy receipt: no consequence-bound review snapshot was recorded.'),
      ...[receipt.prior_state, ...(receipt.prior_carrier_evidence ?? [])]
        .filter(item => item?.unexpected_request_id).map(item => el('p', {},
          `Prior uncertainty retained: ${item.unexpected_request_reason} (${item.unexpected_request_id}).`)))));
}

function logTab() {
  const log = state.ws.injections ?? [];
  if (!log.length) {
    return [
      deliveryReconciliationsSection(),
      el(
        'section',
        {},
        el('h2', {}, 'Injection log'),
        el('div', { class: state.carrierHygieneStatus === 'clean' ? 'banner info' : 'banner warn' },
          `History hygiene: ${carrierHygieneSummary()}. ${state.carrierHygieneReason}`),
        el('button', {
          class: 'act shrink',
          disabled: Boolean(state.injectionPruneBusy),
          onclick: () => runRecurringInjectionPrune(),
        }, state.injectionPruneBusy ? 'Checking…' : 'Verify and clean complete history'),
        el(
          'p',
          { class: 'empty' },
          'Nothing injected yet. Send a turn with a card in the scene, or a surface due.',
        ),
      ),
    ];
  }

  const live = log.filter((record) => !record.pruned);
  const totals = live.reduce(
    (a, r) => ({ turns: a.turns + 1, tokens: a.tokens + (r.estimated_tokens ?? 0) }),
    { turns: 0, tokens: 0 },
  );
  return [
    deliveryReconciliationsSection(),
    el(
      'section',
      {},
      el(
        'h2',
        {},
        'Injection log',
        el(
          'span',
          { class: 'meta' },
          `workspace turn ${state.ws.current_turn} · ${log.length} records · ${live.length} live · ` +
            `~${live.length ? Math.round(totals.tokens / live.length) : 0} est tokens per live carrier`,
        ),
      ),
      el(
        'p',
        { class: 'empty' },
        'Every planned extension carrier appears here. Lifecycle shows whether MAIN world selected it, host history exposed it, and exact removal was verified.',
      ),
      el('div', { class: state.carrierHygieneStatus === 'clean' ? 'banner info' : 'banner warn' },
        `History hygiene: ${carrierHygieneSummary()}. ${state.carrierHygieneReason}`),
      el(
        'div',
        { class: 'row' },
        el(
          'button',
          {
            class: 'act shrink',
            disabled: Boolean(state.injectionPruneBusy),
            onclick: () => runRecurringInjectionPrune(),
          },
          state.injectionPruneBusy ? 'Checking…' : 'Verify and clean complete history',
        ),
        el('span', { class: 'meta' }, state.injectionPruneStatus ?? 'zero historical DGCE carriers required before injection'),
      ),
    ),
    ...log.slice(0, 25).map((r) =>
      el(
        'div',
        { class: 'card' },
        el(
          'div',
          { class: 'title' },
          el('strong', {}, `turn ${r.turn ?? '?'}`),
          el('span', {
            class: 'meta',
            title: r.recorded_at ?? 'Legacy receipt: no timestamp was recorded.',
          }, injectionRecordedAtLabel(r.recorded_at)),
          el('span', { class: 'pill' }, injectionLifecycleLabel(r)),
          el('span', { class: 'pill' }, `~${r.estimated_tokens} tok`),
          ...(r.parts ?? []).map((p) => el('span', { class: 'pill' }, p)),
          r.pruned ? el('span', { class: 'pill' }, 'removed from transcript') : null,
          r.matched != null
            ? el('span', { class: 'pill' }, `${r.matched}/${r.considered} matched`)
            : null,
        ),
        ...(r.staged ?? []).map((id) =>
          el(
            'div',
            { class: 'summary' },
            `${state.ws.cards[id]?.name_or_title ?? id} — ${(r.why?.[id] ?? []).join('; ') || 'no reason recorded'}`,
          ),
        ),
        el(
          'div',
          { class: 'summary' },
          `request ${r.request_id ?? 'legacy/unknown'} · workspace revision ${r.workspace_revision ?? 'unknown'} · ` +
            `campaign revision ${r.campaign_revision ?? 'none'}`,
        ),
        r.unexpected_request_id ? el('div', { class: 'banner warn' }, requestObservationWarning(r)) : null,
        r.failure_reason
          ? el('div', { class: 'summary' }, `Lifecycle note: ${r.failure_reason}`)
          : null,
        r.bridge_transport
          ? el('div', { class: 'summary' }, `Bridge: ${r.bridge_transport} · ${Number.isFinite(r.bridge_elapsed_ms) ? Math.round(r.bridge_elapsed_ms) + ' ms' : 'duration unavailable'}`)
          : null,
        // Planned content is not a delivery receipt.
        r.body
          ? el(
              'details',
              { class: 'disclosure' },
              el('summary', {}, 'carrier projection'),
              el('pre', { style: 'white-space:pre-wrap;overflow-x:auto' }, el('code', {}, r.body)),
            )
          : null,
        el('div', { class: 'summary' }, el('code', {}, r.nonce)),
      ),
    ),
  ];
}

function deckTab() {
  const deck = state.ws.deck;
  const anchors = deck.cards.filter((c) => c.anchored).length;
  const out = [];

  const modeSelect = el('select', {});
  for (const m of DECK_MODES) {
    const opt = el('option', { value: m }, DECK_MODE_LABELS[m]);
    if (deck.mode === m) opt.setAttribute('selected', '');
    modeSelect.append(opt);
  }
  modeSelect.addEventListener('change', () =>
    commitDeck((ws) => setDeckMode(ws.deck, modeSelect.value)),
  );

  out.push(
    el(
      'section',
      {},
      el('h2', {}, 'Chaos deck', el('span', { class: 'meta' }, 'entropy, not memory')),
      modeSelect,
      el(
        'p',
        { class: 'empty' },
        'One card is drawn at random each turn and consumed, so it can never repeat. ' +
          'The model is told to weave it in only if it genuinely fits, and to ignore it ' +
          'otherwise. This is what stops the story falling into loops.',
      ),
    ),
  );

  if (!deckEnabled(deck)) return out;

  if (deck.current_draw) {
    out.push(
      el(
        'section',
        {},
        el('h2', {}, 'Drawn this turn'),
        el('div', { class: 'banner info' }, deck.current_draw.text),
      ),
    );
  }

  if (deck.pending.length) {
    out.push(
      el(
        'section',
        {},
        el('h2', {}, 'Awaiting your review', el('span', { class: 'meta' }, `${deck.pending.length}`)),
        ...deck.pending.map((item) =>
          el(
            'div',
            { class: 'card' },
            el('div', {}, item.text),
            el(
              'div',
              { class: 'actions' },
              el(
                'button',
                { class: 'act', onclick: () => commitDeck((ws) => acceptDeckCard(ws.deck, item.text, { turn: ws.current_turn })) },
                'Accept',
              ),
              el(
                'button',
                { class: 'act danger', onclick: () => commitDeck((ws) => rejectDeckCard(ws.deck, item.text)) },
                'Reject',
              ),
            ),
          ),
        ),
      ),
    );
  }

  if (deckAssisted(deck)) {
    const { knownNames, establishedActors, genreProfile, dynamicsProfile } = freeDeckContext(state.ws);
    const paste = el('textarea', {
      id: 'deck-paste',
      placeholder: "Paste the Assistant's reply here…",
      style: 'min-height:70px',
    });

    const refill = state.deckRefill;
    if (refill) out.push(el('section', {},
      el('h2', {}, 'Latest Assistant refill'),
      el('p', { class: refill.phase === 'failed' ? 'banner warn' : 'empty' }, refill.message),
      el('p', { class: 'empty' }, 'Page-local status. Saved Assistant chat is retained; no automatic resend after failure.'),
      refill.reply ? el('button', { class: 'act', onclick: () => {
        paste.value = refill.reply;
        paste.focus();
      } }, 'Use saved reply for review') : null,
      refill.phase === 'failed' ? el('button', { class: 'act', onclick: () => {
        if (state.assistantBusy || state.archivistBusy) return;
        if (!confirm('Review the saved Assistant chat for a late reply first. Allow a new refill request on this page? This does not resend the old request or apply its reply.')) return;
        state.deckRefill = null;
        render();
      } }, 'Reviewed prior attempt; allow new refill') : null,
    ));

    out.push(
      el(
        'section',
        {},
        el(
          'h2',
          {},
          'Get cards from the Assistant',
          el('span', { class: 'meta' }, `wants ${replenishTarget(deck)}`),
        ),
        el(
          'p',
          { class: 'empty' },
          'Copy the prompt, paste it into the Assistant tab, then bring its reply back here. ' +
            'The Assistant runs on its own context and does not cost you roleplay tokens.',
        ),
        el(
          'div',
          { class: 'row' },
          el(
            'button',
            {
              class: 'act shrink',
              onclick: () => requestDeckRefill(),
            },
            'Ask the Assistant',
          ),
          el(
            'button',
            {
              class: 'act shrink',
              onclick: async () => {
                const prompt = renderReplenishPrompt(deck, {
                  knownNames, establishedActors, genreProfile, dynamicsProfile,
                });
                await navigator.clipboard.writeText(prompt);
                state.banner = { kind: 'info', text: 'Prompt copied — paste it into the Assistant tab.' };
                render();
              },
            },
            'Copy prompt',
          ),
        ),
        (() => {
          const p = probeAssistant();
          return p.ready
            ? null
            : el(
                'div',
                { class: 'banner warn' },
                'The Assistant panel is not reachable right now — use Copy prompt and paste manually.',
              );
        })(),
        paste,
        el(
          'div',
          { class: 'row', style: 'margin-top:6px' },
          el(
            'button',
            {
              class: 'act shrink',
              onclick: async () => {
                const found = parseProposedCards(root.getElementById('deck-paste').value);
                if (!found.length) {
                  state.banner = {
                    kind: 'warn',
                    text: 'No cards found. Each line should start with "CARD: ".',
                  };
                  render();
                  return;
                }
                const epoch = state.epoch;
                const saved = await commitDeck(
                  (ws) => {
                    const res = proposeCards(ws.deck, found, { turn: ws.current_turn });
                    state.lastProposal = res;
                  },
                  {
                    note:
                      deck.mode === 'assisted_auto'
                        ? `${found.length} cards added.`
                        : `${found.length} cards queued for review.`,
                  },
                );
                if (isCurrent(epoch) && saved?.ok) {
                  state.deckRefill = null;
                  render();
                }
              },
            },
            'Add from reply',
          ),
        ),
      ),
    );
  }

  const input = el('input', { type: 'text', id: 'deck-new', placeholder: 'Add a card…' });
  const add = () => {
    const text = root.getElementById('deck-new').value.trim();
    if (!text) return;
    commitDeck((ws) => addDeckCards(ws.deck, text, { turn: ws.current_turn }));
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && add());

  out.push(
    el(
      'section',
      {},
      el(
        'h2',
        {},
        'Cards',
        el(
          'span',
          { class: 'meta' },
          `${deck.cards.length} / ${deck.max_cards} · ${anchors} / ${deck.max_anchors} anchored` +
            (needsReplenish(deck) ? ' · running low' : ''),
        ),
      ),
      el('p', { class: 'empty' },
        'Anchor keeps a card from being replaced when new cards fill the deck. It does not force a draw ' +
        'or make the event mandatory. An anchored card is still consumed when drawn.'),
      el('div', { class: 'row' }, input, el('button', { class: 'act shrink', onclick: add }, 'Add')),
      ...(deck.cards.length
        ? deck.cards.map((card) =>
            el(
              'div',
              { class: 'card' },
              el(
                'div',
                { class: 'title' },
                el('span', {}, card.text),
                card.anchored ? el('span', { class: 'pill pinned' }, 'anchored') : null,
              ),
              el(
                'div',
                { class: 'actions' },
                el(
                  'button',
                  {
                    class: 'act',
                    title: 'Protect from replacement, not from being drawn and consumed. Does not force the event.',
                    onclick: () => {
                      try {
                        commitDeck((ws) => setDeckAnchored(ws.deck, card.text, !card.anchored));
                      } catch (e) {
                        state.banner = { kind: 'warn', text: e.message };
                        render();
                      }
                    },
                  },
                  card.anchored ? 'Unanchor' : 'Anchor',
                ),
                el(
                  'button',
                  { class: 'act danger', onclick: () => commitDeck((ws) => removeDeckCard(ws.deck, card.text)) },
                  'Remove',
                ),
              ),
            ),
          )
        : [el('p', { class: 'empty' }, 'No cards yet.')]),
    ),
  );

  return out;
}

function maybeReplenishDeck() {
  if (editionWorkspaceIssue(state.ws) || state.ws?.ordinary_pending) return;
  const deck = state.ws?.deck;
  // archivistBusy is the other half of the same interlock as in
  // maybeScheduledArchivist: both of these talk to the one Assistant chat.
  if (!deck || !deckAssisted(deck) || !needsReplenish(deck) || state.assistantBusy) return;
  if (state.archivistBusy) return;
  if (!probeAssistant().ready) return;

  return requestDeckRefill();
}

async function requestDeckRefill() {
  if (editionWorkspaceIssue(state.ws) || !state.ws || state.ws.ordinary_pending
    || state.assistantBusy || state.archivistBusy || !deckAssisted(state.ws.deck)) return;
  // A failed request may still have a late host reply. Do not quietly request
  // another batch next turn; retain the reply/reason until explicit review.
  if (state.deckRefill?.phase === 'failed') return;
  const deck = state.ws.deck;
  state.assistantBusy = true;
  const epoch = state.epoch;
  const mode = deck.mode;
  const receipt = { phase: 'waiting', reply: null,
    message: 'Waiting for Assistant cards; thinking and streaming may take several minutes.' };
  state.deckRefill = receipt;
  render();
  const { knownNames, establishedActors, genreProfile, dynamicsProfile } = freeDeckContext(state.ws);
  try {
    const reply = await askAssistant(renderReplenishPrompt(deck, {
      knownNames, establishedActors, genreProfile, dynamicsProfile,
    }));
    if (!isCurrent(epoch)) return;
    receipt.reply = reply;
    const found = parseProposedCards(reply);
    if (!found.length) throw new Error('Assistant replied, but no usable cards were found. Review its saved reply.');
    let proposal;
    const saved = await commitDeck(ws => {
      if (ws.deck.mode !== mode) throw new Error('Deck mode changed while waiting. Review the saved reply before adding cards.');
      proposal = proposeCards(ws.deck, found, { turn: ws.current_turn });
    });
    if (!isCurrent(epoch)) return;
    if (!saved?.ok) throw saved?.error ?? new Error('The refill was not confirmed saved. Review the current deck and saved reply.');
    receipt.phase = 'applied';
    receipt.reply = null;
    receipt.message = `${proposal.accepted.length} cards added; ${proposal.queued.length} queued for review.`;
  } catch (error) {
    if (!isCurrent(epoch)) return;
    receipt.phase = 'failed';
    receipt.message = `Refill not completed: ${error.message}. No automatic resend. ${receipt.reply ? 'Reply retained on this page for review.' : 'Inspect Assistant chat for a late reply.'}`;
  } finally {
    if (isCurrent(epoch)) {
      state.assistantBusy = false;
      render();
      scheduleArchivistRecheck();
    }
  }
}

function continuityToolsSection() {
  const epoch = state.epoch, route = document.location.pathname;
  if (state.continuityToolsDraft?.epoch !== epoch) state.continuityToolsDraft = { epoch };
  const guard = ws => {
    if (!isCurrent(epoch) || document.location.pathname !== route || workspaceIdFromLocation() !== ws.workspace_id) throw new Error('Session changed. Reopen this review.');
    if (state.injectionPruneBusy || state.archivistBusy || state.assistantBusy) throw new Error('Wait for the current maintenance operation to finish.');
    assertContinuityIdle(ws);
  };
  return continuityTools({ el, ws: state.ws, draft: state.continuityToolsDraft, readAuthored: readAuthoredEntities, render,
    mutate: fn => commit(ws => { guard(ws); fn(ws); reconcileCardAuthority(ws, definedEntityGroups(ws)); }, { requireLock: true }),
    notify: text => { state.banner = { kind: 'info', text }; render(); },
    copy: text => navigator.clipboard.writeText(text),
    download: (filename, text) => {
      guard(state.ws);
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const anchor = el('a', { href: url, download: filename }); anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  });
}
// Public-build controller pieces; shared continuity functions are extracted separately.
function definedEntityGroups() { return readAuthoredEntities(); }
function mechanicalBasis(ws) {
  const { revision, updated_at, writer_tab_id, injections, mechanical_turns, delivery_metrics,
    delivery_reconciliations, last_ordinary_reconciliation, last_ordinary_delivery, last_archivist_attempt_turn,
    last_archivist_attempt_result, last_archivist_failure_reason, ...governed } = ws;
  return canonicalSha256(governed).hash;
}
function planInjection(userText = '', ws) {
  assertEditionWorkspace(ws);
  if (!ws || !state.store || workspaceIdFromLocation() !== ws.workspace_id || !authoritativeInjectionAllowed(ws)) return null;
  ws.current_turn++;
  if (!hasCurrentHistoryClearance()) {
    state.banner = { kind: 'warn', text: 'History clearance is missing. No new memory context was injected. Check Schedules or the new-session confirmation.' };
    return null;
  }
  const selection = stageForNextTurn(ws, { recentText: [userText, ...recentModelTurns(12)].join('\n') });
  const deckBefore = structuredClone(ws.deck);
  const drawn = deckEnabled(ws.deck) ? drawCard(ws.deck) : null;
  const diagnostics = {};
  const injection = buildInjection(ws, { staged: selection.staged, diagnostics });
  // A budget-excluded prompt was never handed off. Keep it available to draw.
  if (drawn && !injection?.parts.includes('deck')) ws.deck = deckBefore;
  if (injection) Object.assign(injection, { turn: ws.current_turn, workspace_revision: ws.revision,
    staged: selection.staged, why: selection.why, considered: selection.considered, matched: selection.matched });
  state.debugAttempt = { at: new Date().toISOString(), turn: ws.current_turn,
    workspaceId: ws.workspace_id, status: diagnostics.status, budget: diagnostics, nonce: injection?.nonce ?? null };
  if (!injection && diagnostics.status === 'budget_exceeded') {
    state.banner = { kind: 'warn', text: `Memory requires ${diagnostics.requiredTokens} estimated tokens; ${diagnostics.enforcedLimit} allowed. No partial sentence was sent.` };
  }
  return injection;
}
function onUserTurn(userText, ws) {
  assertEditionWorkspace(ws); assertEditionCommand(userText);
  if (!ws || !state.store || workspaceIdFromLocation() !== ws.workspace_id || !authoritativeInjectionAllowed(ws)) return;
  if (Object.values(ws.unconfirmed).some(list => list.length)) considerUserTurn(ws, {
    userTurnText: userText, recentModelTurns: recentModelTurns(ws.settings.origination_compare_window),
  });
}
function freeDeckContext(ws) {
  const context = campaignDeckContext(ws);
  const groups = readAuthoredEntities();
  const personas = new Set((groups.persona ?? []).map(entry => entry.name.toLowerCase()));
  const names = new Set(context.knownNames);
  for (const kind of ['npc', 'location', 'object']) {
    for (const entry of groups[kind] ?? []) names.add(entry.name);
  }
  const actors = new Set(context.establishedActors.filter(row => !personas.has(row.split(':')[0].toLowerCase())));
  for (const entry of groups.npc ?? []) if (!personas.has(entry.name.toLowerCase())) actors.add(entry.name);
  return { ...context, knownNames: [...names], establishedActors: [...actors] };
}
function commitDeck(mutator, options) {
  return commit(ws => {
    if (ws.ordinary_pending) throw new Error('Reconcile the pending turn before changing its deck. Nothing changed.');
    mutator(ws);
  }, options);
}
async function verifyFreeOrdinaryReadback() {
  if (!state.ws || editionWorkspaceIssue(state.ws) || !state.persistenceQueue
      || state.ws.timeline_integrity?.desynchronized) return;
  const pending = state.ws.ordinary_pending;
  if (pending?.nonce === null) return verifyFreePlainOrdinaryReadback();
  const records = (state.ws.injections ?? []).filter(r => r.ordinary_action_id === pending?.id && pending?.nonce === r.nonce);
  if (!pending || records.length !== 1) return;
  const record = records[0], epoch = state.epoch, workspaceId = state.ws.workspace_id;
  if (workspaceIdFromLocation() !== workspaceId || !record.request_id || !record.interaction_id
      || !record.native_submission || record.unexpected_request_id || record.pruned
      || record.pending_outcomes_acknowledged_at || record.pending_texts?.length) return;
  // Capture primitives: the pending object and ledger may mutate while the
  // worker request is in flight, even without changing the outer action ID.
  const binding = { id: pending.id, nonce: record.nonce, requestId: record.request_id, interactionId: record.interaction_id };
  const matchesBinding = ws => {
    if (ws?.ordinary_pending?.id !== binding.id || ws.ordinary_pending.nonce !== binding.nonce) return false;
    const rows = (ws.injections ?? []).filter(r => r.nonce === binding.nonce);
    return rows.length === 1 && rows[0].ordinary_action_id === binding.id
      && rows[0].request_id === binding.requestId && rows[0].interaction_id === binding.interactionId;
  };
  const key = `${epoch}:${binding.id}:${binding.nonce}:${binding.requestId}`;
  if (state.freeReadback?.key !== key) state.freeReadback = { key, attempts: 0, busy: false, nextAt: 0 };
  const attempt = state.freeReadback;
  if (attempt.busy || attempt.attempts >= 6 || Date.now() < attempt.nextAt) return;
  attempt.busy = true; attempt.attempts++; attempt.nextAt = Date.now() + 5000;
  const current = () => isCurrent(epoch) && state.freeReadback === attempt
    && workspaceIdFromLocation() === workspaceId && matchesBinding(state.ws);
  try {
    const reply = await chrome.runtime.sendMessage({ type: SESSION_READBACK, workspaceId, interactionId: binding.interactionId });
    if (!current()) return;
    if (!reply?.ok || reply.value?.source !== 'extension_authenticated_session_get_v1') {
      attempt.status = 'readback_unavailable'; return;
    }
    const parsed = stripInjections(reply.value.raw_text);
    if (parsed.status === 'ambiguous' || parsed.nonces.length !== 1) { attempt.status = 'carrier_mismatch'; return; }
    const witness = { ...reply.value, kind: 'HOST_INTERACTION_READBACK', nonce: parsed.nonces[0] };
    let changed = false;
    const saved = await state.persistenceQueue.enqueue(ws => {
      changed = false;
      if (!current() || ws.workspace_id !== workspaceId || !matchesBinding(ws)
          || ws.timeline_integrity?.desynchronized || editionWorkspaceIssue(ws)) return ws;
      const live = ws.injections?.find(r => r.nonce === binding.nonce);
      if (!live || live.pending_texts?.length || live.unexpected_request_id) return ws;
      const result = markInjectionObserved(ws, binding.nonce, Date.now(), witness);
      attempt.status = result.status; changed = result.changed;
      if (changed) live.completion_evidence.source = witness.source;
      return ws;
    });
    // The shared adoption helper copies metadata only; it deliberately does
    // not overwrite local work. Adopt just this durable lifecycle transition
    // while the exact pending action is still current, not the whole workspace.
    let adopted = false;
    const durable = saved.injections?.find(r => r.nonce === binding.nonce);
    if (current() && (state.ws.revision ?? 0) <= saved.revision && !saved.ordinary_pending
        && durable?.ordinary_action_id === binding.id && durable.request_id === binding.requestId
        && durable.pending_outcomes_acknowledged_at && durable.completion_evidence?.source === witness.source) {
      const local = state.ws.injections?.find(r => r.nonce === binding.nonce);
      if (local?.ordinary_action_id === binding.id && local.request_id === binding.requestId) {
        for (const field of ['observed_in_host_history_at', 'dispatch_status', 'lifecycle_status',
          'completion_evidence', 'pending_outcomes_acknowledged_at']) {
          local[field] = structuredClone(durable[field]);
        }
        delete state.ws.ordinary_pending;
        adopted = true;
      }
    }
    adoptQueuedWrite(saved, epoch);
    if (!isCurrent(epoch) || workspaceIdFromLocation() !== workspaceId) return;
    if (adopted) {
      state.banner = { kind: 'info', text: 'Exact saved interaction verified against DreamGen session data. No resend or reroll. This does not prove model consumption.' };
      scheduleRecurringInjectionPrune(epoch, 0, true);
      setTimeout(maybeReplenishDeck, 2000);
    }
    render();
  } catch (error) {
    if (current()) attempt.status = 'readback_unavailable';
  } finally {
    attempt.busy = false;
    if (current()) scheduleArchivistRecheck();
    if (current() && attempt.attempts < 6) setTimeout(() => {
      if (current()) void verifyFreeOrdinaryReadback();
    }, 5000);
  }
}
async function verifyFreePlainOrdinaryReadback() {
  if (!state.ws || editionWorkspaceIssue(state.ws) || !state.persistenceQueue) return;
  const binding = plainOrdinaryBinding(state.ws), epoch = state.epoch;
  if (!binding || workspaceIdFromLocation() !== binding.workspaceId) return;
  const key = `${epoch}:plain:${binding.pendingHash}`;
  if (state.freeReadback?.key !== key) state.freeReadback = { key, attempts: 0, busy: false, nextAt: 0 };
  const attempt = state.freeReadback;
  if (attempt.busy || attempt.attempts >= 6 || Date.now() < attempt.nextAt) return;
  attempt.busy = true; attempt.attempts++; attempt.nextAt = Date.now() + 5000;
  const current = () => isCurrent(epoch) && state.freeReadback === attempt
    && workspaceIdFromLocation() === binding.workspaceId && matchesPlainOrdinaryBinding(state.ws, binding);
  try {
    const reply = await chrome.runtime.sendMessage({ type: SESSION_READBACK,
      workspaceId: binding.workspaceId, interactionId: binding.interactionId });
    if (!current()) return;
    if (!reply?.ok) { attempt.status = 'readback_unavailable'; return; }
    const saved = await state.persistenceQueue.enqueue(ws => {
      if (current() && !editionWorkspaceIssue(ws)) {
        attempt.status = completePlainOrdinaryReadback(ws, binding, reply.value)
          ? 'exact_action_observed' : 'readback_mismatch';
      }
      return ws;
    });
    let adopted = false;
    const receipt = saved.last_ordinary_delivery;
    if (current() && (state.ws.revision ?? 0) <= saved.revision && !saved.ordinary_pending
        && receipt?.pendingHash === binding.pendingHash && receipt.id === binding.id
        && receipt.requestId === binding.requestId && receipt.interactionId === binding.interactionId
        && receipt.source === 'extension_authenticated_session_get_v1') {
      state.ws.last_ordinary_delivery = structuredClone(receipt);
      delete state.ws.ordinary_pending;
      adopted = true;
    }
    adoptQueuedWrite(saved, epoch);
    if (!isCurrent(epoch) || workspaceIdFromLocation() !== binding.workspaceId) return;
    if (adopted) state.banner = { kind: 'info', text: 'Exact saved plain-text interaction verified. No resend. History clearance is unchanged; model consumption is not verified.' };
    render();
  } catch (error) {
    if (current()) attempt.status = 'readback_unavailable';
  } finally {
    attempt.busy = false;
    if (current()) scheduleArchivistRecheck();
    if (current() && attempt.attempts < 6) setTimeout(() => {
      if (current()) void verifyFreePlainOrdinaryReadback();
    }, 5000);
  }
}
function header() {
  return el('header', {}, el('h1', {}, 'Continuity'),
    state.ws ? el('span', { class: 'rev' }, `rev ${state.ws.revision}`) : null,
    el('button', { class: 'act shrink', onclick: toggle }, 'Close'));
}
function previewTab(name) {
  const descriptions = {
    Campaign: 'Build reusable campaigns with character sheets, skill checks, combat and advancement.',
    RNG: 'Use configurable randomness and rule-driven outcomes alongside your story.',
  };
  return [el('section', {}, el('h2', {}, `${name} — In development`),
    el('p', {}, descriptions[name]),
    el('p', { class: 'empty' }, 'A preview of planned work, not an active tool. No release date is promised. The implementation is not included in this public build.'))];
}
function body() {
  const main = el('main');
  if (state.banner) main.append(el('div', { class: `banner ${state.banner.kind}` }, state.banner.text,
    el('button', { class: 'act shrink', onclick: () => { state.banner = null; render(); } }, 'Dismiss')));
  if (!state.ws) { main.append(el('p', {}, 'Open a supported DreamGen role-play session.')); return main; }
  if (editionWorkspaceIssue(state.ws)) {
    main.append(el('p', { class: 'banner warn' }, editionWorkspaceIssue(state.ws)),
      el('button', { class: 'act', onclick: copyBackup }, 'Copy workspace export'));
    return main;
  }
  if (!TABS.includes(state.tab)) state.tab = 'Memory';
  const pending = state.ws.ordinary_pending;
  if (pending) main.append(el('section', { class: 'banner warn' },
    el('h2', {}, 'Delivery needs reconciliation'),
    el('p', {}, 'Do not resend. Inspect the saved interaction, including its hidden context. Visible story text alone is not delivery proof.'),
    savedTurnAttestationButton('ordinary', pending.id)));
  const legacy = (state.legacyRecoveryNonces ?? []).filter(nonce => !(state.ws.injections ?? []).some(r => r.nonce === nonce && r.ordinary_action_id));
  if (legacy.length) main.append(legacyCarrierRecoverySection(legacy));
  for (const nonce of (state.legacyRecoveryNonces ?? []).filter(n => !legacy.includes(n))) main.append(modernCarrierRecoverySection(nonce));
  if (state.ws.current_turn === 0 && !state.ws.ordinary_pending && !(state.ws.injections?.length)) {
    main.append(loadedInteractionRoots(document).length ? openingSessionSection() : emptySessionSection());
  }
  const view = { Memory: memoryTab, People: () => cardsTab('npc'), Places: () => cardsTab('location'),
    Events: () => cardsTab('event'), Objects: () => cardsTab('object'), Resolve: resolveTab, Campaign: () => previewTab('Campaign'),
    Deck: deckTab, RNG: () => previewTab('RNG'), Schedules: schedulesTab,
    Log: logTab, Debug: debugTab, Data: dataTab }[state.tab];
  main.append(...view().filter(Boolean));
  if (state.tab === 'Data') main.append(continuityToolsSection());
  main.append(el('p', { class: 'disclosure' }, 'Memory is local to this extension and browser profile. Export it regularly. DGCE is not a DreamGen transcript backup. Cleanup removes only recorded extension-owned context, never story prose. Request evidence and your attestations do not prove model consumption.'));
  return main;
}
async function refreshFreeHistoryContinuity() {
  const ws = state.ws, epoch = state.epoch, workspaceId = ws?.workspace_id;
  const eligible = () => isCurrent(epoch) && state.ws === ws
    && workspaceIdFromLocation() === workspaceId && !editionWorkspaceIssue(ws)
    && !ws.timeline_integrity?.desynchronized && !state.injectionPruneBusy
    && ['clean', 'history_unverified'].includes(state.carrierHygieneStatus)
    && !(ws.injections ?? []).some(record => !record.pruned);
  if (!ws || !eligible()) return false;
  if (state.freeHistoryRefresh?.epoch === epoch) return state.freeHistoryRefresh.promise;
  const attempt = { epoch };
  state.freeHistoryRefresh = attempt;
  attempt.promise = (async () => {
    try {
      const complete = await settleHistoryContinuity(document);
      if (!eligible() || state.freeHistoryRefresh !== attempt) return false;
      const carriers = discoverOwnedInjectionCarriers(document);
      const clean = complete && hasHistoryCompletenessWitness(document) && carriers.length === 0;
      const status = clean ? 'clean' : 'history_unverified';
      const count = loadedInteractionRoots(document).length;
      const scope = historyContinuityScope(document);
      const reason = clean
        ? `${scope.startsWith('user_attested_') ? 'User-attested origin (not automatic completeness proof)' : 'Previously witnessed history'}; mounted continuity checked: ${count} interactions, no context carriers.`
        : 'Current history continuity is unverified. No new DGCE context will be injected until a supported history check succeeds.';
      if (state.carrierHygieneStatus !== status || state.carrierHygieneReason !== reason) {
        state.carrierHygieneStatus = status;
        state.carrierHygieneReason = reason;
        state.carrierHygieneVerifiedAt = clean ? new Date().toISOString() : null;
        render();
      }
      if (!clean) scheduleFreeHistoryRecovery();
      return clean;
    } catch {
      if (eligible()) {
        state.carrierHygieneStatus = 'history_unverified';
        state.carrierHygieneVerifiedAt = null;
        state.carrierHygieneReason = 'History continuity check failed. No new context clearance granted.';
        render();
      }
      return false;
    } finally {
      if (state.freeHistoryRefresh === attempt) state.freeHistoryRefresh = null;
    }
  })();
  return attempt.promise;
}
function scheduleFreeHistoryRecovery() {
  const ws = state.ws, epoch = state.epoch;
  if (!ws || workspaceIdFromLocation() !== ws.workspace_id || editionWorkspaceIssue(ws)
      || ws.timeline_integrity?.desynchronized || ws.ordinary_pending || state.freeReadback?.busy
      || state.injectionPruneBusy || state.archivistBusy || state.assistantBusy || state.dirty?.size
      || state.carrierHygieneStatus !== 'history_unverified'
      || (ws.injections ?? []).some(record => !record.pruned)
      || !roleplayEditorIdle(document, { lastUserInputAt: state.lastUserInputAt })) return;
  const control = historyLoadControl(document);
  if (!control) return;
  const previous = state.freeHistoryRecovery;
  // One attempt per settled turn/control, not an observer-driven retry loop.
  if (previous?.epoch === epoch && previous.workspaceId === ws.workspace_id
      && previous.turn === ws.current_turn && previous.control === control) return;
  state.freeHistoryRecovery = { epoch, workspaceId: ws.workspace_id, turn: ws.current_turn, control };
  scheduleRecurringInjectionPrune(epoch, 0, true);
}
function debugTab() {
  return [el('section', {}, el('h2', {}, 'Continuity diagnostics'),
    el('p', {}, `Build ${document.getElementById('dgce-root')?.dataset.dgceBuild ?? 'unknown'} · turn ${state.ws.current_turn}`),
    el('p', {}, `History: ${carrierHygieneSummary()}. ${state.carrierHygieneReason}`),
    el('p', {}, 'Recorded context and request evidence only; no proof of model consumption.'),
    el('pre', {}, JSON.stringify({ latestAttempt: state.debugAttempt, latestCarrier: state.ws.injections?.[0] ?? null,
      savedInteractionReadback: state.freeReadback ?? null,
      latestPlainDelivery: state.ws.last_ordinary_delivery ?? null,
      timeline: state.ws.timeline_integrity, emptySessionAttestation: state.ws.free_empty_session_attestation ?? null,
      openingSessionAttestation: state.ws.free_opening_session_attestation ?? null,
      historyContinuity: historyContinuityDiagnostics(document) }, null, 2)))];
}
async function copyBackup() {
  await navigator.clipboard.writeText(exportToJSON(state.ws));
  state.banner = { kind: 'info', text: 'Extension backup copied. It does not include the DreamGen transcript.' }; render();
}
function dataTab() {
  const input = el('textarea', { id: 'import-json', rows: 8, placeholder: 'Paste a DGCE continuity backup…' });
  input.value = state.freeImportDraft && state.freeImportDraft.epoch === state.epoch ? state.freeImportDraft.text : '';
  input.oninput = () => { state.freeImportDraft = { epoch: state.epoch, text: input.value }; };
  const inspect = () => {
    try { const result = inspectImport(input.value); state.banner = { kind: 'info', text: `${result.display_name || result.workspace_id}: ${result.counts.cards} cards. Import has not run.` }; }
    catch (error) { state.banner = { kind: 'bad', text: error.message }; }
    input.oninput(); render();
  };
  const loadFile = el('input', { type: 'file', accept: '.json,application/json', 'aria-label': 'Load continuity backup JSON', onchange: async event => {
    const file = event.target.files?.[0], epoch = state.epoch;
    if (!file) return;
    try {
      const value = await file.text();
      if (!isCurrent(epoch) || root.getElementById('import-json') !== input) return;
      inspectImport(value); input.value = value; inspect();
    } catch (error) { if (isCurrent(epoch)) { state.banner = { kind: 'bad', text: error.message }; render(); } }
  } });
  return [el('section', {}, el('h2', {}, 'Backup and restore'),
    el('p', { class: 'banner warn' }, 'Stored only in this extension on this browser profile. Uninstalling or clearing extension data can erase it. Export regularly; DreamGen does not back up this memory.'),
    el('button', { class: 'act', onclick: copyBackup }, 'Copy export JSON'),
    el('button', { class: 'act', onclick: () => {
      const blob = new Blob([exportToJSON(state.ws)], { type: 'application/json' });
      const url = URL.createObjectURL(blob), anchor = el('a', { href: url, download: 'dgce-backup.json' });
      anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } }, 'Download backup'),
    el('h3', {}, 'Restore continuity memory'), loadFile, input,
    el('button', { class: 'act', onclick: inspect }, 'Inspect backup'),
    ...['merge', 'replace'].map(mode => el('button', { class: 'act', onclick: () => restoreContinuityBackup(input.value, mode) }, mode === 'merge' ? 'Import (add only)' : 'Import (replace)')),
    el('p', {}, 'Campaign clean-start files and other in-development data that are not included in this public build cannot be imported here. Nothing is silently stripped.'))];
}
let restoreBusy = false;
async function restoreContinuityBackup(json, mode) {
  if (restoreBusy) return;
  restoreBusy = true;
  const epoch = state.epoch, route = document.location.pathname;
  state.freeImportDraft = { epoch, text: json };
  const eligible = ws => {
    assertEditionWorkspace(ws);
    if (!isCurrent(epoch) || document.location.pathname !== route) throw new Error('Session changed. Nothing imported.');
    if (ws.ordinary_pending || (ws.injections ?? []).some(r => !r.pruned)
        || state.archivistBusy || state.injectionPruneBusy) throw new Error('Finish delivery recovery and context cleanup before importing.');
  };
  try {
    await state.persistenceQueue?.whenIdle();
    if (!isCurrent(epoch)) return;
    eligible(state.ws);
    inspectImport(json);
    const fence = captureWorkspaceFence(state.ws, state.mutationGeneration);
    if (!confirm(mode === 'replace' ? 'Replace local continuity memory? Export it first. This does not change DreamGen history.' : 'Add missing cards from this backup, preserving existing cards?')) return;
    if (!workspaceFenceMatches(fence, state.ws, state.mutationGeneration)) throw new Error('Workspace changed during confirmation. Nothing imported.');
    eligible(state.ws);
    const result = await commit(ws => {
      eligible(state.ws);
      eligible(ws);
      Object.assign(ws, importWorkspace(ws, json, { mode }).workspace);
    }, { requireLock: true, note: 'Continuity backup imported. History clearance must be checked independently.' });
    if (!result.ok || !isCurrent(epoch) || document.location.pathname !== route) return;
    invalidateHistoryContinuity(document); state.carrierHygieneStatus = 'unchecked';
    scheduleRecurringInjectionPrune(epoch, 0, true);
  } catch (error) { if (isCurrent(epoch)) state.banner = { kind: 'bad', text: error.message }; }
  finally { restoreBusy = false; if (isCurrent(epoch)) render(); }
}
let emptySessionBusy = false;
function openingSessionSection() {
  const audit = state.ws.free_opening_session_attestation;
  if (audit?.kind === 'user_attested_scenario_opening' && audit.route === document.location.pathname
      && hasHistoryCompletenessWitness(document)) {
    return el('section', { class: 'card', role: 'status' }, el('h3', {}, 'Scenario opening confirmed for this page'),
      el('p', {}, 'Your testimony is recorded, not automatic completeness proof. No need to confirm again on this page. Reloading ends this clearance.'));
  }
  return el('section', { class: 'card' }, el('h3', {}, 'New session with a scenario opening?'),
    el('p', {}, 'Confirm only if you created this session and its only interactions are the preloaded scenario opening. Do not use for an existing, played, edited, or imported transcript. This is your testimony, not automatic history proof; clearance ends on reload.'),
    el('button', { class: 'act', disabled: emptySessionBusy, onclick: event => {
      if (event.isTrusted) confirmOpeningSession();
    } }, 'Confirm only scenario opening'));
}
async function confirmOpeningSession() {
  if (emptySessionBusy) return;
  emptySessionBusy = true;
  const epoch = state.epoch, route = document.location.pathname;
  let snapshot;
  const eligible = ws => {
    assertEditionWorkspace(ws);
    if (!isCurrent(epoch) || document.location.pathname !== route
        || !ws || ws.current_turn !== 0 || ws.ordinary_pending || ws.injections?.length
        || ws.timeline_integrity?.desynchronized || state.archivistBusy || state.injectionPruneBusy
        || !roleplayEditorIdle(document) || !openingSessionHistoryMatches(document, snapshot)) {
      throw new Error('Session or opening changed, or recovery is pending. No history clearance granted.');
    }
  };
  try {
    await state.persistenceQueue?.whenIdle();
    if (!isCurrent(epoch)) return;
    snapshot = captureOpeningSessionHistory(document, route);
    eligible(state.ws);
    const fence = captureWorkspaceFence(state.ws, state.mutationGeneration);
    if (!confirm(`I created this new session. These ${snapshot.roots.length} interactions are its entire preloaded scenario opening; I have not played, edited, or imported transcript history here. DGCE cannot independently prove this. Record my testimony for this page only? No history will be changed.`)) return;
    if (!workspaceFenceMatches(fence, state.ws, state.mutationGeneration)) throw new Error('Workspace changed during confirmation. Nothing cleared.');
    eligible(state.ws);
    const result = await commit(ws => {
      eligible(state.ws); eligible(ws);
      ws.free_opening_session_attestation = { kind: 'user_attested_scenario_opening', route,
        count: snapshot.roots.length, snapshotHash: canonicalSha256(snapshot.texts).hash,
        at: new Date().toISOString() };
    }, { requireLock: true });
    if (!result.ok || !isCurrent(epoch) || document.location.pathname !== route) return;
    eligible(state.ws);
    if (!attestOpeningSessionHistory(document, snapshot)) throw new Error('Host changed after recording testimony. No clearance granted.');
    state.banner = { kind: 'info', text: 'Scenario-opening testimony recorded, not automatic history proof. No story changed. You may begin normally; reloading ends this page-local clearance.' };
    scheduleRecurringInjectionPrune(epoch, 0, true);
  } catch (error) { if (isCurrent(epoch)) state.banner = { kind: 'warn', text: error.message }; }
  finally { emptySessionBusy = false; if (isCurrent(epoch)) render(); }
}
function emptySessionSection() {
  const attestation = state.ws.free_empty_session_attestation;
  if (attestation?.kind === 'user_attested_empty_session'
      && attestation.route === document.location.pathname
      && hasHistoryCompletenessWitness(document)) {
    return el('section', { class: 'card', role: 'status' },
      el('h3', {}, 'Empty session confirmed for this page'),
      el('p', {}, 'Your attestation is recorded. No need to confirm again. This is your testimony, not automatic history proof; reloading ends this page-local clearance.'));
  }
  return el('section', { class: 'card' }, el('h3', {}, 'Starting a genuinely new session?'),
    el('p', {}, 'Use this only if you created this DreamGen session and it has never contained interactions. It is your testimony, not automatic history proof; clearance lasts only while this page remains loaded.'),
    el('button', { class: 'act', disabled: emptySessionBusy, onclick: event => { if (event.isTrusted) confirmEmptySession(); } }, 'Confirm my new empty session'));
}
async function confirmEmptySession() {
  if (emptySessionBusy) return;
  emptySessionBusy = true;
  const epoch = state.epoch, route = document.location.pathname;
  const eligible = ws => {
    assertEditionWorkspace(ws);
    if (!isCurrent(epoch) || document.location.pathname !== route
        || !ws || ws.current_turn !== 0 || ws.ordinary_pending || ws.injections?.length
        || ws.timeline_integrity?.desynchronized || state.archivistBusy || state.injectionPruneBusy
        || !roleplayEditorIdle(document) || !canAttestEmptySessionHistory(document, route)) throw new Error('The session is not eligible for new-empty-session confirmation. Nothing cleared.');
  };
  try {
    await state.persistenceQueue?.whenIdle();
    if (!isCurrent(epoch)) return;
    eligible(state.ws);
    const fence = captureWorkspaceFence(state.ws, state.mutationGeneration);
    if (!confirm('I created this new DreamGen session and it has never contained interactions. DGCE cannot independently prove that. Record my attestation for this page lifetime only? No history will be deleted.')) return;
    if (!isCurrent(epoch) || !workspaceFenceMatches(fence, state.ws, state.mutationGeneration)) throw new Error('Workspace changed during confirmation. Nothing cleared.');
    eligible(state.ws);
    const result = await commit(ws => {
      eligible(state.ws);
      eligible(ws);
      ws.free_empty_session_attestation = { kind: 'user_attested_empty_session', route, at: new Date().toISOString() };
    }, { requireLock: true });
    if (!result.ok || !isCurrent(epoch) || document.location.pathname !== route) return;
    if (!attestEmptySessionHistory(document, route)) throw new Error('Host changed after recording the attestation; history clearance was not granted.');
    state.banner = { kind: 'info', text: 'Your empty-session attestation was recorded—not automatic history proof. You may begin normally. Reloading loses this page-local clearance.' };
    scheduleRecurringInjectionPrune(epoch, 0, true);
  } catch (error) { if (isCurrent(epoch)) state.banner = { kind: 'warn', text: error.message }; }
  finally { emptySessionBusy = false; if (isCurrent(epoch)) render(); }
}

export { el, workspaceIdFromLocation, kindOfId };
