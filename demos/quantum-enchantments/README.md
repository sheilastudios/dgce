# Quantum Enchantments demo revision 3

Open **SCENARIO.md**. It is the only document you need open while setting up
the demo: all fields, eight opening interactions, optional deck cards, and
DGCE instructions are in that one file. There is no separate fields folder.

The expanded demo works in DreamGen without DGCE. Optional continuity and deck
features use the extension included at the repository's `extension/` directory;
this demo subdirectory contains scenario text, verification tools, and the
gameplay recording at `media/QE_DEMO_DreamGen.mp4`.
It is not the contest edition and does not claim a 2,500-token editor count.

RIGHTS.md preserves the story's separate license. DEMO-STATUS.md describes
the revision and testing. The public contest entry is separate and unchanged.

For reviewers with Node.js (no npm installation needed):

    node verify-demo.mjs
    node --test verify-demo.test.mjs

The verifier checks an exact eight-file inventory (including the gameplay
recording), hashes, and specified text/structure invariants. No arbitrary media
files or other extras are ignored. The manifest lists seven hashed files and
excludes only itself; an external archive checksum must bind all eight members.
Existing distribution receipts apply only to their original ZIPs, not this
updated repository directory.

Maintainers: after intentional package edits, run `node verify-demo.mjs --seal`
with no concurrent package edits or other sealing process. This validates the
scenario and inventory before writing, then flushes and reads back a complete
temporary manifest before replacing the old one. Validation, write, or rename
failure does not truncate the old manifest. There is no delete-first fallback.
An interrupted process may leave a `.DEMO-MANIFEST-*.tmp` file; verification
rejects that extra file rather than silently ignoring it. Inspect it and preserve
the old manifest before removing the orphan and retrying. This is not a
transaction across all package files or a power-loss durability guarantee.

Demo text/tool files are pinned to LF by the repository's `.gitattributes` so
byte hashes remain reproducible across checkouts. Resealing does not establish
authorship, approve a release, or upgrade the recorded playtest scope.
