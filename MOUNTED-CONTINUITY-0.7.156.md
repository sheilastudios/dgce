# DGCE .156 mounted continuity regression — 2026-09-28

Session: adc1bcb6-b643-49f5-8940-c0d14fdb2e9b (disposable QE playtest).
User reloaded extension and page. Debug confirmed .156, turn 35, revision 190,
clean supported-host history, 148 interactions, zero remaining carriers.

## Ten sends with no reload between them

| Turn | Mounted interactions | Revision | Cleanup |
| --- | --- | --- | --- |
| 36 | 152 | 195 | 1 removed, 0 remaining, clean |
| 37 | 156 | 200 | 1 removed, 0 remaining, clean |
| 38 | 160 | 207 | 1 removed, 0 remaining, clean |
| 39 | 164 | 212 | 1 removed, 0 remaining, clean |
| 40 | 168 | 217 | 1 removed, 0 remaining, clean |
| 41 | 172 | 222 | 1 removed, 0 remaining, clean |
| 42 | 175 | 227 | 1 removed, 0 remaining, clean |
| 43 | 178 | 233 | 1 removed, 0 remaining, clean |
| 44 | 182 | 239 | 1 removed, 0 remaining, clean |
| 45 | 186 | 244 | 1 removed, 0 remaining, clean |

First/second/final diagnostic screenshots recorded anchor_issue null and
reply_batch true. Second/final additions recorded remounted true, contiguous
true, reply_count 3. Final settlement: 2026-09-28T21:12:47.895Z.

Messages included ordinary quoted dialogue, two paragraphs, and unquoted
action prose. Prepared composers visibly contained memory plus Chaos Deck
context, and periodically event/social surfaces. No recovery attestation,
resending a committed turn, reroll, memory reset, or history refresh was used.
Cleanup notices explicitly retained story text. The final Deck view reported
7 cards added and 0 queued for review; this does not imply narrative compliance.

## Separate findings

- Scheduled memory run at turn 38: stale_workspace during preparation,
  prompt revision 203, current 204; last applied remained turn 33.
- Scheduled memory run at turn 43: same refusal, prompt revision 230,
  current 231. Both stopped before the model call. No newer work overwritten.
- After the ten-turn soak, one manual refresh at settled turn 45 failed with
  `Assistant close did not settle; next request deferred`. Revision 245,
  last applied still turn 33, next scheduled turn 50. Subsequent read-only DOM
  inspection found no Assistant dialog or Close assistant button. The original
  close did not settle within two seconds; exact disappearance time was not
  measured. No manual-refresh success is claimed.
- Browser semantic selectors became unreliable after Assistant activity.
  Visible composer/send controls still worked through the browser's supported
  native click path. Failed selector calls were checked against draft/history
  before any native click; no duplicate submission was observed. Cause not
  established; not evidence by itself that normal user controls are broken.
- Narrative still occasionally extends player actions, invents clock readings,
  or shifts to offscreen VR. These are story/model observations, not proof of
  delivery corruption and not a reason to expand the extension's authority.

Disposition: narrow .156 mounted continuity PASS; overall release remains HOLD
pending scheduling follow-up. The subsequent .157 source change does not inherit
a mounted scheduling pass from this run.
