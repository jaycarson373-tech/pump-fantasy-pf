# Pump Fantasy

Pump Fantasy is a five-pick fantasy contest based on Pump.fun's one-month PnL leaderboard. Each season snapshots the top 50, split into five fixed rank bands. Eligible holders choose one trader from each band during a three-hour draft. Picks are saved per wallet and can be edited until the server-side lock. The scoring period then runs 48 hours with one-day score settlements.

The public root route is currently the relaunch page. The complete draft application is staged at `/draft` and remains noindex; its submit button stays disabled until the backend reports an open draft, the live 50-player roster is available, and the connected wallet passes the signed-message plus 500,000 FANTASY balance check.

## What is implemented

- Wallet Standard connection and one-time signed-message authentication; no transaction is needed to sign in.
- Server-side SPL Token and Token-2022 balance checks; the default minimum is 500,000 whole FANTASY.
- Persistent one-entry-per-wallet storage in Railway Postgres, with server-side rank-band and deadline validation.
- A fixed Pump.fun top-50 roster per season and fresh 1M PnL score snapshots at the scoring start and daily boundaries.
- Automatic daily winner calculation, tied-score resolution by wallet address, payment-status records, and season rollover to a fresh top 50.
- Onchain verification before an award is shown as paid. The prize wallet must make the SOL transfer; this app does not store a private key or sign transfers server-side.
- A Railway server clock retries due season work every five minutes and runs immediately on app startup. Score windows missed by more than 15 minutes are marked `awaiting_data` rather than fabricating a winner.

Pump.fun's public leaderboard endpoint is an external dependency. If it omits a selected trader or fails around a settlement boundary, that day's payout is held for review instead of ranking incomplete data. Do not advertise a prize as funded until the prize amount is configured and the prize wallet has the funds.

## Railway production setup

The Railway project contains the `pump-fantasy-pf` web service and a Postgres service. `DATABASE_URL` on the web service references Railway Postgres. The service runs the idempotent SQL migrator before starting Next.js, so the schema is ready before health checks pass. The `SOLANA_RPC_URL`, `PF_SESSION_SECRET`, and `PF_DATA_INGEST_SECRET` are server-side variables. Keep them private.

On Vercel, the production-only `PF_API_PROXY=1` setting enables a `beforeFiles` rewrite that proxies every `/api/*` request to this Railway service; Railway does not set that flag, so the backend serves API routes locally. Keep `NEXT_PUBLIC_SITE_URL` set to the canonical public domain (`https://www.pumpfunfantasy.xyz`) so wallet challenges bind to the website users actually visit.

The first season row is `season-1` with status `draft`. After the FANTASY token is live, set `FANTASY_MINT_ADDRESS` to the verified mint. Health and preflight verify that the mint is initialized on Solana through the configured RPC; a nonempty address alone is not enough. Set `PF_DAILY_PRIZE_LAMPORTS` to the exact daily SOL prize in lamports, set `PF_PRIZE_WALLET_ADDRESS`, and fund the prize wallet before starting the season. The start endpoint checks that it covers both days of prizes plus fees.

Before launch, call the protected read-only preflight. It checks the live FANTASY mint, database/migrations, prepared draft season, Pump.fun top-50 snapshot, prize amount, prize-wallet address, and enough SOL to cover both daily awards plus fees. It does not start a season or send a transaction.

You can also run the public and protected checks together from a trusted machine. Set `NEXT_PUBLIC_SITE_URL` to the canonical site and `PF_DATA_INGEST_SECRET` in the shell first. The script never prints the secret, prize wallet, or player list, and it never starts a season or sends a transaction. It exits nonzero unless every launch gate passes.

```bash
npm run check:live
```

```bash
curl "$NEXT_PUBLIC_SITE_URL/api/admin/season/preflight" \
  -H "Authorization: Bearer $PF_DATA_INGEST_SECRET"
```

To open Season 1, call the protected start endpoint once after the token is live and preflight returns `ready: true`. It snapshots Pump.fun's current 1–50 field and opens a three-hour draft by default. For a specific lock time within the next three hours, send `draftLocksAt` as an ISO-8601 timestamp with an explicit timezone; the server rejects past times and durations over three hours. The next 48 hours are split into two daily scoring windows. Later seasons open automatically when the preceding season ends.

```bash
curl -X POST "$NEXT_PUBLIC_SITE_URL/api/admin/season/start" \
  -H "Authorization: Bearer $PF_DATA_INGEST_SECRET"
```

For example, to lock the draft at 2:00 PM Eastern on October 13, 2026 (EDT, UTC−4), use `{"draftLocksAt":"2026-10-13T14:00:00-04:00"}` as the JSON request body. Only do this when the preflight is ready and the requested lock time is still in the future.

The prize wallet connects to the site and presses the daily award payment button; the wallet shows the exact SOL transfer for approval. The award is marked paid only after RPC confirms that exact transfer to the winner. Submit the verified signature to `/api/admin/awards/payment` with `awardId` and `signature`, using the same bearer secret. A wallet private key is not required by the site.

## Local development

Requires Node.js 24 and a PostgreSQL database. Set `DATABASE_URL`, `PF_SESSION_SECRET`, `SOLANA_RPC_URL`, `FANTASY_MINT_ADDRESS`, `PF_ACTIVE_SEASON_ID`, and `PF_DATA_INGEST_SECRET` in a local environment. Apply the schema with `npm run db:migrate`, then run `npm run dev`.

```bash
npm run lint
npm run build
```
