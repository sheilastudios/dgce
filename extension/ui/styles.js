// Panel styles, served into a shadow root so DreamGen's CSS and ours cannot
// fight. Everything is scoped to :host.

export const CSS = `
:host {
  --bg: #14141a;
  --bg-2: #1c1c25;
  --bg-3: #24242f;
  --fg: #e8e8ef;
  --fg-dim: #9a9aab;
  --line: #32323f;
  --accent: #c9a3ff;
  --warn: #ffb454;
  --bad: #ff6b6b;
  --ok: #7ddc9a;
  --radius: 8px;
  all: initial;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 13px;
  line-height: 1.45;
  color: var(--fg);
}
* { box-sizing: border-box; }

.launcher {
  position: fixed; right: 0; top: 45%; z-index: 2147483646;
  background: var(--bg-2); color: var(--fg); border: 1px solid var(--line);
  border-right: none; border-radius: var(--radius) 0 0 var(--radius);
  padding: 10px 6px; cursor: pointer; writing-mode: vertical-rl;
  letter-spacing: .08em; font-size: 11px; text-transform: uppercase;
}
.launcher:hover { background: var(--bg-3); }

.drawer {
  position: fixed; top: 0; right: 0; height: 100vh; width: 420px; max-width: 92vw;
  min-width: min(340px, 92vw);
  z-index: 2147483647; background: var(--bg); border-left: 1px solid var(--line);
  display: flex; flex-direction: column; box-shadow: -8px 0 24px rgba(0,0,0,.4);
}
.drawer[hidden] { display: none; }
.drawer-resizer {
  position: absolute; top: 0; bottom: 0; left: -5px; width: 10px; z-index: 50;
  cursor: col-resize; touch-action: none; outline: none;
}
.drawer-resizer::after {
  content: ''; position: absolute; top: 0; bottom: 0; left: 4px; width: 2px;
  background: transparent; transition: background .12s ease;
}
.drawer-resizer:hover::after,
.drawer-resizer:focus-visible::after,
.drawer-resizer.dragging::after { background: var(--accent); }

header { padding: 10px 12px; border-bottom: 1px solid var(--line); display: flex;
  align-items: center; gap: 8px; }
header h1 { font-size: 13px; margin: 0; font-weight: 600; flex: 1; }
header .rev { color: var(--fg-dim); font-size: 11px; font-variant-numeric: tabular-nums; }

nav { display: flex; flex-wrap: wrap; gap: 2px; padding: 6px 8px;
  border-bottom: 1px solid var(--line); }
nav button { background: none; border: 1px solid transparent; color: var(--fg-dim);
  padding: 4px 8px; border-radius: 6px; cursor: pointer; font-size: 12px; }
nav button[aria-selected="true"] { background: var(--bg-3); color: var(--fg);
  border-color: var(--line); }

main { flex: 1; overflow-y: auto; padding: 12px; }

.campaign-action-bar {
  position: sticky; top: -12px; z-index: 20;
  margin: -12px -12px 12px; padding: 8px 12px;
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  background: color-mix(in srgb, var(--bg) 94%, transparent);
  border-bottom: 1px solid var(--line);
  box-shadow: 0 6px 14px rgba(0,0,0,.25);
  backdrop-filter: blur(8px);
}
.campaign-action-bar .proposal-label { flex: 1; min-width: 150px; }
.campaign-action-bar .proposal-label strong { display: block; font-size: 11px; }
.campaign-action-bar .proposal-label span { color: var(--fg-dim); font-size: 10px; }
.campaign-action-bar.pending { border-bottom-color: var(--accent); }

.banner { padding: 8px 10px; border-radius: var(--radius); margin-bottom: 10px;
  border: 1px solid; font-size: 12px; }
.banner.warn { border-color: var(--warn); color: var(--warn); background: #3a2a10; }
.banner.bad  { border-color: var(--bad);  color: var(--bad);  background: #3a1414; }
.banner.info { border-color: var(--line); color: var(--fg-dim); background: var(--bg-2); }

section { margin-bottom: 16px; }
section > h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em;
  color: var(--fg-dim); margin: 0 0 6px; display: flex; align-items: baseline; gap: 8px; }
section > h2 .meta { font-weight: 400; text-transform: none; letter-spacing: 0; }

textarea, input[type=text], input[type=number], select {
  width: 100%; background: var(--bg-2); color: var(--fg);
  border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px;
  font: inherit; resize: vertical;
}
textarea { min-height: 78px; }
textarea.surface { min-height: 150px; line-height: 1.55; }
label { display: block; margin: 6px 0 2px; color: var(--fg-dim); font-size: 11px; }

.row { display: flex; gap: 6px; align-items: center; }
.row > * { flex: 1; }
.row .shrink { flex: 0 0 auto; }

button.act { background: var(--bg-3); color: var(--fg); border: 1px solid var(--line);
  border-radius: 6px; padding: 5px 10px; cursor: pointer; font: inherit; }
button.act:hover { border-color: var(--accent); }
button.act[disabled] { opacity: .45; cursor: default; }
button.act.danger:hover { border-color: var(--bad); color: var(--bad); }

.group-label { display: flex; align-items: center; gap: 8px; margin: 12px 0 4px;
  color: var(--fg-dim); font-size: 11px; text-transform: uppercase; letter-spacing: .06em; }
.group-label::after { content: ""; flex: 1; height: 1px; background: var(--line); }

.boundary { border-top: 1px dashed var(--accent); margin: 8px 0; position: relative; }
.boundary span { position: absolute; top: -8px; left: 0; background: var(--bg);
  padding-right: 6px; color: var(--accent); font-size: 10px; letter-spacing: .06em; }

.card { border: 1px solid var(--line); border-radius: var(--radius);
  padding: 8px; margin-bottom: 6px; background: var(--bg-2); }
.card .title { display: flex; gap: 6px; align-items: baseline; }
.card .title strong { font-weight: 600; }
.card .summary { color: var(--fg-dim); margin-top: 2px; }
.card .actions { display: flex; gap: 4px; margin-top: 6px; flex-wrap: wrap; }

.campaign-components { margin-top: 10px; }
.campaign-component { padding: 10px; margin-bottom: 10px; }
.campaign-component > .title { margin-bottom: 6px; }
.campaign-value { margin-top: 7px; }
.campaign-value-row { display: flex; align-items: end; gap: 6px; }
.campaign-value-row > .campaign-field { flex: 1; min-width: 0; }
.campaign-group-head { display: flex; gap: 6px; align-items: center; margin: 9px 0 4px; }
.campaign-group-head strong { flex: 1; font-size: 12px; }
.campaign-nested { border-left: 2px solid var(--line); padding-left: 8px; }
.campaign-toggle { display: flex; align-items: center; gap: 7px; min-height: 31px; }
.campaign-toggle input { margin: 0; }
.campaign-add-field, .campaign-add-component {
  display: grid; grid-template-columns: minmax(0, 1fr) 110px auto;
  gap: 6px; align-items: end; margin-top: 8px;
}
.campaign-add-component { grid-template-columns: 120px minmax(0, 1fr) auto; margin: 12px 0 4px; }
.campaign-add-field .signal, .campaign-add-component .signal { grid-column: 1 / -1; }
.campaign-editor-status { align-self: end; padding: 7px 0; text-align: right; }
.campaign-save-row { margin: 10px 0; justify-content: flex-start; }
.campaign-save-row > * { flex: 0 0 auto; }
.campaign-remove { font-size: 11px; padding: 4px 7px; }
.campaign-advanced, .campaign-rejections { margin-top: 10px; }
.campaign-pending-proposal { scroll-margin-top: 58px; }
.campaign-advanced > summary, .campaign-rejections > summary {
  cursor: pointer; color: var(--fg-dim); font-size: 11px;
}
.foundation-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 8px; }
.foundation-field { margin: 0; min-width: 0; }
.foundation-field .summary { font-size: 10px; }
.foundation-chosen { color: var(--ok); border-color: var(--ok); }
.foundation-inheritedFromPreset { color: var(--accent); border-color: var(--accent); }
.foundation-inferred, .foundation-defaulted, .foundation-deferred { color: var(--warn); border-color: var(--warn); }
.foundation-contradicted, .foundation-unresolved { color: var(--bad); border-color: var(--bad); }
.campaign-agenda { margin-top: 10px; }
.campaign-agenda > summary { cursor: pointer; color: var(--fg-dim); font-size: 11px; }
.agenda-list { margin-top: 6px; display: grid; gap: 4px; }
.agenda-item { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; padding: 5px 7px; border-left: 2px solid var(--line); background: var(--bg-2); }
.agenda-item .agenda-label { flex: 1; }
.agenda-item .signal { flex-basis: 100%; }
.agenda-ready { border-left-color: var(--accent); }
.agenda-blocked, .agenda-conflicted { border-left-color: var(--bad); }
.agenda-answered, .agenda-defaulted, .agenda-skipped { border-left-color: var(--ok); }

.pill { font-size: 10px; padding: 1px 6px; border-radius: 999px;
  border: 1px solid var(--line); color: var(--fg-dim); white-space: nowrap; }
.pill.fresh { color: var(--ok); border-color: var(--ok); }
.pill.aging { color: var(--warn); border-color: var(--warn); }
.pill.stale { color: var(--bad); border-color: var(--bad); }
.pill.pinned { color: var(--accent); border-color: var(--accent); }
.pill.rank { font-variant-numeric: tabular-nums; }

.signal { margin-top: 4px; font-size: 11px; color: var(--warn); }

.empty { color: var(--fg-dim); font-style: italic; padding: 6px 0; }
.disclosure { color: var(--fg-dim); font-size: 11px; border-top: 1px solid var(--line);
  padding-top: 8px; margin-top: 12px; }
.over { color: var(--bad); }
code { background: var(--bg-3); padding: 1px 4px; border-radius: 4px; font-size: 11px; }
`;
