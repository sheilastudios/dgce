# Quantum Enchantments: The Waykey — setup

Public demo revision 1, September 26, 2026. No campaign builder, mechanical rules, slash commands, private runtime or preloaded memory is required. This is the same adventure premise as the contest draft, packaged separately with a few plain-language continuity clarifications. It is not a contest submission.

You can play this scenario with DreamGen alone. If you also want continuity tracking or optional Chaos Deck support, install DGCE first using the main repository instructions, then come back here.

## 1. Create the native DreamGen scenario

In DreamGen, open **Your Scenarios** and create a new roleplay scenario. Keep it private while setting it up. Use a fresh scenario rather than overwriting another game.

Open the files in `fields/` with a text editor. Each contains only the text to paste, without Markdown section labels. The equivalent all-in-one reference is [SCENARIO.md](SCENARIO.md); do not paste the entire document into one field.

| File | Where it goes |
|---|---|
| `01-title.txt` | Scenario title |
| `02-brief-description.txt` | Brief description |
| `03-public-description.txt` | Public/listing description |
| `04-setting.txt` | Setting |
| `05-player-description.txt` | Suggested user persona/character description; name it **Johnny / Bob** |
| `06-hazelnut.txt` | A scenario character named **Hazelnut** |
| `07-plot.txt` | Plot |
| `08-opening-description.txt` | The opening's description/label |
| `09-opening-narrative.txt` | One **Narrative** interaction inside that opening |

Keep Johnny / Bob assigned to the user, not an AI-controlled character. Aurelia, Rusk, Pip, Cynthia and the porter are already described in Plot/Setting; separate character entries are not required for this demo. No History, extra Style, hidden opening or example block is required. Remove unrelated template text if you started from a template.

### The opening has two different boxes

The opening **description** is just the player-facing label, “A respectable offer.” The actual scene belongs in an interaction inside the opening. Add one interaction and choose **Narrative** for its type. Paste `09-opening-narrative.txt` there, not as Johnny's message and not into the description box. Leave Hidden and Excluded off. This opening is intentionally a single prose scene containing NPC dialogue; do not split it unless you want to customize it.

If the control currently offers a user message, change the interaction type to Narrative. If you cannot find that option in your current layout, consult [DreamGen's openings guide](https://v2.dreamgen.com/docs/scenario-editor#openings) rather than saving the scene as player speech.

Save the scenario. Start a new roleplay with the suggested Johnny / Bob persona and the **A respectable offer** opening. Confirm that the scene appears as narration, ending with Aurelia asking what Bob needs to know. Bob should not already have accepted the job or taken the purse.

## 2. Turn on continuity, not campaign mechanics

With DGCE loaded and the DreamGen page refreshed, open **Continuity**. Use this new session's own local workspace. No clean-start campaign import is needed; do not use the Campaign or RNG preview tabs for this demo.

If DGCE requests an empty-session confirmation, confirm only if the session genuinely has no interactions. A saved scenario opening may already count as history: do not attest that a populated session is empty. Follow the extension's inspection/cleanup controls instead. A history warning is not permission to erase your story.

Start with the default continuity budgets and Chaos Deck off. Play a few exchanges. You can then use **Refresh with Archivist** to update local continuity from the loaded roleplay; the operation uses DreamGen's Assistant. Keep unrelated Assistant work out of that session while maintenance runs, and inspect the resulting Memory/People/Places/Events/Objects entries. If maintenance is blocked, follow its warning rather than repeatedly resending.

Do not preload the whole Plot as remembered events. The rescue, reward, key ownership and promises should reflect what actually happened in your playthrough. The scenario defines the situation; continuity records your particular run. Check that an offered reward has not been recorded as already paid, or a proposed plan as completed.

Later, mention an established character or object by name to exercise selective recall. Ambiguous names are not guaranteed to resolve. Context remains bounded; this is not perfect memory or proof that the model obeyed every instruction.

## 3. Take your first turn

Send an ordinary player message as Johnny / Bob. You do not need a `/check` command or a second instruction to generate the opening. For example:

> I study the drawing without reaching for the purse. “Before I agree: how does the key work, and what do we actually know about the people inside?” I glance at Hazelnut. “Anything you want to ask?”

Or negotiate, inspect, improvise, decline the job, or ask Cynthia for a covered break. No single response is required. Physical work belongs to Johnny; fantasy action belongs to Bob. The player chooses attention changes.

## 4. Optional Chaos Deck

The full adventure is playable with the deck off. Once the characters and scene are established, open **Deck** if you want additional narrative suggestions. Start with manual cards or an Assistant mode that lets you review proposals. Review proposed cards before accepting them; discard anything that assumes an unplayed event, dictates Bob's choice, reveals an offline identity, or moves game magic into physical reality.

For a simple manual suggestion, you could use: “If it fits the current scene, let a present NPC notice a practical detail that opens another option without choosing Bob's response.” It is a suggestion, not a guaranteed outcome. No deck preset or automatic import is included. Cards can be ignored when they do not fit; draws do not establish memory or mechanical consequences.

## 5. Save and recover safely

- Use DGCE **Data** to export continuity periodically. Keep DreamGen's own scenario/conversation backup separately; DGCE does not back up the transcript.
- If delivery is uncertain, do not resend the same action to force it through. Inspect the saved interaction and follow the displayed recovery process. Do not claim to have checked raw text unless you actually did.
- If history cleanup is blocked or incomplete, keep the pending state intact. Do not reset memory merely to silence the warning.
- If you want to play without DGCE, first resolve any pending delivery/cleanup. Then disable the extension normally and refresh. Disabling it does not repair an unresolved record, and turning it back on may require reconciliation after intervening play.
- If narration oversteps your action, correct it in DreamGen. The scenario and extension help continuity; neither guarantees narrative obedience.

## Sharing and scope

The public demo intentionally omits unrevealed novel background. Its local adventure can end through rescue, return, compromise or refusal. No proprietary runtime notation, advanced game engine or contest hashtag is bundled. Do not represent the historical contest token count as a measurement of this edited public demo; check the editor again if making a separate contest entry.

Source setup reference: [DreamGen scenario editor](https://v2.dreamgen.com/docs/scenario-editor), checked September 26, 2026. This package uses manual field entry, not an invented native JSON import.
