// Single-flight Archivist scheduler. Spec §10b (C-B).
//
// Two clicks on "Refresh with Assistant" must not become two applies. The
// revision check in §16b would reject the second one anyway, but only after
// paying for a model call and only if the timing cooperates.
//
// Coalescing rather than superseding: superseding does not break the guard, it
// just burns a call and adds cancellation state for no gain.
//
//   law: max_in_flight_archivist_runs = 1
//        a coalesced follow-up reads the NEWEST workspace revision

export class ArchivistRunner {
  /**
   * @param getWorkspace  () => current workspace (must return the newest)
   * @param invoke        (ws, runId) => Promise<string>  raw Archivist output
   * @param apply         (ws, raw, opts) => result
   * @param commit        (result) => void|Promise  persist an applied result
   * @param mintRunId     () => string
   */
  constructor({ getWorkspace, invoke, apply, commit, mintRunId }) {
    Object.assign(this, { getWorkspace, invoke, apply, commit, mintRunId });
    this.inFlight = null;
    this.pending = false;
    this.runsStarted = 0;
  }

  get isRunning() {
    return this.inFlight !== null;
  }

  /** True when a follow-up run is queued behind the in-flight one. */
  get isPending() {
    return this.pending;
  }

  /**
   * Request a maintenance run. Resolves when this request's work is done —
   * either its own run, or the coalesced run that subsumed it.
   */
  request() {
    if (this.inFlight) {
      // depth-1 coalescing queue: many clicks collapse to one follow-up
      this.pending = true;
      return this.inFlight.then(() => this.settled);
    }
    return this.#start();
  }

  #start() {
    this.inFlight = this.#runOnce()
      .then(async (result) => {
        this.inFlight = null;
        if (this.pending) {
          this.pending = false;
          // Read the workspace again: the follow-up must see what the run that
          // just finished committed, or its revision check will reject it.
          this.settled = await this.#start();
          return this.settled;
        }
        this.settled = result;
        return result;
      })
      .catch((e) => {
        this.inFlight = null;
        this.pending = false;
        throw e;
      });
    return this.inFlight;
  }

  async #runOnce() {
    const ws = this.getWorkspace();
    const runId = this.mintRunId();
    const expectedRevision = ws.revision;

    this.runsStarted += 1;
    const raw = await this.invoke(ws, runId);

    // Re-read: the workspace may have moved while the model was thinking.
    const current = this.getWorkspace();
    const result = this.apply(current, raw, { outstandingRunId: runId, expectedRevision });

    if (result.status === 'applied') await this.commit(result);
    return result;
  }
}
