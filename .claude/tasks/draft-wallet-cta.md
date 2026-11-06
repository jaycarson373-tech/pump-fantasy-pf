**Status:** in-progress
**Owner:** codex--pf-draft-wallet-cta
**Branch:** codex/draft-wallet-cta
**Next:** Fix and verify the disabled roster sign-in CTA, then update the local test instance.

Actor: Codex. User picked five traders in the open local no-prize draft but Connect & verify is disabled. Root cause: roster CTA disabled whenever auth.eligible is false, despite its sign-in label. Reuse the existing single wallet/menu/controller; enable the same-menu action before eligibility, keep actual submission gated. No token checks, copy, financial effects or additional wallet provider. Separate worktree avoids peer-owned error-logging edits. Requested peer coordination before touching WalletControl props.
