import "server-only";
import { queryRows, withTransaction } from "./database";
import { fetchCommunityProfile } from "./community-data";
import { communityRpc, finalizedBurn, preparePlayerBurn, verifiedSignedBurn } from "./community-chain";
import { verifyBurnProof } from "../community-burn/proof";
import { record, type CommunityProfile } from "../community-data";
import type { BurnIntent, PreparedBurn } from "../community-burn/types";
import { verifyMainnetRpc } from "./solana";

type BurnRow = { id: string; wallet: string; intent: BurnIntent; prepared: PreparedBurn; profile: CommunityProfile; signature: string | null; signed_wire: string | null; completed_at: string | null };

export async function playerStatus(wallet: string) {
  const players = await queryRows("select wallet,display_name,avatar_url,profile_url,registered_at from pf_community_players where wallet=$1", [wallet]);
  const burns = await queryRows<BurnRow>("select * from pf_player_burns where wallet=$1", [wallet]);
  const pending = burns[0];
  return { wallet, player: players[0] ?? null, pending: pending && !pending.completed_at ? { id: pending.id, signature: pending.signature } : null };
}

export async function throttlePlayerRequest(wallet: string) {
  const claimed = await queryRows("insert into pf_community_requests(wallet,next_request) values($1,clock_timestamp()+interval '3 seconds') on conflict(wallet) do update set next_request=excluded.next_request where pf_community_requests.next_request<=clock_timestamp() returning wallet", [wallet]);
  if (!claimed.length) throw new Error("Please wait a few seconds before retrying this player request.");
}

export async function prepareCommunityPlayer(wallet: string) {
  const state = await playerStatus(wallet);
  if (state.player) throw new Error("Your player is already registered. No additional burn is needed.");
  const [saved] = await queryRows<BurnRow>("select * from pf_player_burns where wallet=$1", [wallet]);
  if (saved?.signature) throw new Error("Your burn already has a receipt. Verify it before preparing another transaction.");
  // External reads never hold a pool client while acquiring another for budgets/cache.
  const profile = await fetchCommunityProfile(wallet);
  await verifyMainnetRpc();
  const valid = saved ? record(await communityRpc("isBlockhashValid", [saved.prepared.blockhash, { commitment: "finalized" }])).value : false;
  if (saved && typeof valid !== "boolean") throw new Error("Unable to check the previous transaction. Retry verification later.");
  const candidate = saved && valid ? { intent: saved.intent, prepared: saved.prepared } : await preparePlayerBurn(wallet);
  return withTransaction(async query => {
    await query("select pg_advisory_xact_lock(hashtext($1))", [`community-player:${wallet}`]);
    if ((await query("select wallet from pf_community_players where wallet=$1", [wallet])).length) throw new Error("Your player is already registered. No additional burn is needed.");
    const [current] = await query<BurnRow>("select * from pf_player_burns where wallet=$1 for update", [wallet]);
    if (current?.signature) throw new Error("Your burn already has a receipt. Verify it before preparing another transaction.");
    if (current?.id !== saved?.id) throw new Error("Your player request changed. Refresh before signing.");
    if (current && valid) return { id: current.id, profile, prepared: current.prepared, wallet, amount: "500000" };
    if (current) await query("delete from pf_player_burns where id=$1 and signature is null", [current.id]);
    const { intent, prepared } = candidate;
    await query("insert into pf_player_burns(id,wallet,intent,prepared,profile) values($1,$2,$3::jsonb,$4::jsonb,$5::jsonb)", [intent.id, wallet, JSON.stringify(intent), JSON.stringify(prepared), JSON.stringify(profile)]);
    return { id: intent.id, profile, prepared, wallet, amount: "500000" };
  });
}

async function ownBurn(wallet: string, id: string) {
  const [burn] = await queryRows<BurnRow>("select * from pf_player_burns where wallet=$1 and id=$2", [wallet, id]);
  if (!burn) throw new Error("Player burn was not found for this wallet. Reopen your own player profile.");
  return burn;
}

