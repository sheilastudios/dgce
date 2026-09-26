// Entity authority boundary between scenario/campaign definitions and the
// emergent continuity-card index.

import { normalizeTerm } from './ids.js';
import { rebuildAliasIndex } from './aliases.js';
import { activeIds, removeFromOrder } from './ordering.js';

export const REASON_DEFINED_ELSEWHERE = 'defined_entity_duplicate';

const emptyGroups = () => ({ persona: [], npc: [], location: [], object: [] });
const clean = (value) => String(value ?? '').trim();
const GENRE_VALUE_LIMIT = 6;
const GENRE_VALUE_CHARS = 120;
const DYNAMICS_VALUE_LIMIT = 12;
const DYNAMICS_VALUE_CHARS = 220;
const clipCodePoints = (text, limit) => [...text].slice(0, limit).join('');

function promptDatum(value) {
  return clipCodePoints(clean(value).replace(/\s+/g, ' '), GENRE_VALUE_CHARS);
}

function promptData(value, depth = 0) {
  if (depth > 2 || value == null) return [];
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const datum = promptDatum(value);
    return datum ? [datum] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item) => promptData(item, depth + 1));
  if (typeof value === 'object') {
    return Object.values(value).flatMap((item) => promptData(item, depth + 1));
  }
  return [];
}

function uniquePromptData(...sources) {
  const out = [];
  const seen = new Set();
  for (const value of sources.flatMap((source) => promptData(source))) {
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= GENRE_VALUE_LIMIT) break;
  }
  return out;
}

function fieldValue(fields, ...ids) {
  for (const id of ids) {
    const record = fields?.[id];
    if (record && Object.hasOwn(record, 'value')) return record.value;
  }
  return null;
}

/** Published descriptive genre data for Assistant flavoring, never rule authority. */
export function campaignGenreProfile(campaign) {
  const fields = campaign?.publication?.active?.foundation?.fields ?? {};
  const genre = fieldValue(fields, 'genre', 'genres');
  const tone = fieldValue(fields, 'tone', 'toneAndAesthetic', 'tone_and_aesthetic');
  const themes = fieldValue(fields, 'themes', 'theme');
  const genreObject = genre && typeof genre === 'object' && !Array.isArray(genre) ? genre : null;

  const primary = genreObject
    ? uniquePromptData(
      genreObject.primary, genreObject.genre, genreObject.genres,
      genreObject.name, genreObject.value,
    )
    : uniquePromptData(genre);
  const profileTone = uniquePromptData(
    genreObject?.tone, genreObject?.aesthetic,
    tone,
  );
  const focus = uniquePromptData(
    genreObject?.focus, genreObject?.focuses, genreObject?.priorities,
  );
  const profileThemes = uniquePromptData(
    genreObject?.themes, genreObject?.theme,
    themes,
  );

  return { primary, tone: profileTone, focus, themes: profileThemes };
}

const DYNAMICS_FIELDS = [
  ['Core experience', ['coreExperience', 'core_experience']],
  ['Authority', ['interactionAuthority', 'interaction_authority']],
  ['Structure', ['campaignStructure', 'campaign_structure']],
  ['Realism', ['realismProfile', 'realism_profile']],
  ['Character architecture', ['characterArchitecture', 'character_architecture']],
  ['World architecture', ['worldArchitecture', 'world_architecture']],
];

function collectDynamics(value, path, out, depth = 0) {
  if (value == null || depth > 6) return;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const datum = clipCodePoints(clean(value).replace(/\s+/g, ' '), DYNAMICS_VALUE_CHARS);
    if (datum) out.push(`${path.join('.')}: ${datum}`);
    return;
  }
  if (Array.isArray(value)) {
    const primitive = value.every((item) =>
      typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean');
    if (primitive) {
      const datum = clipCodePoints(value.map(clean).filter(Boolean).join('; '), DYNAMICS_VALUE_CHARS);
      if (datum) out.push(`${path.join('.')}: ${datum}`);
      return;
    }
    for (const item of value) collectDynamics(item, path, out, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (/^(?:question|status|note|source|source_ref)$/i.test(key)) continue;
      collectDynamics(item, [...path, key], out, depth + 1);
    }
  }
}

function dynamicsPriority(value) {
  const text = value.toLowerCase();
  if (/transition|attention|presence|reality|virtual|physical|layer|embodiment|foreground|interrupt/.test(text)) return 0;
  if (/authority|control|voluntary|involuntary|offscreen|concurrent|simultaneous|causal/.test(text)) return 1;
  return 2;
}

