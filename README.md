# Pump Fantasy

Pump Fantasy is a five-pick fantasy contest based on Pump.fun's one-month PnL leaderboard. Each season snapshots the top 50, split into five fixed rank bands. Eligible holders choose one trader from each band during a one-hour draft. Picks are saved per wallet and can be edited until the server-side lock. The scoring period then runs 48 hours with one-day score settlements. Confirmed creator fees split 30% into daily rewards, 50% into the overall 48-hour season winner pool, and 20% into championship bonus reserves.

The public root route shows the relaunch page while a season is being prepared or scheduled, then switches to the draft application when the season opens (including visitors already waiting on the page). The site is noindex. Squad submission stays disabled until the backend reports an open draft, the live 50-player roster is available, and the connected wallet passes the signed-message plus 500,000 FANTASY balance check.

## What is implemented

- Wallet Standard connection and one-time signed-message authentication; no transaction is needed to sign in.
- Server-side SPL Token and Token-2022 balance checks; the default minimum is 500,000 whole FANTASY.
- Persistent one-entry-per-wallet storage in Railway Postgres, with server-side rank-band and deadline validation.
- A fixed Pump.fun top-50 roster per season and fresh 1M PnL score snapshots at the scoring start and daily boundaries.
- Automatic daily winner calculation, tied-score resolution by wallet address, payment-status records, and season rollover to a fresh top 50.
- Optional automatic SOL payouts are disabled by default. When explicitly enabled, a protected Railway worker signs transfers from the dedicated payout wallet; awards are shown as paid only after the exact transfer finalizes onchain.
- A Railway server clock retries due season work every five minutes and runs immediately on app startup. Score windows missed by more than 15 minutes are marked `awaiting_data` rather than fabricating a winner.

Pump.fun's public leaderboard endpoint is an external dependency. If it omits a selected trader or fails around a settlement boundary, that day's payout is held for review instead of ranking incomplete data. Do not advertise a prize as funded until the prize amount is configured and the prize wallet has the funds.

## Railway production setup

The Railway project contains the `pump-fantasy-pf` web service and a Postgres service. `DATABASE_URL` on the web service references Railway Postgres. `npm start` runs the idempotent SQL migrator before starting Next.js, so the schema is ready even when Railway uses its service-level start command instead of the repository deploy configuration. A failed migration prevents startup. The `SOLANA_RPC_URL`, `PF_SESSION_SECRET`, and `PF_DATA_INGEST_SECRET` are server-side variables. Keep them private.

On Vercel, the production-only `PF_API_PROXY=1` setting enables a `beforeFiles` rewrite that proxies every `/api/*` request to this Railway service; Railway does not set that flag, so the backend serves API routes locally. Keep `NEXT_PUBLIC_SITE_URL` set to the canonical public domain (`https://www.pumpfunfantasy.xyz`) so originless wallet challenges bind to the website users should visit. The origin checker allows that canonical origin and this repo's `pump-fantasy-pf.vercel.app` project domain by default. Set `PUMP_FANTASY_ALLOWED_ORIGINS` on Railway to add any other exact browser origins; wallet challenge messages use the validated page origin, not Railway's internal request host.

The first season row is `season-1` with status `draft`. After the FANTASY token is live, set `FANTASY_MINT_ADDRESS` to the verified mint. Health and preflight verify that the mint is initialized on Solana through the configured RPC; a nonempty address alone is not enough. For this relaunch, use `PF_REWARD_MODE=creator-fees`; no fixed daily SOL prize is needed. Set the new dedicated creator wallet public address in both `PF_CREATOR_WALLET_ADDRESS` and `PF_PRIZE_WALLET_ADDRESS`, and configure the matching 64-byte Solana keypair JSON in the server-only `PF_PAYOUT_SIGNER_KEYPAIR_JSON` secret. Turnkey is not required. The keypair is validated against the configured prize address before signing; signing never broadcasts. Never place the keypair in Git, browser variables, or logs. `PF_AUTO_PAYOUT_MAX_AWARD_LAMPORTS` defaults to `1000000000` (1 SOL), and `PF_AUTO_PAYOUT_MAX_SEASON_LAMPORTS` defaults to `2000000000` (2 SOL); explicit overrides must be positive bounded integers. Blank or malformed overrides block payouts. Awards remain limited to their confirmed fee allocation. Set `PF_CREATOR_WALLET_DEDICATED=true`, `PF_FEE_COLLECTION_ENABLED=true`, `PF_AUTO_PAYOUT_ENABLED=true`, and `PF_PAYOUT_NETWORK=mainnet-beta`. Fund at least 0.005 SOL separately for claims and transfers. The creator must match the token's onchain Pump creator, and the token must be SOL-quoted. Shared-fee configurations currently fail closed.

