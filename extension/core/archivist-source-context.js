// Run-local source catalogue. Captured roleplay is evidence to interpret, not
// automatically a GM fact. Exact matching establishes origin, not entailment.
export function buildArchivistSourceContext(records, { maxBytes = 240000 } = {}) {
  if (!Array.isArray(records) || !records.length) throw new Error('no loaded roleplay sources');
  if (!Number.isInteger(maxBytes) || maxBytes < 1) throw new Error('invalid source byte limit');
  const sources = records.map((record, index) => {
    if (!record || typeof record.text !== 'string' || !record.text.trim()
      || typeof record.speakerLabel !== 'string') throw new Error('invalid roleplay source record');
    return Object.freeze({ id: `s${index + 1}`, speakerLabel: record.speakerLabel, text: record.text });
  });
  const catalog = Object.freeze({ schemaVersion: 1, coverage: 'loadedInteractionsOnly', sources: Object.freeze(sources) });
  const sourceContext = JSON.stringify(catalog);
  if (new TextEncoder().encode(sourceContext).length > maxBytes) throw new Error('loaded source context exceeds capture limit; not truncated');
  return Object.freeze({ catalog, sourceContext });
}

/** Require unambiguous exact quotations; NEVER substitute model paraphrases. */
export function resolveArchivistSourceQuotes(thread, catalog) {
  if (thread.sourceSpanIds !== undefined) {
    if (thread.sourceQuotes !== undefined) throw new Error('choose spans or quotations, not both');
    if (!Array.isArray(thread.sourceSpanIds) || !thread.sourceSpanIds.length
      || new Set(thread.sourceSpanIds).size !== thread.sourceSpanIds.length) throw new Error('distinct source spans required');
    const passages = new Map(indexArchivistSourceSpans(catalog).sources.flatMap(source =>
      source.passages.map(span => [span.id, { ...span, sourceId: source.id }])));
    const covered = new Set();
    const anchors = thread.sourceSpanIds.map(id => {
      const span = passages.get(id);
      if (!span || !thread.sourceIds.includes(span.sourceId)) throw new Error('unknown or undeclared source span');
      const source = catalog.sources.find(s => s.id === span.sourceId);
      covered.add(source.id);
      return { sourceId: source.id, start: span.start, end: span.end,
        quote: source.text.slice(span.start, span.end), speakerLabel: source.speakerLabel, contextText: source.text };
    });
    if (covered.size !== new Set(thread.sourceIds).size) throw new Error('each cited source needs a matching span');
    return anchors;
  }
  if (!Array.isArray(thread.sourceQuotes) || !thread.sourceQuotes.length) throw new Error('sourceQuotes required for source-grounded repair');
  const sourceIds = new Set(thread.sourceIds);
  const covered = new Set();
  const seen = new Set();
  const anchors = thread.sourceQuotes.map(ref => {
    const source = catalog.sources.find(item => item.id === ref.sourceId);
    if (!source || !sourceIds.has(ref.sourceId)) throw new Error('unknown or undeclared source reference');
    if (typeof ref.quote !== 'string' || !ref.quote.trim()) throw new Error('empty source quotation');
    const start = source.text.indexOf(ref.quote);
    if (start < 0) throw new Error('source quotation is not verbatim');
    if (source.text.indexOf(ref.quote, start + 1) >= 0) throw new Error('source quotation is ambiguous; cite more context');
    const key = JSON.stringify([ref.sourceId, ref.quote]);
    if (seen.has(key)) throw new Error('duplicate source quotation');
    seen.add(key); covered.add(ref.sourceId);
    return { sourceId: source.id, start, end: start + ref.quote.length,
      quote: source.text.slice(start, start + ref.quote.length),
      speakerLabel: source.speakerLabel, contextText: source.text };
  });
  if (covered.size !== sourceIds.size) throw new Error('each cited source needs a matching quotation');
  return anchors;
}

// Mechanical, run-local locators, NOT semantic evidence units. Preserve exact
// offsets, including repeated identical passages; never ask the model to copy
// text or calculate offsets. No source or nonblank passage is removed here.
export function indexArchivistSourceSpans(catalog) {
  return { schemaVersion: 1, coverage: catalog.coverage, sources: catalog.sources.map(source => ({
    id: source.id, speakerLabel: source.speakerLabel,
    passages: [...source.text.matchAll(/[^\r\n]+/g)].filter(m => m[0].trim()).map((m, i) => ({
      id: `${source.id}.p${i + 1}`, start: m.index, end: m.index + m[0].length, text: m[0],
    })),
  })) };
}
