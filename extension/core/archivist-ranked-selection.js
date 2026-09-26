// Compact model-facing selection protocol. The model orders threads and chooses
// ONE cutoff. Code derives flags/priorities; it never silently clips an invalid
// cutoff or invents a ranking. Existing internal selection gates still run.
import { normalize, ParseError } from './parse.js';
import { parseArchivistSelection } from './archivist-selection.js';
import { indexArchivistSourceSpans, resolveArchivistSourceQuotes } from './archivist-source-context.js';

function exact(value, keys, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(k => !(k in value))) {
    throw new ParseError(`${name}: unexpected shape`);
  }
}

export function parseArchivistRankedSelection(raw, { catalog, runId, targetSurfaces, maxRetainedThreads = 2 }) {
  let doc;
  try { doc = JSON.parse(normalize(raw)); }
  catch { throw new ParseError('invalid ranked selection JSON'); }
  exact(doc, ['schema_version', 'run_id', 'surfaces'], 'ranked selection');
  if (doc.schema_version !== 1 || doc.run_id !== runId) throw new ParseError('ranked selection identity mismatch');
  if (!Array.isArray(doc.surfaces)) throw new ParseError('ranked surfaces must be an array');
  const spanSources = new Map(indexArchivistSourceSpans(catalog).sources.flatMap(s => s.passages.map(p => [p.id, s.id])));
  const surfaces = doc.surfaces.map(surface => {
    exact(surface, ['surface', 'retainCount', 'threads'], 'ranked surface');
    if (!Number.isInteger(surface.retainCount) || surface.retainCount < 1
      || surface.retainCount > maxRetainedThreads) throw new ParseError('retainCount exceeds allowed range');
    if (!Array.isArray(surface.threads) || surface.threads.length <= surface.retainCount) {
      throw new ParseError('ranked selection must omit at least one whole thread');
    }
    const threads = surface.threads.map((t, i) => {
      exact(t, ['id', 'topic', 'spanIds', 'reason'], 'ranked thread');
      if (!Array.isArray(t.spanIds) || !t.spanIds.length || t.spanIds.some(id => !spanSources.has(id))
        || new Set(t.spanIds).size !== t.spanIds.length) throw new ParseError('invalid ranked source spans');
      const decision = i < surface.retainCount ? 'retain' : 'omit';
      // Paragraph boundaries are not semantic thread boundaries. Different
      // questions may cite the same passage; IDs prove origin, not selection
      // fidelity. The renderer must use the requested focus only as a query.
      const thread = { id: t.id, priority: i + 1, topic: t.topic, reason: t.reason,
        sourceIds: [...new Set(t.spanIds.map(id => spanSources.get(id)))], sourceSpanIds: [...t.spanIds],
        decision };
      resolveArchivistSourceQuotes(thread, catalog);
      return thread;
    });
    return { surface: surface.surface, threads, referenceRepairs: [] };
  });
  return parseArchivistSelection(JSON.stringify({ schema_version: doc.schema_version, run_id: doc.run_id, surfaces }),
    { runId, targetSurfaces, maxRetainedThreads });
}

// Map rendered entries to the already accepted thread IDs, then normalize only
// layout whitespace. Never shorten content or infer a missing thread. The normal
// surface byte limit, atomic apply and freshness checks still run afterwards.
export function parseArchivistThreadRendering(raw, request) {
  let doc;
  try { doc = JSON.parse(normalize(raw)); }
  catch { throw new ParseError('invalid thread rendering JSON'); }
  exact(doc, ['schema_version', 'run_id', 'surfaces'], 'thread rendering');
  if (doc.schema_version !== 1 || doc.run_id !== request.runId || !Array.isArray(doc.surfaces)) {
    throw new ParseError('invalid thread rendering identity');
  }
  const seen = new Set();
  const operations = doc.surfaces.map(surface => {
    exact(surface, ['surface', 'threads'], 'rendered surface');
    const accepted = request.selection.find(s => s.surface === surface.surface);
    if (!accepted || seen.has(surface.surface) || !Array.isArray(surface.threads)) throw new ParseError('unexpected rendered surface');
    seen.add(surface.surface);
    const entries = new Map();
    for (const thread of surface.threads) {
      exact(thread, ['id', 'text'], 'rendered thread');
      if (!accepted.retainedThreads.some(t => t.id === thread.id) || entries.has(thread.id)
        || typeof thread.text !== 'string' || !thread.text.trim()) throw new ParseError('invalid rendered thread');
      entries.set(thread.id, thread.text.trim().replace(/\s*[\r\n]+\s*/g, ' '));
    }
    if (entries.size !== accepted.retainedThreads.length) throw new ParseError('missing rendered thread');
    return { op: 'SET_SURFACE', surface: surface.surface,
      text: accepted.retainedThreads.map(t => entries.get(t.id)).join('\n') };
  });
  if (seen.size !== request.selection.length) throw new ParseError('missing rendered surface');
  return JSON.stringify({ schema_version: 1, run_id: doc.run_id, operations });
}
