# 0.7.149 Assistant layout compatibility candidate

Observed on DreamGen 2026-09-28: Open Writing Assistant opens an accessible
dialog named Assistant. The old selected Assistant tab and its textarea remain
in a zero-size tabpanel. Resolving that old target caused composer timeouts.
The dialog's host status is inside its immediate content div, not a direct child.

Changes:

- Prefer the unique visible, exactly named Assistant dialog with its close
  control. Otherwise retain the visible legacy tabpanel relationship.
- Open via the unique visible Open Writing Assistant control; do not click the
  hidden legacy tab. Never search the whole page for an arbitrary composer.
- Require one visible scoped composer and one visible send control. Existing
  drafts and changed surfaces prevent submission.
- Read only the observed host status positions outside message content.
- Exempt only the resolved Assistant itself from blocking-dialog checks;
  unrelated and nested confirmations still block or undergo existing exact
  scratch-ownership validation. No blanket dialog bypass.
- Restore an automatically opened dialog only while it is still the same
  surface, on the same route, without another modal or a user draft. An already
  open Assistant is left open. Scratch user-activity protection remains in force.

Local suite: 580/580 passed. Sixteen added cases exercise modern and legacy
layouts, hidden legacy targets, ambiguity, scoped status, view restoration,
actual ask/headroom paths, draft/modal guards and two-stage temporary cleanup.

No new permissions, no migrations, no changes to generation contracts or
campaign mechanics. Existing .148 package remains unchanged. Live memory refresh
and deck-proposal checks on the reloaded .149 build are still required before
beta release. No new public-release approval or GitHub push.
