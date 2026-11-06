# Pump Fantasy release

The website, live roster, real one-trader-per-band draft, holder check, scoring, creator-fee journal and payout reconciliation are implemented. The salary-cap Draft Lab is a separate browser-local simulation and cannot enter a prize contest.

## Required production setup

Frontend runs on Vercel; all entry, database, collection and payout services run on Railway. Keep `PF_API_PROXY=1` on Vercel. Configure these server-only Railway variables using the dashboard, never chat:

- `DATABASE_URL`, `PF_SESSION_SECRET` (at least 32 characters), `PF_DATA_INGEST_SECRET`.
- `SOLANA_RPC_URL` — HTTPS mainnet endpoint; the actual genesis hash is checked before holder or payout reads. A mainnet-looking hostname is insufficient.
- `FANTASY_MINT_ADDRESS` and `FANTASY_MINIMUM_TOKENS=500000`.
- `PF_ACTIVE_SEASON_ID` matching the database season.
- `PF_REWARD_MODE=creator-fees`.
- `PF_CREATOR_WALLET_ADDRESS`, `PF_PRIZE_WALLET_ADDRESS`. Use a dedicated creator wallet for this token; its fee vault can aggregate multiple tokens otherwise.
- `PF_CREATOR_PRIVATE_KEY` (base58) or `PF_PAYOUT_SIGNER_KEYPAIR_JSON` (64-byte JSON array), added directly to Railway secrets. The signing key must match the configured public wallet. No key goes in a public environment variable.
- `PF_PAYOUT_NETWORK=mainnet-beta` and explicit award/season spending caps where appropriate.

Keep `PF_FEE_COLLECTION_ENABLED=false` and `PF_AUTO_PAYOUT_ENABLED=false` until the owner reviews the wallet, funding and limits. They are deliberate operator controls, not frontend flags. Collection and awards preserve signed transaction records and reconcile uncertain results without creating replacement payments.

Vercel public values: `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_FANTASY_CA`, `NEXT_PUBLIC_SOLANA_RPC_URL`; do not expose the server RPC credential as the browser key. `PUMP_FANTASY_ALLOWED_ORIGINS` belongs on the backend and must allow the exact public site.

## Rewards and activation

Only finalized verified creator-fee claims fund rewards: 65% daily prizes and 35% reserve. No fixed prize is promised. The reserve is not an implemented weekly/monthly/playoff payout rule. A complete configured season, funded fee payer and protected preflight are required before the owner starts the 60-minute draft and 48-hour scoring period. Do not start a season from a generic deploy command.

Run `npm run check:live` against the canonical URL. This check is read-only and exits unsuccessfully while required settings are missing. Public health reports and the owner’s protected preflight determine launch status. Test a holder sign-in, entry, rejection, score snapshot and one authorized award before marketing a paid reward cycle.

## Release checks

38 domain tests cover scoring, award recovery, creator-fee allocation, network identity, season timing, origin binding and draft persistence. Lint and production compilation are required. Browser QA includes the actual roster, mobile layouts and saving/reloading five practice picks. No funded payout has been performed by the coding agent.

## Green palette refresh — November 5, 2026

Presentation-only update on latest main: Pump-green primary actions, forest-green draft panels and mint surfaces. Blue remains on a secondary preview card and small data details. Existing layout, eligibility, fee allocation, wallet flow and activation controls are preserved. Desktop 1440px and phone 390px checked without horizontal overflow. No financial execution was performed.

## Logo, rules and allocation presentation — November 5, 2026

Owner explicitly limited this pass to frontend; collaborator owns backend. Supplied glossy crowned shield replaces the header/footer mark and transparent favicons. Rules now shares the green league visual system. Season 1 appears as a compact hero badge; later season lengths/formats may vary and must be published before entries open.

The announced fee allocation is 30% daily payouts, 50% each season's leaderboard, 20% championship bonus. This pass does NOT change the existing 65/35 receipt accounting, payout code, database, scheduler, or activation flags. Public copy identifies the new allocation as awaiting payout activation/event rules; historical transaction history remains untouched. Collaborator must implement the new split with versioned receipts (preserving history), dedicated season/championship pools, defined leaderboard distribution and championship rules, and verified settlement. Do not derive new pool balances by splitting old reserves in the frontend. Subsequent season timing must follow backend schedules; update the small Season 1 badge with the published season identity when the next season is configured.
