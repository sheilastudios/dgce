import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseSavedSession, readSavedInteraction, installSessionReadback, SESSION_READBACK } from '../extension/host/session-readback.js';
import { markInjectionObserved } from '../extension/core/injection-lifecycle.js';
import { canonicalSha256 } from '../extension/core/canonical-json.js';
import { wrapInjection } from '../extension/core/injection.js';
const sid = '11111111-2222-4333-8444-555555555555', iid = '11111111-2222-4333-8444-666666666666';
const parent = '11111111-2222-4333-8444-777777777777';
const route = `\0app\0my\0session\0$sessionId\0\0app\0my\0session\0${sid}\0`;
const url = `https://v2.dreamgen.com/app/my/session/${sid}`;
test('sidebar shares the message identity without importing the worker-only HTML parser', async () => {
  const protocol = await import('../extension/host/session-readback-protocol.js');
  assert.equal(protocol.SESSION_READBACK, SESSION_READBACK);
  const panel = await readFile(new URL('../extension/ui/panel.js', import.meta.url), 'utf8');
  assert.match(panel, /import \{ SESSION_READBACK \} from '\.\.\/host\/session-readback-protocol\.js'/);
  assert.doesNotMatch(panel, /from ['"][^'"]*(?:session-readback\.js|vendor\/parse5\.js)['"]/);
  const shared = await readFile(new URL('../extension/host/session-readback-protocol.js', import.meta.url), 'utf8');
  assert.doesNotMatch(shared, /\bimport\b/);
});
test('actual background entry initializes with browser globals and no options object', async t => {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
  t.after(() => before ? Object.defineProperty(globalThis, 'chrome', before) : delete globalThis.chrome);
  const internal = [], network = [];
  globalThis.chrome = { runtime: { id: 'worker-startup', onMessage: { addListener: fn => internal.push(fn) } },
    webRequest: { onBeforeRequest: { addListener: fn => network.push(fn) } } };
  await import('../extension/background.js');
  assert.equal(internal.length, 2, 'readback and observer-ready listeners');
  assert.equal(network.length, 1);
});
function row(text = 'I inspect the binder.', overrides = {}) {
  return { id: iid, parentId: parent, data: { header: { role: 'writer' }, body: { content: { kind: 'text', data: text } } }, ...overrides };
}
function fixture(rows = [row()], change = value => value) {
  const match = change({ i: route, s: 'success', ssr: 'data-only', l: { session: { id: sid, data: { interactions: rows } } } });
  // Same captured property spelling and $R assignment grammar, synthetic IDs/text.
  return `<script>window.loader={matches:$R[16]=[${JSON.stringify(match)}],lastMatchId:${JSON.stringify(route)}};</script>`;
}

for (const end of ['</script\t\n bar>', '</SCRIPT data-x="a>b">', '</script/>', '</script / stray>']) {
  test(`HTML boundaries: browser-recognized end tag ${JSON.stringify(end)}`, () => {
    const source = fixture().replace('</script>', end);
    assert.equal(parseSavedSession(source, sid).interactions[0].raw_text, 'I inspect the binder.');
    const outside = fixture().slice('<script>'.length, -'</script>'.length);
    assert.throws(() => parseSavedSession(`<script>${end}<div>${outside}</div><script></script>`, sid), /Missing or ambiguous/);
  });
}

for (const tag of ['textarea', 'title', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'template', 'svg', 'math']) {
  test(`HTML boundaries: a loader-looking script in ${tag} is not session evidence`, () => {
    const decoy = `<${tag}>${fixture([row('DECOY')])}</${tag}>`;
    assert.throws(() => parseSavedSession(decoy, sid), /Missing or ambiguous/);
    assert.equal(parseSavedSession(decoy + fixture(), sid).interactions[0].raw_text, 'I inspect the binder.');
  });
}

test('HTML boundaries: comments, attributes, plaintext and incomplete scripts supply no loader', () => {
  const fake = fixture([row('DECOY')]);
  for (const decoy of [`<!--${fake}-->`, `<!-->${fake.replace('<script>', '<script-x>')}`, `<div data-example='${fake}'></div>`]) {
    assert.throws(() => parseSavedSession(decoy, sid));
    assert.equal(parseSavedSession(decoy + fixture(), sid).interactions[0].raw_text, 'I inspect the binder.');
  }
  assert.throws(() => parseSavedSession(`<plaintext>${fake}`, sid));
  assert.throws(() => parseSavedSession(fixture().replace('</script>', ''), sid));
});

