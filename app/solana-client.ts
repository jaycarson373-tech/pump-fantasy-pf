import { createClient } from "@solana/kit";
import { solanaRpc } from "@solana/kit-plugin-rpc";
import { walletSigner } from "@solana/kit-plugin-wallet";

export const solanaClient = createClient()
  .use(walletSigner({ chain: "solana:mainnet" }))
  .use(
    solanaRpc({
      rpcUrl: "https://api.mainnet-beta.solana.com",
      rpcSubscriptionsUrl: "wss://api.mainnet-beta.solana.com",
    }),
  );

export type AppSolanaClient = Awaited<typeof solanaClient>;
