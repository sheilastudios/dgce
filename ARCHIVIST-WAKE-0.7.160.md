# DGCE .160 — trailing scheduled-Archivist recheck

## Mounted finding

.159 manual Archivist succeeded at turn 45: fresh marked request, three applied
operations, revision 248, restored closed Assistant. Temporarily setting cadence
to one allowed one story send to exercise scheduling without five filler turns.
Turn 46 completed at revision 254, with 190 interactions and clean history after
one carrier removal. No Stop generating control remained and the visible
Continue conversation control was enabled. Archivist remained idle, last applied
45, next scheduled 46. It did not automatically run. Cadence was restored to 5
at revision 255. No story resend or manual-refresh substitution was performed.

Code inspection identifies a missing-wake path: the history observer can invoke
the scheduled gate while cleanup/readback is still busy or within the input
guard, and clearing the internal flag need not cause another observed mutation.
The specific blocking flag in the mounted instant was not instrumented; this
is a reproduced liveness gap with a matching code path, not an exact timing trace.

## Change

One coalesced one-second trailing callback is scheduled after history settlement,
input activity, carrier-cleanup completion, readback completion, and deck-work
completion. New hints replace the old timer. A token plus originating epoch
prevents a stale wake from affecting a newer session. The callback invokes the
unchanged eligibility gate, including due/authority/route, pending delivery,
readback, Assistant/cleanup busy flags, clean history and idle editor checks.
It does not poll or rearm itself, spend a cadence slot, resend a request, or
weaken exact snapshot/result validation. A still-blocked callback remains inert.

## Verification

Five new source-extracted tests cover burst coalescing beyond the input guard,
busy-clear wake without another DOM mutation, epoch invalidation/supersession,
no polling/cadence consumption while blocked, and actual wake wiring. Existing
assembled readback and deck tests assert that wake happens only after busy clears.
Focused scheduler/readback/deck suites: 62/62 passing.

Full suite: 683/683 passing (13.7 seconds). `git diff --check` passes.
The first full run exposed one missing wake stub in the isolated Free-deck
harness; that harness now also asserts busy-clear ordering, and the full suite
was rerun successfully.

## Mounted .160 result: automatic scheduling PASS (bounded)

After the user reloaded the extension and page, Debug confirmed .160 at turn
46/revision 255 with clean history, 190 interactions and zero carriers.
Cadence was temporarily changed from 5 to 2 (revision 256), making the next
turn due relative to the last applied run at turn 45 without triggering a run
merely from changing the setting. One ordinary player send advanced to turn 47.
No manual Archivist refresh, page reload, resend or attestation substituted for
the scheduled run.

The resulting UI showed four operations applied at revision 262, history clean
with 194 interactions checked and zero context carriers remaining. The Assistant
was closed. Cadence was restored to 5 at revision 263. Memory then confirmed:
Archivist idle; last attempt turn 47 (applied); last applied turn 47; next
scheduled turn 52. The original story text remained visible.

This verifies one automatic scheduled run on the mounted .160 build in the
existing long disposable session. It is not a new ten-turn soak, a guarantee
for every host timing pattern, or proof of model consumption. The earlier .156
ten-turn continuity pass and .159 manual transport pass retain their separate
scope. No package, commit, push or external publication was performed.

External release is not approved. The installed directory remains
`C:\Sheila\dgce-public-opening-fix\extension`; no permissions or source-lane
boundaries changed.
