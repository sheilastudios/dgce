# 0.7.150: Assistant close settlement

The .149 mounted cold-start Archivist attempt opened the new dialog and prepared
its prompt, then safely stopped with Assistant panel changed before send.
No request was sent. A comparison starting with the Assistant already open did
submit and begin a response. This supports the asynchronous-close diagnosis:
headroom opened and closed the Assistant, while the next ask could adopt the
still-visible closing surface before React removed it.

The restoration operation now awaits disappearance/disconnection of the exact
panel it closed. It times out rather than proceeding when closure does not
settle. The ask lease remains held through restoration. It does not relax the
pre-send panel-identity guard or adopt a replacement after writing a prompt.

A delayed-close fixture tests real ensureHeadroom followed by real ask. Both
use the intended surface and the single request completes; no stale panel is
adopted. Suite: 581/581. Closed-start mounted verification still required.
No permissions or memory schema changes; .149 package remains unchanged.
