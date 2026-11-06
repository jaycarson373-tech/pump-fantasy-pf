**Status:** done
**Owner:** codex--pf-draft-wallet-cta
**Branch:** codex/draft-wallet-cta
**Next:** Run the real Phantom walkthrough when browser control is available; local fix is applied and ready for user testing.

Actor: Codex. User picked five traders in the open local no-prize draft but Connect & verify is disabled. Root cause: roster CTA disabled whenever auth.eligible is false, despite its sign-in label. Reuse the existing single wallet/menu/controller; enable the same-menu action before eligibility, keep actual submission gated. No token-check changes, financial effects or additional wallet provider. User approved the Submit squad label. Separate worktree avoids peer-owned error-logging edits. Requested peer coordination before touching WalletControl props.


Implementation: unauthenticated five-pick entry starts the existing wallet menu, verifies the message, then submits once. Cancel/rejection/unmount prevents continuation. The signed-in draft key adopts current picks before PUT so auth hydration cannot erase successful saves or submission failures. Session hydration cannot overwrite newer verification; account checks reject wallet changes during verification.

Verification (Actor: Codex, Node 24.22.1): 55 tests, explicit tsc --noEmit, repository ESLint and webpack production build passed on the candidate. Local HTTP 200 and the signed disposable-wallet API regression passed against the existing isolated no-prize database; no token holdings/burn or funds. Generic global lint still reports pre-existing large-component complexity/nested ternaries, not enforced by this repository lint. Browser/Phantom walkthrough remains BLOCKED: browser access host unavailable. Production was not deployed or changed.

Independent review: requested gpt-6.1-sol/xhigh, actual model not exposed. Reviewer identified hydration erasing PUT errors, fixed by carrying the draft before submission; focused recheck passed. No separate provider/controller was introduced. Local draft timer preserved.

Source commit: 3c6123f, integrated into codex/single-wallet-backend for existing draft PR #8. Final runtime files match the reviewed source; HTTP 200 and local API submission/readback/edit/logout passed after copying. Existing draft deadline unchanged.
