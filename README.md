# DGCE 0.7.146 — public build

DGCE 0.7.146 is the current public build of the DreamGen continuity
companion extension. It provides continuity tools, selective recall,
backup/import, and Chaos Deck support for DreamGen sessions, while leaving
DreamGen responsible for the model, chat, and scene generation.

This edition includes the .146 delivery/readback hardening: exact
authenticated session readback for ordinary sends, persisted request parent and
timing evidence, durable-before-adoption guards, and same-document route
handling after host navigation. No new permissions were added.

DGCE is an unofficial community extension. It is not affiliated with or
endorsed by DreamGen. The source code in this repository is licensed under the
Mozilla Public License 2.0. Project names, logos, and other brand assets are
not granted under that license. The Quantum Enchantments demo/story content
under `demos/quantum-enchantments/` is licensed separately; see that
directory's `RIGHTS.md`. See `LICENSE`, `CONTRIBUTING.md`, and
`TRADEMARKS.md`.

## What this does for your game

- Keeps local continuity notes for people, places, events, objects, social
  context, and optional inventory memory.
- Lets you selectively recall the right continuity back into the current scene
  instead of dumping everything at once.
- Gives you backup/import tools and sequel handoff support for carrying local
  continuity into later sessions.
- Adds an optional Chaos Deck for nudges, anchors, and reviewed Assistant
  proposals without pretending those draws are resolved game outcomes.
- Preserves delivery/recovery discipline so saved-turn evidence is clearer when
  DreamGen or the browser does something ambiguous.

## Install

1. Download or clone this repository.
2. If you downloaded a ZIP, extract it first.
3. In Chrome, open `chrome://extensions`.
4. Turn on **Developer mode**.
5. Choose **Load unpacked** and select the extracted `extension/` directory from this repo.
6. Open a supported DreamGen session at `https://v2.dreamgen.com/`.

Use a dedicated browser profile for testing if you want a clean lane. Do not
run multiple DGCE variants on the same page.

## Try the Quantum Enchantments demo

**[The Waykey — setup guide](demos/quantum-enchantments/README.md)** gives you
a self-contained comic fantasy adventure you can play immediately, with or
without DGCE. It includes paste-ready DreamGen scenario fields and a concrete
schema/example package you can inspect when building your own scenarios by
hand. The story/demo text in that directory has its own separate rights note;
see `demos/quantum-enchantments/RIGHTS.md`.

The same demo is also attached to the GitHub release assets as a standalone ZIP.

## Included

Local Event Log, Social Context and optional inventory memory; People, Places
Events and Objects cards; selective recall; entity resolution; manual/scheduled Archivist;
continuity backup/import; existing delivery recovery and owned-context cleanup.
Chaos Deck: manual cards, anchors, Assistant proposals with review or automatic
acceptance, low-water replenishment, and one optional draw per turn. Off by default.
Each supplied card retains the instruction to ignore it completely if it does not
fit the scene. A draw is not a memory update or a resolved game outcome.
DreamGen still provides the model and conversation. This is not a transcript backup.

## License and marks

The source code in this repository is licensed under the Mozilla Public
License, v. 2.0. This repository contains the current public build.

The Quantum Enchantments demo content under `demos/quantum-enchantments/` is
not licensed under MPL-2.0 unless that directory explicitly says otherwise.
See `demos/quantum-enchantments/RIGHTS.md`.

If future builds, experimental branches, or larger works are distributed
separately, changes to files in this repository remain governed by MPL-2.0.

The DGCE name, associated logos/icons, and Sheila Studios brand assets are not
licensed under MPL-2.0. References to DreamGen are nominative only; third-party
marks belong to their respective owners. See `TRADEMARKS.md` for practical use
rules.

## In-development surfaces not included in this public build

Campaign builder, publication, character generation, mechanical checks, combat,
skill progression, campaign proposal admission, configurable RNG, and rule
packs are still in development and are not included in this public build.
No additional checkout or extraction script is needed to load or test this
directory. Imported settings cannot activate code that is not present here.
Campaign and RNG tabs contain static "In development" previews, not active
tools. This is feature scoping, not DRM.

Some helper filenames retain historical names (`mechanical-submit.js`,
`command-palette.js`, `builder-transcript.js`). Their contents in this public
build support native sending, composer editing, and history evidence; the
in-development campaign engine, command palette, and builder-transcript
deletion flows are not included here.

Deck uses only an unbiased random-index helper, not RNG vectors or game rules.
Workspaces containing campaign/RNG/rule-pack data from in-development surfaces
remain export-only in this build. Imports containing that data are refused
without modifying the target. There is no automatic downgrade or selective
data loss.

