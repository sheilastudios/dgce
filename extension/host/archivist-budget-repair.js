// Staged repair, opted into through the manual temporary-Assistant UI path.
// Callers supply source context and stage adapters; no DOM, persistence, or
// source extraction is implemented here. Structure != semantic certification.
import { parseArchivistOutput } from '../core/parse.js';
import { parseArchivistSelection, selectionForRendering } from '../core/archivist-selection.js';
import { applyArchivistRun } from '../core/apply.js';
import { estimateTokens, enforcementTarget } from '../core/tokens.js';

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/**
 * One selection call and at most one rendering call, only for budget-only
 * failures. No partial application and no mechanical text fitting. The caller
 * must persist only an `applied` result, as with applyArchivistRun.
 */
export async function repairArchivistBudgets(ws, rawProposal, {
  sourceContext,
  selectFn,
  renderFn,
  getWorkspace,
  getSourceContext,
  applyOptions = {},
  maxRetainedThreads = 2,
} = {}) {
  const fingerprint = JSON.stringify(ws);
  const revision = ws.revision;
  const options = {
    ...applyOptions,
    rankable: applyOptions.rankable == null ? null : new Set(applyOptions.rankable),
    protectedEntities: applyOptions.protectedEntities == null ? null : structuredClone(applyOptions.protectedEntities),
    expectedRevision: revision,
  };
  let live = ws;
  let phase = 'preflight';
  let runId = options.outstandingRunId;
  const reject = errors => ({ status: 'rejected', workspace: live, receipt: null, errors, runId, phase, budgetFitted: null });
  const freshness = async () => {
    live = getWorkspace ? await getWorkspace() : ws;
    if (!live || live.revision !== revision || JSON.stringify(live) !== fingerprint) {
      return { status: 'stale_workspace', workspace: live ?? ws, receipt: null,
        errors: [`workspace changed or became unavailable during budget repair ${phase}`],
        runId, phase, budgetFitted: null };
    }
    if (getSourceContext) {
      let current;
      try { current = getSourceContext(); } catch { current = null; }
      if (current !== sourceContext) return {
        status: 'stale_source', workspace: live, receipt: null,
        errors: [`loaded source context changed or became unavailable during budget repair ${phase}`],
        runId, phase, budgetFitted: null,
      };
    }
    return null;
  };
  if (typeof sourceContext !== 'string' || !sourceContext.trim()) return reject(['original source context required']);
  if (typeof selectFn !== 'function' || typeof renderFn !== 'function') return reject(['stage adapters required']);
  if (!Number.isInteger(maxRetainedThreads) || maxRetainedThreads < 1) return reject(['invalid retained-thread cap']);
  if (applyOptions.expectedRevision != null && applyOptions.expectedRevision !== revision) return reject(['expected revision mismatch']);
  if (typeof runId !== 'string' || !runId) return reject(['outstanding run id required']);
  const stale = await freshness();
  if (stale) return stale;

  let proposal;
  try { proposal = parseArchivistOutput(rawProposal); }
  catch (error) { return reject(error.errors ?? [error.message]); }
  if (proposal.run_id !== runId) return reject(['proposal run_id mismatch']);
  if (proposal.operations.some(op => op.op === 'NO_CHANGE') && proposal.operations.length !== 1) {
    return reject(['NO_CHANGE cannot accompany mutations']);
  }
  const seen = new Set();
  const targets = [];
  for (const op of proposal.operations.filter(op => op.op === 'SET_SURFACE')) {
    if (seen.has(op.surface)) return reject(['duplicate surface operation']);
    seen.add(op.surface);
    const hardLimit = enforcementTarget(ws.surfaces[op.surface].max_tokens);
    if (estimateTokens(op.text) > hardLimit) {
      targets.push({ surface: op.surface, draft: op.text, hardLimit, maxBytes: hardLimit * 3 });
    }
  }
  if (!targets.length) return reject(['proposal has no surface budget failure']);
  const names = new Set(targets.map(t => t.surface));

  // Budget preflight in apply.js can precede relation validation. Neutralize
  // only target texts on a disposable proposal to expose other fatal errors.
  // This is validation only: its resulting clone/receipt is never published.
  const probe = structuredClone(proposal);
  for (const op of probe.operations) if (op.op === 'SET_SURFACE' && names.has(op.surface)) op.text = '';
  const eligible = applyArchivistRun(ws, JSON.stringify(probe), options);
  if (eligible.status !== 'applied') return reject(eligible.errors);

  const request = freeze({ runId, sourceContext, maxRetainedThreads, targets });
  phase = 'selection';
  let selectionReply;
  let stageError;
  try { selectionReply = await selectFn(request); }
  catch (error) { stageError = error; }
  const afterSelection = await freshness();
  if (afterSelection) return afterSelection;
  if (stageError) return reject(stageError.errors ?? [String(stageError.message ?? stageError)]);
  let selection;
  try { selection = parseArchivistSelection(selectionReply, { runId, targetSurfaces: names, maxRetainedThreads }); }
  catch (error) { return reject(error.errors ?? [error.message]); }

  phase = 'rendering';
  let renderedReply;
  try {
    renderedReply = await renderFn(freeze({
      runId, sourceContext, targets,
      selection: selectionForRendering(selection),
      // Reference repairs must be derived again from original evidence.
      // Source IDs are unverified locators, never excerpts or evidence.
      sourceReferencesVerified: false,
    }));
  } catch (error) { stageError = error; }
  const afterRendering = await freshness();
  if (afterRendering) return afterRendering;
  if (stageError) return reject(stageError.errors ?? [String(stageError.message ?? stageError)]);

  let rendered;
  try { rendered = parseArchivistOutput(renderedReply); }
  catch (error) { return reject(error.errors ?? [error.message]); }
  if (rendered.run_id !== runId) return reject(['rendered run_id mismatch']);
  const replacements = new Map();
  for (const op of rendered.operations) {
    if (op.op !== 'SET_SURFACE' || !names.has(op.surface) || replacements.has(op.surface)) {
      return reject(['rendering must replace each target surface exactly once and nothing else']);
    }
    const retained = selection.surfaces.find(s => s.surface === op.surface)
      .threads.filter(t => t.decision === 'retain').length;
    const lines = op.text.split(/\r\n|\r|\n/).filter(line => line.trim());
    if (lines.length !== retained) return reject(['rendered line count must match accepted retained-thread count']);
    replacements.set(op.surface, op.text);
  }
  if (replacements.size !== names.size) return reject(['rendering omitted a target surface']);

  // Rebuild from the original proposal, not model-returned non-target ops.
  const candidate = structuredClone(proposal);
  for (const op of candidate.operations) if (op.op === 'SET_SURFACE' && names.has(op.surface)) {
    op.text = replacements.get(op.surface);
  }
  phase = 'apply';
  const result = applyArchivistRun(live, JSON.stringify(candidate), options);
  return { ...result, runId, phase, budgetFitted: null,
    budgetRepaired: result.status === 'applied', candidate };
}
