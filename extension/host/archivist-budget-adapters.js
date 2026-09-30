// Opt-in stage transport, supplied only by the manual temporary-Assistant path.
import { ask, ensureHeadroom } from './assistant.js';
import { captureArchivistSources } from './archivist-sources.js';
import { repairArchivistBudgets } from './archivist-budget-repair.js';
import { parseArchivistSelection } from '../core/archivist-selection.js';
import { parseArchivistRankedSelection, parseArchivistThreadRendering } from '../core/archivist-ranked-selection.js';
import { resolveArchivistSourceQuotes } from '../core/archivist-source-context.js';
import { estimateTokens } from '../core/tokens.js';
import {
  buildArchivistSelectionPrompt, buildArchivistRenderingPrompt,
  buildArchivistRankedSelectionPrompt,
  looksLikeCompleteArchivistSelection,
} from '../core/archivist-budget-prompts.js';

export function createArchivistRepairAdapters({
  snapshot, getSourceContext, assertWorkspaceCurrent = async () => {},
  askFn = ask, ensureHeadroomFn = ensureHeadroom, onStatus = () => {},
  selectionMode = 'quotes',
}) {
  if (!['quotes', 'ranked-spans'].includes(selectionMode)) throw new Error('unknown selection mode');
  let acceptedFocus = null;
  const check = async () => {
    await assertWorkspaceCurrent();
    if (getSourceContext() !== snapshot.sourceContext) throw new Error('repair source context changed');
  };
  const roundTrip = async (prompt, stage) => {
    await check();
    onStatus(`Archivist budget repair: ${stage}`);
    // This adapter never clears history itself. A caller may supply the
    // explicitly owned scratch transport; every stage stays self-contained.
    await ensureHeadroomFn(estimateTokens(prompt));
    await check();
    // Completion != schema validity. Even an error object is complete and must
    // reach validation rather than appearing to stream until timeout.
    const reply = await askFn(prompt, { isComplete: looksLikeCompleteArchivistSelection });
    await check();
    return reply;
  };
  const matchSnapshot = request => {
    if (request.sourceContext !== snapshot.sourceContext) throw new Error('adapter source snapshot mismatch');
  };
  return {
    async selectFn(request) {
      acceptedFocus = null;
      matchSnapshot(request);
      const ranked = selectionMode === 'ranked-spans';
      const reply = await roundTrip((ranked ? buildArchivistRankedSelectionPrompt : buildArchivistSelectionPrompt)(request, snapshot.catalog), 'selecting');
      const selected = (ranked ? parseArchivistRankedSelection : parseArchivistSelection)(reply, {
        catalog: snapshot.catalog,
        runId: request.runId, targetSurfaces: request.targets.map(t => t.surface),
        maxRetainedThreads: request.maxRetainedThreads,
      });
      for (const surface of selected.surfaces) for (const thread of surface.threads) {
        resolveArchivistSourceQuotes(thread, snapshot.catalog);
      }
      acceptedFocus = ranked ? { runId: request.runId, surfaces: selected.surfaces.map(surface => ({ surface: surface.surface,
        threads: surface.threads.filter(t => t.decision === 'retain').map(t => ({ id: t.id, topic: t.topic })) })) } : null;
      return JSON.stringify(selected);
    },
    async renderFn(request) {
      matchSnapshot(request);
      const keyedThreads = selectionMode === 'ranked-spans';
      if (keyedThreads && (!acceptedFocus || acceptedFocus.runId !== request.runId)) throw new Error('ranked rendering requires accepted selection');
      const reply = await roundTrip(buildArchivistRenderingPrompt(request, snapshot.catalog, { keyedThreads, acceptedFocus }), 'rendering');
      return keyedThreads ? parseArchivistThreadRendering(reply, request) : reply;
    },
  };
}

/** Capture once, re-read for freshness only; never extend a snapshot mid-run. */
export async function runSourceGroundedArchivistRepair(ws, rawProposal, {
  captureSources = captureArchivistSources,
  askFn = ask, ensureHeadroomFn = ensureHeadroom, onStatus = () => {},
  getWorkspace, applyOptions = {}, maxRetainedThreads = 2,
  selectionMode = 'quotes',
} = {}) {
  const workspaceFingerprint = JSON.stringify(ws);
  let snapshot;
  try { snapshot = captureSources(); }
  catch (error) {
    return { status: 'rejected', workspace: ws, receipt: null,
      errors: [`source capture unavailable: ${error.message}`], phase: 'capture', budgetFitted: null };
  }
  const getSourceContext = () => captureSources().sourceContext;
  const assertWorkspaceCurrent = async () => {
    const live = getWorkspace ? await getWorkspace() : ws;
    if (!live || JSON.stringify(live) !== workspaceFingerprint) throw new Error('repair workspace changed');
  };
  const adapters = createArchivistRepairAdapters({ snapshot, getSourceContext, assertWorkspaceCurrent,
    askFn, ensureHeadroomFn, onStatus, selectionMode });
  return repairArchivistBudgets(ws, rawProposal, {
    sourceContext: snapshot.sourceContext, getSourceContext,
    getWorkspace, applyOptions, maxRetainedThreads, ...adapters,
  });
}
