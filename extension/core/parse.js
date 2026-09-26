// Strict Archivist output parsing. Spec §10b.
//
// Everything here is structural and workspace-independent: shape, types,
// vocabulary. Anything that needs to know the current state — merge legality,
// promotion budget, replay — lives in apply.js, because a validator that needs
// the workspace cannot be reasoned about on its own.
//
//   law: invalid_Archivist_output = no_state_change
//        normalization != salvage

export class ParseError extends Error {
  constructor(message, errors = []) {
    super(message);
    this.errors = errors.length ? errors : [message];
  }
}

export const REASON_CODES = new Set([
  'confirmation_withheld_recent_model_overlap',
  'repeated_archivist_detection',
  'repeated_assistant_mention',
  'possible_duplicate',
  'merge_proposed',
  'deferred_promotion',
  'ambiguous_user_reference',
  'defined_entity_duplicate',
]);

const SURFACES = new Set(['event_log', 'social_context', 'inventory']);
const KINDS = new Set(['npc', 'location', 'event', 'object']);
const REVIEW_STATES = new Set(['confirmed', 'unconfirmed']);

// op -> { required, optional }
const OPS = {
  SET_SURFACE: { required: ['op', 'surface', 'text'], optional: [] },
  UPSERT_CARD: {
    required: ['op', 'kind', 'id', 'name_or_title', 'aliases', 'summary', 'link_ids', 'review_state'],
    optional: [],
  },
  PROMOTE_TO_ACTIVE: { required: ['op', 'kind', 'id', 'active_position'], optional: [] },
  REVIEW_SIGNAL: { required: ['op', 'id', 'reason_code'], optional: ['detail'] },
  MERGE_CARD: { required: ['op', 'duplicate_id', 'canonical_id'], optional: [] },
  SET_LINKS: { required: ['op', 'id', 'link_ids'], optional: [] },
  NO_CHANGE: { required: ['op'], optional: [] },
};

/**
 * Deterministic, non-semantic pre-step. Spec §10b parse_tolerance.
 * Strips a BOM, surrounding whitespace, and exactly ONE wrapping code fence.
 * A single unpaired fence is malformed — we do not guess.
 */
export function normalize(raw) {
  if (typeof raw !== 'string') throw new ParseError('archivist output was not a string');

  let text = raw.replace(/^﻿/, '').trim();

  const open = text.match(/^(`{3,})[ \t]*[A-Za-z0-9_-]*[ \t]*\r?\n/);
  const closeRe = /\r?\n(`{3,})$/;
  const close = text.match(closeRe);

  if (open && close) {
    if (close[1].length < open[1].length) {
      throw new ParseError('closing fence is shorter than the opening fence');
    }
    text = text.slice(open[0].length, text.length - close[0].length).trim();
  } else if (open || close) {
    // if_only_one_fence_present: treat as malformed; do not guess
    throw new ParseError('unpaired markdown code fence');
  }

  return text;
}

function typeError(path, expected, value) {
  return `${path}: expected ${expected}, got ${value === null ? 'null' : typeof value}`;
}

function isStringArray(v) {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/**
 * Parse and structurally validate. Returns { schema_version, run_id, operations }.
 * Collects every error rather than throwing on the first, so a retry prompt can
 * carry the full list (§10b retry_prompt).
 */
export function parseArchivistOutput(raw) {
  const text = normalize(raw);

  let doc;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    throw new ParseError(`not valid JSON: ${e.message}`);
  }

  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new ParseError('top level must be a JSON object');
  }

  const errors = [];

  const allowedTop = new Set(['schema_version', 'run_id', 'operations']);
  for (const key of Object.keys(doc)) {
    if (!allowedTop.has(key)) errors.push(`unknown top-level field: ${key}`);
  }

  if (doc.schema_version !== 1) errors.push(`schema_version must be 1, got ${doc.schema_version}`);
  if (typeof doc.run_id !== 'string' || !doc.run_id) errors.push('run_id must be a non-empty string');
  if (!Array.isArray(doc.operations)) errors.push('operations must be an array');

  if (Array.isArray(doc.operations)) {
    doc.operations.forEach((op, i) => validateOperation(op, i, errors));
  }

  if (errors.length) throw new ParseError('archivist output failed validation', errors);
  return doc;
}

