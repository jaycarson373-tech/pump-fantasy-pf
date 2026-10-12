import "./disposable-stack-polyfill";
import { createClient } from "@solana/kit";
import { solanaRpc } from "@solana/kit-plugin-rpc";
import { walletSigner } from "@solana/kit-plugin-wallet";

export const solanaClient = createClient()
  .use(walletSigner({ chain: "solana:mainnet" }))
  .use(
    solanaRpc({
      rpcUrl: process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
      rpcSubscriptionsUrl: (process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com").replace(/^http/, "ws"),
    }),
  );

export type AppSolanaClient = Awaited<typeof solanaClient>;
