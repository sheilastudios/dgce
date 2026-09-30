# 0.7.151: thinking-aware waits and retained deck failures

## Changes

- The former 90-second wall-clock deadline becomes a 90-second inactivity
  deadline. Scoped host thinking/generating status or visible Stop response,
  after the owned prompt is observed, keeps it active. Actual reply text changes
  also count as progress. A ten-minute absolute ceiling bounds stuck status.
- Quick non-thinking responses settle promptly. No model/settings changes.
- Neither valid-looking JSON nor a temporarily stable card list completes while
  the host reports generation active. Stability compares full text, not length.
- Host errors, disconnected/replaced surfaces, and session changes stop the
  request. Existing generation is rechecked before preparing and before sending.
- Manual and automatic deck refills use the same checked save path. A false
  commit result is a failure, not success. Mode and pending-action guards remain.
- Latest refill outcome/reason is visible in Deck. Received but unsaved reply
  text is retained page-locally and can be copied into the existing review input.
  Automatic refill requests pause after failure until explicit review. Nothing
  is automatically resent or retroactively applied after a timeout.
- Page reload/session change clears page-local refill diagnostics, not the host's
  saved chat. Inspect that chat for late replies. No new storage schema/permission.
- Anchor help is now above the card controls and on each Anchor button: it
  protects against replacement, not drawing/consumption or optionality.

## Verification

603 local tests pass. New deterministic clock cases cover >90-second thinking,
quick replies, paused partial cards, JSON while busy, same-length edits, text
progress, stuck status, idle/no-prompt cases, errors, and detached surfaces.
Actual ask fixtures cover busy-before-prepare and busy-before-send races.
Actual extracted panel refill logic is exercised against real deck primitives
for auto/review modes, failed commits, pending-turn races, unparsable replies,
timeouts, mode changes, and cross-session completion. Existing live-history and
ordinary-send regressions remain in the suite.

Mounted .151 verification remains pending. The .150 receipt is not a .151 pass.
No claim that the exact cause of the earlier silent deck failure is proven: its
old catch discarded the reason. This change repairs confirmed timeout behavior,
generic completion hazards, and discarded commit/error results without guessing.

## Deliberate limits

No background late-reply adoption after the hard stop: doing that safely needs
fresh ownership/workspace validation. No timeout-triggered request replay.
No automatic overwrite of user drafts or Assistant chat deletion.
