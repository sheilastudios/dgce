# DGCE 0.7.163 — public-build candidate

DGCE 0.7.163 is a candidate update to the public DreamGen continuity
companion extension. It provides continuity tools, selective recall,
backup/import, and Chaos Deck support for DreamGen sessions, while leaving
DreamGen responsible for the model, chat, and scene generation.

Current .163 status: 714 local tests and ten uninterrupted mounted story turns
pass. Scheduled memory refresh, temporary-mode refusal, and isolated empty-chat
cleanup/restoration pass. Cold reload recovery and three subsequent sends also
pass. Fresh in-page pagination-loss recovery remains a live coverage gap.
Review candidate; not stable-release approved.
Temporary Assistant mode now waits for chat settlement and
rechecks emptiness before taking ownership, preserving saved history that
arrives during preparation. This is a bounded safeguard, not proof of server
history completeness. See TEMPORARY-ASSISTANT-READINESS-0.7.163.md.

The inherited .162 behavior temporarily expands the collapsed desktop tools pane for
Assistant work and preserves the last response's exact representation after
successful Load all recovery. Clearance still requires positive load evidence;
unexplained edits and unbound replacements remain blocked. See
PANE-AND-RECOVERY-0.7.162.md. Older approvals below are historical.

This edition includes the .146 delivery/readback hardening: exact
authenticated session readback for ordinary sends, persisted request parent and
timing evidence, durable-before-adoption guards, and same-document route
handling after host navigation. No new permissions were added.

This candidate adds a separate, explicit confirmation for genuinely new sessions
that already contain a scenario opening. The .148 mounted regression passed
two plain sends and a memory-bearing send with automatic cleanup.

It also maintains an existing history witness after plain-text turns without
requiring a context-carrier cleanup, and refreshes a dismissed drawer when its
state changes. Neither behavior creates history proof from a bare transcript.

The candidate recognizes DreamGen's moved Assistant dialog as well as the
legacy tab layout. Its composer, replies, status and temporary cleanup remain
scoped to the exact Assistant surface. It also waits for dialog closure before
the next request can reuse the surface. Thinking/streaming activity now extends
the 90-second idle wait, with a ten-minute hard maximum. Quick replies do not
wait for that maximum. DGCE does not change the model or its thinking setting.
Deck refills now show their result, retain received-but-unsaved replies for
review, and pause automatic requests after a failed attempt. Refill diagnostics
are page-local; the saved Assistant conversation remains the recovery source.
The .150 ten-turn soak passed ordinary delivery/cleanup but exposed slow-reply
and refill issues. The .151 compressed-QE soak then exposed repeated history
clearance loss. Version .152 fixed marked dialogue-quote rendering but still
failed live with concealed context. Version .153 also handles the host's block
separators and excludes only the exact locally bound concealed carrier from
that display comparison. Raw saved-packet evidence and exact comparisons for
older history are unchanged. The .153 mounted run still failed on its second
uninterrupted send. Version .154 diagnostics traced the remaining display
mismatch to adjacent quote Text nodes. Version .155 joins those nodes without
changing their characters, while still rejecting nested markup. The .155 live
run still failed: DreamGen also removes four-space continuation indentation
within concealed paragraphs. Version .156 permits that bounded display-only
projection against the locally recorded carrier. It does not relax raw-packet
delivery or cleanup checks. Its mounted ten-turn continuity regression passed,
but two scheduled memory runs cancelled during preparation as the local
workspace advanced. Version .157 waits for settled delivery,
generation and cleanup before scheduled Archivist work, retaining exact stale-
result checks, and allows ten seconds for actual Assistant-panel closure.
The .157 mounted manual check passed panel closure but rejected an old run ID.
Assistant history appeared after an initially empty dialog; a shared prompt
prefix could bind an old exchange. Version .158 adds a unique per-send request
marker and revalidates prompt identity while waiting. It does not weaken the
Archivist validator, clear chat, or resend an uncertain request. At that stage,
external release was held pending mounted request/scheduling verification.
The .158 mounted check refused stale history but its new prompt was not observed.
Version .159 waits for displayed Assistant history/composer settlement before
preparing a send or estimating headroom, then rechecks the same transcript and
composer immediately before sending. The bounded wait is not server-history
proof; per-send identity and no-automatic-resend safeguards remain mandatory.
The .159 manual mounted run applied three operations and closed the Assistant;
the next story turn passed delivery and cleanup. Automatic scheduling remained
due but idle after cleanup. Version .160 adds a coalesced, session-bound trailing
recheck after activity and completion of blocking work. Existing eligibility
checks remain; this is not polling or an automatic failed-request retry.
The mounted .160 check passed one automatic scheduled run at turn 47: four
operations applied, Assistant closed, 194 interactions checked and zero carriers
remaining. Normal five-turn cadence was restored. This is a bounded scheduling
pass, not a repeat ten-turn soak or universal host-compatibility claim; see
`ARCHIVIST-WAKE-0.7.160.md`. Exact-artifact review and the subsequent narrow
release-hygiene review found no current code blocker. External release awaits
an explicit owner decision; see `RELEASE-HYGIENE-0.7.160.md`.
That historical .160 suite passed 683 tests; the .163 suite passes 714.

