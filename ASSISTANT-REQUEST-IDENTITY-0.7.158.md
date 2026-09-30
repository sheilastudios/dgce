# DGCE .158 — Assistant per-send identity

## Mounted finding

Session adc1bcb6-b643-49f5-8940-c0d14fdb2e9b; .157; settled turn 45.
Baseline revision 245, clean history, 186 interactions, zero carriers.
Manual Archivist closed the Assistant but rejected after one retry:

- Requested run: run-84ecda4f-adab-416d-b4a9-40674bd72690.
- Returned run: run-5084359c-cdfb-424a-9059-22bd0d6d5920.
- Revision after rejection: 246; last applied remained turn 33.

Subsequent read-only UI inspection saw an empty Assistant before its history
loaded. Loaded history contained 36 message nodes: its first exchange carried
the returned ID, and the current requested ID was absent. The latest stored
pair was run-fff4d948-6462-42e7-adfa-bd840a7589b1 from an earlier attempt.
No transcript was cleared, edited, or replayed during this investigation.

The driver's pre-send count can be zero while history is loading. Matching only
the first 60 characters then mistakes an old Archivist prompt and adjacent reply
for the current exchange. A local actual-ask fixture reproduces this ordering.
The run-ID validator prevented old memory adoption; this does not prove every
earlier failure had the same cause. The disposition of the absent current send
is uncertain; no automatic resend is introduced.

## Change and boundary

Each actual ask appends one fresh UUID identity line. The reply waiter requires
that standalone line and the prompt opening on exactly one post-snapshot
message, then reads only its immediate successor. Identity and uniqueness are
rechecked each poll. Replacement, reordering, disappearance or duplication after
binding stops the run rather than reassigning ownership. Direct unmarked helper
callers require full whitespace-normalized prompt equality instead of a prefix.

The caller's opening is preserved for temporary-mode ownership checks, and its
acknowledgment receives the actual displayed marked prompt. Unsent cleanup may
remove only this exact prepared prompt. Caller options cannot override the
actual send identity, panel, or count. The marker is correlation evidence, not
server persistence, model consumption, or a hostile-page authentication proof.

No revision/run-ID validation, history gate, timeout, permission or automatic
retry policy was relaxed. No chat was cleared. This does not prove host history
has fully loaded for headroom estimation, nor that the host accepted a send
during hydration; those remain live compatibility checks, not guessed facts.

## Verification

Eight new tests: late old-prefix hydration refusal; correct later marked pair;
replacement at owned index; duplicate marker before binding; duplicate after
binding; embedded non-line marker refusal; exact unmarked prompt; actual ask
with old chat hydrated after its snapshot. The actual-send test also checks
that the generated marker is present. Existing scratch ownership tests remain.

Full suite: 669/669 passing (13.5 seconds). `git diff --check` passes.
An initial run caught the not-yet-updated build receipt; after synchronizing
the receipt with the manifest, the complete suite was rerun successfully.
Mounted .158 request and scheduled-run
verification remain pending. External release is not approved.

## Mounted .158 follow-up

Build confirmed at turn 45/revision 246, history clean, 186 interactions and
zero carriers. A manual Archivist request no longer adopted the first old
exchange. It instead reached the idle deadline at 90321ms with the submitted
prompt not observed. Result: revision 247, last applied still turn 33, no memory
update. During the wait, the visible Assistant contained the same 36 old message
nodes, no fresh identity marker, an empty composer, and an empty status. No new
send was attempted to recover this uncertain request. Scheduled testing remains
deferred. This is a successful stale-reply refusal, not a working Archivist pass.
The .159 bounded readiness mitigation addresses sending during cold hydration.
