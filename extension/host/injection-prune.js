// Exact removal of extension-owned context carriers through DreamGen's own
// interaction editor. Complete-history sanitation is mandatory and idle-gated.

import { stripInjections, stripRecordedInjection } from '../core/injection.js';
import { carrierMayHaveExisted, carrierHasRecoveryDependency } from '../core/injection-lifecycle.js';
import { legacyAbsenceAccepted } from '../core/legacy-carrier-recovery.js';
import { modernAbsenceAccepted } from '../core/modern-carrier-recovery.js';
import { loadAllInteractions, inspectHistoryLoad, loadedInteractionRoots, acknowledgeHistoryReadback, beginHistoryReadback, historyInteractionText } from './builder-transcript.js';

const waitFor = async (fn, { attempts = 30, delay = 100 } = {}) => {
  for (let i = 0; i < attempts; i += 1) {
    const value = fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  return null;
};

function interactionForNonce(doc, nonce) {
  const matches = [...doc.querySelectorAll('p,pre,code,span,div')].filter((node) => {
    if (!(node.innerText || node.textContent || '').includes(nonce)) return false;
    return ![...(node.children ?? [])]
      .some((child) => (child.innerText || child.textContent || '').includes(nonce));
  });
  const interactions = new Set();
  for (const match of matches) {
    let node = match;
    while (node && node !== doc.body) {
      if (node.querySelector?.('button[aria-label="Edit Interaction"]')) {
        interactions.add(node);
        break;
      }
      node = node.parentElement;
    }
  }
  return interactions.size === 1 ? [...interactions][0] : null;
}

const interactionText = historyInteractionText;

/** Read-only discovery projection, NOT raw editor text or deletion authority.
 * DreamGen renders a hidden block as a spoiler button and consumes its wrapper.
 * Restore that wrapper only around the observed collapsed-spoiler DOM shape.
 * An unwrapped marker elsewhere must still fail the strict source parser.
 */
export function renderedCarrierText(root) {
  const spoilers = new Set([...(root?.querySelectorAll?.('button[aria-label="Reveal spoiler"]') ?? [])]
    .filter(node => node.closest?.('.prose') && !node.closest?.('pre,code')
      && node.getAttribute('aria-expanded') === 'false'
      && node.childNodes?.length === 1
      && node.children?.length === 1 && node.children[0].tagName === 'SPAN'
      && node.children[0].getAttribute('aria-hidden') === 'true'));
  if (!spoilers.size) return interactionText(root);
  const read = node => {
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType === 8) return '';
    const body = [...(node.childNodes ?? [])].map(read).join('');
    return spoilers.has(node) ? `<hidden>${body}</hidden>` : body;
  };
  return read(root);
}

/**
 * Discover DGCE carriers from host history itself.
 *
 * Discovery is deliberately broad, including legacy markers. It is NOT proof
 * of ownership: only a matching local ledger entry permits automatic removal.
 */
export function discoverOwnedInjectionCarriers(doc = document) {
  const roots = loadedInteractionRoots(doc);
  const byNonce = new Map();
  roots.forEach((interaction, index) => {
    const { nonces } = stripInjections(renderedCarrierText(interaction));
    for (const nonce of nonces) {
      const entries = byNonce.get(nonce) ?? [];
      entries.push({ interaction, interaction_index: index });
      byNonce.set(nonce, entries);
    }
  });
  return [...byNonce.entries()].map(([nonce, entries]) => ({
    nonce,
    interaction: entries.length === 1 ? entries[0].interaction : null,
    interaction_index: entries.length === 1 ? entries[0].interaction_index : null,
    has_following_interaction: entries.length === 1
      && entries[0].interaction_index < roots.length - 1,
    ambiguous: entries.length !== 1,
    candidate_count: entries.length,
  }));
}

/** Load the complete host history before claiming that a carrier is absent. */
export async function inspectOwnedInjectionHistory({ doc = document, waitOptions = undefined } = {}) {
  const history = await inspectHistoryLoad(doc, waitOptions);
  if (!history.supported) return { status: 'load_incomplete', carriers: [], interaction_count: 0, history };
  const carriers = discoverOwnedInjectionCarriers(doc);
  const ambiguousSource = loadedInteractionRoots(doc).some(root =>
    stripInjections(renderedCarrierText(root)).status === 'ambiguous');
  return {
    status: ambiguousSource ? 'manual_review' : carriers.length ? 'dirty' : history.complete ? 'clean' : 'history_unverified',
    source_fidelity: ambiguousSource ? 'ambiguous' : 'structurally_valid',
    history,
    carriers,
    interaction_count: loadedInteractionRoots(doc).length,
  };
}

