export const SOLANA_MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

/** Cache only a successful network read, independently for each configured RPC. */
export function createMainnetVerifier(readGenesis: () => Promise<string>, now = Date.now) {
  let verified: { endpoint: string; at: number } | null = null;
  return async (endpoint: string | undefined) => {
    if (!endpoint) throw new Error("Solana RPC is not configured.");
    const url = new URL(endpoint);
    if (url.protocol !== "https:") throw new Error("Production Solana RPC must use HTTPS.");
    if (verified?.endpoint === endpoint && now() - verified.at < 30_000) return;
    if (await readGenesis() !== SOLANA_MAINNET_GENESIS)
      throw new Error("Solana RPC is not mainnet. Entries and payouts remain closed.");
    verified = { endpoint, at: now() };
  };
}
