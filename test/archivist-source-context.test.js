import test from 'node:test';
import assert from 'node:assert/strict';
import { buildArchivistSourceContext, resolveArchivistSourceQuotes } from '../extension/core/archivist-source-context.js';
import { captureArchivistSources } from '../extension/host/archivist-sources.js';

test('catalogue is immutable, source-exact, run-local and explicitly partial', () => {
  const text = 'Neri: “Olan told me the gate was closed.”\nI did not see it.';
  const records = [{ speakerLabel: 'Neri', text }];
  const snapshot = buildArchivistSourceContext(records);
  records[0].text = 'Changed outside snapshot';
  assert.equal(snapshot.catalog.coverage, 'loadedInteractionsOnly');
  assert.equal(snapshot.catalog.sources[0].text, text);
  assert.ok(Object.isFrozen(snapshot.catalog.sources[0]));
  assert.deepEqual(JSON.parse(snapshot.sourceContext), snapshot.catalog);
  const anchors = resolveArchivistSourceQuotes({ sourceIds: ['s1'], sourceQuotes: [
    { sourceId: 's1', quote: '“Olan told me the gate was closed.”' },
  ] }, snapshot.catalog);
  assert.equal(text.slice(anchors[0].start, anchors[0].end), anchors[0].quote);
  assert.equal(anchors[0].contextText, text);
  assert.equal(anchors[0].speakerLabel, 'Neri');
});

test('distinct subthreads can locate different quotations in the same interaction', () => {
  const { catalog } = buildArchivistSourceContext([{ speakerLabel: 'Noll', text: 'Eska told me it was empty. I checked yesterday\'s register.' }]);
  const ref = quote => resolveArchivistSourceQuotes({ sourceIds: ['s1'], sourceQuotes: [{ sourceId: 's1', quote }] }, catalog)[0];
  assert.notEqual(ref('Eska told me it was empty.').start, ref("I checked yesterday's register.").start);
});

test('source matcher refuses invented, ambiguous, duplicate or ungrounded references', () => {
  const { catalog } = buildArchivistSourceContext([
    { speakerLabel: 'Neri', text: 'A repeated phrase. A repeated phrase. The unique ending.' },
    { speakerLabel: 'Olan', text: 'Second source.' },
  ]);
  for (const thread of [
    { sourceIds: ['s1'] },
    { sourceIds: ['s1'], sourceQuotes: [] },
    { sourceIds: ['s1'], sourceQuotes: [{ sourceId: 's1', quote: 'Invented paraphrase.' }] },
    { sourceIds: ['s1'], sourceQuotes: [{ sourceId: 's1', quote: 'A repeated phrase.' }] },
    { sourceIds: ['s9'], sourceQuotes: [{ sourceId: 's9', quote: 'The unique ending.' }] },
    { sourceIds: ['s2'], sourceQuotes: [{ sourceId: 's1', quote: 'The unique ending.' }] },
    { sourceIds: ['s1', 's2'], sourceQuotes: [{ sourceId: 's1', quote: 'The unique ending.' }] },
    { sourceIds: ['s1'], sourceQuotes: [1, 2].map(() => ({ sourceId: 's1', quote: 'The unique ending.' })) },
  ]) assert.throws(() => resolveArchivistSourceQuotes(thread, catalog));
});

test('capture limits use UTF-8 bytes and never silently truncate', () => {
  const records = [{ speakerLabel: '', text: 'é🙂'.repeat(40) }];
  const snapshot = buildArchivistSourceContext(records);
  const bytes = new TextEncoder().encode(snapshot.sourceContext).length;
  assert.doesNotThrow(() => buildArchivistSourceContext(records, { maxBytes: bytes }));
  assert.throws(() => buildArchivistSourceContext(records, { maxBytes: bytes - 1 }), /not truncated/);
  assert.throws(() => buildArchivistSourceContext([]), /no loaded/);
  assert.throws(() => buildArchivistSourceContext([{ speakerLabel: '', text: '' }]), /invalid/);
});

