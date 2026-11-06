# Pump Fantasy League — Starting Seven

Existing Next.js / Solana application upgraded to a weekly fantasy league. This branch contains the implementation and frontend; external data, production activation and funded payouts are not certified by a successful build.

## Current format

100 verified traders, four rank tiers (10/20/30/40), seven picks (1/2/2/2), one captain with a 1.5× multiplier including losses. Drafting opens Saturday 00:00 UTC and locks Monday 00:00 UTC. Seven daily intervals make a weekly round. The inaugural calendar defaults to four weeks; later calendars are configurable.

**Hold at least 500,000 PFL** to enter and remain eligible. Exactly 500,000 qualifies. The user's November 6 correction supersedes the previous 250,000 threshold. Historical 30-day PnL ranks the draft field only; actual competition-interval PnL determines points.

Creator-fee allocation: 30% daily / 50% season / 20% champion. Accounting uses integer units and confirmed receipts. PFL conversion and payout execution remain gated pending reviewed integrations and authorization.

## Frontend

Home `/`, Draft `/draft`, My Team `/my-team`, Leaderboard `/leaderboard`, Rewards `/rewards`, Rules `/rules`, Champion `/champion`. `/budget-draft` points to the new draft UI. The hero and draft share saved picks and captain. The football-style shield is also the transparent SVG favicon. Dexscreener uses the configured PFL mint; without one it opens Solana discovery, not an invented token.

## Development

Use Node 24. `npm install`, `npm run dev`, `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`.

`npm start` applies migrations before serving. Do not point a local test at production accidentally. The additive migration is `db/migrations/202611060004_starting_seven.sql`. Prior competition tables and records remain intact. Legacy execution requires the explicit `PF_LEGACY_COMPETITION=true` switch and is not the new default.

See [integration and release handoff](docs/STARTING_SEVEN.md) for required providers, environments, verification and incomplete services.
