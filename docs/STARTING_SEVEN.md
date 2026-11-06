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

New seasons explicitly configured with `PF_REWARD_ASSET=PUMP` collect and allocate actual $PUMP directly: 30% daily, 50% season, 20% champion. No SOL-to-PFL conversion is involved. Historical SOL receipts and PFL conversion seasons retain their original asset identities. Migrations005/006 bind receipt, season, entitlement and persisted claim assets; duplicate or mismatched allocations fail at the database boundary.

Authenticated `POST /api/league/claim` accepts an entitlement ID, derives its recipient and amount from the ledger, checks funding/caps, persists a signed wire before broadcasting, and confirms only exact finalized bytes plus PUMP token movement. Unknown sends retain their original signature and cannot be replaced. This implementation is not proof of a funded mainnet payout. Historical conversion rows still require independently verified onchain evidence.

Final activation requires treasury authority, reviewed payout implementation, operational safeguards and the legal review requested in the specification. Daily funds outside scoring windows, insufficient entrants, integer dust and late receipts remain retained in the ledger; agree a carryover policy before settlement activation. Rank movement is currently unavailable rather than fabricated. Champion screen shows final totals; detailed historical winning-roster presentation is still a follow-up.

The existing Railway web service and Postgres were paused by the operator for cost. They have not been restarted. No environment secrets or live spending switches were changed. Production migrations, funded wallet submissions, swaps and payouts have not been tested on mainnet. This is not a mainnet-readiness certification.

## Checks and UI evidence

65 unit tests cover previous behavior plus tiers, roster/captain constraints, exact 500000-token boundary across decimals, clock locks, score ties/losses, season points and reward conservation. The ephemeral PostgreSQL test applies all nine migrations and exercises 36 database constraints, including duplicate claims, receipt attribution, conversion budgets, locked entries and immutable scores. It uses PGlite only in a temporary QA folder, not as a production dependency.

Run `DATABASE_URL=postgresql://localhost:55442/pf_league_test_<fresh_name> node scripts/test-starting-seven-db.mjs` against a fresh disposable local PostgreSQL database for database checks. `scripts/qa-league-ui.mjs` is a loopback-only read-only UI test gateway with conspicuously named QA fixtures; it is never a live data adapter. Seven picks and captain were verified to persist back to the hero. Desktop and mobile checks include lower-page layout and Dexscreener links.

Design references reviewed: https://21st.dev/community/components and https://reactbits.dev/components/spotlight-card. No reference implementation copied and no animation dependency added. Custom vector crest follows the supplied PFL shield direction; CSS uses a football draft board, compact standings and restrained tier colors. Missing shared Projects2026 AI_CONTEXT/workflows paths were noted; repository-local instructions were used.

## Opening Draft override — latest operator instruction

The first draft has a 45-minute window from the operator-announced token launch. Do not start it until the operator says to. The waiting UI labels the Opening Draft and its 45 MIN entry window; the running countdown appears only with an actual operator-set deadline. When ready, protected create-season accepts `openingDraftAt` (a future ISO UTC timestamp) instead of `startsAt`. It verifies the configured mint and creates the first lock exactly 45 minutes later, with seven-day scoring and later 24-hour draft windows before each weekly lock. No schedule or live settings were changed by this update. Complete the production data/backend setup before opening entries. Existing published calendars cannot be rewritten.

Latest presentation update: removed the global league-data banner and launch-pending phrases. The draft board retains an inline refresh control and actual submissions remain server-gated. Each later Opening Draft calendar round opens during the final 24 hours of the previous week (including drafting Week 3 before Week 2 ends). Existing published rounds and the legacy calendar are unchanged. No countdown was started.

### November 6: real Top 100 draft catalog
- `data/pumpfun-monthly-top100.json` contains all 100 records read from Pump's selected 1M Profit leaderboard, including public wallet/profile links, avatars, displayed USD PnL, and capture timestamp. This is a timestamped catalog, not fabricated sample data or a live scoring feed.
- Before the backend publishes a round, visitors can select 1/2/2/2, choose a captain, and save their draft on this device. Hero and draft use the same saved selections. A local save does not confirm competition entry.
- Published round data always takes precedence. No catalog fallback may replace a known round or unlock a closed round. Entry still requires the server round, authenticated wallet, holdings and lock checks.
- Pump's rendered monthly board does not supply trade counts, ROI, a finalized slot or complete accounting evidence. These stay null; the strict competition validator rejects this display catalog. Backend owner must publish the validated round snapshot and enable the existing entry service; do not reuse these historical PnL totals as weekly points.
- Collaborator CA merged: `PFLnhH2Rn2kd2maipS8ueJVCojHsrnraPLn3HAQoB8W`. Header has one compact copyable address beside X, with no duplicate full-width line. Wallet chevron removed.
- Railway remains paused and the opening 45-minute clock has not been started.

### November 6: PUMP test integration and deployment alignment

Actor: Codex. Latest frontend source baseline `0bdbc57` (context head `71f342e`) preserves the Top100 catalog, saved seven-player draft, broadcast promos and CA controls. Both active frontend sessions confirmed 30/50/20. Backend remains stopped; public `/api/league` and `/api/health` returned404 during this integration. No vault keys were read, token launched, funds sent, or live switches changed by this update.

PUMP payout gates additionally require `PF_AUTO_PAYOUT_ENABLED=true`, `PF_PAYOUT_NETWORK=mainnet-beta`, matching dedicated creator/prize wallet addresses, approved signer injection, explicit positive `PF_AUTO_PAYOUT_MAX_AWARD_RAW` and `PF_AUTO_PAYOUT_MAX_SEASON_RAW`, and an approved unexpired `PF_AUTO_PAYOUT_RUN_UNTIL` ISO deadline. Raw PUMP uses six decimals. Individual network fees are capped at25,000lamports and ATA rent at2,500,000lamports. Keep all effect switches off until the bounded key/funding workflow is approved. Never reuse the existing production PFL mint as if its quote were PUMP; the test requires a fresh verified PUMP-quoted mint and isolated database/treasury.

`npm run check:live` now inspects the current public Starting Seven API, not the retired five-player/Top50 endpoints. It uses no credentials. Display catalog data is not qualified rankings, exact-interval PnL, or historical holding evidence. Those three provider contracts, backend activation, funded receipts and a real wallet walkthrough remain release gates. The browser automation host was unavailable; no Phantom pass is claimed.

Verification of the PUMP candidate:97unit tests, TypeScript, lint, production build and five fresh PostgreSQL suites passed on Node24.22.1. Independent review found two claim-recovery defects; both fixed and regression tested. Actual PUMP uses Token-2022, six decimals and a dormant transfer hook. Both collection and payout now use that program; mint checks reject hook activation or unsupported extensions. Mainnet read-only validation passed at finalizedslot466239125. This remains unproven with funded transactions.
