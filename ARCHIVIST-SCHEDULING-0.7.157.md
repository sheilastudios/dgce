# DGCE .157 — scheduled Archivist waits for a settled turn

Two .156 mounted attempts cancelled during preparation after a local revision
advance (see MOUNTED-CONTINUITY-0.7.156.md). The four-second scheduling callback
could start before ordinary readback and the current response were finished.
The existing preparation freshness fence correctly refused the changed state,
but the cancelled attempt spent a five-turn cadence slot.

## Change

Automatic readiness now requires no pending ordinary action, no active readback,
no Assistant/Archivist/cleanup work, clean history with no unpruned injection,
and an idle story editor (no generation, draft, or interaction editor).
The existing history observer rechecks scheduling after continuity settlement,
including plain turns without carriers, bound to the originating epoch.
Busy state coalesces duplicate ready callbacks. Deferral does not record an
attempt or spend cadence. Timeline authority and due/route guards remain.

After the ten-turn soak, an isolated manual .156 run also reproduced the
two-second Assistant close timeout. The dialog was absent at later inspection,
but exact disappearance time was not measured. The close deadline is now ten
seconds, still requiring actual disappearance and refusing a stuck panel. No
additional click/send is performed by the wait. This is a bounded mitigation,
not a claim that every host-close failure is explained or fixed.

No freshness check was removed; the prompt still binds exact revision and
workspace fingerprint, and results cannot be rebased onto newer state. Manual
refresh admission, user chat ownership, permissions and packet doctrine are
unchanged. This does not guarantee a scheduled run can survive later user edits.

## Verification

New source-extracted scheduler tests failed before the change, then passed:
pending delivery, active readback, generation, dirty/unpruned history, existing
busy gates, unchanged cadence during deferral, exactly one ready start, route/
authority/due checks, no-carrier observer recheck, and old-epoch suppression.
Additional real-timer tests cover successful close after 2.3 seconds and a
stuck close refusing at the new bounded deadline, with one close click and no
send. Full suite: 661/661. One old observer stub was made async to match its
actual dependency. Mounted .157 verification remains pending; no release approval.

## Mounted follow-up

The next manual check at settled turn 45, revision 245 confirmed build .157 and
clean history (186 interactions, zero carriers). Assistant closure completed,
but the run was rejected after one correction attempt for an old run ID; revision
246 recorded rejection, last applied remained 33. No memory update was applied.
The Assistant initially rendered empty when opened for inspection, then loaded
36 historical messages. Its first reply contained the returned old ID; the
current requested ID was absent. The driver matched only a common 60-character
prompt prefix beyond an initially zero count. See the .158 identity report.
Scheduled verification is deferred until that transport defect is repaired.