## Test this artifact

Use current Node.js with the built-in test runner and Web Crypto; there are no
npm dependencies to install. Run `npm test` in this directory. Tests import the
actual public-build configuration and exercise continuity, injection, import,
and storage boundaries. They do not establish mounted-browser compatibility or
narrative compliance.

The package includes shared continuity regression suites and build-specific
onboarding, restore, race, and failed-write tests. Rule-pack import tests for
surfaces that are still in development are excluded; this build asserts
rejection instead. A legacy generic Archivist scheduler is included only as a
test helper, not in the runtime graph.

For isolated manual verification beyond normal use, load the `extension`
directory unpacked in a dedicated test profile.

## Starting and restoring

This build separates Recall result (default 120 estimated tokens for selected
cards) from Total continuity context (default 1200, enforcing 960 with headroom).
The total covers surfaces, selected memory and the optional Chaos Deck seed.
Old saves acquire the total setting without changing their recall allowance.

Ordinary carrier sends may reconcile automatically using an extension-owned,
credentialed GET of the current DreamGen session. It reads the observed saved
loader's interaction ID, parent ID and raw packet, then applies the existing
exact release/request/packet/carrier checks. No host script is executed. This
adds no permission and writes no host data. Unsupported, missing, mismatched,
oversized or unauthenticated responses leave recovery pending. Context-free sends
require their own exact action, request, parent, release and saved-text evidence.
Only CRLF/LF normalization is accepted for these plain packets. Completion neither
grants history clearance nor acknowledges outcomes nor creates a carrier receipt.
Legacy pending turns missing request parent/timing evidence remain manual recovery;
the upgrade never fabricates missing facts. Mechanical outcomes that are still
in development are not included here.
This is one-record readback, not complete-history or model-consumption proof.
Mounted verification of this adapter was later completed on the reviewed .146
runtime; this released copy preserves that documented behavior without
claiming that a byte-changed future artifact has already inherited the same
exact release receipt.

For a genuinely new DreamGen session, the empty-session confirmation records
user testimony, not automatic history proof. Clearance is page-local. The saved
audit does not recreate clearance after reload.

Data supports backup download, file/paste inspection, additive import and
replacement import. Export before replacement. Pending delivery or cleanup
blocks import. Failed/cancelled saves do not trigger cleanup. Pasted backup text
survives redraw/cancellation but is not carried into another session.
Replacement import restores the deck pool, anchors, mode, review queue and last
draw. Additive import keeps the target deck unchanged; use replacement to restore
a deck backup. Older saves with a null deck acquire an empty, disabled deck.
Cards excluded by the context budget are not consumed. Deck edits/refills wait
while an ordinary send is pending, preserving its exact rollback boundary.

## Guide-workflow additions

Unique full-name or alias mentions can bring retired confirmed memories into
bounded recall without changing durable rank. Ambiguous names are not guessed.
Cards also have an explicit Recall for this session control. Objects are plain
descriptive continuity cards, separate from inventory and mechanical equipment.
Workspace schema 3 migrates older object-less saves and imports.

Data includes a reviewed continuity-only transfer for a new sequel session.
It carries memory, not mechanics, deck, clocks, carrier receipts, host transcript
or history clearance. The destination must have empty local continuity; its
existing game state remains unchanged. Source-turn ages become unknown rather
than being mislabeled as target-session ages.

Data also includes an authored-text library: inspect visible native fields or
paste block JSON, explicitly save complete text, preserve versions, copy/download
for native Building Block swapping, and prepare revision-review prompts from
owner-supplied evidence. This is a review/copy bridge, not automatic native-slot
editing or native Building Block import/removal. Archived blocks do not enter
model context. Library entries travel in ordinary backups, not sequel transfers.

## Release status

- Mounted Chrome/DreamGen verification was completed for the reviewed .146
  runtime, including same-document navigation/plain-turn checks and the
  supplemental mounted carrier regression pass.
- This build preserves existing host/history fail-closed behavior. It does not bypass
  a missing history witness or treat visible prose as delivery proof.
- Independent review and packaging review were supplied for the reviewed .146
  release; this repository copy is the public released form.
- Any separately packaged public zip or later public artifact that changes
  bytes must be identified by its own hash and release receipt.

No billing, license service, private runtime, or payment integration is added.

`BUILD-STATUS.json` records public release scope and status.
`SHA256SUMS.txt` records every packaged file except the hash list itself.
