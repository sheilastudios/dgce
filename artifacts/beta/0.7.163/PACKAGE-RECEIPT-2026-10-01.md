# DGCE 0.7.163 beta package receipt — 2026-10-01

Prepared on 2026-10-01 from repo commit `f5722b1` (full: `f5722b186785352e99164f2b97731c277ac43c86`).

## Artifact

- ZIP: `DGCE_0.7.163_with_QE_demo_beta_2026-10-01.zip`
- SHA-256: `7c0c1c71de4d5f8035da07e95dae253e0851abbca980f551776ed86d37e6d21f`
- Size: 40277666 bytes
- Packaged root: `dgce/`

## Verification

- Fresh staged copy created from the current repository, excluding `.git/` and repo-local `artifacts/` packaging outputs.
- `SHA256SUMS.txt` regenerated for the staged package tree before zipping.
- Fresh extraction matched the staged inventory byte-for-byte.
- Extension suite rerun on the extracted package: **766/766 passed**.
- Demo verifier tests rerun on the extracted package: **27/27 passed**.

## Scope notes

- This package reflects the current merged 0.7.163 beta state after the latest remote CodeQL and demo-manifest fixes were merged.
- It supersedes the earlier same-day local package that was built before those upstream merges landed on `origin/main`.
- This is a beta/review artifact, not a stable-release approval.
