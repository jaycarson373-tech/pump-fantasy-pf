**Status:** in-progress
**Owner:** codex--pump-fantasy-pf
**Branch:** codex/single-wallet-backend
**Next:** Obtain scoped GitHub/Railway credential and deployer-key authorization, publish without triggering hosted CI, then configure/deploy and run read-only preflight.

Actor: Codex. Session 32da0da0. User authorized single-wallet signing and agent-selected caps.
Bounded change: reuse installed Solana Kit 7 signing and existing transaction proof/recovery, remove Turnkey. Shared solana-core/pump-fees loaders inspected: legacy web3.js types incompatible with this Kit transaction path; no new dependency needed.
Money decisions 2026-11-05: retain 65% daily / 35% reserve, two daily awards per 48-hour season, computed winner recipients and one-hour draft. Initial configuration caps: 1 SOL/award, 2 SOL/season. No funded transaction or deployment authorized yet. User-named wallet keypair remains unopened. Public mint/creator identity must be verified before activation; no ownership mappings in published docs.

Verification: Node 24.22.1; 49 tests, tsc --noEmit, ESLint, production webpack build pass. Independent review role requested gpt-6.1-sol/xhigh (actual unknown), source-only, no blocking findings. Existing entry SQL integration and migration checks passed against temporary PostgreSQL before this signer-only change. Turnkey removed; default award/season caps 1/2 SOL; explicit invalid values fail closed.
Remaining: no production key access/configuration/deployment; GitHub credential use unapproved; draft PR currently triggers hosted ubuntu-latest CI without verified budget. Manual roster-import env season-ID defect remains outside this signer change. Existing historical MAINNET report describes the older managed signer.
