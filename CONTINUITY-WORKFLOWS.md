# Continuity workflows — 0.7.135

These additions are shared by Free and Full/Pro. Chaos Deck remains included in
Free. The mechanical game engines remain Full-only.

## Recall and Objects

Confirmed retired cards become eligible for bounded context recall when their
unique full name or alias is mentioned. Ambiguous matches are not guessed, and
unconfirmed or authored-definition-conflicting cards remain excluded. The card's
"Recall for this session" control requests recall explicitly. Neither path
confirms a fact or changes durable rank; context budgets still apply.

Objects are a fourth descriptive card kind, distinct from carried inventory or
equipment mechanics. Use them for a lantern's properties, a key's identifying
marks, or a document's established contents. An object card does not grant
possession, damage, powers or other mechanical consequences. Schema 3 migrates
older saves without discarding their existing card kinds.

## Continue across native sequels

1. Use DreamGen's native Create Sequel and review its generated HISTORY.
2. In the old session, open Data and download a continuity transfer.
3. In the new session, paste the transfer into Data and inspect its complete
   card/surface preview. Import explicitly after review.

The target must have empty local continuity. The source remains unchanged.
Changed source input or target state invalidates the review. Pending delivery
blocks transfer. Whole text must fit the target's configured limits.

This carries local memory, not campaign mechanics, Chaos Deck, turn counters,
host transcript, delivery receipts or history clearance. Source-turn freshness
becomes unknown. Full users must retain their ordinary full backup separately;
this narrow transfer is not migration of a complete running mechanical campaign.

## Authored characters and Building Blocks

Data now offers a reviewed authored library. Read a visible native entity into a
draft, or paste JSON with `kind`, `name` and complete `text`. Supported kinds are
persona, npc, location, object, history, plot, style and setting. Inspect the exact
text, then explicitly save it. Identical saves deduplicate; changed text creates
a separate version rather than overwriting the old one.

Copy complete text or download block JSON for native reuse. To propose an update,
supply established changes and copy the revision-review prompt for Assistant.
Review the returned proposal yourself before saving a new version or pasting it
into DreamGen. Archive outgoing definitions before removing native blocks.

The library is local storage, not injected memory. These controls do not edit,
remove or remount native slots. Individual blocks can move between editions;
ordinary backups include the library, while sequel continuity transfers do not.
Keep DreamGen's native scenario/transcript backup as well.

## Verification boundary

Local automated tests and browser fixtures do not establish DreamGen compatibility
or model obedience. Native sequel creation, HISTORY correction, host speaker and
portrait repair, and scenario/style decisions remain host/user operations. This
is not a claim that every manual step in a DreamGen guide is automated.