test('HTML boundaries: quoted greater-than attributes and exact script bytes survive HTML parsing', () => {
  const raw = 'line one\r\nline two\0&notin; literal';
  const html = fixture([row(raw)]).replace('<script>', '<SCRIPT data-note="one > two" nonce="test">');
  assert.equal(parseSavedSession(html, sid).interactions[0].raw_text, raw);
});
test('saved session parser reads exact IDs, parent and raw text without inferring list completeness', () => {
  const text = 'Quotes “stay”;\r\n\n<hidden><ext_ctx id="dgce-abcdef">\nbody\n</ext_ctx></hidden>';
  const result = parseSavedSession(fixture([row(text)]), sid);
  assert.deepEqual(result, { workspace_id: sid, interactions: [{ interaction_id: iid, parent_id: parent, raw_text: text }] });
  assert.equal(Object.hasOwn(result, 'complete_history'), false);
});
test('captured unquoted keys, literal route NUL, references, void parent and Date assignments parse as data', () => {
  const html = `<script>let x={matches:$R[16]=[$R[20]={i:"${route}",u:42,s:"success",l:$R[21]={session:$R[25]={data:$R[26]={interactions:$R[80]=[$R[98]={id:"${iid}",parentId:void 0,data:$R[99]={header:$R[100]={role:"writer"},body:$R[103]={content:$R[104]={kind:"text",data:"hello"}}},createdAt:$R[106]=new Date("2026-09-24T05:39:51.628Z"),updatedAt:$R[106]}]},id:"${sid}"}},ssr:"data-only"}],lastMatchId:"${route}"};</script>`;
  assert.equal(parseSavedSession(html, sid).interactions[0].parent_id, null);
});
test('captured hexadecimal tag escaping decodes exactly without double-decoding literal backslashes', () => {
  const raw = 'Literal \\x3C is not a tag.\n\n<hidden><ext_ctx id="dgce-abcdef">\n<memory>safe</memory>\n</ext_ctx></hidden>';
  const html = fixture([row(raw)]).replaceAll('<hidden>', '\\x3Chidden>')
    .replaceAll('<ext_ctx', '\\x3Cext_ctx').replaceAll('<memory>', '\\x3Cmemory>')
    .replaceAll('</memory>', '\\x3C/memory>').replaceAll('</ext_ctx>', '\\x3C/ext_ctx>')
    .replaceAll('</hidden>', '\\x3C/hidden>');
  assert.equal(parseSavedSession(html, sid).interactions[0].raw_text, raw);
  assert.throws(() => parseSavedSession(html.replace('\\x3Chidden', '\\xZZhidden'), sid));
});
test('a forged loader inside story strings is inert; no host code is executed', () => {
  const story = 'matches:$R[0]=[{forged:true}],lastMatchId:"x"; globalThis.PWNED = true;';
  assert.equal(parseSavedSession(fixture([row(story)]), sid).interactions[0].raw_text, story);
  assert.equal(globalThis.PWNED, undefined);
});
for (const [name, html] of [
  ['wrong session', fixture([row()], m => { m.l.session.id = parent; return m; })],
  ['wrong route', fixture([row()], m => { m.i = 'another route'; return m; })],
  ['unsuccessful loader', fixture([row()], m => { m.s = 'pending'; return m; })],
  ['unsupported loader', fixture([row()], m => { m.ssr = true; return m; })],
  ['duplicate loader', fixture() + fixture()],
  ['duplicate record', fixture([row(), row()])],
  ['invalid parent', fixture([row('text', { parentId: 'not-an-id' })])],
  ['non-text body', fixture([row('text', { data: { body: { content: { kind: 'image', data: 'text' } } } })])],
  ['expression instead of data', fixture().replace('"interactions":[', '"interactions":evil([')],
  ['expression after data', fixture().replace('],lastMatchId:', ']||evil(),lastMatchId:')],
  ['unresolved ref', fixture().replace('"data":"I inspect the binder."', '"data":$R[999]')],
  ['duplicate key', fixture().replace('"id":', '"id":"evil","id":')],
  ['prototype key', fixture().replace('"header":', '"__proto__":{},"header":')],
  ['oversize', ' '.repeat(2 * 1024 * 1024 + 1)],
]) test(`saved session rejects ${name}`, () => assert.throws(() => parseSavedSession(html, sid)));

