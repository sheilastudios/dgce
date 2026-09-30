# DGCE .160 release-hygiene review — 2026-09-28

Disposition: **PASS_FOR_RELEASE_HYGIENE**

No specific current release-blocking code defect was found in this bounded
review. No new feature/proof round is required by this disposition. External
release still requires the owner's explicit decision; cleanup is not approval.

## A. Original exact artifact

Reviewed ZIP SHA-256:
`f326c4cf9aa6ae318649c47d463afac46fe670dffd1d57b24c0fad6670de55f0`.
Codex freshly extracted that ZIP, verified all 131 manifest members and the
132-file inventory including SHA256SUMS.txt, then reran the actual bundled
suite: 683/683 pass, no failures/skips (13.760 seconds). This reproduces
Shel's supplied independent review. It does not bind changed documentation.

## B/C. Narrow scheduler and regression challenge

- `extension/ui/panel.js:477-487`: one replaceable timer, wake-object identity,
  originating epoch check, no callback self-rearm or polling loop.
- `panel.js:489-512`: unchanged due/authority, busy, ordinary-pending,
  readback, clean-history, unpruned-carrier, editor-idle and live-route gates.
  A route mismatch blocks even before the periodic route loader bumps epoch.
- `panel.js:808-846`: busy is set synchronously before the first await, so
  overlapping wake callbacks cannot start a second run through this path.
  Storage reread/fences and later epoch checks remain intact.
- `panel.js:949-967` and `core/workspace.js:185-190`: blocked wakes spend no
  cadence. A completed failed attempt normally records the cadence marker;
  this is distinct from a blocked wake. An existing failed marker write can
  allow a later attempt (the code documents that cost-guard limitation).
- `host/assistant.js:186-213,318-380,439-480`: draft/readiness and pre-click
  snapshot/composer checks remain; fresh request marker and repeated reply
  identity checks prevent the observed old-history adoption path.
- `host/archivist-run.js:91-115`: transport failure is thrown, not automatically
  resent by the wake. The pre-existing single retry for a received invalid
  model output is separate and retained. Therefore "no automatic resend"
  means no new scheduler resend mechanism, not "the entire product can never
  issue another request after any kind of failure."

The source-extracted scheduling tests exercise coalescing, busy-clear wake,
epoch invalidation/supersession, retained gates, no blocked cadence consumption
and wiring. Existing Assistant tests exercise draft preservation, late history,
identity ambiguity/replacement, and route/surface change. No new tests or runtime
changes were needed. Exact runtime/test identity is checked against the reviewed
ZIP during rebuilding, not inferred from matching version numbers.

## D. Minimum public-state cleanup

- README.md: mark .158's pending state historical; replace current-public/
  released-copy language in License, Starting and restoring, and Release status;
  preserve .146 as historical evidence. State demo omission without dead setup
  links or an unverified claim about current GitHub release assets.
- BUILD-STATUS.json: current audience/disposition is reviewed candidate awaiting
  owner decision; externalReleaseApproved remains false. Qualify historical
  .146 release note. Other dated evidence stays historical and unchanged.
- REVIEW-HANDOFF-0.7.160.md: acknowledge completed original-artifact review and
  point to this update; maintain demo exclusion and pending owner decision.
- CONTINUITY-WORKFLOWS.md: clarify historical .135 workflow introduction versus
  current public candidate scope, without implying a release receipt.

No runtime files, tests, permissions, version, historical reports or QE files
are changed by this cleanup. .156 ten-turn continuity, .159 manual transport,
and .160 one scheduled run remain separate bounded evidence. No .160 ten-turn
soak, universal compatibility, model-consumption or new history-completeness
proof is claimed.

## E. Rebinding and final receipt

After these edits: regenerate manifests; build a new extension-only ZIP;
extract it afresh; verify inventory and all hashes; compare extension/ and test/
bytes to the original reviewed ZIP; rerun all 683 packaged tests; compute the
final ZIP hash and sidecar. Preserve the original reviewed artifact.

The accompanying receipt must state artifact name/hash/size, original review
hash, exact file delta, inventory/hash counts, packaged test result, unchanged
runtime/test proof, mounted-evidence scope, QE omission, and owner approval /
publication state. The new hash belongs in that external receipt to avoid a
self-referential ZIP hash. If an owner-approved BUILD-STATUS edit changes bytes
later, repeat this binding procedure; never reuse this receipt for changed bytes.

No push or publication occurs in this cleanup lane.
