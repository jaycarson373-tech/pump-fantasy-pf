import "server-only";
import { getBackendConfig } from "./config";

const TOKEN_PROGRAMS = [
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
];

type RpcResponse<T> = { result?: T; error?: { message?: string } };

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const { rpcUrl } = getBackendConfig();
  if (!rpcUrl) throw new Error("Solana RPC is not configured.");
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`Solana RPC returned HTTP ${response.status}.`);
  const body = (await response.json()) as RpcResponse<T>;
  if (body.error || body.result === undefined) throw new Error(body.error?.message || "Solana RPC returned no result.");
  return body.result;
}

export async function getHolderBalance(wallet: string) {
  const config = getBackendConfig();
  if (!config.mint || !config.minimumTokens) throw new Error("Holder eligibility is not configured.");
  let total = 0n;
  const supply = await rpc<{ value: { decimals: number } }>("getTokenSupply", [config.mint, { commitment: "confirmed" }]);
  for (const programId of TOKEN_PROGRAMS) {
    const result = await rpc<{ value: Array<{ account: { data: { parsed?: { info?: { mint?: string; tokenAmount?: { amount?: string } } } } } }> }>(
      "getTokenAccountsByOwner",
      [wallet, { programId }, { encoding: "jsonParsed", commitment: "confirmed" }],
    );
    for (const item of result.value) {
      const info = item.account.data.parsed?.info;
      if (info?.mint === config.mint && info.tokenAmount?.amount && /^\d+$/.test(info.tokenAmount.amount)) {
        total += BigInt(info.tokenAmount.amount);
      }
    }
  }
  const threshold = config.minimumTokens * (10n ** BigInt(supply.value.decimals));
  const scale = 10n ** BigInt(supply.value.decimals);
  const whole = total / scale;
  const fraction = (total % scale).toString().padStart(supply.value.decimals, "0").slice(0, 4).replace(/0+$/, "");
  const displayBalance = `${whole.toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
  return { rawBalance: total.toString(), decimals: supply.value.decimals, displayBalance, minimumTokens: config.minimumTokens.toString(), eligible: total >= threshold };
}
