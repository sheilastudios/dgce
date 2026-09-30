# DGCE 0.7.162: collapsed Assistant and post-recovery continuity

## Disposition

Local candidate; bounded normal-Assistant and two-turn mounted checks pass.
The exact new post-Load-all terminal-remount case is locally tested; a fresh
live pagination-drop-to-recovery-to-next-send sequence was not recaptured.
Not release approval.
Installed source: `C:\Sheila\dgce-public-opening-fix\extension`.
No new permissions, no new attestations, and no history deletion.

## Observed failures

The QE screenshot run (session `bf3e2e7d-66b4-4039-a5f5-475753b52fae`)
on .161 exposed two independent failures:

- Archivist preparation could not find a ready Assistant with the native tools
  pane collapsed. The tabs still had nonzero rectangles, but the pane/composer
  was zero-width. Manually opening the pane allowed the request to complete.
- After an earlier history loss and completed Load all recovery, turn 5 lost
  clearance again. Its send diagnostic had `prior_batch:false`; the first
  replaced root was index 22 of 24, while the first text difference was at 24
  and the new-send anchor issue was null. This is consistent with the terminal
  OUTPUT reply moving into stored history without a retained representation
  lease. The carrier itself was verified and pruned; no resend is needed.

## Changes

`assistant.js` uses the observed native desktop splitter's Enter action to
expand a zero-width tools pane. It still requires a scoped, visible Assistant
composer before sending. On completion it restores its own expansion, unless
the user resized the pane, changed route, opened a blocking dialog, or left a
draft. Existing modern dialog and legacy tab handling remain supported.

`builder-transcript.js` retains a bounded terminal OUTPUT batch when a positive
Load all cycle establishes a fresh witness. A subsequent locally bound send
must still pass the existing exact-text, shape, detached-old-root, unchanged
prefix, stored-container, and new-player-anchor checks. This is DOM continuity,
not proof of delivery identity or model consumption. Bare visible history
still cannot create clearance.

## Verification

- Before the fixes: three collapsed-pane tests and the normal post-Load-all
  remount test failed against .161. Negative remount cases stayed blocked.
- Initial patched full suite: 709/709 passed.
- Final full suite: 712/712 passed, including draft/ambiguous-control checks and
  temporary-Assistant collapse restoration. A preexisting 40 ms scratch-test
  timeout flaked under concurrent load; its test-only allowance is now 500 ms.
  Production cleanup timeouts were not changed.
- Live native splitter: Enter collapsed from 63.454 to 100 and expanded back
  to 63.454. This validates the host action, not the extension's mounted path.
- User reloaded .162 and refreshed the same disposable run. Debug confirmed
  build .162, turn 5, revision 29, clean history and 28 interactions.
- With native tools collapsed (`aria-valuenow=100`), manual Archivist opened
  the pane to 63.454, applied one operation at turn 5/revision 30, and restored
  it to 100 without manual expansion or closure. No draft was overwritten.
- First context-bearing story send advanced to turn 6/revision 35, 32
  interactions, clean history, one carrier removed and zero remaining.
  Diagnostics: anchor issue null, reply batch true, three reply roots.
- Second consecutive story send advanced to turn 7/revision 39, 36
  interactions, clean history and zero carriers. No injection was due; exact
  saved plain-text delivery was verified. Diagnostics: prior batch true,
  remounted true, anchor issue null, new reply batch true, three reply roots.
  No refresh, resend, new attestation, or manual history recovery between sends.
- Temporary-Assistant restoration was added after that reload; it is covered
  by local tests but not this mounted run. The normal Assistant and history
  logic exercised live were unchanged by that follow-up.

Final source SHA-256:

- `extension/host/assistant.js`: `149177dfd23ace5d90a50ead36313144fade5cceb6666fc9e9a8eba2005e75e2`
- `extension/host/assistant-scratch.js`: `7847d0a73b6408a60c66af4f0f97630ee815f06ab893c445b8fbf1627d594a6d`
- `extension/host/builder-transcript.js`: `04912d02986df5b7a00ca5f391f5eb90e90a4986d99dba520defe98454bccddf`

## Scope exclusions

No changes to scenario prose, NPC knowledge policy, deck selection, Archivist
budgets, raw interaction comparison, delivery receipts, or private features.
Earlier code and documentation changes in this worktree were preserved.
