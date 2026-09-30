# DGCE 0.7.163: temporary Assistant readiness

## Disposition

Review candidate. Bounded mounted .163 checks below; independent release review pending.
Installed source: `C:\Sheila\dgce-public-opening-fix\extension`.
No new permissions, history-clearance shortcuts, scenario edits, or changes to
delivery evidence. Existing unrelated worktree changes are preserved.

## Reproduced gap and fix

Temporary Assistant mode checked for an empty chat immediately after its
composer became visible. Saved chat messages can arrive later. Normal Assistant
asks already wait for bounded chat settlement, but temporary ownership was
granted before that wait.

The temporary wrapper now uses the same readiness check before invoking its
task, then rechecks ownership and emptiness. Trusted user input is watched during
the wait. Saved history arriving during preparation prevents the task from
starting; it is never cleared. A user who takes over keeps the pane visible.

The existing limits remain: five-second grace for an empty chat, one-second
quiet interval, ten-second readiness cap. This is UI settlement, not server
completeness proof. Later exchange identity, message-count, user-input, draft,
route, and cleanup checks remain mandatory. Failed exchanges remain inspectable.

## Verification

- Two regressions failed before the fix: delayed saved history allowed the
  temporary task to start; trusted user input during the missing wait was not
  observed before task invocation.
- Both now pass. Delayed saved text is unchanged, no task starts, no cleanup
  runs, and an automation-owned pane expansion is restored.
- Trusted user activity prevents task invocation and leaves the pane expanded.
- Focused temporary-Assistant suite: 26/26 pass.
- Full local suite: 714/714 pass, zero failed, skipped, or cancelled.
- Mounted testing begins from the existing .162 disposable QE session. Its
  results must be recorded separately from .163 verification after reload.

## Mounted .162 continuation, 2026-09-30

Disposable session: `bf3e2e7d-66b4-4039-a5f5-475753b52fae`.
User signed in, reloaded DGCE and refreshed that tab; Debug confirmed .162,
turn 7/revision 39, clean history and 36 mounted interactions.

Four uninterrupted story sends then reached:

| Turn | Revision | Interactions | Result |
| --- | --- | --- | --- |
| 8 | 43 | 40 | Exact plain-text delivery verified; clean history |
| 9 | 48 | 44 | One owned context carrier removed; clean history |
| 10 | 52, then 53 | 48 | Plain delivery; scheduled Archivist applied two operations after one retry |
| 11 | 57 | 52 | Exact plain-text delivery verified; clean history |

Native tools were deliberately collapsed before turn 10 (`aria-valuenow=100`).
The scheduled Archivist opened the Assistant, completed, restored the Scenario
tab, and collapsed tools back to 100. Last applied turn became 10; next due 15.
No manual refresh, attestation, resend, or Assistant intervention was used
between these sends. No story text was deleted.

Pagination loss did not occur during this continuation; 52 interactions remained
mounted. Therefore this does not close the fresh Load-all transition proof gap.
It also does not verify .163 temporary readiness: that code requires the next
extension reload.

Current source SHA-256:

- `extension/host/assistant-scratch.js`: `976e91ec2031d8fbb1c3066f4309430a6e40eae5f5b4316195af202884741e3f`
- `extension/host/assistant.js`: `149177dfd23ace5d90a50ead36313144fade5cceb6666fc9e9a8eba2005e75e2`
- `extension/host/builder-transcript.js`: `04912d02986df5b7a00ca5f391f5eb90e90a4986d99dba520defe98454bccddf`

## Remaining verification

- Fresh mounted pagination loss, automatic Load all recovery, and subsequent
  send without refresh or attestation.
- Independent exact-artifact review before final release approval. Packaging
  verification is recorded separately in the ZIP's adjacent package receipt.

Empty-chat success/cleanup, refusal/restoration, the ten-turn uninterrupted
sample, and cold reload plus three subsequent sends passed below.

## Mounted .163 continuation, 2026-09-30

User reloaded the same extension and refreshed the same disposable session.
The rendered root confirmed `data-dgce-build=0.7.163`, turn 11/revision 57.

The user approved a temporary-Assistant test that must preserve existing chat.
It refused with the exact empty-chat prerequisite, returning to idle at revision
58. The native tools pane was restored to collapsed (`aria-valuenow=100`) with
Scenario selected. Last applied memory remained turn 10; the refused manual
attempt was recorded at turn 11 and next scheduled turn became 16. No existing
Assistant chat was cleared to force this test through. This verifies refusal
and restoration, not successful empty-chat cleanup or delayed hydration live.

Consecutive story sends without page refresh, resend, attestation, or manual
history recovery:

