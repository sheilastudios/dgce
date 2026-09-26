import { hasHistoryCompletenessWitness, loadedInteractionRoots, historyInteractionText, historyContinuityScope } from './builder-transcript.js';
import { stripInjections } from '../core/injection.js';
import { canonicalSha256 } from '../core/canonical-json.js';

// Read-only, current mounted evidence. No stored receipt can substitute for it
// when a new recovery approval is requested.
export function captureLegacyAbsenceHistory(doc = document) {
  if (!hasHistoryCompletenessWitness(doc)) throw new Error('Verify and load complete supported history before reviewing legacy records.');
  const texts = loadedInteractionRoots(doc).map(historyInteractionText);
  if (!texts.length || texts.some(text => { const parsed = stripInjections(text);
    return parsed.status === 'ambiguous' || parsed.nonces.length; })) {
    throw new Error('History must be structurally unambiguous and contain no context carriers.');
  }
  return { kind: 'SUPPORTED_HOST_CARRIER_FREE_SNAPSHOT', scope: historyContinuityScope(doc),
    workspace_id: doc.location.pathname.replace(/\/$/, '').split('/').pop(),
    interaction_count: texts.length, history_digest: canonicalSha256(texts).hash };
}
