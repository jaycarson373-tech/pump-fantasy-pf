# Starting Seven handoff — 2026-11-06

## Implemented

- Existing Wallet Standard connection, signed-message sessions and SPL/Token-2022 balance reads reused. Server requires at least 500,000 PFL; 500,000 exactly qualifies. No custody or spending approval for entry.
- `lib/league/engine.ts`: 100-player validation; four tier quotas; seven unique picks; captain; UTC calendar; deterministic interval scoring; weekly percentiles; season tie ordering; integer fee splits and tied prizes.
- `lib/server/league/`: authenticated entry, database-backed rounds, fixed snapshots, interval evidence adapters, historical eligibility coverage, weekly disqualification, recoverable scoring, fee allocation and pending reward entitlements.
- `app/league-app.tsx`, `app/starting-seven.css`: shared hero/draft lineup, searchable four-tier board, trader details, next-tier guidance adapted from collaborator commit 85cfaf1, mobile formation, team/boards/rewards/rules/champion screens. No invented production traders, transactions or prize balances.
- `GET /api/league`, `PUT /api/league/entry`, protected `POST /api/league/admin`, gated `POST /api/league/claim`. Existing auth endpoints retained. Legacy entry/admin mutation paths require the explicit legacy flag.
- Additive migration `202611060004_starting_seven.sql`: pfl seasons, rounds, rosters, eligibility events/coverage, days/scores, standings, fee allocations, conversions, entitlements, claims, jobs and settlements. Unique constraints, immutable published evidence and database-clock entry locks. Existing receipts carry a format discriminator preventing old/new double allocation.

## Required server configuration

Keep secret values out of Git, browsers and logs.

| Variable | Purpose |
|---|---|
| DATABASE_URL | Existing dedicated Postgres |
| PF_SESSION_SECRET | Existing session authentication, at least 32 characters |
| SOLANA_RPC_URL | Mainnet RPC for verified mint and balances |
| FANTASY_MINT_ADDRESS or PF_MINT_ADDRESS | Actual verified PFL mint |
| FANTASY_MINIMUM_TOKENS / PF_MINIMUM_TOKENS | Use 500000; Starting Seven enforces its 500000 rule independently |
| NEXT_PUBLIC_SITE_URL | Canonical https://www.pfleague.fun |
| PUMP_FANTASY_ALLOWED_ORIGINS | Exact permitted frontend origins |
| PF_DATA_INGEST_SECRET | Existing protected administration credential |
| PF_RANKINGS_URL | HTTPS historical Top100 source |
| PF_PNL_URL | HTTPS exact daily net-PnL source |
| PF_ELIGIBILITY_URL | HTTPS complete historical token-balance coverage |
| PF_LEAGUE_DATA_TOKEN | Optional server-only source bearer credential |
| PF_LEAGUE_FEE_CUTOVER | Reviewed ISO date separating eligible new receipts from prior obligations |
| PF_LEAGUE_WORKER_ENABLED | Defaults off; true enables the persistent league scheduler |
| PF_LEGACY_COMPETITION | Keep false for Starting Seven |
| PF_API_PROXY | Vercel-only 1 forwards all APIs to existing Railway; only enable with compatible running backend |

Frontend wallet RPC configuration remains as before. Never copy development proxy credentials into deployed clients.

Provider contracts are exported in `lib/server/league/provider.ts`. Rankings must attest a complete 30-day window at the Saturday boundary, screening policy, exclusions, exact integer PnL, qualifying trade counts and real wallets. Daily evidence must match interval and accounting methodology, exclude transfers and confirm deduplication/completeness. Eligibility evidence must cover the whole requested interval and actual mint decimals. Current RPC balances cannot substitute for historical custody coverage.

To create a future season, authenticated POST `/api/league/admin` with `{action:"create-season",id,title,number,startsAt,weeks:4}`. `startsAt` must be Monday 00:00 UTC and drafting begins the preceding Saturday. The mint is verified before creation. `{action:"tick"}` remains disabled unless the worker switch is enabled. No season was created on production in this update.

## Financial state and remaining work

The old Pump.fun monthly endpoint returned HTTP403 during verification. It also does not supply the required complete interval accounting. Production Top100, live scoring and continuous holding verification need reliable configured providers. No fake fallback is shipped.

Receipt allocation and pending entitlements are implemented. A reviewed, authorized SOL-to-PFL conversion executor and PFL payout/claim service are still required. `POST /api/league/claim` returns a review-required unavailable state; it does not pretend to transfer tokens. Conversion ledger rows must be supplied by a trusted onchain-verifying settlement service; SQL constraints alone do not prove a signature onchain. UI never offers a false successful claim.

Final activation requires treasury authority, reviewed payout implementation, operational safeguards and the legal review requested in the specification. Daily funds outside scoring windows, insufficient entrants, integer dust and late receipts remain retained in the ledger; agree a carryover policy before settlement activation. Rank movement is currently unavailable rather than fabricated. Champion screen shows final totals; detailed historical winning-roster presentation is still a follow-up.

The existing Railway web service and Postgres were paused by the operator for cost. They have not been restarted. No environment secrets or live spending switches were changed. Production migrations, funded wallet submissions, swaps and payouts have not been tested on mainnet. This is not a mainnet-readiness certification.

## Checks and UI evidence

65 unit tests cover previous behavior plus tiers, roster/captain constraints, exact 500000-token boundary across decimals, clock locks, score ties/losses, season points and reward conservation. The ephemeral PostgreSQL test applies all nine migrations and exercises 36 database constraints, including duplicate claims, receipt attribution, conversion budgets, locked entries and immutable scores. It uses PGlite only in a temporary QA folder, not as a production dependency.

Run `PGLITE_PACKAGE=/path/to/@electric-sql/pglite node scripts/test-starting-seven-db.mjs` for database checks. `scripts/qa-league-ui.mjs` is a loopback-only read-only UI test gateway with conspicuously named QA fixtures; it is never a live data adapter. Seven picks and captain were verified to persist back to the hero. Desktop and mobile checks include lower-page layout and Dexscreener links.

Design references reviewed: https://21st.dev/community/components and https://reactbits.dev/components/spotlight-card. No reference implementation copied and no animation dependency added. Custom vector crest follows the supplied PFL shield direction; CSS uses a football draft board, compact standings and restrained tier colors. Missing shared Projects2026 AI_CONTEXT/workflows paths were noted; repository-local instructions were used.
