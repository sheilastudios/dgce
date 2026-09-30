// Read-only saved-session adapter for the observed DreamGen SSR data envelope.
// This is a bounded data parser, NEVER eval/Function or host-script execution.
export const SESSION_READBACK = 'dgce:saved-session-readback-v1';
const ORIGIN = 'https://v2.dreamgen.com';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 2 * 1024 * 1024;

function reader(text, start) {
  let at = start, count = 0;
  const refs = new Map();
  const fail = () => { throw new Error('Unsupported saved-session representation'); };
  const ws = () => { while (/\s/.test(text[at] ?? '') && at < text.length) at++; };
  const take = token => { ws(); if (!text.startsWith(token, at)) fail(); at += token.length; };
  function string() {
    take('"'); let encoded = '"';
    while (at < text.length) {
      const char = text[at++];
      if (char === '\\') {
        const escape = text[at++];
        if (escape === 'x') {
          const hex = text.slice(at, at + 2);
          if (!/^[0-9a-f]{2}$/i.test(hex)) fail();
          encoded += '\\u00' + hex; at += 2;
        } else encoded += '\\' + escape;
        continue;
      }
      if (char === '"') {
        // JS permits literal NUL in route-match strings; JSON requires escaping.
        return JSON.parse(encoded + '"');
      }
      encoded += char.charCodeAt(0) < 32 ? '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0') : char;
    }
    fail();
  }
  function value(depth = 0) {
    if (++count > 100000 || depth > 64) fail();
    ws();
    if (text.startsWith('$R[', at)) {
      const match = /^\$R\[(\d{1,6})\]/.exec(text.slice(at));
      if (!match) fail(); at += match[0].length; ws();
      const key = match[1];
      if (text[at] !== '=') { if (!refs.has(key)) fail(); return refs.get(key); }
      if (refs.has(key)) fail(); at++;
      const result = value(depth + 1); refs.set(key, result); return result;
    }
    if (text[at] === '"') return string();
    if (text[at] === '{') {
      at++; const result = Object.create(null); ws();
      if (text[at] === '}') { at++; return result; }
      while (at < text.length) {
        ws(); let key;
        if (text[at] === '"') key = string();
        else { const m = /^[A-Za-z_$][\w$]*/.exec(text.slice(at)); if (!m) fail(); key = m[0]; at += key.length; }
        if (Object.hasOwn(result, key) || ['__proto__', 'prototype', 'constructor'].includes(key)) fail();
        take(':'); result[key] = value(depth + 1); ws();
        if (text[at] === '}') { at++; return result; } take(',');
      }
      fail();
    }
    if (text[at] === '[') {
      at++; const result = []; ws();
      if (text[at] === ']') { at++; return result; }
      while (at < text.length) {
        result.push(value(depth + 1)); ws();
        if (text[at] === ']') { at++; return result; } take(',');
      }
      fail();
    }
    if (text.startsWith('new Date(', at)) { take('new Date('); const date = string(); take(')'); if (!Number.isFinite(Date.parse(date))) fail(); return date; }
    for (const [token, result] of [['void 0', undefined], ['null', null], ['true', true], ['false', false], ['!0', true], ['!1', false]]) {
      if (text.startsWith(token, at) && !/[\w$]/.test(text[at + token.length] ?? '')) { at += token.length; return result; }
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(at));
    if (number) { at += number[0].length; const n = Number(number[0]); if (!Number.isFinite(n)) fail(); return n; }
    fail();
  }
  return { value, end: () => at };
}

function matchEnvelopes(html) {
  const values = [];
  for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    const text = script[1];
    for (let at = 0; at < text.length; at++) {
      const char = text[at];
      // Never discover structural keys inside quoted story or script strings.
      if (char === '"' || char === "'" || char === '`') {
        const quote = char;
        while (++at < text.length) { if (text[at] === '\\') at++; else if (text[at] === quote) break; }
        continue;
      }
      if (text.startsWith('//', at)) { const end = text.indexOf('\n', at); at = end < 0 ? text.length : end; continue; }
      if (text.startsWith('/*', at)) { const end = text.indexOf('*/', at + 2); if (end < 0) throw new Error('Unclosed script comment'); at = end + 1; continue; }
      if (!text.startsWith('matches:', at) || !/[{,]/.test(text[at - 1] ?? '')) continue;
      const data = reader(text, at + 'matches:'.length);
      const matches = data.value();
      if (!text.startsWith(',lastMatchId:', data.end())) throw new Error('Unsupported loader boundary');
      values.push(matches); at = data.end() - 1;
    }
  }
  return values;
}

