// DreamGen request-payload reader/writer.
//
// Captured shape (live probe, 2026-08-28). A string-table encoding consistent
// with TanStack Start server functions:
//
//   { t: 10, i: N, p: { k: [names], v: [nodes] } }   object
//   { t:  9, i: N, a: [nodes] }                      array
//   { t:  1, s: "…" }                                string
//
// The turn we care about sits at:
//   data.upsert[].data.body.content = { kind: "text", data: "<the turn text>" }
//
// EVERYTHING HERE FAILS CLOSED. If the payload does not match exactly what we
// observed — zero candidates, more than one, an unexpected node type — we
// return null and inject nothing. Losing a turn's memory is a small cost;
// corrupting a user's turn because the host changed shape under us is not.
//
//   law: uncertain_shape => do_not_inject

const T_STRING = 1;
const T_ARRAY = 9;
const T_OBJECT = 10;

// Seroval string nodes carry a SECOND escaping layer inside JSON's strings.
// Decode/encode only this bounded text representation, never evaluate a payload.
// One-pass replacement preserves literal backslashes (e.g. a player's "\\n").
// Wire mapping: https://github.com/lxsmnsyc/seroval/blob/main/packages/seroval/src/core/string.ts
const STRING_ESCAPES = Object.freeze({
  '"': '\\"', '\\': '\\\\', '\n': '\\n', '\r': '\\r', '\b': '\\b',
  '\t': '\\t', '\f': '\\f', '<': '\\x3C', '\u2028': '\\u2028', '\u2029': '\\u2029',
});
const STRING_UNESCAPES = Object.fromEntries(Object.entries(STRING_ESCAPES).map(([a, b]) => [b, a]));
export const encodeWireString = text => text.replace(/["\\\n\r\b\t\f<\u2028\u2029]/g, char => STRING_ESCAPES[char]);
export const decodeWireString = text => text.replace(/\\(?:\\|"|n|r|b|t|f|x3C|u2028|u2029)/g, escape => STRING_UNESCAPES[escape]);

export function parsePayload(body) {
  if (typeof body !== 'string') return null;
  try {
    const doc = JSON.parse(body);
    if (!doc || typeof doc !== 'object') return null;
    // JSON validity does not establish wire-node validity. Bound traversal too:
    // a tiny but deeply nested body must not overflow recursive consumers.
    const pending = [[doc, 0]];
    let visited = 0;
    while (pending.length) {
      const [node, depth] = pending.pop();
      if (!node || typeof node !== 'object') continue;
      if (++visited > 100_000 || depth > 128) return null;
      if (node.t === T_OBJECT && (!Array.isArray(node.p?.k) || !Array.isArray(node.p?.v)
          || node.p.k.length !== node.p.v.length || node.p.k.some(k => typeof k !== 'string')
          || new Set(node.p.k).size !== node.p.k.length)) return null;
      if (node.t === T_ARRAY && !Array.isArray(node.a)) return null;
      if (node.t === T_STRING && typeof node.s !== 'string') return null;
      for (const child of Object.values(node)) {
        if (child && typeof child === 'object') pending.push([child, depth + 1]);
      }
    }
    return doc;
  } catch {
    return null;
  }
}

const isObjectNode = (n) => n && typeof n === 'object' && n.t === T_OBJECT
  && Array.isArray(n.p?.k) && Array.isArray(n.p?.v) && n.p.k.length === n.p.v.length;
const isArrayNode = (n) => n && typeof n === 'object' && n.t === T_ARRAY && Array.isArray(n.a);
const isStringNode = (n) => n && typeof n === 'object' && n.t === T_STRING && typeof n.s === 'string';
// Live first-interaction capture (2026-09-15): an explicit no-parent value.
// Missing, arbitrary constants, and plain null are not this captured encoding.
const isNoParentNode = (n) => n && typeof n === 'object' && n.t === 2 && n.s === 1;

/** Value node for `key` on an object node, or undefined. */
function field(node, key) {
  if (!isObjectNode(node)) return undefined;
  const i = node.p.k.indexOf(key);
  return i === -1 ? undefined : node.p.v[i];
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  if (isObjectNode(node)) node.p.v.forEach((child) => walk(child, visit));
  else if (isArrayNode(node)) node.a.forEach((child) => walk(child, visit));
  else for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v, visit);
}

/**
 * Every `{ kind: "text", data: "…" }` content node in the payload.
 * Returns the STRING NODE holding the text, so a caller can read or mutate
 * `.s` in place.
 */
export function findTextContentNodes(doc) {
  const found = [];
  walk(doc, (node) => {
    if (!isObjectNode(node)) return;
    const kind = field(node, 'kind');
    const data = field(node, 'data');
    if (isStringNode(kind) && kind.s === 'text' && isStringNode(data)) found.push(data);
  });
  return found;
}

/** The interaction ids being upserted, for the audit log. */
export function findUpsertIds(doc) {
  const ids = [];
  walk(doc, (node) => {
    if (!isObjectNode(node)) return;
    const id = field(node, 'id');
    const parentId = field(node, 'parentId');
    if (isStringNode(id) && (isStringNode(parentId) || isNoParentNode(parentId))) {
      ids.push({ id: id.s, parentId: isStringNode(parentId) ? parentId.s : null });
    }
  });
  return ids;
}

export function findSessionId(doc) {
  let found = null;
  walk(doc, (node) => {
    if (found || !isObjectNode(node)) return;
    const v = field(node, 'sessionId');
    if (isStringNode(v)) found = v.s;
  });
  return found;
}

/** The session head declared by the persist envelope, or null. */
export function findHeadInteractionId(doc) {
  let found = null;
  walk(doc, (node) => {
    if (found || !isObjectNode(node)) return;
    const v = field(node, 'headInteractionId');
    if (isStringNode(v)) found = v.s;
  });
  return found;
}

/** Number of interactions the persist envelope asks the host to delete. */
export function findDeleteCount(doc) {
  let found = null;
  walk(doc, (node) => {
    if (found !== null || !isObjectNode(node)) return;
    const v = field(node, 'delete');
    if (isArrayNode(v)) found = v.a.length;
  });
  return found;
}

/** Read the single turn's text, or null if the payload is not a single-turn write. */
export function readTurnText(body) {
  const doc = parsePayload(body);
  if (!doc) return null;
  const nodes = findTextContentNodes(doc);
  return nodes.length === 1 ? decodeWireString(nodes[0].s) : null;
}

/**
 * Rewrite the single turn's text.
 *
 * Requires EXACTLY ONE text content node. A send carries one; anything else
 * means we are looking at a payload we do not understand — a batch write, a
 * different operation, or a changed host — and we decline rather than guess
 * which one to touch.
 *
 * Returns the new body string, or null if we declined.
 */
export function writeTurnText(body, nextText) {
  const doc = parsePayload(body);
  if (!doc) return null;
  const nodes = findTextContentNodes(doc);
  if (nodes.length !== 1) return null;
  if (typeof nextText !== 'string') return null;

  const original = nodes[0].s;
  nodes[0].s = encodeWireString(nextText);
  try {
    return JSON.stringify(doc);
  } catch {
    nodes[0].s = original; // leave the caller's object as we found it
    return null;
  }
}

/** True when this request looks like a single-turn persist we can augment. */
export function isSingleTurnWrite(body) {
  const doc = parsePayload(body);
  if (!doc) return false;
  return findTextContentNodes(doc).length === 1 && findSessionId(doc) !== null;
}

/**
 * True only for the live-captured shape of a newly appended user turn.
 *
 * DreamGen sends edits through the same persist endpoint as new turns. An edit
 * must never acquire fresh context in the past, and edited prose must not count
 * as a new user-authored confirmation. The captured append has one upsert, no
 * deletions, and promotes that upsert to the session head. Anything else is an
 * edit, a batch operation, or a host shape we have not established, so it is
 * declined.
 *
 * This is deliberately a sufficient condition, not a claim that every future
 * host append must keep this shape. Missing one turn's context is cheaper than
 * writing context into an old turn.
 *
 *   law: append_shape_known => injection_eligible
 *        edit_or_unknown_shape => do_not_inject
 */
export function isAppendShapedTurnWrite(body) {
  const doc = parsePayload(body);
  if (!doc || findTextContentNodes(doc).length !== 1 || findSessionId(doc) === null) return false;

  const ids = findUpsertIds(doc);
  const head = findHeadInteractionId(doc);
  const deletes = findDeleteCount(doc);
  return ids.length === 1 && head !== null && ids[0].id === head && deletes === 0;
}

/** Append structure alone does not establish player authorship: generated
 * replies use the same persist endpoint. The captured Instruction role is
 * user; player-character messages are writer + exclusively user-labelled
 * characters. An unlabelled narrative is ambiguous and must not drive turns. */
export function isPlayerTurnWrite(body) {
  if (!isAppendShapedTurnWrite(body)) return false;
  const doc = parsePayload(body);
  const headers = [];
  walk(doc, (node) => {
    const header = field(node, 'header');
    if (header) headers.push(header);
  });
  if (headers.length !== 1) return false;
  const role = field(headers[0], 'role');
  if (!isStringNode(role)) return false;
  if (role.s === 'user') return true;
  const characters = field(headers[0], 'characters');
  return role.s === 'writer' && isArrayNode(characters) && characters.a.length > 0
    && characters.a.every((character) => {
      const label = field(character, 'label');
      return isStringNode(label) && label.s === 'user';
    });
}

/**
 * Structural description of a payload, for evidence-gathering only.
 *
 * The prune gate asks for proof that an in-place edit keeps its id and parent
 * and is accepted by the host. The host performs that edit itself, so the
 * cheapest proof is to watch it do so — and the extension already receives
 * every outgoing body, so no request needs to be made to find out.
 *
 * Reports SHAPE ONLY: node kinds, key names, counts, and string lengths. Never
 * the strings themselves. What the user wrote is not evidence about the wire
 * format, and a debugging aid is a poor reason to copy someone's fiction into
 * a console.
 *
 *   law: shape_is_evidence != content_is_evidence
 */
export function describeShape(body, { maxDepth = 6 } = {}) {
  const doc = parsePayload(body);
  if (!doc) return { parsed: false, bytes: typeof body === 'string' ? body.length : 0 };

  const idish = /^(id|.*_id|.*Id|consistency|kind|role|type|version)$/;
  const seen = [];

  const walk = (node, depth, path) => {
    if (depth > maxDepth || node == null) return;
    if (typeof node === 'string') return;
    if (Array.isArray(node)) {
      node.slice(0, 4).forEach((n, i) => walk(n, depth + 1, `${path}[${i}]`));
      return;
    }
    if (typeof node !== 'object') return;

    // The captured encoding stores objects as { p: { k: [...], v: [...] } }.
    const keys = node.p?.k ?? Object.keys(node);
    const vals = node.p?.v ?? Object.values(node);
    if (!Array.isArray(keys) || !Array.isArray(vals)) return;

    const row = { path, keys: keys.slice(0, 24) };
    const marks = {};
    keys.forEach((k, i) => {
      const v = vals[i];
      if (!idish.test(String(k))) return;
      // Report only the SHAPE of an identifier: its length and whether it looks
      // like a uuid. The value itself is not needed to build a writer.
      const s = v?.s ?? (typeof v === 'string' ? v : null);
      if (typeof s === 'string') {
        marks[k] = /^[0-9a-f-]{36}$/i.test(s) ? 'uuid' : `str(${s.length})`;
      } else if (typeof v === 'number') marks[k] = 'num';
    });
    if (Object.keys(marks).length) row.marks = marks;
    seen.push(row);

    keys.forEach((k, i) => walk(vals[i], depth + 1, `${path}.${k}`));
  };

  walk(doc.t ?? doc, 0, '$');

  return {
    parsed: true,
    bytes: typeof body === 'string' ? body.length : 0,
    textNodes: findTextContentNodes(doc).length,
    upsertIds: findUpsertIds(doc).length,
    deleteIds: findDeleteCount(doc),
    upsertIsHead:
      findUpsertIds(doc).length === 1
      && findUpsertIds(doc)[0].id === findHeadInteractionId(doc),
    singleTurnWrite: isSingleTurnWrite(body),
    appendShapedTurnWrite: isAppendShapedTurnWrite(body),
    nodes: seen.slice(0, 40),
  };
}
