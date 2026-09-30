# DGCE .159 — bounded Assistant preparation readiness

## Evidence and scope

The .158 mounted manual check correctly refused to adopt old Assistant history,
but its fresh marked prompt never appeared during the 90-second idle window.
At inspection the dialog had 36 old messages, no new marker, an empty composer
and no active generation status. Memory remained unchanged; revision 247 stored
the failure, with last applied turn 33. No resend or chat deletion was performed.
Prior .157 inspection had directly observed an initially empty Assistant render
followed by loaded history. Sending before hydration finishes is a supported
working hypothesis, not proof of the exact host-side request disposition.

## Change

Before both send preparation and headroom measurement, require the same scoped
Assistant, route and empty composer, no other modal or generation, and one second
of unchanged displayed message text and composer identity. An empty transcript
also waits a five-second opening grace. The total readiness wait is ten seconds.
Changes restart quiet time; route/draft/modal/generation changes refuse safely.
After typing and the existing React settlement delay, verify that the displayed
chat snapshot and composer are still the ones admitted before clicking Send.
If changed, refuse without sending and clear only the exact owned unsent text.

This is a compatibility mitigation, not positive evidence of complete server
history. Hydration later than the bounded grace is possible. The unique .158
per-send identity remains required, and missing or changed identities cannot
be rescued by accepting old traffic or automatically resending. No permissions,
history authority, memory validation, or retry rules are loosened.

## Tests

Nine new virtual-clock tests cover late hydration, empty-chat grace, same-count
text change, continuous changes reaching the bound, four ownership/readiness
interruptions, and headroom measured after hydration. The actual-ask regression
now requires zero sends when chat hydrates during typing; the reply-wait tests
still independently cover old traffic arriving after a send. Existing layout
tests use short injected readiness timings; production defaults are exercised
by the virtual-clock tests. Focused Assistant suites: 70/70.

Full suite: 678/678 passing (13.8 seconds); `git diff --check` passes.
Mounted .159 verification remains pending.
Automatic scheduling has not yet received a successful mounted verification.
External release remains held. No story turns or cadence settings were changed.

## Subsequent mounted verification

Manual transport PASS in session adc1bcb6-b643-49f5-8940-c0d14fdb2e9b:

- Confirmed .159, turn 45/revision 247, 186 interactions, zero carriers.
- Fresh request appeared after cold opening, as message 37; marker
  `fa70d352-d9f8-4482-b10b-aca6ce0de8d7`. Host visibly generated a reply.
- UI reported three operations applied, revision 248, last applied turn 45
  (previously 33). Assistant dialog was absent after automatic restoration.
- Cadence temporarily changed from 5 to 1, revision 249, for one scheduler test.
- One story turn sent without reload: turn 46/revision 254, 190 interactions,
  cleanup verified one carrier removed, story preserved, zero carriers remaining.
- After story generation finished, the automatic run remained due/idle at turn
  46. No manual Archivist refresh was used to substitute for this failed check.
- Cadence restored to 5, visibly confirmed, revision 255.

Thus Assistant readiness/manual operation and ordinary delivery/cleanup passed
this bounded check. Automatic scheduling did not; see the .160 wake report.
No repeated send, attestation, reset, or Assistant-chat deletion was performed.
