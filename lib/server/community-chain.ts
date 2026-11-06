import "server-only";
import { randomUUID, createPublicKey, verify } from "node:crypto";
import { address, getBase58Encoder, getTransactionDecoder } from "@solana/kit";
import { getBackendConfig } from "./config";
import { boundedJson } from "./community-data";
import { record } from "../community-data";
import { TOKEN_PROGRAMS, PLAYER_BURN_TOKENS, tokenAmount, type BurnIntent } from "../community-burn/types";
import { buildBurnTransaction, signedBurn } from "../community-burn/transaction";
import { verifyMainnetRpc } from "./solana";

export async function communityRpc(method: string, params: unknown[] = []) {
  const endpoint = getBackendConfig().rpcUrl;
  if (!endpoint) throw new Error("Player registration is unavailable. Try again later.");
  const response = await fetch(endpoint, { method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000), headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const body = record(await boundedJson(response));
  if (body.error || body.id !== 1 || !Object.hasOwn(body, "result")) throw new Error("Chain verification is unavailable. Keep your receipt and retry.");
  return body.result;
}

function parsed(value: unknown, program: string, type: string) {
  const account = record(value);
  const data = record(record(account.data).parsed);
  if (account.owner !== program || account.executable !== false || data.type !== type) throw new Error("Token account does not match this burn. Refresh your profile.");
  return record(data.info);
}

async function burnSource(wallet: string, mint: string, program: string, decimals: number, amount: bigint) {
  const result = record(await communityRpc("getTokenAccountsByOwner", [wallet, { mint }, { encoding: "jsonParsed", commitment: "finalized" }]));
  if (!Array.isArray(result.value) || result.value.length > 100) throw new Error("Cannot safely select a token account. Consolidate your PFL and retry.");
  for (const row of result.value) {
    const account = record(row);
    const info = parsed(account.account, program, "account");
    const balance = record(info.tokenAmount);
    if (info.owner === wallet && info.mint === mint && info.state === "initialized" && info.isNative === false && balance.decimals === decimals && BigInt(tokenAmount(balance.amount)) >= amount) return address(String(account.pubkey));
  }
  throw new Error("Hold 500,000 PFL in one token account to create your player, plus SOL for the network fee.");
}

export async function preparePlayerBurn(wallet: string) {
  address(wallet);
  await verifyMainnetRpc();
  const mint = address(getBackendConfig().mint ?? "");
  const raw = record(record(await communityRpc("getAccountInfo", [mint, { encoding: "jsonParsed", commitment: "finalized" }])).value);
  const program = String(raw.owner);
  if (!(TOKEN_PROGRAMS as readonly string[]).includes(program)) throw new Error("PFL mint program is unsupported. Registration remains closed.");
  const info = parsed(raw, program, "mint");
  const decimals = Number(info.decimals);
  const maxDecimals = 12;
  if (info.isInitialized !== true || !Number.isInteger(decimals) || decimals < 0 || decimals > maxDecimals) throw new Error("PFL mint configuration is invalid. Registration remains closed.");
  const amount = PLAYER_BURN_TOKENS * 10n ** BigInt(decimals);
  const source = await burnSource(wallet, mint, program, decimals, amount);
  const id = randomUUID();
  const intent: BurnIntent = { id, wallet, source, mint, tokenProgram: program, decimals, amount: amount.toString(), memo: `pfl:create-player:${id}`, created: Math.floor(Date.now() / 1000) };
  const hash = record(record(await communityRpc("getLatestBlockhash", [{ commitment: "finalized" }])).value);
  const height = Number(hash.lastValidBlockHeight);
  if (!Number.isSafeInteger(height) || height <= 0) throw new Error("Chain lifetime is unavailable. Retry before signing.");
  return { intent, prepared: buildBurnTransaction(intent, String(hash.blockhash), height) };
}

export function verifiedSignedBurn(prepared: Parameters<typeof signedBurn>[0], wire: unknown, wallet: string) {
  const signed = signedBurn(prepared, wire, wallet);
  const tx = getTransactionDecoder().decode(Buffer.from(signed.wire, "base64"));
  const bytes = getBase58Encoder().encode(wallet);
  const key = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(bytes)]), format: "der", type: "spki" });
  if (!verify(null, Buffer.from(tx.messageBytes), key, Buffer.from(getBase58Encoder().encode(signed.signature)))) throw new Error("Burn signature does not match your wallet. Sign the original request again.");
  return signed;
}

export async function finalizedBurn(signature: string) {
  return communityRpc("getTransaction", [signature, { encoding: "jsonParsed", commitment: "finalized", maxSupportedTransactionVersion: 1 }]);
}
