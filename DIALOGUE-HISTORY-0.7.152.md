# DGCE 0.7.152 — dialogue display continuity

## Evidence and cause

The .151 ten-turn QE soak repeatedly lost clearance on consecutive sends.
Diagnostics showed the preceding reply batch replaced with identical text,
followed by new interactions. Refresh recovered clearance without resetting
memory or resending. Story generation itself completed all ten turns.

Two further diagnostic sends used straight double-quoted dialogue. Live DOM
inspection showed DreamGen displays these as curly delimiters in `span.quote`.
The adapter compared player `innerText` literally against the armed outgoing
text. A mismatch prevented recording the generated reply batch. When DreamGen
later moved that batch into stored history, the adapter correctly rejected an
otherwise unauthorized replacement, but had lost the necessary continuity link.

The local regression reproduces failure on the second dialogue turn before the
patch. Three consecutive sends pass after it. This demonstrates a causal path;
it does not establish that every observed clearance loss has this cause.

## Bounded change

- The existing exact display comparison remains first.
- Fallback supports only paragraphs of text and leaf `span.quote` nodes.
- Only their opening/closing curly double quotes may match source straight
  double quotes. Reconstructed text must equal actual displayed text.
- Unknown markup, changed words, punctuation, spacing and extra text fail.
- The existing locally armed send, actor/mode, deadline, route, row shape,
  prefix identity/text and reply-batch replacement checks remain required.
- No new history witness is minted. This is display continuity, not authority
  for delivery, model consumption, raw packet equivalence or history completeness.
- No new permissions, storage schema, source authority or request replay.

## Verification

617/617 local tests pass. The added lifecycle test failed before the change at
turn two. Negative display cases and the raw packet quote rejection pass.

Mounted .152 verification FAILED: turn 26 retained clean history (113 rows),
but turn 27 lost clearance (117 rows, first identity difference 110). The
quote-only fixture did not model concealed context paragraphs or real Markdown
block-separator text nodes. See DIALOGUE-CARRIER-HISTORY-0.7.153.md.

## Scope limits

The fallback intentionally does not interpret arbitrary Markdown or unknown
host renderers. Unsupported shapes may still withhold continuity. No narrative
quality or scenario prose changes are included in this patch.
