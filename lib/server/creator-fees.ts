import "server-only";
import { address, appendTransactionMessageInstructions, blockhash, compileTransaction, createNoopSigner, createTransactionMessage, getBase64EncodedWireTransaction, getSignatureFromTransaction, getTransactionDecoder, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash, pipe } from "@solana/kit";
import { queryRows, withTransaction } from "./database";
import { getFeeTreasury } from "./fee-treasury";
import { getBackendConfig } from "./config";
import { payoutSigner, signPayout } from "./payout-signer";
import { collectedFeesFromBalances, collectedTokenFeesFromBalances, splitCreatorFees } from "./fee-accounting";
import { creatorAddresses, directCollectionInstructions, assertFinalizedWire, WSOL, quoteCollectionAddresses, quoteCollectionInstructions, assertDirectCreator, assertQuoteMint, assertQuotePool } from "./creator-protocol.mjs";
import { rewardAsset, assetDetails, type RewardAsset } from "../reward-asset";
import { verifyMainnetRpc } from "./solana";

type Claim = { reward_asset: RewardAsset; signature: string; mint_address: string; creator_wallet: string; transaction_base64: string; last_valid_block_height: string; status: string };
type ParsedAccount = { lamports: number; owner: string; data: { parsed?: { info?: { mint?: string; owner?: string; state?: string; tokenAmount?: {amount: string; decimals?: number} } } } };
type ParsedTx = {slot: number; meta: {err: unknown; preBalances:number[];postBalances:number[];preTokenBalances?:Array<{accountIndex:number;mint:string;owner?:string;programId?:string;uiTokenAmount:{amount:string;decimals?:number}}>;postTokenBalances?:Array<{accountIndex:number;mint:string;owner?:string;programId?:string;uiTokenAmount:{amount:string;decimals?:number}}>};transaction:{signatures:string[];message:{accountKeys:Array<{pubkey:string}>}}};
async function rpc<T>(method:string,params:unknown[]):Promise<T>{
  const url=getBackendConfig().rpcUrl;if(!url)throw new Error("Solana RPC is not configured.");
  const response=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:"fantasy-creator-fees",method,params}),signal:AbortSignal.timeout(12000),cache:"no-store"});
  if(!response.ok)throw new Error("Creator-fee network read is unavailable.");
  const body=await response.json();if(body.error||body.result===undefined)throw new Error("Creator-fee network request was rejected.");return body.result as T;
}
const COLLECTION_GAS_LAMPORTS=2_500_000n;
const MINIMUM_CLAIM_RAW=50_000n;
const MAX_CLAIM_FEE_LAMPORTS=25_000;
const PACKET_BYTES=1232;
async function readCollectionRoute(mint:string,creator:string,asset:RewardAsset){
  const details=assetDetails(asset),a=await quoteCollectionAddresses(creator,mint,details.mint);
  const curveAccount=await rpc<{value:unknown}>("getAccountInfo",[a.curve,{encoding:"base64",commitment:"finalized"}]);
  const curve=assertDirectCreator(curveAccount.value,creator,details.mint);
  let poolWaiting=0n;
  if(asset==="PUMP"){
    const quote=await rpc<{value:unknown}>("getAccountInfo",[details.mint,{encoding:"base64",commitment:"finalized"}]);
    assertQuoteMint(quote.value,details.decimals);
    if(curve.complete){
      const pool=await rpc<{value:unknown}>("getAccountInfo",[a.pool,{encoding:"base64",commitment:"finalized"}]);
      poolWaiting=assertQuotePool(pool.value,mint,creator,details.mint,a.poolATA).waiting;
    }
  }
  return {a,curve,poolWaiting};
}
export async function creatorFeeConfigurationBlockers(){
  const {mint,rpcUrl}=getBackendConfig(),creator=process.env.PF_CREATOR_WALLET_ADDRESS,blockers:string[]=[];
  if(process.env.PF_FEE_COLLECTION_ENABLED!=="true")blockers.push("Enable PF_FEE_COLLECTION_ENABLED for creator-fee collection.");
  if(process.env.PF_CREATOR_WALLET_DEDICATED!=="true")blockers.push("Confirm the creator wallet is dedicated to this token.");
  if(!creator||creator!==process.env.PF_PRIZE_WALLET_ADDRESS)blockers.push("Creator and prize-wallet public addresses must match.");
  if(!mint||!rpcUrl||!creator)return [...blockers,"The real token mint and creator wallet are required."];
  try{await verifyMainnetRpc();await readCollectionRoute(mint,creator,rewardAsset(process.env.PF_REWARD_ASSET??"SOL"));}
  catch{blockers.push("Could not verify the configured reward quote, mint, direct creator and supported fee mode; check the token configuration.");}
  return blockers;
}
async function claimGross(claim:Claim,tx:ParsedTx){
  const asset=rewardAsset(claim.reward_asset),details=assetDetails(asset),keys=tx.transaction.message.accountKeys.map(k=>k.pubkey);
  if(asset==="SOL"){
    const a=await creatorAddresses(claim.creator_wallet);
    return collectedFeesFromBalances(keys,tx.meta,a.solVault,a.ammATA,WSOL);
  }
  const a=await quoteCollectionAddresses(claim.creator_wallet,claim.mint_address,details.mint);
  return collectedTokenFeesFromBalances(keys,tx.meta,{address:a.creatorATA,owner:claim.creator_wallet},[
    {address:a.curveATA,owner:a.curve},{address:a.solVaultATA,owner:a.solVault},
    {address:a.ammATA,owner:a.ammAuthority},{address:a.poolATA,owner:a.pool},
  ],details);
}
async function resumeClaim(claim:Claim){
  const state=(await rpc<{value:Array<{err:unknown;confirmationStatus:string|null}|null>}>("getSignatureStatuses",[[claim.signature],{searchTransactionHistory:true}])).value[0];
  if(state?.confirmationStatus==="finalized"){
    if(state.err){await queryRows("update pf_creator_claims set status='failed' where signature=$1",[claim.signature]);return "claim-failed";}
    return finalizeClaim(claim);
  }
  if(state)return "claim-confirming";
  const height=await rpc<number>("getBlockHeight",[{commitment:"finalized"}]);
  if(BigInt(height)>BigInt(claim.last_valid_block_height)){await queryRows("update pf_creator_claims set status='unknown' where signature=$1",[claim.signature]);return "claim-needs-reconciliation";}
  const signature=await rpc<string>("sendTransaction",[claim.transaction_base64,{encoding:"base64",skipPreflight:false,preflightCommitment:"confirmed",maxRetries:0}]);
  if(signature!==claim.signature)throw new Error("Fee claim signature mismatch.");return "claim-submitted";
}
async function finalizeClaim(claim:Claim){
    const raw=await rpc<{slot:number}>("getTransaction",[claim.signature,{encoding:"base64",commitment:"finalized",maxSupportedTransactionVersion:0}]);
    if(!raw)return "claim-awaiting-receipt";assertFinalizedWire(claim.transaction_base64,raw);
    const tx=await rpc<ParsedTx>("getTransaction",[claim.signature,{encoding:"jsonParsed",commitment:"finalized",maxSupportedTransactionVersion:0}]);
    if(!tx||tx.slot!==raw.slot||tx.meta?.err!==null||tx.transaction.signatures[0]!==claim.signature)throw new Error("Finalized creator-fee receipt views disagree.");
    const gross=await claimGross(claim,tx),allocation=splitCreatorFees(gross);
    await withTransaction(async query=>{
      const previous=await query<{mint_address:string;reward_asset:RewardAsset;gross_raw:string}>("select mint_address,reward_asset,gross_raw from pf_creator_fee_receipts where signature=$1",[claim.signature]);
      if(previous[0]&&(previous[0].mint_address!==claim.mint_address||previous[0].reward_asset!==claim.reward_asset||BigInt(previous[0].gross_raw)!==gross))throw new Error("Creator-fee receipt conflicts with its original attribution.");
      if(gross>0n)await query("insert into pf_creator_fee_receipts(signature,mint_address,reward_asset,gross_raw,daily_raw,season_raw,reserve_raw) values($1,$2,$3,$4,$5,$6,$7) on conflict(signature) do nothing",[claim.signature,claim.mint_address,claim.reward_asset,gross.toString(),allocation.daily.toString(),allocation.season.toString(),allocation.reserve.toString()]);
      await query("update pf_creator_claims set status='finalized' where signature=$1",[claim.signature]);
    });return "claim-finalized";
}
/** Called under the durable season worker lock. Signing never broadcasts; exact
 * signed bytes are persisted first. Unknown claims are reconciled, not replaced. */
