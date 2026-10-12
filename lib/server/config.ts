import "server-only";

export function getBackendConfig() {
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const sessionSecret = process.env.PF_SESSION_SECRET;
  const rpcUrl = process.env.SOLANA_RPC_URL;
  const mint = process.env.PF_MINT_ADDRESS;
  const minimumTokens = process.env.PF_MINIMUM_TOKENS;

  const parsedMinimum = minimumTokens && /^\d+$/.test(minimumTokens) && BigInt(minimumTokens) > 0n ? BigInt(minimumTokens) : null;
  return {
    supabaseUrl,
    serviceKey,
    sessionSecret,
    rpcUrl,
    mint,
    minimumTokens: parsedMinimum,
    ready: Boolean(supabaseUrl && serviceKey && sessionSecret && sessionSecret.length >= 32 && rpcUrl && mint && parsedMinimum),
  };
}

export class BackendNotConfigured extends Error {
  constructor() {
    super("Pump Fantasy entry services are not configured yet.");
    this.name = "BackendNotConfigured";
  }
}

export async function supabaseRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const config = getBackendConfig();
  if (!config.supabaseUrl || !config.serviceKey) throw new BackendNotConfigured();
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      apikey: config.serviceKey,
      Authorization: `Bearer ${config.serviceKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Database request failed (${response.status}): ${detail.slice(0, 300)}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
