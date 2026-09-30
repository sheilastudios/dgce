# DGCE future work

Recorded September 28, 2026. Discussion backlog, not implemented behavior or
scope for the current release fix. Existing packages remain unchanged.

## Sparse Chaos Deck sampling

- Preserve manual authoring; do not require generated filler to dilute a small
  authored deck. Three cards about one character should not imply that character
  gets a suggestion every turn.
- Preferred proposal for evaluation: sample against at least 12 virtual slots.
  With N remaining cards (N <= 12), draw a real card with probability N/12;
  otherwise draw no card. Choose uniformly among the real cards on a hit.
- Empty slots are local no-ops, not prompt text or stored filler cards. Consuming
  a real card leaves an empty slot; do not shrink the denominator toward an
  inevitable final draw. No-op does not consume a real card or disable memory.
- Anchor protects against refill replacement only; it does not increase draw
  weight or grant recurring injection. Preserve existing once-consumed behavior.
- Show the effective draw chance and allow streaks; padding reduces frequency,
  not guaranteed spacing. No reroll merely because the draw is empty.
- Keep Chaos Deck optional. Consider a clear onboarding choice explaining its
  benefit; default-on versus explicit opt-in is not adjudicated for a future build.
- Verify sparse/full/empty decks, refill transitions, retries without redraw,
  and same-character concentration. This is not a guarantee of model compliance.

## Optional host-native context presentation

- User requested an option to disable DGCE's additional hidden presentation and
  let DreamGen handle context display through its normal mechanism.
- Inspect the actual carrier/display path before defining or implementing the
  switch. Keep presentation separate from whether context is sent, ownership,
  receipt correlation, cleanup, history clearance, and consumption claims.
- Preserve the current default initially; make the alternative an explicit
  user choice with an accurate preview/explanation of what becomes visible.
- Legitimate uses include debugging, accessibility, inspecting what was sent,
  auditing memory, and preference. Do not frame users' choices as cheating.
- Warn that display may reveal campaign-private material to the local reader
  or screenshots. Do not expose it automatically, rewrite old turns, or promise
  secrecy against a reader who can inspect browser-local data or raw history.
- Test both presentation modes against ordinary send, readback, reconciliation,
  cleanup, and host-editor normalization before shipping.

## Current issue remains separate

The five-turn QE test reached history-unverified after a three-card manual deck
was exhausted. Diagnosis found host pagination dropping early interactions and
exposing Load all; .161 adds guarded carrier-free recovery. See
PAGINATION-RECOVERY-0.7.161.md for the bounded proof status. Padding must not hide
that lifecycle failure or substitute for history evidence.
