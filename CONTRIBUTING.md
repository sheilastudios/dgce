# Contributing to DGCE

Thanks for helping improve DGCE.

## Scope

This repository is for the current **public build**: continuity tools, recall,
backup/import, delivery/readback behavior, and Chaos Deck support.

Please do not submit:
- unreleased in-development code that is outside the scope of this public build
- private keys, secrets, or captured user data
- DreamGen source code or other third-party proprietary material
- branding changes that would blur the distinction between community forks and
  the main DGCE release line

## License for contributions

By submitting a contribution, you represent that you have the right to submit
it and that you are licensing your contribution under the terms of the
**Mozilla Public License 2.0** for inclusion in this repository.

In short:
- files in this repository are MPL-2.0-covered source files
- changes to those files stay under MPL-2.0 when distributed
- separate larger works or separately distributed in-development modules should
  remain separate, rather than mixing closed changes into MPL-covered files

If you want to discuss a contribution that does not fit those terms, open an
issue before doing the work.

## Practical expectations

- Keep changes narrow and reviewable.
- Preserve fail-closed behavior around delivery, recovery, continuity, and
  safety boundaries.
- Do not weaken provenance, verification, or rollback discipline for the sake
  of convenience.
- Include or update tests when behavior changes.
- Keep README and user-facing docs accurate when feature scope changes.

## Forks and naming

Forks are welcome under MPL-2.0, but please use a distinct name and branding if
you publish a modified build. See `TRADEMARKS.md`.