export async function collectCreatorFees(){
  const {rpcUrl,mint}=getBackendConfig();
  if(process.env.PF_FEE_COLLECTION_ENABLED!=="true"||!rpcUrl||!mint)return "collection-disabled";
  await verifyMainnetRpc();
  const outstanding=await queryRows<Claim>("select * from pf_creator_claims where status in ('prepared','unknown') order by created_at limit 1");
  if(outstanding[0])return resumeClaim(outstanding[0]);
  if((await creatorFeeConfigurationBlockers()).length)return "collection-not-configured";
  const creator=process.env.PF_CREATOR_WALLET_ADDRESS!;
  const asset=rewardAsset(process.env.PF_REWARD_ASSET??"SOL");
  const route=await readCollectionRoute(mint,creator,asset);
  const instructions=asset==="PUMP"?await prepareTokenCollection(mint,creator,route):await prepareSolCollection(mint,creator);
  if(typeof instructions==="string")return instructions;
  const prepared=await prepareClaimTransaction(mint,creator,instructions);
  if(!prepared)return "collection-needs-gas";
  return signAndPersistClaim(mint,creator,asset,prepared);
}
async function prepareClaimTransaction(mint:string,creator:string,instructions:import("@solana/kit").Instruction[]){
  const lifetime=(await rpc<{value:{blockhash:string;lastValidBlockHeight:number}}>("getLatestBlockhash",[{commitment:"confirmed"}])).value;
  const message=pipe(createTransactionMessage({version:0}),
    tx=>setTransactionMessageFeePayerSigner(createNoopSigner(address(creator)),tx),
    tx=>setTransactionMessageLifetimeUsingBlockhash({blockhash:blockhash(lifetime.blockhash),lastValidBlockHeight:BigInt(lifetime.lastValidBlockHeight)},tx),
    tx=>appendTransactionMessageInstructions(instructions,tx));
  const compiled=compileTransaction(message),unsigned=getBase64EncodedWireTransaction(compiled);
  if(Buffer.from(unsigned,"base64").length>PACKET_BYTES)throw new Error("Creator-fee claim exceeds the packet limit; nothing was signed.");
  const fee=(await rpc<{value:number|null}>("getFeeForMessage",[Buffer.from(compiled.messageBytes).toString("base64"),{commitment:"confirmed"}])).value;
  if(fee===null||!Number.isSafeInteger(fee)||fee<0||fee>MAX_CLAIM_FEE_LAMPORTS)throw new Error("Creator-fee collection exceeds the network-fee ceiling.");
  if(!await simulateClaim(mint,creator,unsigned))return null;
  return {unsigned,lastValidBlockHeight:String(lifetime.lastValidBlockHeight)};
}
async function simulateClaim(mint:string,creator:string,unsigned:string){
  const simulation=await rpc<{value:{err:unknown;accounts?:Array<{lamports:number}|null>}}>("simulateTransaction",[unsigned,{encoding:"base64",sigVerify:false,commitment:"confirmed",accounts:{addresses:[creator],encoding:"base64"}}]);
  if(simulation.value.err)throw new Error("Creator-fee claim simulation failed. Nothing was sent.");
  const simulatedBalance=simulation.value.accounts?.[0]?.lamports;
  if(simulatedBalance===undefined)throw new Error("Collection simulation omitted the SOL balance; retry without signing.");
  if(!await collectionHasGas(mint,creator,simulatedBalance))return null;
  return collectionHasGas(mint,creator,simulatedBalance);
}
async function signAndPersistClaim(mint:string,creator:string,asset:RewardAsset,prepared:{unsigned:string;lastValidBlockHeight:string}){
  const signer=await payoutSigner();
  if(!signer)return "collection-no-signer";
  if(signer.address!==creator)return "collection-signer-mismatch";
  const wire=await signPayout(prepared.unsigned,creator),signature=getSignatureFromTransaction(getTransactionDecoder().decode(Buffer.from(wire,"base64")));
  const claim:Claim={reward_asset:asset,signature,mint_address:mint,creator_wallet:creator,transaction_base64:wire,last_valid_block_height:prepared.lastValidBlockHeight,status:"prepared"};
  await queryRows("insert into pf_creator_claims(signature,mint_address,creator_wallet,transaction_base64,last_valid_block_height,reward_asset,status) values($1,$2,$3,$4,$5,$6,'prepared')",[signature,mint,creator,wire,claim.last_valid_block_height,asset]);
  return resumeClaim(claim);
}

