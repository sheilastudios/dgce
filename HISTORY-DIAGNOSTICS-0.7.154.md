# DGCE 0.7.154 — remaining live failure diagnostics

This is instrumentation, not a claimed fix. No clearance conditions are relaxed.

## Mounted .153 receipt

Same disposable QE session adc1bcb6-b643-49f5-8940-c0d14fdb2e9b.

- Baseline: build .153, turn 28, revision 153, clean history, 121 interactions.
- Turn 29: context delivered/cleaned automatically; clean 125, revision 158.
- Next attempted send stopped with Extension context invalidated; draft remained
  unsent. User subsequently said they thought they had reloaded the extension.
- Preserved draft, refreshed page, verified unchanged turn 29/revision 158 and
  125 interactions, then submitted it. No committed turn was replayed.
- Turn 30: clean 129, revision 163, one carrier removed, story preserved.
- Turn 31: no intervening refresh/reload; context sent and removed but clearance
  became history_unverified, 132 interactions, revision 169.
- Failure diagnostic: non_additive_snapshot_change at 2026-09-28T19:34:49.390Z;
  expected 129, current 132, first identity difference 126, first text difference
  129, no owned/read-only edit active. Stopped further sends.

The original quote-only and concealed-paragraph fixtures are insufficient to
prove the live fix. .153 cannot be represented as passing this regression.

## Added diagnostics

The last eight page-local records now include local-send arming/rejection,
settled addition counts, whether a reply batch was retained, and specific
anchor failure categories (missing/expired send, missing/old/unsupported row,
actor mismatch, prose count, display mismatch). Invalidation also reports
whether a send and prior batch were present. No prompt, carrier, actor name,
story text, or action identifier is copied into diagnostics. The exported
records are copies. No persistent schema or permissions change.

631 local tests pass, including bounded diagnostics and text non-disclosure.
The actual panel module graph and manifest/display/receipt consistency pass.
Mounted .154 testing is pending.

## Separate outstanding issue

Memory showed last Archivist attempt turn 28 (error), last applied turn 23,
next scheduled turn 33: Assistant close did not settle; next request deferred.
No source of that close failure was established in this run. It is not explained
away by the history bug or claimed fixed by these diagnostics.