function response(html = fixture(), overrides = {}) {
  const value = new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  Object.defineProperty(value, 'url', { value: url });
  return Object.assign(value, overrides);
}

test('large synthetic session reads early, middle and latest exact rows across UTF-8 stream chunks', async () => {
  const id = n => `22222222-3333-4444-8555-${n.toString(16).padStart(12, '0')}`;
  const rows = Array.from({ length: 1200 }, (_, n) => row(`Entry ${n}: ` + 'Archive note. “unchanged” 🌙 '.repeat(35),
    { id: id(n), parentId: n ? id(n - 1) : null }));
  const html = fixture(rows), bytes = new TextEncoder().encode(html);
  assert.ok(bytes.length > 1024 * 1024 && bytes.length < 2 * 1024 * 1024, `size ${bytes.length}`);
  const fetchImpl = async () => {
    let at = 0;
    const stream = new ReadableStream({ pull(controller) {
      if (at >= bytes.length) { controller.close(); return; }
      controller.enqueue(bytes.slice(at, at += 8191));
    } });
    const result = new Response(stream, { headers: { 'content-type': 'text/html' } });
    Object.defineProperty(result, 'url', { value: url }); return result;
  };
  for (const n of [0, 600, 1199]) {
    const result = await readSavedInteraction({ workspaceId: sid, interactionId: id(n), fetchImpl });
    assert.equal(result.raw_text, rows[n].data.body.content.data);
    assert.equal(result.parent_id, rows[n].parentId);
    assert.equal(result.candidate_count, 1);
    assert.equal(Object.hasOwn(result, 'complete_history'), false);
  }
  await assert.rejects(readSavedInteraction({ workspaceId: sid, interactionId: iid, fetchImpl }), /not found/);
  const partial = fixture(rows.slice(-100));
  await assert.rejects(readSavedInteraction({ workspaceId: sid, interactionId: id(0), fetchImpl: async () => response(partial) }), /not found/);
  assert.equal(parseSavedSession(partial, sid).interactions.length, 100, 'partial history is not inferred complete');
  rows[1199].data.body.content.data += 'x'.repeat(2 * 1024 * 1024);
  await assert.rejects(readSavedInteraction({ workspaceId: sid, interactionId: id(1199), fetchImpl: async () => response(fixture(rows)) }), /too large/);
});
test('readback is a bounded credentialed GET to the fixed current session, not a page-provided URL', async () => {
  let request;
  const value = await readSavedInteraction({ workspaceId: sid, interactionId: iid, fetchImpl: async (...args) => { request = args; return response(); } });
  assert.equal(request[0], url);
  assert.deepEqual([request[1].method, request[1].credentials, request[1].cache, request[1].redirect], ['GET', 'include', 'no-store', 'error']);
  assert.equal(value.interaction_id, iid);
  assert.equal(value.candidate_count, 1);
  for (const bad of ['https://evil.test', '../elsewhere', '']) await assert.rejects(readSavedInteraction({ workspaceId: bad, interactionId: iid, fetchImpl: () => assert.fail() }));
  await assert.rejects(readSavedInteraction({ workspaceId: sid, interactionId: parent, fetchImpl: async () => response() }), /not found/);
  await assert.rejects(readSavedInteraction({ workspaceId: sid, interactionId: iid, fetchImpl: async () => new Response('login') }), /unavailable/);
  await assert.rejects(readSavedInteraction({ workspaceId: sid, interactionId: iid, fetchImpl: async () => response('x'.repeat(2 * 1024 * 1024 + 1)) }), /too large/);
});
test('worker refuses page, subframe, old documentless and cross-session requests', () => {
  let listener;
  const runtime = { id: 'extension', onMessage: { addListener: fn => { listener = fn; }, removeListener() {} } };
  installSessionReadback({ runtime, fetchImpl: () => assert.fail('unauthorized fetch') });
  const sender = { id: 'extension', tab: { id: 1 }, frameId: 0, documentId: 'doc', url };
  for (const altered of [{ id: 'page' }, { tab: undefined }, { frameId: 1 }, { documentId: undefined }, { url: url.replace(sid, parent) }]) {
    assert.equal(listener({ type: SESSION_READBACK, workspaceId: sid, interactionId: iid }, { ...sender, ...altered }, () => assert.fail()), undefined);
  }
});
test('worker sends only the requested interaction and limits concurrent probes', async () => {
  let listener, finish; const output = [];
  const runtime = { id: 'extension', onMessage: { addListener: fn => { listener = fn; }, removeListener() {} } };
  installSessionReadback({ runtime, fetchImpl: () => new Promise(resolve => { finish = resolve; }) });
  const sender = { id: 'extension', tab: { id: 1 }, frameId: 0, documentId: 'doc', url };
  const message = { type: SESSION_READBACK, workspaceId: sid, interactionId: iid };
  assert.equal(listener(message, sender, value => output.push(value)), true);
  listener(message, sender, value => output.push(value));
  assert.equal(output[0].ok, false);
  finish(response(fixture([row(), row('private other turn', { id: parent, parentId: undefined })])));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(output[1].ok, true);
  assert.doesNotMatch(JSON.stringify(output[1]), /private other turn/);
});

