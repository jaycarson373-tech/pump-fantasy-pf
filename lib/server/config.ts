import "server-only";

export function getBackendConfig() {
  const databaseUrl = process.env.DATABASE_URL;
  const sessionSecret = process.env.PF_SESSION_SECRET;
  const rpcUrl = process.env.SOLANA_RPC_URL;
  const mint = process.env.FANTASY_MINT_ADDRESS || process.env.PF_MINT_ADDRESS;
  const minimumTokens = process.env.FANTASY_MINIMUM_TOKENS || process.env.PF_MINIMUM_TOKENS || "500000";

  const parsedMinimum = minimumTokens && /^\d+$/.test(minimumTokens) && BigInt(minimumTokens) > 0n ? BigInt(minimumTokens) : null;
  const holderFloor = 500_000n;
  return {
    databaseUrl,
    sessionSecret,
    rpcUrl,
    mint,
    minimumTokens: parsedMinimum === null ? null : parsedMinimum > holderFloor ? parsedMinimum : holderFloor,
    ready: Boolean(databaseUrl && sessionSecret && sessionSecret.length >= 32 && rpcUrl && mint && parsedMinimum),
  };
}

export class BackendNotConfigured extends Error {
  constructor() {
    super("Pump Fantasy entry services are not configured yet.");
    this.name = "BackendNotConfigured";
  }
}
