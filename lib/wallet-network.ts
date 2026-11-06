export function walletNetwork(network = "mainnet") {
  if (network === "mainnet") return { chain: "solana:mainnet" as const, rpcUrl: "https://api.mainnet-beta.solana.com" };
  if (network === "devnet") return { chain: "solana:devnet" as const, rpcUrl: "https://api.devnet.solana.com" };
  throw new Error("Set NEXT_PUBLIC_WALLET_NETWORK to mainnet or devnet.");
}