async function collectionHasGas(mint:string,creator:string,simulatedBalance?:number){
  // SOL liabilities remain protected even when the new receipt is in PUMP units.
  const treasury=await getFeeTreasury(mint,"SOL"),protectedBalance=treasury.gross-treasury.paid+treasury.leagueSolReserved+COLLECTION_GAS_LAMPORTS;
  const balance=simulatedBalance??(await rpc<{value:number}>("getBalance",[creator,{commitment:"confirmed"}])).value;
  if(!Number.isSafeInteger(balance)||balance<0)throw new Error("Invalid SOL gas balance; verify the RPC response.");
  return BigInt(balance)>=protectedBalance;
}
function quoteTokenInfo(account:ParsedAccount,owner:string,asset:RewardAsset){
  const details=assetDetails(asset),token=account.data?.parsed?.info;
  if(!token)throw new Error("Unparsed creator token account; verify the RPC response.");
  if(account.owner!==details.tokenProgram||token.mint!==details.mint||token.owner!==owner||token.state!=="initialized")throw new Error("Invalid creator quote-token account; verify its mint, program, owner and state.");
  return token;
}
function tokenRaw(account:ParsedAccount|null,owner:string,asset:RewardAsset){
  if(!account)return 0n;
  const token=quoteTokenInfo(account,owner,asset),amount=token.tokenAmount;
  if(!amount||amount.decimals!==assetDetails(asset).decimals||!/^\d+$/.test(amount.amount))throw new Error("Invalid quote token decimals or amount; verify the RPC response.");
  return BigInt(amount.amount);
}
async function prepareSolCollection(mint:string,creator:string){
  const a=await creatorAddresses(creator);
  const vaults=await rpc<{value:Array<ParsedAccount|null>}>("getMultipleAccounts",[[a.solVault,a.ammATA],{encoding:"jsonParsed",commitment:"finalized"}]);
  const rent=await rpc<number>("getMinimumBalanceForRentExemption",[0]);
  const curveAmount=BigInt(Math.max(0,(vaults.value[0]?.lamports||0)-rent));
  const ammAmount=tokenRaw(vaults.value[1],a.ammAuthority,"SOL");
  if(curveAmount+ammAmount<MINIMUM_CLAIM_RAW)return "no-claimable-fees";
  if(!await collectionHasGas(mint,creator))return "collection-needs-gas";
  return directCollectionInstructions(creator,{curve:curveAmount>0n,amm:ammAmount>0n});
}
async function prepareTokenCollection(mint:string,creator:string,route:Awaited<ReturnType<typeof readCollectionRoute>>){
  const {a,curve,poolWaiting}=route;
  const accounts=await rpc<{value:Array<ParsedAccount|null>}>("getMultipleAccounts",[
    [a.solVaultATA,a.ammATA,a.curveATA,a.poolATA,a.creatorATA],{encoding:"jsonParsed",commitment:"finalized"},
  ]);
  const owners=[a.solVault,a.ammAuthority,a.curve,a.pool,creator];
  if(accounts.value.length!==owners.length)throw new Error("Incomplete creator token-account response; retry the network read.");
  const amounts=accounts.value.map((account,index)=>tokenRaw(account,owners[index],"PUMP"));
  if(amounts[2]<curve.waiting||amounts[3]<poolWaiting)throw new Error("Creator fee source balance is below its onchain fee amount; reconcile the route.");
  const claimable=amounts[0]+amounts[1]+curve.waiting+poolWaiting;
  if(claimable<MINIMUM_CLAIM_RAW)return "no-claimable-fees";
  if(!await collectionHasGas(mint,creator))return "collection-needs-gas";
  return quoteCollectionInstructions(creator,mint,assetDetails("PUMP").mint,{pool:curve.complete});
}
