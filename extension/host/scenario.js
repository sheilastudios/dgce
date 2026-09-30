// Read the scenario the user authored. Stage 4 — READ ONLY.
//
// The extension never writes a scenario slot (§0b). It reads them for exactly
// three purposes:
//
//   1. so the Archivist does not card what is already always-sent
//   2. so entity resolution knows an authored character exists, and does not
//      report a name the user themselves defined as "unknown"
//   3. so an explicitly marked DGCE bootloader scenario can start its builder
//      without turning ordinary continuity workspaces into game builders
//
// Both matter because of the same guide distinction (§8.3): the scenario bible
// is author-defined substrate, the card index is emergent continuity. Cards
// duplicating slots is the failure the split exists to prevent.
//
// NON-MUTATING. No clicking, no expanding, no focus changes. Observed live:
// the entity inputs stay mounted even while their section reads as collapsed,
// so nothing needs to be opened and the user's form is never marked dirty.
//
//   law: observation != interaction

const FIELD_RE = /^scenario\.(personas|characters|locations|objects)\[(\d+)\]\.data\.definition\.(name|description)$/;

const KIND_FOR = {
  personas: 'persona',
  characters: 'npc',
  locations: 'location',
  objects: 'object',
};

const CAMPAIGN_BOOTLOADER_RE = /DGCE UNIVERSAL BOOTLOADER|DGCE is the campaign-mode authority/i;

export function hasCampaignBootloader(doc = document) {
  for (const input of doc.querySelectorAll?.('input, textarea') ?? []) {
    if (CAMPAIGN_BOOTLOADER_RE.test(String(input.value ?? ''))) return true;
  }
  return false;
}

/**
 * Everything currently defined in the scenario, grouped by kind.
 * Returns empty groups rather than throwing when the panel is not present.
 */
export function readAuthoredEntities(doc = document) {
  const groups = { persona: [], npc: [], location: [], object: [] };
  const bucket = new Map(); // "characters[0]" -> { name, description }

  for (const input of doc.querySelectorAll?.('input[name], textarea[name]') ?? []) {
    const m = FIELD_RE.exec(input.name);
    if (!m) continue;
    const [, group, index, field] = m;
    const key = `${group}[${index}]`;
    if (!bucket.has(key)) bucket.set(key, { group, name: '', description: '' });
    bucket.get(key)[field] = (input.value ?? '').trim();
  }

  for (const entry of bucket.values()) {
    if (!entry.name) continue; // an empty slot the user has not filled in
    groups[KIND_FOR[entry.group]].push({
      name: entry.name,
      description: entry.description,
    });
  }
  return groups;
}

/** Flat list of every authored name, for do-not-duplicate checks. */
export function authoredNames(groups = readAuthoredEntities()) {
  return Object.values(groups).flatMap((list) => list.map((e) => e.name));
}

/**
 * The block handed to the Archivist so it can tell substrate from emergence.
 *
 * Names only, not descriptions: the Assistant can already see the scenario, so
 * repeating the descriptions would spend context to tell it something it has.
 * What it needs from us is the LIST — an explicit boundary it can check
 * against, rather than a judgment call about what counts as "already defined".
 */
export function authoredBlock(groups = readAuthoredEntities()) {
  const lines = [];
  const label = { persona: 'Player persona', npc: 'Characters', location: 'Locations', object: 'Objects' };

  for (const [kind, list] of Object.entries(groups)) {
    if (!list.length) continue;
    lines.push(`${label[kind]}: ${list.map((e) => e.name).join(', ')}`);
  }
  return lines.length ? lines.join('\n') : '(the scenario defines no entities)';
}

/**
 * Is this term something the user authored into the scenario?
 * Case- and whitespace-insensitive; the caller normalizes further if it wants.
 */
export function findAuthored(term, groups = readAuthoredEntities()) {
  const want = String(term ?? '').trim().toLowerCase();
  if (!want) return null;
  for (const [kind, list] of Object.entries(groups)) {
    for (const entry of list) {
      if (entry.name.trim().toLowerCase() === want) return { ...entry, kind };
    }
  }
  return null;
}
