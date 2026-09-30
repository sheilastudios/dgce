# DGCE 0.7.155 — actual quote-component node shape

## Evidence

Mounted .154 started at turn 31 with clean history, 132 interactions. Turn 32
completed and cleaned its carrier, reaching clean history with 136 interactions.
The new diagnostic recorded local_send_armed with carrier_bound true, followed
by addition_settled at 2026-09-28T19:41:19.542Z: contiguous true, reply_count 3,
anchor_issue display_mismatch, reply_batch false. This isolates failure before
the next reply-batch remount rather than merely reporting its later symptom.

Turn 33 was used to inspect actual DOM. The player paragraph's span.quote had
THREE adjacent Text nodes: opening curly quote, dialogue body, closing curly
quote. The .152-.154 fixture incorrectly used one Text node, and the fallback
explicitly required one. Serialized innerHTML hid that distinction. The
concealed carrier was also captured before cleanup. Both generation controls
were absent and the Assistant view had closed at the final status check.

## Change and tests

Within the already supported leaf span.quote shape, join one or more adjacent
Text nodes, with no character normalization added. Reject element/comment
children. The only permitted changed story characters remain the DOM-marked
double-quote delimiters. All other source, carrier, route, actor, expiry,
history identity, cleanup and receipt conditions remain unchanged.

The shared fixture now uses the captured three-node shape. Before the fix,
both consecutive quoted-send fixtures fail on turn two. After the fix, three
quoted sends, including context-bearing cleanup/remount, pass. Tests also cover
single-node and per-character text fragmentation and reject nested elements
and comments. Full suite: 634/634. Diagnostics remain bounded and text-free.

Mounted .155 verification remains pending. This is a candidate, not beta or
external-release approval. The separate Assistant-close error remains open.
