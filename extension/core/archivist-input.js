// Archivist input assembly. Spec §10, §3 host economics, §5 rank scope.
//
// The Assistant does not consume RP context, costs no credits, and carries
// 128k+. So there is exactly one scarce resource in this system — the RP
// model's window — and everything here is free.
//
//   law: archivist_side_is_free
//        rp_context_is_the_only_scarce_resource
//
// That does NOT mean dump everything. Ranking is sound when the material
// carries the basis for the judgment and unsound when the model has to invent
// one. A flat list of 400 names forces invention no matter how much room it is
// given; the same 400 cards with their relations, support ages and recent
// movement do not.
//
//   law: cheap_to_send != sound_to_rank
//
// So the free context is spent on STRUCTURE, not volume.

import { KINDS, kindOfId, normalizeTerm } from './ids.js';
import { activeIds, retiredIds, activityOf } from './ordering.js';
import { ordinalRank } from './workspace.js';
import { freshnessBand } from './freshness.js';
import { resolveRedirect, lookupTerm } from './aliases.js';
import { estimateTokens, enforcementTarget } from './tokens.js';

/** Resolve a link id to a display name, following redirects. */
function linkName(ws, id) {
  try {
    const target = resolveRedirect(ws, id);
    return ws.cards[target]?.name_or_title ?? id;
  } catch {
    return id;
  }
}

/**
 * One card as a relational line rather than a record.
 *
 *   #3 Tomas [npc] (active, aging) — engineer; Hartwell issue
 *      → Hartwell inspection problem [event], Hartwell [location]
 *      last supported turn 118 of 190 · pinned
 *
 * Names support reasoning; optional IDs address maintenance operations exactly.
 * RP projections keep their existing compact form without maintenance IDs.
 */
export function describeCard(ws, id, { includeLinks = true, includeIds = false } = {}) {
  const card = ws.cards[id];
  if (!card) return null;

  const rank = ordinalRank(ws, id);
  const parts = [
    rank ? `#${rank}` : '(unranked)',
    card.name_or_title,
    `[${card.kind}]`,
    ...(includeIds ? [`(id: ${card.id})`] : []),
    `(${activityOf(ws, id)}, ${freshnessBand(ws, id)})`,
  ];
  if (card.pinned) parts.push('· pinned');
  if (card.aliases.length) parts.push(`· aka ${card.aliases.join(', ')}`);

  let line = parts.join(' ');
  if (card.summary) line += ` — ${card.summary}`;

  if (includeLinks && card.link_ids.length) {
    const named = card.link_ids.map((l) => `${linkName(ws, l)} [${kindOfId(l) ?? '?'}]${includeIds ? ` (id: ${l})` : ''}`);
    line += `\n    → ${named.join(', ')}`;
  }

  const support =
    card.last_supported_turn == null
      ? 'never supported'
      : `last supported turn ${card.last_supported_turn} of ${ws.current_turn}`;
  line += `\n    ${support}`;

  if (card.review_signals.length) {
    line += `\n    flags: ${card.review_signals.map((s) => s.reason_code).join(', ')}`;
  }
  return line;
}

/**
 * Cards touched or edited since the last Archivist pass — the "what moved
 * recently and why" that makes a ranking decision derivable rather than
 * invented.
 */
export function recentMovement(ws, sinceTurn) {
  const moved = [];
  for (const card of Object.values(ws.cards)) {
    if (card.merged_into) continue;
    const touched = card.last_touched != null && card.last_touched >= sinceTurn;
    const supported = card.last_supported_turn != null && card.last_supported_turn >= sinceTurn;
    if (!touched && !supported && !card.session_touched) continue;
    moved.push({
      id: card.id,
      name: card.name_or_title,
      why: supported ? 'revised or edited' : 'recalled',
      turn: Math.max(card.last_supported_turn ?? -1, card.last_touched ?? -1),
    });
  }
  return moved.sort((a, b) => b.turn - a.turn || (a.id < b.id ? -1 : 1));
}

/**
 * Build the Archivist's view of the workspace.
 *
 * Scope is the full confirmed population plus unconfirmed candidates, because
 * that is now affordable and because ranking over a population the model can
 * actually see is the thing that makes wide scope legitimate.
 *
 *   law: must_not_rank any card not present in the context of that run
 *
 * The corollary is enforced here rather than hoped for: whatever this function
 * omits, the Archivist may not rank. `rankable` is returned explicitly so the
 * validator can check proposals against it.
 */