for (const mode of ['list_to_session', 'session_to_session', 'other_tab_route', 'opaque_origin',
  'foreign_context', 'foreign_tab', 'cached_document', 'missing_lifecycle', 'message_url_only']) {
  test(`worker same-document route evidence: ${mode}`, async () => {
    let listener, fetches = 0;
    const runtime = { id: 'extension', onMessage: { addListener: fn => { listener = fn; }, removeListener() {} } };
    installSessionReadback({ runtime, fetchImpl: async () => { fetches++; return response(); } });
    const sender = { id: 'extension', tab: { id: 1, url }, frameId: 0, documentId: 'doc',
      url: 'https://v2.dreamgen.com/app/my/sessions/role-play', origin: 'https://v2.dreamgen.com', documentLifecycle: 'active' };
    if (mode === 'session_to_session') sender.url = url.replace(sid, parent);
    if (mode === 'other_tab_route') sender.tab.url = url.replace(sid, parent);
    if (mode === 'opaque_origin') sender.origin = 'null';
    if (mode === 'foreign_context') sender.url = 'https://evil.test/';
    if (mode === 'foreign_tab') sender.tab.url = 'https://evil.test/';
    if (mode === 'cached_document') sender.documentLifecycle = 'cached';
    if (mode === 'missing_lifecycle') delete sender.documentLifecycle;
    if (mode === 'message_url_only') delete sender.tab.url;
    let output;
    const result = listener({ type: SESSION_READBACK, workspaceId: sid, interactionId: iid, url }, sender, value => { output = value; });
    if (mode === 'list_to_session' || mode === 'session_to_session') {
      assert.equal(result, true);
      await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal(output.ok, true); assert.equal(fetches, 1);
    } else {
      assert.equal(result, undefined); assert.equal(fetches, 0); assert.equal(output, undefined);
    }
  });
}
test('independent host readback satisfies unchanged lifecycle checks; wrong parent, packet or release cannot', () => {
  const nonce = 'dgce-abcdef', body = '<memory>Lantern on desk</memory>';
  const raw = 'I inspect the binder.\n\n' + wrapInjection(body, nonce);
  const host = parseSavedSession(fixture([row(raw)]), sid).interactions[0];
  const witness = { ...host, kind: 'HOST_INTERACTION_READBACK', workspace_id: sid, nonce, candidate_count: 1 };
  const make = () => ({ workspace_id: sid, ordinary_pending: { id: 'action' }, injections: [{ nonce, body,
    ordinary_action_id: 'action', request_id: 'request', interaction_id: iid, request_parent_id: parent,
    native_submission: true, native_submit_attempt_at: '2026-09-24T00:00:00.000Z', network_observed_at: '2026-09-24T00:00:00.010Z',
    outgoing_text_hash: canonicalSha256(raw).hash, lifecycle_status: 'planned', pending_texts: [] }] });
  const ws = make(); assert.equal(markInjectionObserved(ws, nonce, Date.now(), witness).changed, true);
  assert.equal(ws.ordinary_pending, undefined);
  for (const change of [w => { w.parent_id = null; }, w => { w.raw_text += ' '; }, w => { w.interaction_id = parent; }, w => { w.candidate_count = 2; }]) {
    const fresh = make(), altered = { ...witness }; change(altered);
    assert.equal(markInjectionObserved(fresh, nonce, Date.now(), altered).changed, false);
    assert.ok(fresh.ordinary_pending);
  }
  const fresh = make(); fresh.injections[0].native_submission = false;
  assert.equal(markInjectionObserved(fresh, nonce, Date.now(), witness).changed, false);
});