function documentFixture({ editing = false, hiddenOnly = false } = {}) {
  let clicks = 0;
  const prose = { innerText: hiddenOnly ? undefined : 'Visible story.\n<hidden><ext_ctx id="dgce-abcdef">MEMORY CARRIER</ext_ctx></hidden>\nNext event.',
    textContent: 'HIDDEN OR ASSISTANT CONTENT', parentElement: { closest: () => null } };
  const nested = { innerText: 'DUPLICATE NESTED PROSE', parentElement: { closest: () => prose } };
  const root = {
    querySelector(selector) {
      if (selector.startsWith('button[aria-label="Edit Interaction"]')) return { click() { clicks++; } };
      if (selector.startsWith('[contenteditable]')) return editing ? {} : null;
      if (selector === '.flex.justify-between.items-center') return { innerText: 'Narrator' };
      return null;
    },
    querySelectorAll(selector) { return selector === '.prose' ? [prose, nested] : []; },
  };
  const doc = { querySelectorAll(selector) {
    return selector === 'div.flex.flex-col.rounded-md.min-h-12' ? [root] : [];
  } };
  return { doc, clicks: () => clicks };
}

test('capture preserves document order across known and fallback interaction roots', () => {
  const roots = ['First narrative.', 'Second dialogue.', 'Third narrative.'].map((text, index) => ({
    compareDocumentPosition(other) { return index < roots.indexOf(other) ? 4 : 2; },
    querySelector(selector) {
      if (selector.startsWith('button[aria-label="Edit Interaction"]')) return {};
      if (selector === 'p,pre,[data-slot="markdown"]') return {};
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '.prose') return [{ innerText: text }];
      if (selector === 'button[aria-label="Edit Interaction"]') return [edits[index]];
      return [];
    },
  }));
  const edits = roots.map((root, index) => ({ parentElement: root, closest: () => index === 1 ? root : null }));
  const doc = { body: {}, querySelectorAll(selector) {
    if (selector === 'div.flex.flex-col.rounded-md.min-h-12') return [roots[1]];
    if (selector === 'button[aria-label="Edit Interaction"]') return edits;
    return [];
  } };
  assert.deepEqual(captureArchivistSources({ doc }).catalog.sources.map(s => s.text),
    ['First narrative.', 'Second dialogue.', 'Third narrative.']);
});

test('capture refuses active roleplay generation but not Assistant generation', () => {
  const f = documentFixture();
  const original = f.doc.querySelectorAll;
  let assistant = false;
  f.doc.querySelectorAll = selector => selector === 'button' ? [{
    textContent: 'Stop generating', getClientRects: () => [{}], closest: () => assistant ? {} : null,
  }] : original(selector);
  assert.throws(() => captureArchivistSources({ doc: f.doc }), /generation is active/);
  assistant = true;
  assert.doesNotThrow(() => captureArchivistSources({ doc: f.doc }));
});

test('hidden prose with innerText is excluded instead of promoted to source', () => {
  const f = documentFixture();
  const [root] = f.doc.querySelectorAll('div.flex.flex-col.rounded-md.min-h-12');
  root.querySelectorAll = selector => selector === '.prose' ? [{
    innerText: 'Hidden diagnostic', getClientRects: () => [],
  }] : [];
  assert.throws(() => captureArchivistSources({ doc: f.doc }), /no loaded/);
});

test('read-only capture uses interaction prose, strips owned injection, excludes nested duplication', () => {
  const f = documentFixture();
  const snapshot = captureArchivistSources({ doc: f.doc });
  assert.equal(snapshot.catalog.sources[0].speakerLabel, 'Narrator');
  assert.match(snapshot.catalog.sources[0].text, /Visible story/);
  assert.match(snapshot.catalog.sources[0].text, /Next event/);
  assert.doesNotMatch(snapshot.sourceContext, /MEMORY CARRIER|HIDDEN|ASSISTANT|DUPLICATE/);
  assert.equal(f.clicks(), 0);
});

test('capture refuses open editors and never falls back to hidden textContent', () => {
  assert.throws(() => captureArchivistSources({ doc: documentFixture({ editing: true }).doc }), /being edited/);
  assert.throws(() => captureArchivistSources({ doc: documentFixture({ hiddenOnly: true }).doc }), /no loaded/);
});
