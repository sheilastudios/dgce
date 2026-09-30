# DGCE 0.7.160 — exact-artifact review handoff

## Disposition

Public-build candidate for independent review. No known unresolved code blocker
was observed in the latest bounded checks. External release is not approved:
the original review gate was exact-artifact review and an explicit release decision,
not a claim that another known defect remains to be fixed. Shel has since
passed that exact artifact; see RELEASE-HYGIENE-0.7.160.md for the subsequent
documentation cleanup. Owner release approval remains pending.

## Evidence and limits

- Local suite before packaging: 683/683 passing.
- .156: ten uninterrupted continuity sends, turns 36–45, with owned carrier
  cleanup and story preservation. This was not a ten-turn .160 soak.
- .159: fresh identity-bound manual Archivist request applied three operations
  at turn 45 and restored the closed Assistant. Its automatic wake still failed.
- .160: one automatic run after ordinary turn 47 applied four operations at
  revision 262. Clean history checked 194 interactions with zero carriers.
  Assistant closed. Cadence restored to five at revision 263; last attempt and
  last applied turn 47, next scheduled turn 52. No manual refresh, resend,
  reload or user attestation substituted for this scheduled run.
- No universal host-timing guarantee or model-consumption proof is claimed.

See ARCHIVIST-WAKE-0.7.160.md for the current fix and mounted evidence;
ASSISTANT-READINESS-0.7.159.md and ASSISTANT-REQUEST-IDENTITY-0.7.158.md
describe the preceding transport changes. Older pending/failure notes in
BUILD-STATUS.json are historical, not the current disposition.

## Suggested review focus

1. Unique Assistant request identity cannot bind a hydrated old exchange.
2. Bounded chat/composer settlement and pre-send revalidation preserve drafts
   and fail closed when the surface changes.
3. Trailing scheduler wake is coalesced and session-bound, retains all gates,
   and neither polls nor retries failed requests automatically.
4. Public scope, permissions, packaged module graph, hashes and actual tests.

## Contents and verification

The final extension-review archive includes extension/, test/, docs and licensing.
The optional Quantum Enchantments demo is deliberately OMITTED. Packaging checks
found CRLF-sensitive field verification and a substantive mismatch between
fields/06-hazelnut.txt and SCENARIO.md (the offline-identity paragraph and one
comma differ). No choice between those source variants was made. The local demo
files were preserved byte-for-byte. Reconcile and verify the demo separately
before bundling it for release. The updated README explicitly states this
extension-only package does not include the demo.
No user workspace backups, browser exports, private runtime files or .git
history are included.

Extract the ZIP into a new directory. Verify every SHA256SUMS.txt entry and
that the only additional file is SHA256SUMS.txt itself. Run:

```text
node --test "test/*.test.js"
```

Load unpacked from the extracted extension/ directory. Preserve existing local
memory with an export before replacing an installation; avoid running two
DGCE copies on one page. No new extension permissions are requested.

The ZIP's SHA-256 sidecar identifies the exact review artifact. Packaging is
not public publication, repository push, or release approval.
