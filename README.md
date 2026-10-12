# Pump Fantasy

Pump Fantasy is a daily five-pick fantasy contest based on the pump.fun 1M profit leaderboard. Each round starts with the top-50 one-month PnL snapshot, split into five fixed rank bands. Pick one trader from each band. A pick scores closing 1M PnL minus opening 1M PnL; the five changes are added and the highest lineup wins the disclosed funded prize pool. Wallet sign-in and SPL/Token-2022 balance checks are implemented; entry stays closed until the token mint, minimum, active round, data feed, rules, and prize funding are configured.

## Honest launch status

This local revision has not been deployed. The playable contest is **not open** until the production setup below is complete. A timestamped Pump.fun one-month top-50 roster and its profile images are included as a dated snapshot; leaderboard values move and this snapshot must be refreshed before a real round. This revision implements wallet challenge/signature verification, server-side SPL Token and Token-2022 balance checks, one saved lineup per wallet/round, fixed rank-band validation, standings calculation, and a protected 50-player data-ingest route. It does not fabricate live rankings or scores.

No verified public Pump.fun leaderboard API is configured in this project. The current data-ingest route accepts a verified 50-player snapshot from an approved operator/feed; it is not a background Pump.fun scraper. The included roster is a dated snapshot, not a live ranking. The source and capture timestamp are recorded for each ingested snapshot. To make data updates automatic, connect an authorized, stable provider/API and schedule ingestion. Railway is unnecessary for the Next.js site and Supabase-backed API; add a worker host only if the approved data provider needs a persistent polling process.

No prize pool or payout transaction is implemented in this revision. The protected import is an operator-controlled data upload, not a production scoring feed. Do not advertise funded prizes or automatic payouts until the creator-fee source/split, treasury, opening/closing snapshots, tie-break rules, and payout execution have been implemented and verified.

## Required production setup

1. Create a Supabase project and apply [`supabase/migrations/202610120001_pump_fantasy.sql`](supabase/migrations/202610120001_pump_fantasy.sql).
2. Create one season row, initially `draft`; verify the schedule and scoring rules before changing it to `open`.
3. Set the variables in `.env.example` in Vercel Production. Keep `SUPABASE_SERVICE_ROLE_KEY`, `PF_SESSION_SECRET`, `SOLANA_RPC_URL`, and `PF_DATA_INGEST_SECRET` server-only. Use a high-entropy session secret (32+ random bytes) and an RPC provider appropriate for production traffic.
4. Confirm the exact $PF mint and minimum whole-token threshold. Set `PF_MINT_ADDRESS` and `PF_MINIMUM_TOKENS` only after verifying both; the balance check counts SPL Token and Token-2022 accounts.
5. Capture and verify exactly 50 players from the agreed Pump.fun 1M leaderboard snapshot. Post them to `POST /api/admin/players` with `Authorization: Bearer <PF_DATA_INGEST_SECRET>`. Each row needs a unique `rank` (1–50), wallet, opening `pnlUsd`, and `contestChangeUsd` (closing 1M PnL minus opening 1M PnL; null until there is a source-verified close). Include the profile image URL only from an approved Pump.fun image host. Store the actual source URL and observation time in the body.
6. Open the season only after the player list, scoring window, minimum balance, entry-lock time, and prize terms are published. Recheck Vercel deployment health and Supabase logs.

### First season timing

The first season is configured to use a three-hour lineup-draft window followed by a 48-hour scoring window. Keep the season in `draft` until the owner says to start. At that moment, set `opens_at` to now, `locked_at` to three hours later, and `closes_at` to 48 hours after `locked_at`, then set `status` to `open`. The entry API checks all three timestamps, so early entries are rejected, lineups lock at the three-hour mark, and entries remain closed after the 48-hour contest ends. No Railway scheduler is needed for these entry cutoffs; the API evaluates the timestamps on each request.

Run this statement in Supabase only when the owner gives the go-ahead, replacing the season ID with the exact `pf_seasons.id`:

```sql
update public.pf_seasons
set status = 'open',
    opens_at = now(),
    locked_at = now() + interval '3 hours',
    closes_at = now() + interval '51 hours'
where id = 'season-1' and status = 'draft';
```

This controls entry timing only. It does not capture the closing leaderboard, calculate/verify winners, claim Pump.fun creator fees, or transfer prizes; those still need a trusted PnL feed and a separately secured settlement/payout process.

### Environment variables

See `.env.example`. The API refuses entry writes when the required secrets, mint, threshold, active season, or database are missing. The active season ID must match the Supabase `pf_seasons.id` row. The service-role key is never sent to the browser.

### Data ingest example

```json
{
  "sourceUrl": "https://pump.fun/leaderboard",
  "observedAt": "2026-10-12T16:00:00.000Z",
  "players": [
    {
      "rank": 1,
      "wallet": "<verified-solana-wallet>",
      "displayName": "<public-name-or-null>",
      "profileUrl": "https://pump.fun/<verified-profile>",
      "pnlUsd": 1234.56,
      "avatarUrl": "https://socialimages.pump.fun/profile-images/example.webp",
      "contestChangeUsd": null
    }
  ]
}
```

The endpoint requires exactly 50 unique ranks and wallets. At the opening snapshot, `pnlUsd` is each trader's one-month baseline. At close, `contestChangeUsd` is closing 1M PnL minus that opening value. Only send observed source data. Protect the ingest secret and rotate it if exposed.

## Local development

Requires Node.js 24.

```bash
npm install
npm run dev
```

## Validation

```bash
npm run lint
npm run build
```