/** Published public campaign dynamics for optional-pressure generation. */
export function campaignDynamicsProfile(campaign) {
  const fields = campaign?.publication?.active?.foundation?.fields ?? {};
  const rows = [];
  for (const [label, ids] of DYNAMICS_FIELDS) {
    const value = fieldValue(fields, ...ids);
    collectDynamics(value, [label], rows);
  }
  const seen = new Set();
  return rows
    .map((value, index) => ({ value, index, priority: dynamicsPriority(value) }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .filter(({ value }) => {
      const key = value.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, DYNAMICS_VALUE_LIMIT)
    .map(({ value }) => value);
}

function add(groups, kind, name, description = '', source = 'campaign') {
  const value = clean(name);
  if (!value || !groups[kind]) return;
  const key = normalizeTerm(value);
  if (!key || groups[kind].some((entry) => normalizeTerm(entry.name) === key)) return;
  groups[kind].push({ name: value, description: clean(description), source, kind });
}

function personKind(value) {
  const text = clean(value).toLowerCase();
  return /\b(player|protagonist|persona)\b/.test(text) ? 'persona' : 'npc';
}

function namedPersonFromData(groups, component, data) {
  const semantic = [
    component?.id, component?.kind, data?.type, data?.kind, data?.role,
    data?.entityType, data?.entity_type, data?.category,
  ].map(clean).join(' ');
  if (!/\b(actor|char|character|npc|person|persona|player|protagonist|companion|friend|prospect|cast|roster)\b/i.test(semantic)) return;
  const identity = data?.identity && typeof data.identity === 'object' ? data.identity : {};
  const name = data?.name ?? data?.displayName ?? data?.display_name
    ?? data?.characterName ?? data?.character_name ?? data?.npcName ?? data?.npc_name
    ?? data?.personaName ?? data?.persona_name ?? identity.name;
  add(groups, personKind(semantic), name, data?.description ?? data?.summary, `campaign:${component.id}`);
}

function namedRows(groups, component, data) {
  const semantic = `${clean(component?.id)} ${clean(data?.type)} ${clean(data?.category)}`;
  if (!/\b(actor|char|character|npc|person|persona|player|protagonist|companion|friend|prospect|cast|roster)\b/i.test(semantic)) return;
  const rows = data?.rows ?? data?.entries ?? data?.characters ?? data?.actors ?? data?.people;
  if (!Array.isArray(rows)) return;
  for (const row of rows) {
    if (typeof row === 'string') add(groups, 'npc', row, '', `campaign:${component.id}`);
    else if (row && typeof row === 'object') namedPersonFromData(groups, component, row);
  }
}

function declaredRoleName(value) {
  const text = clean(value);
  if (!text) return '';
  const qualified = /^([\p{L}][\p{L}'-]*(?:\s+[\p{L}][\p{L}'-]*){0,3})\s*\((?:self[- ]?insert|player|ai|npc|character)\)$/iu.exec(text);
  if (qualified) return qualified[1];
  return /^[\p{Lu}][\p{L}'-]*(?:\s+[\p{Lu}][\p{L}'-]*){0,3}$/u.test(text) ? text : '';
}

function addFoundationActors(groups, campaign) {
  const fields = campaign?.publication?.active?.foundation?.fields ?? {};
  const record = fields.interactionAuthority ?? fields.interaction_authority;
  const value = record?.value && typeof record.value === 'object' ? record.value : {};
  const player = declaredRoleName(value.playerRole ?? value.player_role ?? value.player);
  const actor = declaredRoleName(value.actorRole ?? value.actor_role ?? value.actor);
  add(groups, 'persona', player, '', 'campaign:interactionAuthority');
  add(groups, 'npc', actor, '', 'campaign:interactionAuthority');
}

/** Explicit names owned by the published campaign, never inferred from prose. */
export function campaignEntityGroups(campaign) {
  const groups = emptyGroups();
  if (!campaign?.publication?.active) return groups;

  addFoundationActors(groups, campaign);
  add(groups, 'persona', campaign?.character?.identity?.name, '', 'campaign:player');

  for (const component of campaign.publication.active.components ?? []) {
    const data = component?.data && typeof component.data === 'object' ? component.data : {};
    namedPersonFromData(groups, component, data);
    namedRows(groups, component, data);
  }

  const personaTerms = new Set(groups.persona.map((entry) => normalizeTerm(entry.name)));
  groups.npc = groups.npc.filter((entry) => !personaTerms.has(normalizeTerm(entry.name)));
  return groups;
}

export function mergeEntityGroups(...sources) {
  const merged = emptyGroups();
  for (const source of sources) {
    for (const kind of Object.keys(merged)) {
      for (const entry of source?.[kind] ?? []) {
        add(merged, kind, entry.name, entry.description, entry.source ?? 'scenario');
      }
    }
  }
  return merged;
}

/** Cast and place context for assisted deck generation, including campaign-owned actors. */
export function campaignDeckContext(ws) {
  const groups = campaignEntityGroups(ws?.campaign);
  const genreProfile = campaignGenreProfile(ws?.campaign);
  const dynamicsProfile = campaignDynamicsProfile(ws?.campaign);
  const personaNames = new Set((groups.persona ?? []).map((entry) => normalizeTerm(entry.name)));
  const activeCards = Object.keys(ws?.order ?? {}).flatMap((kind) =>
    activeIds(ws, kind).map((id) => ws.cards[id]).filter(Boolean),
  );
  const knownNames = [];
  const known = new Set();
  const addKnown = (name) => {
    const value = clean(name);
    const key = normalizeTerm(value);
    if (!key || known.has(key)) return;
    known.add(key);
    knownNames.push(value);
  };
  for (const card of activeCards) addKnown(card.name_or_title);
  for (const entry of groups.npc ?? []) addKnown(entry.name);

  const actorRows = [
    ...(groups.npc ?? []),
    ...activeCards
      .filter((card) => card.kind === 'npc' && !personaNames.has(normalizeTerm(card.name_or_title)))
      .map((card) => ({ name: card.name_or_title, description: card.summary })),
  ];
  const actorSeen = new Set();
  const establishedActors = [];
  for (const actor of actorRows) {
    const name = clean(actor.name);
    const key = normalizeTerm(name);
    if (!key || actorSeen.has(key)) continue;
    actorSeen.add(key);
    const description = clean(actor.description);
    establishedActors.push(description ? `${name}: ${description}` : name);
  }
  return { knownNames, establishedActors, genreProfile, dynamicsProfile };
}

export function protectedCardMatch(card, groups) {
  if (!card) return null;
  const candidates = card.kind === 'npc'
    ? [...(groups?.persona ?? []), ...(groups?.npc ?? [])]
    : card.kind === 'location' ? (groups?.location ?? [])
    : card.kind === 'object' ? (groups?.object ?? []) : [];
  const terms = [card.name_or_title, ...(card.aliases ?? [])].map(normalizeTerm).filter(Boolean);
  return candidates.find((entry) => terms.includes(normalizeTerm(entry.name))) ?? null;
}

/** Keep legacy duplicates visible, but remove their authority and projection. */
export function reconcileCardAuthority(ws, groups) {
  const changed = [];
  for (const card of Object.values(ws?.cards ?? {})) {
    const match = protectedCardMatch(card, groups);
    if (match) {
      const already = card.authority_conflict?.name === match.name
        && card.review_state === 'unconfirmed'
        && !ws.order[card.kind].includes(card.id)
        && ws.unconfirmed[card.kind].includes(card.id)
        && (card.review_signals ?? []).some((signal) => signal.reason_code === REASON_DEFINED_ELSEWHERE);
      removeFromOrder(ws, card.kind, card.id);
      card.review_state = 'unconfirmed';
      if (!ws.unconfirmed[card.kind].includes(card.id)) ws.unconfirmed[card.kind].push(card.id);
      card.authority_conflict = {
        name: match.name,
        kind: match.kind === 'persona' ? 'persona' : 'defined',
        source: match.source ?? 'scenario',
      };
      card.review_signals = [
        ...(card.review_signals ?? []).filter((signal) => signal.reason_code !== REASON_DEFINED_ELSEWHERE),
        { reason_code: REASON_DEFINED_ELSEWHERE, detail: `${match.name} is owned by ${card.authority_conflict.source}`, turn: ws.current_turn },
      ];
      if (!already) changed.push({ id: card.id, name: card.name_or_title, match: match.name });
    } else if (card.authority_conflict) {
      delete card.authority_conflict;
      card.review_signals = (card.review_signals ?? [])
        .filter((signal) => signal.reason_code !== REASON_DEFINED_ELSEWHERE);
      changed.push({ id: card.id, name: card.name_or_title, released: true });
    }
  }
  rebuildAliasIndex(ws);
  return changed;
}
