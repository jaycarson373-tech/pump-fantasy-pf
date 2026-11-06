import 'server-only';
import { address, appendTransactionMessageInstructions, blockhash, compileTransaction, createTransactionMessage,
  getBase64EncodedWireTransaction, getSignatureFromTransaction,
  getTransactionDecoder, setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash } from '@solana/kit';
import { assetDetails } from '../../reward-asset';
import { queryRows, withAdvisoryLock, withTransaction } from '../database';
import { validWallet } from '../http';
import { rpc, getNativeSolBalance } from '../solana';
import { getRewardBalance, verifyRewardAsset, verifyRewardTransfer } from '../reward-chain';
import { tokenPaymentInstructions } from '../token-payment';
import { signPayout } from '../payout-signer';
import { assertPayoutProof } from '../payout-signing';
import { assertFinalizedWire } from '../creator-protocol.mjs';
import type { Season } from './service';

const PUMP = assetDetails('PUMP').mint;
const FEE_LIMIT = 25_000n;
const ATA_RENT_LIMIT = 2_500_000n;
// Token-2022 account + type byte + ImmutableOwner TLV + TransferHookAccount TLV.
const TOKEN_ACCOUNT_SIZE = 175;
const U64_MAX = (1n << 64n) - 1n;
const MEMO_PROGRAM = address('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const LOCK = 'pfl-starting-seven-worker';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Entitlement = { id:string; season_id:string; wallet:string; amount_raw:string; reward_mint:string; status:string; pool:string };
type Claim = { entitlement_id:string; signature:string; transaction_base64:string; blockhash:string;
  last_valid_block_height:string; source_wallet:string; amount_raw:string; mint:string; prepared_at:string; status:string;
  wallet:string; season_id:string; reward_mint:string; entitlement_amount:string };
function cap(name:string) {
  const value=process.env[name];
  return value && /^[1-9]\d*$/.test(value) && BigInt(value)<=U64_MAX ? BigInt(value) : null;
}
function runOpen() {
  const deadline=Date.parse(process.env.PF_AUTO_PAYOUT_RUN_UNTIL ?? '');
  return Number.isFinite(deadline) && deadline>Date.now();
}
function fundingBlockers() {
  const blockers:string[]=[];
  if(!cap('PF_AUTO_PAYOUT_MAX_AWARD_RAW')||!cap('PF_AUTO_PAYOUT_MAX_SEASON_RAW'))blockers.push('Configure explicit positive PUMP payout caps.');
  const source=process.env.PF_PRIZE_WALLET_ADDRESS;
  if(!validWallet(source)||source!==process.env.PF_CREATOR_WALLET_ADDRESS)blockers.push('Use the matching creator and prize wallet.');
  if(!Object.hasOwn(process.env,'PF_PAYOUT_SIGNER_KEYPAIR_JSON'))blockers.push('Configure the approved payout signer.');
  return blockers;
}
/** No signer or RPC access: public readiness must never read secret material. */
export function claimReadiness(season: Pick<Season,'mint'|'reward_mint'>) {
  const blockers:string[]=[];
  const switches=[['PF_AUTO_PAYOUT_ENABLED','true','Enable reviewed automatic payouts.'],
    ['PF_LEAGUE_WORKER_ENABLED','true','Enable the league worker.'],
    ['PF_PAYOUT_NETWORK','mainnet-beta','Configure mainnet-beta payouts.']];
  for(const [name,expected,message] of switches){if(process.env[name]!==expected)blockers.push(message);}
  if(process.env.PF_REWARD_ASSET!=='PUMP'||season.reward_mint!==PUMP)blockers.push('This season requires actual PUMP rewards.');
  if(!validWallet(season.mint))blockers.push('Configure the season token mint.');
  blockers.push(...fundingBlockers());
  if(!runOpen())blockers.push('Configure an unexpired approved payout run deadline.');
  return {enabled:blockers.length===0,blockers};
}
const CLAIM_SELECT=`select c.*,e.wallet,e.season_id,e.reward_mint,e.amount_raw::text entitlement_amount
 from pfl_claims c join pfl_entitlements e on e.id=c.entitlement_id`;
async function existingClaim(id:string) {
  return (await queryRows<Claim>(`${CLAIM_SELECT} where c.entitlement_id=$1`,[id]))[0];
}
function validBinding(c:Claim) {
  const complete=[c.signature,c.transaction_base64,c.blockhash,c.prepared_at,c.last_valid_block_height].every(Boolean);
  return complete && c.mint===PUMP && c.reward_mint===PUMP && c.amount_raw===c.entitlement_amount &&
    /^[1-9]\d*$/.test(c.amount_raw) && [c.source_wallet,c.wallet].every(validWallet) && c.source_wallet!==c.wallet;
}
async function finalize(c:Claim) {
  const receipt=await rpc<{slot:number}|null>('getTransaction',[c.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:0}]);
  if(!receipt)return 'claim-awaiting-receipt';
  assertFinalizedWire(c.transaction_base64,receipt);
  const verified=await verifyRewardTransfer(c.signature,c.source_wallet,c.wallet,c.amount_raw,'PUMP');
  if(!verified||verified.slot!==receipt.slot)throw Error('Claim receipt does not match the persisted PUMP payment. Reconcile the original signature.');
  await withTransaction(async q=>{
    const changed=await q<{entitlement_id:string}>("update pfl_claims set status='confirmed',confirmed_slot=$2 where entitlement_id=$1 and status in ('prepared','unknown') returning entitlement_id",[c.entitlement_id,verified.slot]);
    if(!changed.length)return;
    const entitlement=await q<{id:string}>("update pfl_entitlements set status='claimed' where id=$1 and status in ('available','forfeited') returning id",[c.entitlement_id]);
    if(entitlement.length!==1)throw Error('Confirmed claim entitlement state changed. Reconcile the ledger.');
  });
  return 'claim-confirmed';
}
/** Always reconcile persisted identities, even when switches or current season changed. */
async function reconcile(c:Claim) {
  if(!validBinding(c))return 'claim-binding-review-required';
  await verifyRewardAsset('PUMP');
  const {value}=await rpc<{value:Array<{err:unknown;confirmationStatus:string|null}|null>}>('getSignatureStatuses',[[c.signature],{searchTransactionHistory:true}]);
  const status=value[0];
  if(status?.confirmationStatus==='finalized'){
    if(status.err!==null){await queryRows("update pfl_claims set status='failed' where entitlement_id=$1 and status in ('prepared','unknown')",[c.entitlement_id]);return 'claim-failed';}
    return finalize(c);
  }
  if(status)return 'claim-pending-finality';
  const height=await rpc<number>('getBlockHeight',[{commitment:'confirmed'}]);
  if(BigInt(height)>BigInt(c.last_valid_block_height)){
    await queryRows("update pfl_claims set status='unknown' where entitlement_id=$1 and status='prepared'",[c.entitlement_id]);
    return 'claim-unknown';
  }
  if(process.env.PF_AUTO_PAYOUT_ENABLED!=='true'||!runOpen())return 'claim-awaiting-approved-run';
  // Only the immutable original wire may be rebroadcast; never sign during recovery.
  const signature=await rpc<string>('sendTransaction',[c.transaction_base64,{encoding:'base64',skipPreflight:false,preflightCommitment:'confirmed',maxRetries:0}]);
  if(signature!==c.signature)throw Error('RPC claim signature mismatch. Reconcile the persisted transaction.');
  return 'claim-submitted';
}
async function checkCaps(e:Entitlement) {
  const amount=BigInt(e.amount_raw),awardCap=cap('PF_AUTO_PAYOUT_MAX_AWARD_RAW'),seasonCap=cap('PF_AUTO_PAYOUT_MAX_SEASON_RAW');
  if(!awardCap||!seasonCap||amount<=0n||amount>awardCap)throw Error('Claim exceeds its configured award cap. Review payout limits.');
  const [reserved]=await queryRows<{raw:string}>(`select coalesce(sum(c.amount_raw),0)::text raw from pfl_claims c join pfl_entitlements e on e.id=c.entitlement_id where e.season_id=$1`,[e.season_id]);
  if(BigInt(reserved.raw)+amount>seasonCap)throw Error('Claim exceeds its configured season cap. Review existing claim reservations.');
  const [funding]=await queryRows<{allocated:string;entitled:string}>(`select
   coalesce((select sum(case $2 when 'daily' then a.daily_raw when 'season' then a.season_raw else a.champion_raw end)
    from pfl_fee_allocations a join pf_creator_fee_receipts r on r.signature=a.receipt_signature
    join pf_creator_claims c on c.signature=r.signature join pfl_seasons s on s.id=a.season_id
    where a.season_id=$1 and a.reward_asset='PUMP' and r.reward_asset='PUMP' and c.status='finalized'
     and c.creator_wallet=$3 and r.mint_address=s.mint),0)::text allocated,
   coalesce((select sum(amount_raw) from pfl_entitlements where season_id=$1 and pool=$2),0)::text entitled`,[e.season_id,e.pool,process.env.PF_PRIZE_WALLET_ADDRESS]);
  if(BigInt(funding.entitled)>BigInt(funding.allocated)||amount>BigInt(funding.allocated))throw Error('Claim is not covered by finalized PUMP fee allocations. Reconcile the season ledger.');
}
async function treasuryLiabilities(source:string,asset:'PUMP'|'SOL') {
  const [r]=await queryRows<{gross:string;paid:string;converted:string;claims:string}>(`select
   coalesce(sum(r.gross_raw),0)::text gross,
   coalesce(sum(case when d.status='paid' then r.daily_raw else 0 end + case when s.status='paid' then r.season_raw else 0 end),0)::text paid,
   coalesce((select sum(v.sol_raw) from pfl_conversions v join pf_creator_fee_receipts f on f.signature=v.receipt_signature join pf_creator_claims k on k.signature=f.signature where k.creator_wallet=$1 and f.reward_asset=$2 and v.status='verified'),0)::text converted,
   coalesce((select sum(amount_raw) from pfl_claims where source_wallet=$1 and mint=$3 and status='confirmed'),0)::text claims
   from pf_creator_fee_receipts r join pf_creator_claims c on c.signature=r.signature
   left join pf_daily_awards d on d.id=r.award_id left join pf_daily_awards s on s.id=r.season_award_id
   where c.creator_wallet=$1 and r.reward_asset=$2 and c.status='finalized'`,[source,asset,assetDetails(asset).mint]);
  const outstanding=BigInt(r.gross)-BigInt(r.paid)-BigInt(r.converted)-BigInt(r.claims);
  if(outstanding<0n)throw Error('Treasury liability ledger is inconsistent. Reconcile finalized payments.');
  return outstanding;
}
async function checkTreasury(source:string,amount:bigint) {
  const [tokens,native,pumpLiability,solLiability]=await Promise.all([
    getRewardBalance(source,'PUMP'),getNativeSolBalance(source),treasuryLiabilities(source,'PUMP'),treasuryLiabilities(source,'SOL'),
  ]);
  const [fixed]=await queryRows<{raw:string}>(`select coalesce(sum(a.prize_raw),0)::text raw from pf_daily_awards a join pf_seasons s on s.id=a.season_id where a.reward_asset='SOL' and s.prize_mode<>'creator-fees' and a.status<>'paid'`);
  if(tokens<pumpLiability||pumpLiability<amount)throw Error('PUMP treasury cannot cover all receipt liabilities. Fund and reconcile the treasury.');
  if(native<solLiability+BigInt(fixed.raw)+FEE_LIMIT+ATA_RENT_LIMIT)throw Error('SOL treasury cannot preserve obligations and payout gas. Fund the treasury.');
}
async function unsignedPayment(source:string,e:Entitlement) {
  const lifetime=(await rpc<{value:{blockhash:string;lastValidBlockHeight:number}}>('getLatestBlockhash',[{commitment:'confirmed'}])).value;
  const instructions=await tokenPaymentInstructions(source,e.wallet,e.amount_raw,'PUMP');
  // Distinguish equal payments to the same winner within one blockhash lifetime.
  instructions.push({programAddress:MEMO_PROGRAM,data:Buffer.from(`pfl-claim:${e.id}`)});
  let message=setTransactionMessageFeePayer(address(source),createTransactionMessage({version:0}));
  message=setTransactionMessageLifetimeUsingBlockhash({blockhash:blockhash(lifetime.blockhash),lastValidBlockHeight:BigInt(lifetime.lastValidBlockHeight)},message);
  const tx=compileTransaction(appendTransactionMessageInstructions(instructions,message));
  const encoded=Buffer.from(tx.messageBytes).toString('base64');
  const [{value:fee},rent]=await Promise.all([
    rpc<{value:number|null}>('getFeeForMessage',[encoded,{commitment:'confirmed'}]),
    rpc<number>('getMinimumBalanceForRentExemption',[TOKEN_ACCOUNT_SIZE,{commitment:'confirmed'}]),
  ]);
  if(fee===null||!Number.isSafeInteger(fee)||fee<0||BigInt(fee)>FEE_LIMIT||!Number.isSafeInteger(rent)||rent<0||BigInt(rent)>ATA_RENT_LIMIT)
    throw Error('Claim fee or ATA rent exceeds its approved limit. Review network costs.');
  const unsigned=getBase64EncodedWireTransaction(tx);
  const simulation=await rpc<{value:{err:unknown}}>('simulateTransaction',[unsigned,{encoding:'base64',sigVerify:false,commitment:'confirmed'}]);
  if(simulation.value.err)throw Error('PUMP claim simulation failed. Reconcile funding before retrying.');
  return {unsigned,lifetime};
}
async function prepare(e:Entitlement,season:Season) {
  if(!claimReadiness(season).enabled)return {action:'claims-disabled'};
  if(e.status!=='available'||e.reward_mint!==PUMP||season.reward_mint!==PUMP)throw Error('Entitlement is unavailable for PUMP claiming. Check settlement status.');
  const source=process.env.PF_PRIZE_WALLET_ADDRESS!;
  if(e.wallet===source||!validWallet(e.wallet))throw Error('Claim recipient is invalid. Use the entitlement owner wallet.');
  await verifyRewardAsset('PUMP');
  await checkCaps(e);
  await checkTreasury(source,BigInt(e.amount_raw));
  const {unsigned,lifetime}=await unsignedPayment(source,e);
  // Recheck effect authority immediately before the only signing boundary.
  if(!claimReadiness(season).enabled)return {action:'claims-disabled'};
  const wire=await signPayout(unsigned,source);
  assertPayoutProof(unsigned,wire,source);
  const signature=getSignatureFromTransaction(getTransactionDecoder().decode(Buffer.from(wire,'base64')));
  await queryRows(`insert into pfl_claims(entitlement_id,signature,status,transaction_base64,blockhash,last_valid_block_height,source_wallet,amount_raw,mint,prepared_at)
    values($1,$2,'prepared',$3,$4,$5,$6,$7,$8,now())`,[e.id,signature,wire,lifetime.blockhash,String(lifetime.lastValidBlockHeight),source,e.amount_raw,PUMP]);
  const saved=await existingClaim(e.id);
  if(!saved)throw Error('Signed claim was not persisted. Stop and reconcile before sending.');
  return {action:await reconcile(saved)};
}
/** Caller already holds the shared worker lock; only one persisted claim is reconciled. */
export async function processLeagueClaims(season:Season):Promise<{action:string}> {
  // Season selects new work elsewhere; recovery deliberately spans previous seasons.
  void season;
  const [pending]=await queryRows<Claim>(`${CLAIM_SELECT} where c.status in ('prepared','unknown') and c.mint=$1 and e.reward_mint=$1
    and c.signature is not null and c.transaction_base64 is not null and c.blockhash is not null
    and c.last_valid_block_height>0 and c.prepared_at is not null and c.source_wallet is not null
    and c.amount_raw=e.amount_raw order by c.last_checked_at nulls first,c.created_at,c.entitlement_id limit 1`,[PUMP]);
  if (!pending) return {action:'no-pending-claims'};
  await queryRows('update pfl_claims set last_checked_at=clock_timestamp() where entitlement_id=$1',[pending.entitlement_id]);
  return {action:await reconcile(pending)};
}
export async function claimEntitlement(id:string,wallet:string):Promise<{action:string}> {
  if(!UUID.test(id)||!validWallet(wallet))throw Error('Invalid claim request. Select a valid entitlement.');
  const result=await withAdvisoryLock(LOCK,async()=>{
    const [e]=await queryRows<Entitlement>('select * from pfl_entitlements where id=$1',[id]);
    if(!e||e.wallet!==wallet)throw Error('Entitlement is unavailable for this wallet. Sign in with its owner.');
    const previous=await existingClaim(id);
    if(previous)return {action:['confirmed','failed'].includes(previous.status)?`claim-${previous.status}`:await reconcile(previous)};
    const [season]=await queryRows<Season>('select * from pfl_seasons where id=$1',[e.season_id]);
    if(!season)throw Error('Claim season is unavailable. Reconcile the entitlement ledger.');
    return prepare(e,season);
  });
  return result.acquired?result.value:{action:'claim-worker-busy'};
}
