type DraftEntryState = {
  busy: boolean;
  pickCount: number;
  requiredPicks: number;
  authenticated: boolean;
  eligible: boolean;
  draftOpen: boolean;
  rosterReady: boolean;
};

export function canStartDraftEntry(state: DraftEntryState) {
  return !state.busy && (state.requiredPicks === 5 || state.requiredPicks === 6) && state.pickCount === state.requiredPicks && state.draftOpen && state.rosterReady
    && (!state.authenticated || state.eligible);
}

/** Keep one entry request while the existing wallet menu/signature prompt is open. */
export function createDraftEntryAction() {
  let pending: Promise<void> | null = null;
  let generation = 0;
  return {
    cancel() { generation++; },
    run(verify: () => Promise<boolean>, submit: () => Promise<void>) {
      if (pending) return pending;
      const started = generation;
      pending = (async () => {
        if (await verify() && started === generation) await submit();
      })().finally(() => { pending = null; });
      return pending;
    },
  };
}
