# DGCE 0.7.156 — captured carrier display indentation

## Mounted .155 failed

At turn 34, history was clean with 144 interactions, but the first anchor was
already rejected: display_mismatch, reply_batch false. Turn 35 reached 148
interactions and history_unverified. This is not an extension-reload failure.

Before cleanup, read-only DOM capture of turn 35 found the concealed memory
paragraph contained `last supported turn 17 of 35` with no indentation. The
same nonce's injection body in a UI-downloaded backup retained four leading
spaces. Nonce: dgce-c739616f8f8dc3a75d47bdfc. No other character changes were
needed beyond the previously supported carrier-ID quote rendering.

## Regression and fix

`test/fixtures/dialogue-carrier-dom-155.json` pairs that DOM tree with the
UI-exported original body and the submitted player text. It is a disposable
test-session fixture, not a production user export. The test restores Element
accessors only; it does not rewrite the captured text. Before the fix, its
positive comparison failed while seven negative/boundary assertions passed.

The display-only fallback splits the exact locally bound carrier into the same
paragraph count and projects four-space continuation indentation removal.
Paragraph starts, boundaries, all other whitespace, words, punctuation and
nonce remain checked. It never trims the observed carrier. Three/five spaces,
tabs, partial indentation loss, changed metadata and changed prose still fail.

This is representation continuity, not delivery evidence. Raw packet
comparison and destructive cleanup remain unchanged and reject the captured
display text as a substitute for the saved raw interaction. Unrelated roots,
actor, route, epoch and prior reply-batch requirements are unchanged.

The three-turn cleanup/remount regression now runs with both retained and
host-rendered carrier indentation and explicitly requires a valid player
anchor and reply batch after each settlement.

Full local suite: 649/649 pass. Mounted .156 verification remains pending.
No release approval or packaging.
The separate Assistant-close settlement issue remains open.
