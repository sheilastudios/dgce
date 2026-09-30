# 0.7.148 plain-turn history and stale drawer repair

The .147 initial opening attestation passed live. Its subsequent apparent
missing sends were a stale drawer: forcing Debug to rerender showed turn 2 and
an exact plain-text saved-interaction receipt. This corrects the earlier
hypothesis that automated submission might have bypassed capture.

Two source-level gaps were identified:

1. Light dismissal preserved drawer DOM across hidden render requests. Opening
   the drawer could display turn 0 / old clean-history status after later turns.
2. Carrier-free turns did not trigger the cleanup path that settles additions
   into the existing history witness. The next synchronous clearance check saw
   added messages instead of its original snapshot. Reply-batch remount tracking
   also depends on settling the previous response before another local send.

Fixes:

- A render request while hidden invalidates preservation; quiet dismissal still
  preserves untouched form DOM. Reopening after updates rerenders current state.
- A read-only history-settlement operation extends only an existing witness,
  never clicks Load all and never creates a genesis witness.
- Carrier-free DOM observation and pre-send preparation call that operation.
  The controller coalesces in-flight checks, fences epoch/workspace/route,
  rejects unretired carriers, active cleanup, dirty/save-uncertain states and
  desynchronized timelines, and preserves attestation scope. No receipt or
  gameplay state is committed by history settlement.
- Debug exposes bounded existing history-invalidation diagnostics (no story text).

564/564 tests pass, including 17 new regression cases: two-turn reply remount,
no-witness/Load-all refusal, edits, carrier boundaries, concurrency movement,
exceptions, no render loop, hidden-drawer invalidation and call-site coverage.

Live validation still required on an unused scenario-opening session. Preserve
the earlier played session as evidence. Do not attest it as a new opening again.
No public push or release approval has occurred. No new permissions.
