# DGCE .161 — carrier-free pagination recovery

## Mounted evidence (.160)

QE run: bbb4b618-66b5-4458-b65b-81acd4973b1a. Three manually authored,
anchored cards consumed on the first three turns; turn-three cleanup reported
one carrier removed, story preserved. Turn four had no remaining card/memory
payload. Diagnostic local_send_armed recorded count 21, prior_batch true,
carrier_bound false at 2026-09-29T00:01:36.194Z.

At 00:01:41.769Z, non_additive_snapshot_change recorded expected_count 21,
current_count 23, first identity/text difference 0, anchor_issue actor_mismatch.
By turn five, the rendered transcript began with the seventh opening interaction
and exposed Load older interactions / Load all. This is consistent with host
pagination dropping the beginning, not evidence of corrupted send text.

Debug: .160, turn 5, revision 32, history unverified, zero remaining carriers;
latest plain interaction verified. Memory: idle, last attempt/applied none,
next scheduled turn 5. No reload, resend or delivery attestation during play.

## Repair

Keep invalidation on lost roots. Do not widen reply-batch matching or treat
same-text history / a saved interaction receipt as whole-history evidence.
When a carrier-free, history-unverified workspace has a unique visible supported
Load all control and is idle, request the existing guarded cleanup/history sweep.
The existing loader requires newly materialized rows, stable host state and the
load control's disappearance. Unknown/unowned carriers and unresolved records
retain their existing checks.

Request once per epoch/workspace/turn/control. Pending delivery, readback,
Assistant/Archivist activity, cleanup, edits, generation, timeline suspension and
unretired records defer the request. Existing trailing wake also rechecks this
recovery opportunity, without spending Archivist cadence. No new permissions,
prompt changes, blank deck cards or display preferences.

## Verification

Focused history and scheduling suites: 52/52 passing, including 15 new recovery
tests. They cover pagination restoration, failure to materialize older rows,
guarded/deferred scheduling, deduplication, new turn/epoch, and ambiguous/hidden/
unsupported controls. The existing bare-DOM test remains fail-closed.

Full suite: 698/698 passing via npm.cmd test; git diff --check passed.
Mounted follow-up, September 29: .161 confirmed in the same preserved test run.
After the first user reload, Debug showed clean history with 29 interactions at
turn 5. The scheduled Archivist failed before sending: "Assistant surface changed
during readiness; no request sent." Turn 6 completed once. The user then reloaded
again; Debug showed clean history, turn 6, revision 37, 33 interactions.

From that second refresh, turns 7 through 10 completed without reload, resend or
delivery attestation. Debug at turn 7: clean, revision 41, 37 interactions, exact
saved plain-text interaction verified. At turn 10: clean, revision 54, 49
interactions, zero remaining carriers. The automatic Archivist applied three
operations after one retry; last applied turn 10, next scheduled turn 15. Its
earlier readiness failure did not recur on that attempt; no new Assistant fix is
claimed. OpenMouth style was edited before turn 7, not transcript history.

These observations establish startup recovery and subsequent plain-turn
continuity. They do not independently capture another live pagination loss and
automatic no-refresh Load all recovery. Keep that narrow mounted regression
claim pending; the synthetic regression passes. Do not re-attest played history
as a fresh opening.

Turn 11 was plain as expected (surface injection cadence is every three turns),
clean at revision 58 with 53 interactions. Turn 12 visibly carried the saved
event_log and social_context; after generation the UI reported "Context cleanup
read-back verified: 1 carrier removed; story text preserved." Debug: .161,
turn 12, revision 63, clean, 57 interactions, zero carriers, latest attempt ready.
Turns 7-12 were uninterrupted by reload or delivery attestation. No claim of
server prompt consumption or model compliance follows from these receipts.