export function buildArchivistView(ws, { sinceTurn = 0, includeUnconfirmed = true } = {}) {
  const sections = [];
  const rankable = new Set();

  for (const kind of KINDS) {
    const active = activeIds(ws, kind);
    const retired = retiredIds(ws, kind);
    const unconfirmed = includeUnconfirmed ? ws.unconfirmed[kind] : [];
    if (!active.length && !retired.length && !unconfirmed.length) {
      sections.push(`## ${kind} — no retained cards`);
      continue;
    }

    const block = [`## ${kind} — ${active.length} active, ${retired.length} retired, ${unconfirmed.length} unconfirmed`];

    block.push(`\n### active (projected into the story right now)`);
    block.push(active.length ? active.map((id) => describeCard(ws, id, { includeIds: true })).join('\n') : '(none)');
    for (const id of active) rankable.add(id);

    block.push(`\n### retired (known and recallable, costing nothing)`);
    block.push(retired.length ? retired.map((id) => describeCard(ws, id, { includeIds: true })).join('\n') : '(none)');
    for (const id of retired) rankable.add(id);

    if (includeUnconfirmed) {
      block.push(`\n### unconfirmed (candidates — you may NOT confirm these)`);
      block.push(
        unconfirmed.length ? unconfirmed.map((id) => describeCard(ws, id, { includeIds: true })).join('\n') : '(none)',
      );
      // deliberately NOT added to rankable: promotion places a card into
      // ambient projection, and unconfirmed cards are excluded from it
    }

    sections.push(block.join('\n'));
  }

  const moved = recentMovement(ws, sinceTurn);
  const movement = moved.length
    ? moved.map((m) => `- ${m.name} (${m.id}) — ${m.why}, turn ${m.turn}`).join('\n')
    : '(nothing has moved since the last pass)';

  const surfaces = Object.entries(ws.surfaces)
    .filter(([, s]) => s.enabled)
    .map(([name, s]) =>
      `### ${name} (hard limit ${enforcementTarget(s.max_tokens)} estimated tokens; safety margin already applied)\n` +
      (s.text || '(empty)'),
    )
    .join('\n\n');

  const view = [
    `# Continuity workspace — turn ${ws.current_turn}, revision ${ws.revision}`,
    '',
    '## maintained surfaces',
    surfaces || '(none enabled)',
    '',
    '## what moved since the last pass',
    movement,
    '',
    ...sections,
  ].join('\n');

  return {
    text: view,
    rankable,
    estimated_tokens: estimateTokens(view),
    card_count: Object.keys(ws.cards).length,
  };
}

/**
 * The remaining budget statement handed to the Archivist each run.
 * Stated as data rather than prose so the model is not asked to infer limits
 * it will then be rejected for exceeding.
 */
export function budgetStatement(ws) {
  return {
    max_promotions_this_run: ws.settings.max_archivist_promotions_per_run,
    max_automatic_merges_this_run: ws.settings.automatic_merge_limit_per_run,
    surface_hard_limits: Object.fromEntries(
      Object.entries(ws.surfaces).map(([k, s]) => [k, enforcementTarget(s.max_tokens)]),
    ),
    active_windows: Object.fromEntries(KINDS.map((k) => [k, ws.settings[`${k}_active_window`]])),
    confirmed_cards_may_be_promoted: true,
    unconfirmed_cards_may_be_promoted: false,
  };
}

/**
 * Staging for the next turn. §9, computed Archivist-side.
 *
 * Current relevance is the FLOOR; the prediction only reorders within it. If
 * prediction selected, going off-script would leave the needed card absent —
 * silent and total. Ranking instead means it sits slightly lower in a set that
 * still contains it.
 *
 *   law: prediction_ranks != prediction_selects
 *
 * `predictedIds` is advisory and may be empty, wrong, or ignored entirely; the
 * result is well-formed in every one of those cases.
 */
/**
 * Bounded edit distance, for names the story spelled slightly differently.
 * Same shape tiny-retrieve.mjs uses to score canon docs.
 */
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let i = 1; i <= b.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= a.length; j += 1) {
      row[j] = b[i - 1] === a[j - 1]
        ? prev[j - 1]
        : Math.min(prev[j - 1], row[j - 1], prev[j]) + 1;
    }
    prev = row;
  }
  return prev[a.length];
}

/**
 * Score one card against the recent story. Ordering of signals follows
 * tiny-retrieve.mjs: exact strongest, token overlap next, fuzzy last,
 * structural bias small and never enough to qualify a card on its own.
 */
export function scoreCard(ws, id, { haystack, haystackTokens }) {
  const card = ws.cards[id];
  if (!card) return { score: 0, why: [] };

  const why = [];
  let score = 0;
  const terms = [card.name_or_title, ...card.aliases].map(normalizeTerm).filter(Boolean);

  for (const term of terms) {
    if (haystack && term && haystack.includes(term)) {
      score += 6;
      why.push('named: ' + term);
      break;
    }
  }

  if (!score) {
    const termTokens = [...new Set(terms.flatMap((t) => t.split(' ')))].filter((t) => t.length > 2);
    const overlap = termTokens.filter((t) => haystackTokens.has(t));
    if (overlap.length) {
      score += overlap.length * 2;
      why.push('token overlap: ' + overlap.join(', '));
    } else {
      for (const t of termTokens) {
        if (t.length < 4) continue;
        for (const h of haystackTokens) {
          if (h.length < 4) continue;
          if (levenshtein(t, h) <= (h.length > 5 ? 2 : 1)) {
            score += 0.5;
            why.push('fuzzy: ' + t + '~' + h);
            break;
          }
        }
      }
    }
  }

  if (card.session_touched) { score += 3; why.push('recalled this session'); }
  if (card.pinned) { score += 2; why.push('pinned'); }

  return { score, why };
}