export function parseSavedSession(html, workspaceId) {
  if (typeof html !== 'string' || new TextEncoder().encode(html).length > MAX_BYTES || !UUID.test(workspaceId)) throw new Error('Invalid saved-session response');
  const envelopes = matchEnvelopes(html);
  if (envelopes.length !== 1 || !Array.isArray(envelopes[0])) throw new Error('Missing or ambiguous session loader');
  const route = `\0app\0my\0session\0$sessionId\0\0app\0my\0session\0${workspaceId}\0`;
  const candidates = envelopes[0].filter(match => match?.i === route && match.s === 'success' && match.ssr === 'data-only');
  if (candidates.length !== 1) throw new Error('Saved-session route mismatch');
  const session = candidates[0].l?.session, rows = session?.data?.interactions;
  if (session?.id !== workspaceId || !Array.isArray(rows) || rows.length > 10000) throw new Error('Unsupported saved-session data');
  const ids = new Set();
  for (const row of rows) {
    if (!UUID.test(row?.id) || ids.has(row.id) || (row.parentId != null && !UUID.test(row.parentId))
        || row.data?.body?.content?.kind !== 'text' || typeof row.data.body.content.data !== 'string') throw new Error('Ambiguous or unsupported interaction');
    ids.add(row.id);
  }
  // This list may be partial. It witnesses one exact record, NOT all history.
  return { workspace_id: session.id, interactions: rows.map(row => ({ interaction_id: row.id,
    parent_id: row.parentId ?? null, raw_text: row.data.body.content.data })) };
}

export async function readSavedInteraction({ workspaceId, interactionId, fetchImpl = fetch }) {
  if (!UUID.test(workspaceId) || !UUID.test(interactionId)) throw new Error('Invalid readback identity');
  const url = `${ORIGIN}/app/my/session/${workspaceId}`;
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetchImpl(url, { method: 'GET', credentials: 'include', cache: 'no-store',
      redirect: 'error', headers: { Accept: 'text/html' }, signal: controller.signal });
    if (!response.ok || response.url !== url || !/^text\/html\b/i.test(response.headers.get('content-type') ?? '')
        || Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Saved-session fetch unavailable');
    const stream = response.body?.getReader(); if (!stream) throw new Error('Missing saved-session body');
    let size = 0, html = ''; const decoder = new TextDecoder('utf-8', { fatal: true });
    try {
      while (true) {
        const { done, value } = await stream.read(); if (done) break;
        size += value.byteLength; if (size > MAX_BYTES) throw new Error('Saved-session response too large');
        html += decoder.decode(value, { stream: true });
      }
      html += decoder.decode();
    } finally { await stream.cancel().catch(() => {}); }
    const session = parseSavedSession(html, workspaceId);
    const rows = session.interactions.filter(row => row.interaction_id === interactionId);
    if (rows.length !== 1) throw new Error('Saved interaction not found');
    return { ...rows[0], workspace_id: session.workspace_id, candidate_count: rows.length,
      source: 'extension_authenticated_session_get_v1' };
  } finally { clearTimeout(timeout); }
}

export function installSessionReadback({ runtime = chrome.runtime, fetchImpl = fetch } = {}) {
  const last = new Map(), busy = new Set();
  const listener = (message, sender, reply) => {
    if (message?.type !== SESSION_READBACK) return;
    // Chrome's content-script context URL can predate a same-document host
    // navigation. Only browser-supplied top-level tab metadata may resolve it;
    // never accept a current URL supplied in the message or read from the DOM.
    const effectiveUrl = sender.tab?.url ?? sender.url;
    const moved = effectiveUrl !== sender.url;
    let origin;
    try { origin = new URL(sender.url).origin; } catch { return; }
    if (origin !== ORIGIN || (sender.documentLifecycle && sender.documentLifecycle !== 'active')
        || (moved && (sender.origin !== ORIGIN || sender.documentLifecycle !== 'active'))) return;
    const route = /^https:\/\/v2\.dreamgen\.com\/app\/my\/session\/([0-9a-f-]{36})$/.exec(effectiveUrl ?? '');
    if (sender.id !== runtime.id || !sender.tab || sender.frameId !== 0 || !sender.documentId
        || !route || route[1] !== message.workspaceId || !UUID.test(message.interactionId)) return;
    const key = `${sender.tab.id}:${sender.documentId}`;
    if (busy.has(key) || Date.now() - (last.get(key) ?? 0) < 2000) { reply({ ok: false, reason: 'Readback busy' }); return; }
    if (last.size > 100) last.clear();
    last.set(key, Date.now()); busy.add(key);
    readSavedInteraction({ workspaceId: route[1], interactionId: message.interactionId, fetchImpl })
      .then(value => reply({ ok: true, value }), () => reply({ ok: false, reason: 'Saved-session identity readback unavailable; retain recovery.' }))
      .finally(() => busy.delete(key));
    return true;
  };
  runtime.onMessage.addListener(listener);
  return () => runtime.onMessage.removeListener(listener);
}