function validateOperation(op, i, errors) {
  const at = `operations[${i}]`;

  if (op === null || typeof op !== 'object' || Array.isArray(op)) {
    errors.push(`${at}: must be an object`);
    return;
  }

  const spec = OPS[op.op];
  if (!spec) {
    errors.push(`${at}: unknown op ${JSON.stringify(op.op)}`);
    return;
  }

  const allowed = new Set([...spec.required, ...spec.optional]);
  for (const key of Object.keys(op)) {
    if (!allowed.has(key)) errors.push(`${at}: unknown field ${key} for ${op.op}`);
  }
  for (const key of spec.required) {
    if (!(key in op)) errors.push(`${at}: missing required field ${key}`);
  }

  switch (op.op) {
    case 'SET_SURFACE':
      if (!SURFACES.has(op.surface)) errors.push(`${at}: unknown surface ${op.surface}`);
      if (typeof op.text !== 'string') errors.push(typeError(`${at}.text`, 'string', op.text));
      break;

    case 'UPSERT_CARD':
      if (!KINDS.has(op.kind)) errors.push(`${at}: unknown kind ${op.kind}`);
      if (typeof op.id !== 'string' || !op.id) errors.push(typeError(`${at}.id`, 'string', op.id));
      if (typeof op.name_or_title !== 'string') {
        errors.push(typeError(`${at}.name_or_title`, 'string', op.name_or_title));
      }
      if (typeof op.summary !== 'string') errors.push(typeError(`${at}.summary`, 'string', op.summary));
      if (!isStringArray(op.aliases)) errors.push(`${at}.aliases: expected string[]`);
      if (!isStringArray(op.link_ids)) errors.push(`${at}.link_ids: expected string[]`);
      if (!REVIEW_STATES.has(op.review_state)) {
        errors.push(`${at}: unknown review_state ${op.review_state}`);
      }
      break;

    case 'PROMOTE_TO_ACTIVE':
      if (!KINDS.has(op.kind)) errors.push(`${at}: unknown kind ${op.kind}`);
      if (typeof op.id !== 'string') errors.push(typeError(`${at}.id`, 'string', op.id));
      // no coercion: "2" is not 2
      if (!Number.isInteger(op.active_position)) {
        errors.push(`${at}.active_position: expected integer, got ${JSON.stringify(op.active_position)}`);
      }
      break;

    case 'REVIEW_SIGNAL':
      if (typeof op.id !== 'string') errors.push(typeError(`${at}.id`, 'string', op.id));
      if (!REASON_CODES.has(op.reason_code)) {
        errors.push(`${at}: unknown reason_code ${JSON.stringify(op.reason_code)}`);
      }
      if ('detail' in op && typeof op.detail !== 'string') {
        errors.push(typeError(`${at}.detail`, 'string', op.detail));
      }
      break;

    case 'MERGE_CARD':
      if (typeof op.duplicate_id !== 'string') {
        errors.push(typeError(`${at}.duplicate_id`, 'string', op.duplicate_id));
      }
      if (typeof op.canonical_id !== 'string') {
        errors.push(typeError(`${at}.canonical_id`, 'string', op.canonical_id));
      }
      break;

    case 'SET_LINKS':
      if (typeof op.id !== 'string') errors.push(typeError(`${at}.id`, 'string', op.id));
      if (!isStringArray(op.link_ids)) errors.push(`${at}.link_ids: expected string[]`);
      break;

    case 'NO_CHANGE':
      break;
  }
}
