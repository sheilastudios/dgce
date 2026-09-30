# DGCE 0.7.147 scenario-opening onboarding candidate

Base: public repository commit 48c3dc3b0444ac025c1e7da939c21f8b4fbd647e.

## Reproduction

In 0.7.146 a genuinely new QE session has ten preloaded opening interactions.
The adapter finds no Load all completeness witness and blocks context. The only
offered attestation requires a session that has never contained interactions,
so the user cannot truthfully use it here. Zero carriers alone is not proof of
history completeness. No evidence establishes whether any other user hit this.

## Bounded fix

- Preserve the empty-session path; offer a separate scenario-opening path when
  a locally unused workspace has mounted interactions.
- A trusted click and explicit confirmation attest that the entire transcript
  is the preloaded opening of a new, unplayed, unedited, non-imported session.
- Require an idle supported host, no Load all or interaction editor, nonempty
  opening text without DGCE carrier markers, no prior local turns/injections,
  no pending delivery or desynchronized timeline, and no active cleanup/Archivist.
- Capture ordered DOM identities and exact text; revalidate route, epoch,
  workspace and opening before and within the durable write and before clearance.
- Save count, snapshot hash, route and timestamp before granting the page-local
  witness. Failed persistence or changed host state cannot grant clearance.
- Preserve the user-attested origin through additions and trusted reply remounts.
  No transcript deletion, automatic completeness claim, delivery receipt,
  model-consumption claim, or new permission is introduced.

## Verification

547/547 public repository tests pass, including 27 new cases. Targeted controller
suite: 67/67. git diff --check passes. New cases cover ten opening interactions,
post-send remounts, reload, synthetic clicks, cancellation, edits/remounts during
confirmation, route/epoch/workspace races, write failure/conflict, pending state,
carriers, unsupported host and Load all. Existing empty-session behavior passes.

Mounted Chrome verification: PENDING. This is not a released or pushed update.
The earlier .146 mounted proof does not establish .147 mounted success.

## Known boundary

This is explicit user testimony, not automatic discovery of scenario provenance
or total transcript size. A misleading attestation remains possible. The saved
audit never recreates clearance after reload. Played/imported sessions and
general history completeness still require a supported independent history path.
Only the public repository candidate is changed; no private/Pro tree was edited.

## Live check

Disable (do not remove) the old extension. Load this repository's extension folder
and refresh the new QE session before any player turn. Confirm that Debug shows
0.7.147, choose Confirm only scenario opening, and personally attest only if the
displayed statement is true. Expect a confirmation status replacing the button,
then a user-attested clean-history status. Verify a first send separately; never
resend a pending action. Preserve the old extension and its local memory.