| Turn | Revision | Interactions | Result |
| --- | --- | --- | --- |
| 12 | 63 | 56 | One owned carrier removed; clean history |
| 13 | 67 | 60 | Exact plain-text delivery; clean history |
| 14 | 71 | 64 | Exact plain-text delivery; clean history |
| 15 | 76 | 68 | One owned carrier removed; clean history |
| 16 | 81 | 72 | Plain delivery; scheduled Archivist applied two operations without retry |
| 17 | 85 | 76 | Plain delivery after the memory update; clean history |
| 18 | 90 | 80 | One owned carrier removed; clean history |
| 19 | 94 | 83 | Exact plain-text delivery; clean history |
| 20 | 98 | 86 | Exact plain-text delivery; clean history |
| 21 | 103, then 104 | 89 | One owned carrier removed; scheduled Archivist applied four operations |

At turn 15, rendered Debug recorded all four addition settlements with null
anchor issues and valid reply batches. The last three adopted remounted reply
roots. No pagination loss appeared in these four transitions; they are ordinary
continuity evidence, not the missing fresh Load-all transition proof.

The scheduled turn-16 run returned to idle, restored Scenario and the collapsed
tools pane (100), and set last applied to 16 / next scheduled to 21. The deliberate
temporary-mode refusal did not prevent later automatic maintenance. The next
send succeeded without intervention.

The scheduled turn-21 run also completed without retry: four operations applied,
revision 104, last applied 21, next scheduled 26, idle and Scenario restored.

Only `extension/host/assistant-scratch.js` and `extension/manifest.json` differ
from the independently extracted .162 review package's extension directory.
The main Assistant adapter and history/recovery code are unchanged.

All ten uninterrupted .163 story sends (turns 12-21) completed with clean
history and zero remaining carriers, growing the mounted transcript from 52
to 89 interactions. Four were context-bearing turns (12, 15, 18, 21); their
owned carriers were removed afterward. The others recorded exact plain-text
delivery. No manual reload, resend, new attestation, or history recovery was
used inside this ten-turn sample. Ordinary story generation continuing alone
was not counted as success: Debug clearance and delivery/cleanup were checked.

The source suite was rerun after mounted testing: 714/714 pass, zero failures,
skips or cancellations. No runtime bytes changed after the .163 reload.
The unchanged bundled demo validator also passes 12/12 tests and its seven-file
inventory/six content hashes. This is not a new playtest of that exact demo file.

## Isolated empty-Assistant success, 2026-09-30

Created a native DreamGen clone of the disposable regression roleplay:
`d689d398-c277-4175-a93f-868bc0ef7e00`. The clone contains 89 story interactions,
an empty Assistant chat, and a separate newly initialized DGCE workspace.
Debug confirmed .163 and clean supported-host history. No scenario-opening
attestation was used on this played transcript.

The user explicitly approved temporary requests and irreversible cleanup of
only the clone's own completed maintenance exchanges. Native confirmation was
handled immediately in one browser call after an earlier confirmation vanished
without starting a run; no duplicate request was sent.

From collapsed native tools, temporary mode completed at turn 0/revision 2:
`2 operations applied · temporary Assistant exchanges cleared.` No retry was
reported. The wrapper returned to idle, restored Scenario, and collapsed tools
to 100. Reopening the native Assistant independently showed the empty-chat
welcome state and empty composer with Send disabled. It was then returned to
Scenario/collapsed. The clone's story remained intact; the original Assistant
conversation was never cleared.

This closes successful temporary-mode cleanup/restoration coverage on the
current mounted build. The delayed-history race itself remains a deterministic
regression test, not a forced live hydration event.

## Cold reload and subsequent sends, 2026-09-30

After the ten-turn sample, the original disposable session was intentionally
reloaded at turn 21/revision 104 with no unsaved composer draft. Supported-host
history recovered clean with 89 interactions and no remaining context carriers.
No new attestation or resend was used. Three consecutive sends then produced:

| Turn | Revision | Interactions | Result |
| --- | --- | --- | --- |
| 22 | 108 | 93 | Exact plain-text delivery; clean history |
| 23 | 112 | 97 | Exact plain-text delivery; clean history |
| 24 | 117 | 101 | Context-bearing send; one owned carrier removed; clean history |

All three recorded contiguous additions, valid reply batches, and null anchor
issues; turns 23 and 24 adopted remounted reply roots. Turn 24 recorded exact
authenticated saved-interaction evidence and bounded editor readback for owned
carrier removal. This does not prove model consumption or server durability of
the cleanup beyond the stated evidence.

The fresh cold-load partial-history stage/Load all control was not captured.
Therefore this is cold reload recovery plus consecutive-send evidence, not the
still-unobserved fresh in-page pagination-loss/Load all/next-send sequence.

## Scope and handoff

No new runtime bytes changed during these final checks. The successful clone
test permanently removed only its own completed maintenance exchanges, with
explicit approval; existing chat and story were preserved. The test tabs are
disposable, and the installed source remains .163.

These checks support a bounded review/beta candidate, not universal host
compatibility or stable-release approval. The live roleplay retained its existing
scenario; transport success does not certify narrative fidelity or substitute for
playtesting the exact bundled demo revision.
