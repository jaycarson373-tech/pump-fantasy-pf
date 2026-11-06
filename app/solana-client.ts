import "./disposable-stack-polyfill";
import { createClient } from "@solana/kit";
import { solanaRpc } from "@solana/kit-plugin-rpc";
import { walletSigner } from "@solana/kit-plugin-wallet";
import { walletNetwork } from "../lib/wallet-network";

const network = walletNetwork(process.env.NEXT_PUBLIC_WALLET_NETWORK);
const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || network.rpcUrl;

export const solanaClient = createClient()
  .use(walletSigner({ chain: network.chain }))
  .use(
    solanaRpc({
      rpcUrl,
      rpcSubscriptionsUrl: rpcUrl.replace(/^http/, "ws"),
    }),
  );

export type AppSolanaClient = Awaited<typeof solanaClient>;
