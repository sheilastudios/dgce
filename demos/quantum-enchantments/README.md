# Quantum Enchantments demo revision 3

Open **SCENARIO.md**. It is the only document you need open while setting up
the demo: all fields, eight opening interactions, optional deck cards, and
DGCE instructions are in that one file. There is no separate fields folder.

The expanded demo works in DreamGen without DGCE. Optional continuity and deck
features use the extension included at the repository's `extension/` directory;
this demo subdirectory contains scenario text and verification tools only.
It is not the contest edition and does not claim a 2,500-token editor count.

RIGHTS.md preserves the story's separate license. DEMO-STATUS.md describes
the revision and testing. The public contest entry is separate and unchanged.

For reviewers with Node.js (no npm installation needed):

    node verify-demo.mjs
    node --test verify-demo.test.mjs

The verifier checks exact inventory, hashes and specified text/structure
invariants. PACKAGE-RECEIPT.md beside the distribution ZIP records its checksum
and fresh-extraction verification.