function setNativeValue(control, value) {
  const win = control.ownerDocument?.defaultView;
  if (control.matches?.('[contenteditable]')) {
    control.focus?.();
    // DreamGen's editor represents line breaks with <br>. textContent drops
    // those on read, and assigning innerText preserves them on the host roundtrip.
    control.innerText = value;
    control.dispatchEvent(new win.InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    return controlText(control) === value;
  }
  const proto = control.tagName === 'TEXTAREA'
    ? win?.HTMLTextAreaElement?.prototype : win?.HTMLInputElement?.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (!setter) return false;
  setter.call(control, value);
  control.dispatchEvent(new win.InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
  control.dispatchEvent(new win.Event('change', { bubbles: true }));
  return control.value === value;
}

function controlText(control) {
  return control?.matches?.('[contenteditable]') ? (control.innerText ?? control.textContent) : control?.value;
}

function visible(node) {
  if (!node || node.hidden) return false;
  const rect = node.getBoundingClientRect?.();
  return !rect || (rect.width > 0 && rect.height > 0);
}

function isEditable(node) {
  return Boolean(node?.matches?.('textarea, input, [contenteditable="true"], [contenteditable=""]'));
}

function labels(button) {
  return [button?.innerText, button?.textContent, button?.getAttribute?.('aria-label')]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);
}

function actionButton(root, pattern) {
  return [...(root?.querySelectorAll?.('button') ?? [])]
    .find((button) => labels(button).some((value) => pattern.test(value)));
}

function editorIn(interaction, doc, nonce = null) {
  const selector = 'textarea, [contenteditable][aria-label="Edit interaction text"]';
  const local = interaction?.querySelector?.(selector);
  if (local && (!nonce || String(controlText(local) ?? '').includes(nonce))) return local;
  const editors = [...doc.querySelectorAll(selector)].filter((editor) => {
    if (!visible(editor)) return false;
    if (nonce && !String(controlText(editor) ?? '').includes(nonce)) return false;
    return true;
  });
  return editors.length === 1 ? editors[0] : null;
}

function restoreFocus(node) {
  if (node?.isConnected !== false && typeof node?.focus === 'function') {
    try { node.focus(); } catch { /* focus restoration is best effort */ }
  }
}

/**
 * Prove the role-play UI is quiet enough for an automatic historical edit.
 * Unknown host shape is busy. `lastUserInputAt` is supplied by the panel's
 * capture-phase activity guard.
 */
export function roleplayEditorIdle(
  doc = document,
  {
    lastUserInputAt = 0,
    now = Date.now(),
    guardWindowMs = 5000,
    allowFocusedEmptyComposer = false,
  } = {},
) {
  if (!doc || now - lastUserInputAt < guardWindowMs) return false;
  const buttons = [...doc.querySelectorAll('button')].filter(visible);
  if (buttons.some((button) => labels(button)
    .some((value) => /stop (generating|generation)|cancel generation|abort generation/i.test(value)))) {
    return false;
  }
  const openEditors = [...doc.querySelectorAll(
    '[aria-label="Edit interaction text"], [data-interaction-editor]',
  )].filter(visible);
  if (openEditors.length) return false;

  const composers = [...doc.querySelectorAll(
    'textarea[aria-label^="Message as "], [contenteditable][aria-label^="Message as "], textarea[placeholder*="message" i]',
  )].filter(visible);
  if (composers.length !== 1 || String(controlText(composers[0]) ?? '').length) return false;

  const active = doc.activeElement;
  if (isEditable(active) && visible(active)
      && !(allowFocusedEmptyComposer && active === composers[0])) return false;

  return buttons.some((button) => labels(button)
    .some((value) => /^continue conversation$/i.test(value)) && !button.disabled);
}

export function injectionPruneCandidate(doc, nonce) {
  if (!doc || !/^dgce-[0-9a-f]{6,}$/i.test(String(nonce ?? ''))) return null;
  const interaction = interactionForNonce(doc, nonce);
  if (!interaction) return null;
  const edit = interaction.querySelector('button[aria-label="Edit Interaction"]');
  return edit ? { interaction, edit } : null;
}

async function closeWithoutSaving(area, interaction) {
  const root = area?.closest?.('.group') ?? area?.parentElement?.parentElement ?? interaction;
  const cancel = actionButton(root, /cancel|close|discard/i)
    ?? actionButton(interaction, /cancel|close|discard/i);
  if (!cancel) return false;
  cancel.click();
  return true;
}

async function rollback(area, interaction, original) {
  if (!area) return false;
  if (controlText(area) !== original && !setNativeValue(area, original)) return false;
  return closeWithoutSaving(area, interaction);
}

export async function pruneOwnedInjection({ nonce, record, doc = document, waitOptions = undefined } = {}) {
  if (!record || record.nonce !== nonce || record.pruned || typeof record.body !== 'string') {
    return { status: 'manual_review', changed: false, reason: 'exact carrier record unavailable' };
  }
  if (carrierHasRecoveryDependency(record)) return { status: 'recovery_required', changed: false,
    reason: 'Carrier retained until pending delivery is reconciled.' };
  const candidate = injectionPruneCandidate(doc, nonce);
  if (!candidate) return { status: 'not_found', changed: false };

  const priorFocus = doc.activeElement;
  const priorRenderedText = interactionText(candidate.interaction);
  const priorRoots = loadedInteractionRoots(doc);
  const priorRoute = doc.location?.href ?? doc.location?.pathname;
  const slot = priorRoots.indexOf(candidate.interaction);
  const priorTexts = priorRoots.map(interactionText);
  // Diagnostic only: describe the first lost invariant without recording story
  // text, adopting a new snapshot, or consulting/mutating the history witness.
  const diagnostic = { started_at: new Date().toISOString(), initial_count: priorRoots.length,
    target_slot: slot, editor_opened_at: null, save_clicked_at: null, first_violation: null };
  const violation = (kind, roots, neighbor = null) => {
    diagnostic.first_violation ??= { kind, observed_at: new Date().toISOString(),
      current_count: roots.length, neighbor_slot: neighbor };
    return null;
  };
  // DreamGen remounts the interaction when entering/leaving its native editor.
  // Bind that one slot to this transaction; every other root AND text must stay
  // unchanged. This is bounded host-UI continuity, not a server identity claim.
  const currentSlot = () => {
    const roots = loadedInteractionRoots(doc);
    if ((doc.location?.href ?? doc.location?.pathname) !== priorRoute) return violation('route_changed', roots);
    if (slot < 0) return violation('target_slot_missing', roots);
    if (roots.length !== priorRoots.length) return violation('root_count_changed', roots);
    for (let i = 0; i < roots.length; i += 1) {
      if (i === slot) continue;
      if (roots[i] !== priorRoots[i]) return violation('neighbor_root_changed', roots, i);
      if (interactionText(roots[i]) !== priorTexts[i]) return violation('neighbor_text_changed', roots, i);
    }
    return roots[slot];
  };
  let area = null;
  let original = null;
  let mutated = false;
  const endHistoryReadback = beginHistoryReadback(doc, candidate.interaction, priorRenderedText);
  try {
    candidate.edit.click();
    area = await waitFor(() => {
      const root = currentSlot();
      const editor = root?.querySelector('textarea, [contenteditable][aria-label="Edit interaction text"]');
      return editor && String(controlText(editor) ?? '').includes(nonce) ? editor : null;
    }, waitOptions);
    if (!area) {
      actionButton(candidate.interaction, /cancel|close|discard/i)?.click();
      diagnostic.finished_at = new Date().toISOString();
      return { status: 'editor_not_found', changed: false, diagnostic };
    }
    diagnostic.editor_opened_at = new Date().toISOString();

    original = controlText(area);
    const stripped = stripRecordedInjection(original, record);
    if (stripped.status !== 'matched') {
      await closeWithoutSaving(area, candidate.interaction);
      return { status: 'manual_review', changed: false, reason: stripped.reason };
    }
    if (!setNativeValue(area, stripped.text) || controlText(area) !== stripped.text) {
      await rollback(area, candidate.interaction, original);
      return { status: 'editor_write_failed', changed: false };
    }
    mutated = true;

    const root = area.closest?.('.group') ?? area.parentElement?.parentElement ?? candidate.interaction;
    const save = actionButton(root, /save|update|confirm/i);
    if (!save || labels(save).some((value) => /rewrite/i.test(value))) {
      await rollback(area, candidate.interaction, original);
      return { status: 'save_not_found', changed: false };
    }
    // Save is the commit boundary. Once invoked, a timeout cannot distinguish
    // "host saved but did not repaint" from "host did not save". Any
    // compensating edit could therefore restore the hidden carrier after a
    // successful save. Relinquish rollback ownership before invoking Save.
    mutated = false;
    try {
      diagnostic.save_clicked_at = new Date().toISOString();
      save.click();
    } catch {
      return { status: 'save_uncertain', changed: null };
    }

    const settled = await waitFor(() => {
      const root = currentSlot();
      return root && !root.querySelector('textarea, [contenteditable][aria-label="Edit interaction text"]')
        && !interactionText(root).includes(nonce) && root;
    }, waitOptions);
    if (!settled) {
      diagnostic.finished_at = new Date().toISOString();
      if (!diagnostic.first_violation) {
        const root = currentSlot();
        diagnostic.unsettled_target = root?.querySelector('textarea, [contenteditable][aria-label="Edit interaction text"]')
          ? 'editor_still_open' : root && interactionText(root).includes(nonce) ? 'nonce_still_present' : 'target_not_settled';
      }
      return { status: 'save_uncertain', changed: null, reason: 'same_interaction_did_not_settle', diagnostic };
    }
    const savedRenderedText = interactionText(settled);
    // Absence is not an edit receipt. Reopen the same isolated history slot and
    // read the exact native editor value; never search elsewhere by story text.
    const readbackEdit = await waitFor(() => {
      const root = currentSlot();
      const edit = root?.querySelector('button[aria-label="Edit Interaction"]');
      return edit && edit.isConnected !== false && !edit.disabled ? edit : null;
    }, waitOptions);
    if (!readbackEdit) return { status: 'save_uncertain', changed: null, reason: 'readback_edit_unavailable' };
    readbackEdit.click();
    const readback = await waitFor(() => currentSlot()?.querySelector('textarea, [contenteditable][aria-label="Edit interaction text"]'), waitOptions);
    const matches = readback && controlText(readback) === stripped.text;
    const closed = readback && await closeWithoutSaving(readback, currentSlot());
    if (!matches || !closed) return { status: 'save_uncertain', changed: null, reason: 'readback_not_confirmed' };
    const finalRoot = await waitFor(() => {
      const root = currentSlot();
      return root && !root.querySelector('textarea, [contenteditable][aria-label="Edit interaction text"]')
        && interactionText(root) === savedRenderedText && root;
    }, waitOptions);
    if (!finalRoot) return { status: 'save_uncertain', changed: null, reason: 'readback_close_not_confirmed' };
    acknowledgeHistoryReadback(doc, candidate.interaction, priorRenderedText, finalRoot);
    mutated = false;
    return { status: 'pruned', changed: true, evidence: 'isolated_history_slot_editor_readback' };
  } finally {
    endHistoryReadback();
    if (mutated && area && original != null && controlText(area) !== original) {
      await rollback(area, candidate.interaction, original);
    }
    restoreFocus(priorFocus);
  }
}

/** Sequential by design: DreamGen exposes one interaction editor at a time. */
export async function pruneOwnedInjections(
  records,
  { doc = document, loadAll = true, waitOptions = undefined } = {},
) {
  const results = [];
  if (loadAll && !(await loadAllInteractions(doc, waitOptions))) {
    return (records ?? []).map((record) => ({
      nonce: record.nonce,
      turn: record.turn,
      status: 'load_incomplete',
      changed: false,
    }));
  }
  for (const record of records ?? []) {
    const result = {
      nonce: record.nonce,
      turn: record.turn,
      ...(await pruneOwnedInjection({ nonce: record.nonce, record, doc, waitOptions })),
    };
    results.push(result);
    // The host editor's post-Save state is unknown. Do not begin another
    // historical edit until a later observation can establish what happened.
    if (['save_uncertain', 'manual_review'].includes(result.status)) break;
  }
  return results;
}

/**
 * Full clean-history transaction used before DGCE may inject again.
 *
 * It retrieves paginated history, discovers both ledgered and unledgered
 * carriers, removes only reconciled carriers with a later interaction, then
 * scans the complete host history again.  A post-Save ambiguity never becomes
 * a clean certificate in the same page lifetime.
 */
export async function sweepOwnedInjectionHistory({ doc = document, waitOptions = undefined, records = [], workspace = null } = {}) {
  const reconcile = result => {
    if (result.status !== 'clean') return result;
    const absent = records.filter(record => !record.pruned && carrierMayHaveExisted(record)
      && !(result.verified_absent_nonces ?? []).includes(record.nonce));
    const accepted = absent.filter(record => legacyAbsenceAccepted(workspace, record)).map(record => record.nonce);
    const modern = absent.filter(record => modernAbsenceAccepted(workspace, record)).map(record => record.nonce);
    const unverified = absent.filter(record => !accepted.includes(record.nonce) && !modern.includes(record.nonce)).map(record => record.nonce);
    return unverified.length ? { ...result, status: 'history_unverified',
      history_issue: 'carrier_retirement_unverified', unverified_record_nonces: unverified }
      : { ...result, accepted_legacy_nonces: accepted, accepted_modern_cleanup_nonces: modern };
  };
  const before = await inspectOwnedInjectionHistory({ doc, waitOptions });
  if (['load_incomplete', 'manual_review'].includes(before.status)) {
    return { ...before, results: [], remaining: [], verified_absent_nonces: [] };
  }
  if (!before.carriers.length) {
    return reconcile({
      ...before,
      results: [],
      remaining: [],
      verified_absent_nonces: [],
    });
  }

  const owned = new Set(records.filter(record => record && !record.pruned).map(record => record.nonce));
  const unknown = before.carriers.filter(carrier => !owned.has(carrier.nonce));
  if (unknown.length) {
    return { ...before, status: 'manual_review', results: [], remaining: before.carriers,
      verified_absent_nonces: [], unknown_nonces: unknown.map(carrier => carrier.nonce) };
  }

  const ambiguous = before.carriers.filter((carrier) => carrier.ambiguous);
  const recoveryRequired = before.carriers.filter(carrier =>
    carrierHasRecoveryDependency(records.find(record => record.nonce === carrier.nonce)));
  const awaitingResponse = before.carriers.filter((carrier) =>
    !carrier.ambiguous && !carrier.has_following_interaction);
  const targets = before.carriers.filter((carrier) =>
    !carrier.ambiguous && carrier.has_following_interaction && !recoveryRequired.includes(carrier));
  const ledgerTargets = targets.map(target => records.find(record => record.nonce === target.nonce));
  const results = await pruneOwnedInjections(ledgerTargets, { doc, loadAll: false, waitOptions });
  const uncertain = results.some((result) => result.status === 'save_uncertain');
  const hardFailure = results.some((result) =>
    !result.changed && !['not_found', 'nonce_not_in_editor'].includes(result.status));

  if (uncertain) {
    return {
      status: 'save_uncertain',
      carriers: before.carriers,
      interaction_count: before.interaction_count,
      results,
      remaining: discoverOwnedInjectionCarriers(doc),
      verified_absent_nonces: [],
    };
  }

  const after = await inspectOwnedInjectionHistory({ doc, waitOptions });
  if (['load_incomplete', 'manual_review'].includes(after.status)) {
    return { ...after, results, remaining: [], verified_absent_nonces: [] };
  }
  const remaining = after.carriers;
  const verifiedAbsent = results.filter(result => result.changed === true
    && result.evidence === 'isolated_history_slot_editor_readback').map(result => result.nonce);

  let status = after.history.complete ? 'clean' : 'history_unverified';
  if (results.some(result => result.status === 'manual_review')) status = 'manual_review';
  else if (recoveryRequired.length) status = 'recovery_required';
  else if (ambiguous.length || hardFailure || remaining.some((carrier) => carrier.ambiguous)) status = 'dirty';
  else if (remaining.length || awaitingResponse.length) status = 'awaiting_response';

  return reconcile({
    status,
    history: after.history,
    carriers: before.carriers,
    interaction_count: after.interaction_count,
    results,
    remaining,
    verified_absent_nonces: verifiedAbsent,
    recovery_required_nonces: recoveryRequired.map(carrier => carrier.nonce),
  });
}
