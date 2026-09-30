# DGCE 0.7.153 — quoted sends with concealed carriers

## Mounted .152 result: FAIL

Test session: adc1bcb6-b643-49f5-8940-c0d14fdb2e9b.
Started after user reload: build .152, turn 25, clean history, 109 rows.
No refresh between the two regression sends:

- Turn 26: context injected, automatically pruned; clean history, 113 rows.
- Turn 27: context injected and removed, but history became unverified.
  Diagnostic at 2026-09-28T19:05:40.646Z: expected 113, current 117,
  first identity difference 110, first text difference 113; no edit active.

Stopped the consecutive-send test. A supported page reload recovered clearance;
no memory reset, attestation, replay or reroll. Diagnostic turn 28 then captured
the player DOM before cleanup. It contained a visible paragraph with dialogue
`span.quote` nodes, followed by newline text nodes and two concealed paragraphs
with `data-dgce-concealed="1"` and `display:none`. Those paragraphs contained the
attached memory/deck carrier. `innerText` omitted them but the .152 fallback
walked them, so its reconstruction failed. The previous fixture missed both
the concealed paragraphs and Markdown separator nodes.

## Change

The final native-release hook binds the complete locally recorded carrier text
to the existing page-local send lease. The display fallback may exclude only a
trailing sequence of concealed paragraphs whose joined text matches that exact
carrier under the existing CRLF/carrier-ID-quote equivalence. A concealment
marker or nonce alone is insufficient. Plain whitespace between DOM blocks is
ignored; whitespace within story paragraphs remains compared.

All original route, expiry, local-send, actor, mode, prior history, generated
batch, and exact isolated cleanup checks remain. No new permissions or schema.
No change to raw packet equivalence, delivery receipts or model-consumption
claims. This matching only preserves a previously established history witness.

## Verification

- Both enhanced fixtures fail at turn two under .152.
- Three plain quoted sends and three carrier-bearing quoted sends with isolated
  cleanup/remount pass after the patch.
- Concealed wrong body, nonce, marker, display, extra text, interleaving, missing
  binding and body-quote changes are rejected.
- All 629 local tests pass, including manifest/display/receipt version agreement
  and importing the actual panel module graph. The stale `version_name` label
  had still displayed .150 despite the actual manifest version being .153;
  corrected without changing extension identity, storage or permissions.
- Mounted .153 verification FAILED. See HISTORY-DIAGNOSTICS-0.7.154.md.

Only the captured split-paragraph carrier rendering is added. Unknown markup
remains unsupported, and display matching does not establish server persistence.
