# DGCE 0.7.163 beta package receipt

Prepared on 2026-09-30 from repo commit `0a4c21c` (full: `0a4c21cd0da7d53ef95baf9cacc5983652445b1e`).

## Artifact

- ZIP: `DGCE_0.7.163_with_QE_demo_beta_2026-09-30.zip`
- SHA-256: `fef6078e5cb5a08af859b41e817c5bc82676a52fa9817422dfdd8b2fbd1f1353`
- Size: 410191 bytes
- Packaged root: `dgce/`

## Verification

- Fresh staged copy created from the current repository, excluding `.git/` and repo-local `artifacts/` packaging outputs.
- `SHA256SUMS.txt` matched the staged package tree before zipping.
- Fresh extraction matched the staged inventory byte-for-byte.
- Extension suite rerun on the extracted package: **714/714 passed**.
- Demo verifier tests rerun on the extracted package: **12/12 passed**.
- Demo verifier summary rerun successfully.

## Scope notes

- This package reflects the current merged 0.7.163 beta state in the repo after the handoff review.
- It preserves the newer Hazelnut wording carried forward during merge, so it is newer than the original handoff ZIP.
- This is a beta/review artifact, not a stable-release approval.

See also `verification.json` beside this receipt for the machine-readable summary.
