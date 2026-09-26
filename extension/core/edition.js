// This public build has no campaign engine implementation or entitlement switch.
export const IS_FREE_EDITION = true;
export const FREE_TABS = Object.freeze(['Memory', 'People', 'Places', 'Events', 'Objects', 'Resolve', 'Campaign', 'Deck', 'RNG', 'Schedules', 'Log', 'Debug', 'Data']);
export const FREE_WORKSPACE_NOTICE = 'This public DGCE build cannot use this workspace because it contains campaign or rule data that is still in development and not included here. Nothing was changed. Export it and reopen it in a compatible build; no automatic downgrade is performed.';
export function editionWorkspaceIssue(ws) {
  if (!ws) return null;
  if (ws.campaign != null || ws.settings?.RNG_enabled
      || (ws.rule_packs != null && (!Array.isArray(ws.rule_packs) || ws.rule_packs.length))
      || (ws.mechanical_turns != null && (!Array.isArray(ws.mechanical_turns) || ws.mechanical_turns.length))) return FREE_WORKSPACE_NOTICE;
  if ((ws.injections ?? []).some(record => record.mechanical_action_id
      || (record.parts ?? []).some(kind => !['event_log', 'social_context', 'inventory', 'memory', 'deck'].includes(kind)))) return FREE_WORKSPACE_NOTICE;
  return null;
}
export function assertEditionWorkspace(ws) {
  const issue = editionWorkspaceIssue(ws);
  if (issue) throw new Error(issue);
}
export function requireFullEdition(feature) {
  throw new Error(`${feature} is not available in this public DGCE build; it is still in development. Nothing was applied.`);
}
export function assertEditionCommand(text) {
  if (/^\s*\/(?:check|attack|initiative|skills|status|sheet|inventory|where|nearby|route|campaign|setup|floor|level|rest|equip|unequip|buy|sell|travel|move|social)\b/i.test(String(text ?? ''))) requireFullEdition('Campaign commands');
}