export async function submitCommunityBurn(wallet: string, id: string, wire: unknown) {
  const burn = await ownBurn(wallet, id);
  if (burn.completed_at) return playerStatus(wallet);
  await verifyMainnetRpc();
  const signed = verifiedSignedBurn(burn.prepared, wire, wallet);
  if (burn.signature && burn.signature !== signed.signature) throw new Error("A different receipt is already pending. Verify the original burn.");
  if (!burn.signature) {
    // Recheck provider availability and ownership immediately before the effect.
    const profile = await fetchCommunityProfile(wallet);
    const valid = record(await communityRpc("isBlockhashValid", [burn.prepared.blockhash, { commitment: "confirmed" }]));
    if (valid.value !== true) throw new Error("The burn quote expired. Preview your player and prepare a fresh quote.");
    const rows = await queryRows("update pf_player_burns set signature=$3,signed_wire=$4,profile=$5::jsonb where id=$1 and wallet=$2 and signature is null and completed_at is null returning id", [id, wallet, signed.signature, signed.wire, JSON.stringify(profile)]);
    if (!rows.length) throw new Error("This burn changed while signing. Verify the pending receipt before retrying.");
  }
  // Journal first. A timeout is recoverable by confirm, never by a new burn.
  await communityRpc("sendTransaction", [signed.wire, { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 0 }]);
  return { wallet, player: null, pending: { id, signature: signed.signature } };
}

async function finalizePlayer(burn: BurnRow, transaction: unknown) {
  if (!burn.signature) throw new Error("No receipt to verify. Sign the prepared burn first.");
  verifyBurnProof(transaction, burn.signature, burn.intent);
  await withTransaction(async query => {
    const [locked] = await query<BurnRow>("select * from pf_player_burns where id=$1 and wallet=$2 for update", [burn.id, burn.wallet]);
    if (!locked || locked.signature !== burn.signature) throw new Error("Burn receipt changed. Refresh your registration.");
    if (locked.completed_at) return;
    const p = locked.profile;
    await query("insert into pf_community_players(wallet,display_name,avatar_url,profile_url,pnl_usd) values($1,$2,$3,$4,$5) on conflict(wallet) do nothing", [burn.wallet,p.display_name,p.avatar_url,p.profile_url,p.pnl_usd]);
    await query("update pf_player_burns set completed_at=clock_timestamp() where id=$1", [burn.id]);
  });
  return playerStatus(burn.wallet);
}

export async function confirmCommunityBurn(wallet: string, id: string) {
  const burn = await ownBurn(wallet, id);
  if (burn.completed_at) return playerStatus(wallet);
  if (!burn.signature) throw new Error("No signed burn is pending. Preview your player to continue.");
  await verifyMainnetRpc();
  const transaction = await finalizedBurn(burn.signature);
  if (transaction && record(record(transaction).meta).err === null) return finalizePlayer(burn, transaction);
  // An expired lifetime or missing RPC history is NOT proof that no burn occurred.
  // Keep unknown receipts indefinitely; only a positively finalized failure can reset.
  if (!transaction) return { wallet, player: null, pending: { id, signature: burn.signature } };
  const receipt = record(transaction);
  const signatures = record(receipt.transaction).signatures;
  const failure = record(receipt.meta).err;
  const failed = (typeof failure === "string" && failure.length > 0) || (failure !== null && typeof failure === "object" && !Array.isArray(failure) && Object.keys(failure).length > 0);
  if (!Array.isArray(signatures) || signatures.length !== 1 || signatures[0] !== burn.signature || !Number.isSafeInteger(receipt.slot) || !failed)
    throw new Error("Chain verification is incomplete. Keep your receipt and retry.");
  await queryRows("delete from pf_player_burns where id=$1 and wallet=$2 and signature=$3 and completed_at is null", [id,wallet,burn.signature]);
  return { wallet, player: null, pending: null, message: "The finalized transaction failed without a burn. You can prepare a new one." };
}
