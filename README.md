# Pump Fantasy (PF)

Pump Fantasy is a polished fantasy-KOL tournament app for the pump.fun community. Players connect a Solana wallet, draft five KOLs, compare daily and weekly performance, and lock a roster into weekly or monthly competitions.

## Included

- Wallet Standard connection for Phantom, Solflare, Backpack, and compatible Solana wallets
- Searchable five-KOL roster builder
- Daily and weekly KOL scores
- Weekly and monthly tournament views
- Device-local roster persistence and tournament locking
- Optional 1,000,000 PF eligibility check
- Responsive white, black, and mint-green interface
- Vercel-ready Next.js build

No transaction is signed or submitted by the current application. Wallet connection is read-only.

## Local development

Requires Node.js 24, matching the Vercel runtime and Solana wallet dependencies.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment variables

Copy `.env.example` to `.env.local` when the PF token mint is available:

```bash
NEXT_PUBLIC_PF_MINT_ADDRESS=your_pf_mint_address
NEXT_PUBLIC_SOLANA_RPC_URL=https://your-mainnet-rpc.example
```

Without `NEXT_PUBLIC_PF_MINT_ADDRESS`, the product remains in clearly labelled preview eligibility mode so the complete drafting flow can be reviewed before the token launches.

## Deploy on Vercel

1. Import this GitHub repository in Vercel.
2. Keep the detected framework as **Next.js**.
3. Add the two environment variables above when the PF mint and production RPC are ready.
4. Deploy.

The current KOL directory and scores are product fixtures. Replace them with an indexing/API source before public launch. The app intentionally has no Railway service or proprietary backend dependency.
