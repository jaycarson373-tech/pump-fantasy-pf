# Pump Fantasy

Pump Fantasy is a five-pick fantasy contest based on the pump.fun 1M profit leaderboard. Each season starts with the top-50 one-month PnL snapshot, split into five fixed rank bands. Pick one trader from each band. A pick scores closing 1M PnL minus opening 1M PnL; the five changes are added and the highest lineup wins the disclosed funded prize pool. Wallet sign-in and SPL/Token-2022 balance checks are implemented; entry stays closed until production configuration is complete and the operator starts a season.

## Honest launch status

This revision implements wallet challenge/signature verification, server-side SPL Token and Token-2022 balance checks, one saved lineup per wallet/season, fixed rank-band validation, standings calculation, protected roster ingest, and an operator-only season-start endpoint. It does not fabricate live rankings or scores. Entry stays closed until production configuration is complete and the operator starts the season.

The app reads the public Pump.fun frontend leaderboard endpoint directly; Pump.fun may change or rate-limit it. The season-start endpoint refuses to open the draft if it cannot capture and validate a fresh, consecutive top-50 snapshot. A protected operator import route is also available as a fallback. The included roster is a dated preview snapshot, not the season-opening field.

The start endpoint captures a fresh top-50 monthly leaderboard from Pump.fun, saves it as the opening snapshot, then starts the three-hour draft. Submitted entries are rejected after the deadline. A season lasts 48 hours after the draft closes. Closing snapshots, final winner settlement, creator-fee claiming, prize payout, season rollover, and playoffs are not automated in this revision. Do not advertise funded prizes or automatic payouts until those systems are implemented and verified.

## Required production setup

1. Create a Supabase project and apply both migrations in [`supabase/migrations`](supabase/migrations). The second migration creates `season-1` in `draft` state.
2. Set `PF_ACTIVE_SEASON_ID=season-1` in Railway.
3. Import this repository into Railway. `railway.json` builds and runs the complete Next.js app (site plus API) and exposes `/api/health` for the deployment health check. Add the environment values in `.env.example`; keep all server-only values in Railway variables. Set `NEXT_PUBLIC_SITE_URL` to the Railway public domain and add the custom domain there if desired.
4. After the token launches, add its verified mint address as `FANTASY_MINT_ADDRESS`. The holder gate requires at least 500,000 whole FANTASY tokens (or a higher configured threshold) and checks both SPL Token and Token-2022 accounts.
5. Verify `/api/health` reports `backendConfigured: true`. Then, after the operator confirms the token is live, start the first season with the protected endpoint below. It captures the fresh Pump.fun one-month top 50, opens the draft immediately for three hours, and sets the following scoring window to 48 hours.

### First season timing

The owner starts the season only after launch by calling this operator-only endpoint from a trusted terminal. It fetches and stores the current leaderboard, then sets `opens_at` to now, `locked_at` to three hours later, and `closes_at` 48 hours after lock. The API enforces these timestamps on every entry request, so a Railway scheduler is not needed to close the draft.

```bash
curl -X POST "$NEXT_PUBLIC_SITE_URL/api/admin/season/start" \
  -H "Authorization: Bearer $PF_DATA_INGEST_SECRET"
```

This endpoint does not claim creator fees or transfer prizes. The season-end snapshot, verified final score, prize settlement, future seasons, and playoff qualifier logic still require implementation. The payout private key is not used for wallet connection, holder verification, or squad submission; do not add it until a separately reviewed payout worker is built.

### Environment variables

See `.env.example`. The API refuses entry writes when the required secrets, mint, threshold, active season, or database are missing. The active season ID must match the Supabase `pf_seasons.id` row. The service-role key is never sent to the browser. A private key is not required for the draft flow.

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
