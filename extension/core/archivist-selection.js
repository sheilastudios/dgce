// Temporary repair metadata, never an Archivist mutation or source of canon.
// Validation here establishes structure, not the truth of source references.
import { normalize, ParseError } from './parse.js';

function object(value, keys, path, errors, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${path}: expected object`);
    return false;
  }
  for (const key of keys) if (!(key in value)) errors.push(`${path}: missing ${key}`);
  for (const key of Object.keys(value)) if (!keys.includes(key) && !optional.includes(key)) errors.push(`${path}: unknown ${key}`);
  return true;
}

const nonempty = value => typeof value === 'string' && Boolean(value.trim());
const strings = value => Array.isArray(value) && value.every(nonempty);

/** Source IDs are opaque model references, NOT verified evidence pointers. */
export function parseArchivistSelection(raw, { runId, targetSurfaces, maxRetainedThreads = 2 }) {
  if (!Number.isInteger(maxRetainedThreads) || maxRetainedThreads < 1) {
    throw new TypeError('maxRetainedThreads must be a positive integer');
  }
  let doc;
  try { doc = JSON.parse(normalize(raw)); }
  catch (error) { throw new ParseError(`invalid selection JSON: ${error.message}`); }
  const errors = [];
  if (!object(doc, ['schema_version', 'run_id', 'surfaces'], 'selection', errors)) {
    throw new ParseError('invalid selection', errors);
  }
  if (doc.schema_version !== 1) errors.push('selection: schema_version must be 1');
  if (doc.run_id !== runId) errors.push('selection: run_id mismatch');
  const expected = new Set(targetSurfaces);
  const seen = new Set();
  if (!Array.isArray(doc.surfaces)) errors.push('selection.surfaces: expected array');
  else for (const [index, surface] of doc.surfaces.entries()) {
    const at = `selection.surfaces[${index}]`;
    if (!object(surface, ['surface', 'threads', 'referenceRepairs'], at, errors)) continue;
    if (!expected.has(surface.surface)) errors.push(`${at}: unexpected surface`);
    if (seen.has(surface.surface)) errors.push(`${at}: duplicate surface`);
    seen.add(surface.surface);
    if (!strings(surface.referenceRepairs)) errors.push(`${at}: invalid referenceRepairs`);
    if (!Array.isArray(surface.threads)) { errors.push(`${at}: threads must be an array`); continue; }
    const ids = new Set();
    const priorities = new Set();
    const retained = [];
    const omitted = [];
    for (const [i, thread] of surface.threads.entries()) {
      const path = `${at}.threads[${i}]`;
      if (!object(thread, ['id', 'priority', 'topic', 'sourceIds', 'decision', 'reason'], path, errors, ['sourceQuotes', 'sourceSpanIds'])) continue;
      for (const key of ['id', 'topic', 'reason']) {
        if (!nonempty(thread[key])) errors.push(`${path}: ${key} must be nonempty text`);
      }
      if (ids.has(thread.id)) errors.push(`${path}: duplicate thread id`);
      ids.add(thread.id);
      if (!Number.isInteger(thread.priority) || thread.priority < 1) errors.push(`${path}: invalid priority`);
      if (priorities.has(thread.priority)) errors.push(`${path}: duplicate priority`);
      priorities.add(thread.priority);
      if (!strings(thread.sourceIds) || !thread.sourceIds.length || new Set(thread.sourceIds).size !== thread.sourceIds.length) {
        errors.push(`${path}: sourceIds must be distinct nonempty strings`);
      }
      if ('sourceQuotes' in thread) {
        if (!Array.isArray(thread.sourceQuotes) || !thread.sourceQuotes.length) errors.push(`${path}: invalid sourceQuotes`);
        else for (const [q, ref] of thread.sourceQuotes.entries()) {
          const refPath = `${path}.sourceQuotes[${q}]`;
          if (!object(ref, ['sourceId', 'quote'], refPath, errors)) continue;
          if (!nonempty(ref.sourceId) || !nonempty(ref.quote)
            || !Array.isArray(thread.sourceIds) || !thread.sourceIds.includes(ref.sourceId)) {
            errors.push(`${refPath}: invalid quote reference`);
          }
        }
      }
      if ('sourceSpanIds' in thread && (!strings(thread.sourceSpanIds) || !thread.sourceSpanIds.length
        || new Set(thread.sourceSpanIds).size !== thread.sourceSpanIds.length || 'sourceQuotes' in thread)) {
        errors.push(`${path}: invalid or mixed source spans`);
      }
      if (thread.decision === 'retain') retained.push(thread.priority);
      else if (thread.decision === 'omit') omitted.push(thread.priority);
      else errors.push(`${path}: invalid decision`);
    }
    if (retained.length < 1 || retained.length > maxRetainedThreads) {
      errors.push(`${at}: retain between 1 and ${maxRetainedThreads} threads`);
    }
    if (!omitted.length) errors.push(`${at}: omit at least one thread`);
    if (retained.length && omitted.length && Math.max(...retained) > Math.min(...omitted)) {
      errors.push(`${at}: priorities disagree with retain/omit decisions`);
    }
  }
  for (const name of expected) if (!seen.has(name)) errors.push(`selection: missing surface ${name}`);
  if (errors.length) throw new ParseError('invalid Archivist selection', errors);
  return doc;
}

/** Labels, reasons and suggested repairs are model judgments, not source text. */
export function selectionForRendering(selection) {
  return selection.surfaces.map(item => ({
    surface: item.surface,
    retainedThreads: item.threads.filter(t => t.decision === 'retain')
      .sort((a, b) => a.priority - b.priority)
      .map(t => ({ id: t.id, sourceIds: [...t.sourceIds],
        ...('sourceSpanIds' in t ? { sourceSpanIds: [...t.sourceSpanIds] } : {}),
        ...('sourceQuotes' in t ? { sourceQuotes: t.sourceQuotes.map(q => ({ ...q })) } : {}) })),
  }));
}