DGCE is an unofficial community extension. It is not affiliated with or
endorsed by DreamGen. The source code in this repository is licensed under the
Mozilla Public License 2.0. Project names, logos, and other brand assets are
not granted under that license. Quantum Enchantments demo/story content under
`demos/quantum-enchantments/` has its own rights notice; it is not MPL-2.0
software. See `LICENSE`, `CONTRIBUTING.md`, `TRADEMARKS.md`, and the demo's
`RIGHTS.md`.

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

### A new session already has opening messages

If DGCE reports that history completeness is unverified, open Continuity.
For a genuinely new, unused session containing only its preloaded scenario opening,
choose **Confirm only scenario opening** and read the confirmation carefully.
This records your testimony, not automatic proof that the transcript is complete.
No messages are deleted or sent. The opening must remain unchanged throughout
confirmation, and the clearance lasts only for the current page lifetime.

Do not use this for a played, edited, or imported transcript. Reloading does not
restore clearance from the saved attestation. Existing sessions still require a
supported history check; this update does not solve general history completeness.
An actually empty session retains its separate empty-session confirmation.

## Optional Quantum Enchantments demo

The Waykey is an optional scenario under `demos/quantum-enchantments/`, not
required to use DGCE. Its single `SCENARIO.md` contains the fields, opening,
optional cards and setup instructions. The expanded demo is separate from the
contest submission. See `DEMO-STATUS.md` for the revision and testing summary.
The software license does not license its story. The distribution ZIP has its
own checksum and extraction receipt, separate from the preceding review ZIP.

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
License, v. 2.0. This directory contains the .160 public-build candidate, not
an assertion that .160 has already been released.

Separately distributed Quantum Enchantments demo content is not licensed under
MPL-2.0 unless its own rights notice explicitly says otherwise.

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
Mounted verification of this adapter was completed on the reviewed .146
runtime. That is historical evidence, not an exact-artifact release receipt
for .160. The current candidate's later bounded checks are listed below.

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

- Current artifact: .160 public-build candidate; owner release decision pending.
- Historical Chrome/DreamGen verification was completed for the reviewed .146
  runtime, including same-document navigation/plain-turn checks and the
  supplemental mounted carrier regression pass.
- This build preserves existing host/history fail-closed behavior. It does not bypass
  a missing history witness or treat visible prose as delivery proof.
- The .156 ten-turn continuity pass, .159 manual transport pass and .160
  single scheduled-run pass are separate bounded evidence. They are not a
  ten-turn .160 soak, universal compatibility, or model-consumption proof.
- Shel independently verified the original .160 review ZIP, its 131 hashes
  and 683 tests. Documentation cleanup creates a new artifact identity;
  the accompanying package receipt binds the rebuilt ZIP and fresh reruns.
- Historical .146 review does not approve .160. No public push or publication
  is implied by this candidate's passing checks.
- Any separately packaged public zip or later public artifact that changes
  bytes must be identified by its own hash and release receipt.

No billing, license service, private runtime, or payment integration is added.

`BUILD-STATUS.json` records public release scope and status.
`SHA256SUMS.txt` records every packaged file except the hash list itself.

## Source security review

The [2026-10-01 CodeQL report](docs/security/codeql-2026-10-01.md) records a fresh
scan of merged source, per-finding triage, verification, and a remaining local
demo-sealing race. It is commit-specific evidence, not approval of a release ZIP.