/**
 * Staging for the next turn.
 *
 * Keyed on PRESENT RELEVANCE, not durable rank. Ordering by rank alone ships
 * the same cards every turn no matter who is in the room — and because
 * ordinalRank is per-kind, the id tiebreak silently ordered whole kinds by
 * prefix spelling, so `npc:` never shipped at all.
 *
 *   law: durable_rank != present_relevance
 *        per_kind_rank != cross_kind_order
 *
 * A card matching nothing in the recent story is NOT sent. That filter is the
 * whole point: capacity is meant to grow without the per-turn cost growing
 * with it.
 *
 *   law: unmatched => unsent
 *        expand_capacity != expand_token_cost
 *
 * `ambient_floor` (default 0) forces the top-ranked cards through anyway, for
 * anyone who wants standing awareness more than they want the tokens.
 */
export function namedRetiredCards(ws, recentText) {
  const haystack = ` ${normalizeTerm(recentText)} `;
  const matched = new Set();
  for (const card of Object.values(ws.cards)) {
    if (activityOf(ws, card.id) !== 'retired' || card.authority_conflict) continue;
    for (const term of [card.name_or_title, ...card.aliases]) {
      const name = normalizeTerm(term);
      if (!name || !haystack.includes(` ${name} `)) continue;
      const hit = lookupTerm(ws, term);
      if (hit.status !== 'ambiguous' && hit.ids?.length === 1 && hit.ids[0] === card.id) matched.add(card.id);
    }
  }
  return [...matched];
}

export function stageForNextTurn(
  ws,
  { predictedIds = [], budgetTokens, recentText = '', ambientFloor } = {},
) {
  const limit = budgetTokens ?? ws.settings.recall_budget;
  const floorCount = ambientFloor ?? ws.settings.ambient_floor ?? 0;
  const predicted = new Set(predictedIds.filter((id) => ws.cards[id]));

  const candidates = [
    ...new Set([
      ...KINDS.flatMap((kind) => activeIds(ws, kind)),
      ...namedRetiredCards(ws, recentText),
      ...Object.values(ws.cards)
        .filter((c) => c.session_touched && activityOf(ws, c.id) === 'retired')
        .map((c) => c.id),
      ...predicted,
    ]),
  ];

  const haystack = normalizeTerm(recentText);
  const haystackTokens = new Set(haystack.split(' ').filter(Boolean));

  const scored = candidates.map((id) => {
    const { score, why } = scoreCard(ws, id, { haystack, haystackTokens });
    return { id, score: score + (predicted.has(id) ? 4 : 0), why };
  });

  const chosen = new Map(scored.filter((c) => c.score > 0).map((c) => [c.id, c]));
  const matched = chosen.size;

  if (floorCount > 0) {
    for (const kind of KINDS) {
      for (const id of activeIds(ws, kind).slice(0, floorCount)) {
        if (!chosen.has(id)) chosen.set(id, { id, score: 0, why: ['ambient floor'] });
      }
    }
  }

  // Highest score first; then round-robin across kinds so a per-kind rank tie
  // cannot hand one whole kind priority by prefix spelling; then rank; then id.
  const byKind = new Map(KINDS.map((k) => [k, []]));
  const ranked = [...chosen.values()].sort(
    (a, b) =>
      b.score - a.score ||
      (ordinalRank(ws, a.id) ?? 1e9) - (ordinalRank(ws, b.id) ?? 1e9) ||
      (a.id < b.id ? -1 : 1),
  );
  for (const c of ranked) byKind.get(kindOfId(c.id))?.push(c);

  const ordered = [];
  for (let i = 0; [...byKind.values()].some((l) => i < l.length); i += 1) {
    for (const list of byKind.values()) if (i < list.length) ordered.push(list[i]);
  }

  const staged = [];
  const why = {};
  let used = 0;
  for (const c of ordered) {
    const cost = estimateTokens(describeCard(ws, c.id, { includeLinks: false }));
    if (used + cost > limit) continue; // skip, do not stop: one long card must not starve the rest
    staged.push(c.id);
    why[c.id] = c.why;
    used += cost;
  }

  return {
    staged,
    estimated_tokens: used,
    budget: limit,
    considered: candidates.length,
    matched,
    why,
    predicted_used: staged.filter((id) => predicted.has(id)),
  };
}