Pinned current official Pump and PumpSwap instructions claim both creator vaults through Solana Kit. Signed claim bytes are persisted before submission; unknown transactions are held for reconciliation. Only finalized withdrawals from those vaults are credited, with a unique transaction receipt preventing double counting. The worker runs every five minutes. 30% of each receipt enters the daily pool and 50% enters the season pool, each rounded down to whole lamports. The remaining 20% plus rounding remainders enters the championship bonus reserve. The daily prize freezes at each 24-hour cutoff, with later receipts carrying into the next day. With no eligible entry, the daily allocation carries forward. Missing scoring data holds settlement. Gas costs are funded separately.

Each winner transfer must exactly match its assigned daily or season share of confirmed fee receipts. The payout balance check preserves every unpaid allocation and the full championship reserve. The 48-hour season winner uses opening-to-closing PnL change, with the existing wallet-address tie rule; the 50% pool freezes at the season close. Missing scoring data holds its allocation for review; no eligible entries carries the pool forward. Championship bonus payouts remain reserved pending separately published rules. Daily and season awards share the same per-award and combined per-season SOL caps. The migration preserves historical 65/35 receipts and applies 30/50/20 only to new receipts. Fixed-prize mode remains available for older deployments with its original explicit payout caps.

Before launch, call the protected read-only preflight. It checks the live FANTASY mint, database/migrations, prepared draft season, Pump.fun top-50 snapshot, dedicated creator/signature configuration, onchain creator and quote checks, explicit mainnet setting, and gas funding. In creator-fee mode, award amounts are bounded by confirmed daily/season fee allocations instead of a fixed prize. It does not start a season or send a transaction.

You can also run the public and protected checks together from a trusted machine. Set `NEXT_PUBLIC_SITE_URL` to the canonical site and `PF_DATA_INGEST_SECRET` in the shell first. The script never prints the secret, prize wallet, or player list, and it never starts a season or sends a transaction. It exits nonzero unless every launch gate passes.

```bash
npm run check:live
```

```bash
curl "$NEXT_PUBLIC_SITE_URL/api/admin/season/preflight" \
  -H "Authorization: Bearer $PF_DATA_INGEST_SECRET"
```

To open Season 1, call the protected start endpoint once after the token is live and preflight returns `ready: true`. It snapshots Pump.fun's current 1–50 field and opens a one-hour draft by default. The server sets the deadline to exactly 60 minutes after the operator starts the season. The next 48 hours are split into two daily scoring windows. Later seasons open automatically when the preceding season ends.

From this checkout, run `sh scripts/open-draft.sh` with the Railway CLI authenticated. The script injects the existing production admin secret without displaying it and opens the real holder-only draft only when preflight passes. The homepage countdown follows the server deadline and survives reloads.

For an unfunded wallet-flow check before token launch, run `sh scripts/open-draft.sh test-open`, then `sh scripts/open-draft.sh test-close` after testing. The test uses a separate season and permits any wallet that signs in. If the live leaderboard is unavailable, this explicitly labeled test uses the archived field. Test drafts never collect fees, score awards, pay prizes, or roll over. Closing restores the prepared real season and its 500,000-token requirement; test entries remain in the separate test season. Do not leave the temporary test active as the real contest.

```bash
curl -X POST "$NEXT_PUBLIC_SITE_URL/api/admin/season/start" \
  -H "Authorization: Bearer $PF_DATA_INGEST_SECRET"
```

Daily SOL awards are sent only when automatic payout and fee collection are enabled and the dedicated signer is configured. Keep all signer keys in Railway secrets. Apply all migrations, including `202611060001_season_fee_rewards.sql`, before enabling collection. No mainnet claim or winner transfer is performed by the readiness check or by merely deploying the site.

## Local development

Requires Node.js 24 and a PostgreSQL database. Set `DATABASE_URL`, `PF_SESSION_SECRET`, `SOLANA_RPC_URL`, `FANTASY_MINT_ADDRESS`, `PF_ACTIVE_SEASON_ID`, and `PF_DATA_INGEST_SECRET` in a local environment. Apply the schema with `npm run db:migrate`, then run `npm run dev`.

```bash
npm run lint
npm run build
```

`npm run test:fees` verifies migration preservation, fee accounting and real season-worker settlement against a **new, empty local PostgreSQL database** whose name starts with `pf_fee_test`. Supply its `DATABASE_URL`; do not inject production secrets. It disables collection/payouts, uses stored local score fixtures and sends no transactions. It refuses a database that already contains the app schema.
