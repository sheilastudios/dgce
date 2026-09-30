// One Archivist maintenance run, end to end. Spec section 10b, Stage 2.
//
// Sequence, and every step can refuse:
//
//   build view -> ensure Assistant headroom -> ask -> freshness check
//   -> extract JSON -> strict validate + atomic apply
//   -> ONE retry on invalid -> freshness check -> commit
//
// The retry never loosens the schema. A second invalid reply is a no-op.
// A reply produced from an older workspace revision is also a no-op.
//
//   law: invalid_Archivist_output = no_state_change
//        async_result != fresh_result

import { buildArchivistView } from '../core/archivist-input.js';
import {
  buildArchivistPrompt,
  mintRunId,
  extractJSON,
  promptCost,
  looksLikeCompleteJSON,
  buildArchivistRetryPrompt,
  fitRetrySurfaceBudgets,
} from '../core/archivist.js';
import { applyArchivistRun } from '../core/apply.js';
import { ask, ensureHeadroom, AssistantError } from './assistant.js';
import { readAuthoredEntities, authoredBlock } from './scenario.js';
import { campaignEntityGroups, mergeEntityGroups } from '../core/entity-authority.js';

export class ArchivistError extends Error {}

/**
 * Run the Archivist against exactly the workspace revision it observed.
 * Workspace movement during either Assistant call returns `stale_workspace`;
 * old judgment is never rebased onto new evidence.
 */
export async function runArchivist(
  ws,
  {
    otherNamespaceBytes = 0,
    onStatus = () => {},
    getWorkspace = null,
    askFn = ask,
    ensureHeadroomFn = ensureHeadroom,
    authoredOverride = undefined,
    budgetRepairFn = null,
  } = {},
) {
  const runId = mintRunId();
  const promptRevision = ws.revision;
  const promptFingerprint = JSON.stringify(ws);
  const view = buildArchivistView(ws);

  const scenarioEntities = authoredOverride === undefined ? readAuthoredEntities() : null;
  const definedEntities = mergeEntityGroups(scenarioEntities, campaignEntityGroups(ws.campaign));
  const authored = authoredOverride === undefined
    ? authoredBlock(definedEntities)
    : authoredOverride;
  const prompt = buildArchivistPrompt(ws, { runId, view, authored });

  onStatus('checking Assistant context');
  await ensureHeadroomFn(promptCost(prompt));

  const latestWorkspace = async () => getWorkspace ? await getWorkspace() : ws;
  const isFresh = (latest) => latest != null && latest.revision === promptRevision
    && JSON.stringify(latest) === promptFingerprint;
  const stale = (phase, latest) => ({
    status: 'stale_workspace',
    workspace: latest ?? ws,
    receipt: null,
    errors: [latest == null ? `workspace became unavailable during Archivist ${phase}` : latest.revision === promptRevision
      ? `workspace state changed during Archivist ${phase} before its revision write completed`
      : `workspace changed during Archivist ${phase} (prompt revision ${promptRevision}, current ${latest.revision})`],
    cleared: false,
    runId,
    retried: phase === 'retry',
    budgetFitted: null,
    promptRevision,
  });
  const applyOptions = {
    outstandingRunId: runId,
    expectedRevision: promptRevision,
    otherNamespaceBytes,
    rankable: view.rankable,
    protectedEntities: definedEntities,
  };

  onStatus('asking the Archivist');
  const beforeAsk = await latestWorkspace();
  if (!isFresh(beforeAsk)) return stale('preparation', beforeAsk);
  let reply;
  try {
    reply = await askFn(prompt, { isComplete: looksLikeCompleteJSON });
  } catch (error) {
    throw error instanceof AssistantError ? error : new ArchivistError(error.message);
  }

  const target = await latestWorkspace();
  if (!isFresh(target)) return stale('model call', target);

  let result = applyArchivistRun(target, extractJSON(reply), applyOptions);
  if (result.status === 'applied') {
    return { ...result, cleared: false, runId, retried: false, promptRevision };
  }

  // malformed_output_policy: retry exactly once without loosening the schema.
  onStatus('output invalid - retrying once');
  const retryPrompt = buildArchivistRetryPrompt(prompt, reply, result.errors);

  const beforeRetry = await latestWorkspace();
  if (!isFresh(beforeRetry)) return stale('retry', beforeRetry);

  let retryReply;
  try {
    retryReply = await askFn(retryPrompt, { isComplete: looksLikeCompleteJSON });
  } catch (error) {
    throw error instanceof AssistantError ? error : new ArchivistError(error.message);
  }

  const retryTarget = await latestWorkspace();
  if (!isFresh(retryTarget)) return stale('retry', retryTarget);

  result = applyArchivistRun(retryTarget, extractJSON(retryReply), applyOptions);
  if (result.status !== 'applied') {
    // Explicit temporary-chat caller only. Eligibility checks precede at most
    // two additional calls. No mechanical fitting after staged rejection.
    if (budgetRepairFn) {
      const repaired = await budgetRepairFn(retryTarget, extractJSON(retryReply), {
        askFn, ensureHeadroomFn, onStatus, getWorkspace, applyOptions,
      });
      const latest = await latestWorkspace();
      if (!isFresh(latest)) return stale('budget repair', latest);
      return { ...repaired, cleared: false, runId, retried: true,
        stagedRepairAttempted: true, promptRevision };
    }
    const fitted = fitRetrySurfaceBudgets(retryReply, retryTarget, result.errors);
    if (fitted) {
      const fittedResult = applyArchivistRun(retryTarget, fitted.output, applyOptions);
      if (fittedResult.status === 'applied') {
        fittedResult.receipt.budget_fit = fitted.details;
        return {
          ...fittedResult,
          cleared: false,
          runId,
          retried: true,
          budgetFitted: fitted.details,
          promptRevision,
        };
      }
      result = fittedResult;
    }
  }
  return {
    ...result,
    cleared: false,
    runId,
    retried: true,
    budgetFitted: null,
    promptRevision,
  };
}
