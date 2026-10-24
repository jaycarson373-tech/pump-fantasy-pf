import { requireSuccessfulSimulation } from "./simulation-policy";
import "server-only";
import { address, appendTransactionMessageInstructions, blockhash, compileTransaction, createNoopSigner, createTransactionMessage, getBase64EncodedWireTransaction, getSignatureFromTransaction, getTransactionDecoder, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash, pipe } from "@solana/kit";
import { queryRows, withTransaction } from "./database";
import { getFeeTreasury } from "./fee-treasury";
import { getBackendConfig } from "./config";
import { managedPayoutAddress, signManagedPayout } from "./managed-signer";
import { collectedFeesFromBalances, splitCreatorFees } from "./fee-accounting";
import { creatorAddresses, bondingCurveAddress, assertDirectSolCreator, directCollectionInstructions, assertFinalizedWire, WSOL, TOKEN } from "./creator-protocol.mjs";
import { verifyMainnetRpc } from "./solana";

type Claim = { signature: string; mint_address: string; creator_wallet: string; transaction_base64: string; last_valid_block_height: string; status: string };
type ParsedAccount = { lamports: number; owner: string; data: { parsed?: { info?: { mint?: string; owner?: string; tokenAmount?: {amount: string} } } } };
type ParsedTx = {slot: number; meta: {err: unknown; preBalances:number[];postBalances:number[];preTokenBalances?:Array<{accountIndex:number;mint:string;uiTokenAmount:{amount:string}}>;postTokenBalances?:Array<{accountIndex:number;mint:string;uiTokenAmount:{amount:string}}>};transaction:{signatures:string[];message:{accountKeys:Array<{pubkey:string}>}}};
async function rpc<T>(method:string,params:unknown[]):Promise<T>{
  const url=getBackendConfig().rpcUrl;if(!url)throw new Error("Solana RPC is not configured.");
  const response=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:"fantasy-creator-fees",method,params}),signal:AbortSignal.timeout(12000),cache:"no-store"});
  if(!response.ok)throw new Error("Creator-fee network read is unavailable.");
  const body=await response.json();if(body.error||body.result===undefined)throw new Error("Creator-fee network request was rejected.");return body.result as T;
}
export async function creatorFeeConfigurationBlockers(){
  const {mint,rpcUrl}=getBackendConfig(),creator=process.env.PF_CREATOR_WALLET_ADDRESS,blockers:string[]=[];
  if(process.env.PF_FEE_COLLECTION_ENABLED!=="true")blockers.push("Enable PF_FEE_COLLECTION_ENABLED for creator-fee collection.");
  if(process.env.PF_CREATOR_WALLET_DEDICATED!=="true")blockers.push("Confirm the creator wallet is dedicated to this token.");
  if(!creator||creator!==process.env.PF_PRIZE_WALLET_ADDRESS)blockers.push("Creator and prize-wallet public addresses must match.");
  if(!mint||!rpcUrl||!creator)return [...blockers,"The real token mint and creator wallet are required."];
  try{await verifyMainnetRpc();const curve=await bondingCurveAddress(mint);const account=await rpc<{value:unknown}>("getAccountInfo",[curve,{encoding:"base64",commitment:"finalized"}]);assertDirectSolCreator(account.value,creator);}
  catch{blockers.push("Could not verify a SOL-quoted direct creator matching the dedicated wallet; sharing-config vaults require their separate distributor.");}
  return blockers;
}
async function resumeClaim(claim:Claim){
  const state=(await rpc<{value:Array<{err:unknown;confirmationStatus:string|null}|null>}>("getSignatureStatuses",[[claim.signature],{searchTransactionHistory:true}])).value[0];
  if(state?.confirmationStatus==="finalized"){
    if(state.err){await queryRows("update pf_creator_claims set status='failed' where signature=$1",[claim.signature]);return "claim-failed";}
    const raw=await rpc<{slot:number}>("getTransaction",[claim.signature,{encoding:"base64",commitment:"finalized",maxSupportedTransactionVersion:0}]);
    if(!raw)return "claim-awaiting-receipt";assertFinalizedWire(claim.transaction_base64,raw);
    const tx=await rpc<ParsedTx>("getTransaction",[claim.signature,{encoding:"jsonParsed",commitment:"finalized",maxSupportedTransactionVersion:0}]);
    if(!tx||tx.slot!==raw.slot||tx.meta?.err!==null||tx.transaction.signatures[0]!==claim.signature)throw new Error("Finalized creator-fee receipt views disagree.");
    const a=await creatorAddresses(claim.creator_wallet),keys=tx.transaction.message.accountKeys.map(k=>k.pubkey);
    const gross=collectedFeesFromBalances(keys,tx.meta,a.solVault,a.ammATA,WSOL),allocation=splitCreatorFees(gross);
    await withTransaction(async query=>{
      const previous=await query<{mint_address:string;gross_lamports:string}>("select mint_address,gross_lamports from pf_creator_fee_receipts where signature=$1",[claim.signature]);
      if(previous[0]&&(previous[0].mint_address!==claim.mint_address||BigInt(previous[0].gross_lamports)!==gross))throw new Error("Creator-fee receipt conflicts with its original attribution.");
      if(gross>0n)await query("insert into pf_creator_fee_receipts(signature,mint_address,gross_lamports,daily_lamports,reserve_lamports) values($1,$2,$3,$4,$5) on conflict(signature) do nothing",[claim.signature,claim.mint_address,gross.toString(),allocation.daily.toString(),allocation.reserve.toString()]);
      await query("update pf_creator_claims set status='finalized' where signature=$1",[claim.signature]);
    });return "claim-finalized";
  }
  if(state)return "claim-confirming";
  const height=await rpc<number>("getBlockHeight",[{commitment:"finalized"}]);
  if(BigInt(height)>BigInt(claim.last_valid_block_height)){await queryRows("update pf_creator_claims set status='unknown' where signature=$1",[claim.signature]);return "claim-needs-reconciliation";}
  const signature=await rpc<string>("sendTransaction",[claim.transaction_base64,{encoding:"base64",skipPreflight:false,preflightCommitment:"confirmed",maxRetries:0}]);
  if(signature!==claim.signature)throw new Error("Fee claim signature mismatch.");return "claim-submitted";
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
  const creator=managedPayoutAddress();if(!creator)return "collection-no-signer";
  if(creator!==process.env.PF_CREATOR_WALLET_ADDRESS)return "collection-signer-mismatch";
  const a=await creatorAddresses(creator);
  const vaults=await rpc<{value:Array<ParsedAccount|null>}>("getMultipleAccounts",[[a.solVault,a.ammATA],{encoding:"jsonParsed",commitment:"finalized"}]);
  const rent=await rpc<number>("getMinimumBalanceForRentExemption",[0]);
  const curveAmount=BigInt(Math.max(0,(vaults.value[0]?.lamports||0)-rent));
  const token=vaults.value[1]?.data?.parsed?.info;
  if(token&&(vaults.value[1]?.owner!==TOKEN||token.mint!==WSOL||token.owner!==a.ammAuthority||!/^\d+$/.test(token.tokenAmount?.amount||"")))throw new Error("Invalid AMM creator vault identity.");
  const ammAmount=BigInt(token?.tokenAmount?.amount||"0");
  if(curveAmount+ammAmount<50000n)return "no-claimable-fees";
  const treasury=await getFeeTreasury(mint),protectedBalance=treasury.daily-treasury.paid+treasury.reserve+2_500_000n;
  const balance=await rpc<{value:number}>("getBalance",[creator,{commitment:"confirmed"}]);
  if(BigInt(balance.value)<protectedBalance)return "collection-needs-gas";
  const instructions=await directCollectionInstructions(creator,{curve:curveAmount>0n,amm:ammAmount>0n});
  const lifetime=(await rpc<{value:{blockhash:string;lastValidBlockHeight:number}}>("getLatestBlockhash",[{commitment:"confirmed"}])).value;
  const message=pipe(createTransactionMessage({version:0}),
    tx=>setTransactionMessageFeePayerSigner(createNoopSigner(address(creator)),tx),
    tx=>setTransactionMessageLifetimeUsingBlockhash({blockhash:blockhash(lifetime.blockhash),lastValidBlockHeight:BigInt(lifetime.lastValidBlockHeight)},tx),
    tx=>appendTransactionMessageInstructions(instructions,tx));
  const compiled=compileTransaction(message),unsigned=getBase64EncodedWireTransaction(compiled);
  if(Buffer.from(unsigned,"base64").length>1232)throw new Error("Creator-fee claim exceeds the packet limit; nothing was signed.");
  const fee=(await rpc<{value:number|null}>("getFeeForMessage",[Buffer.from(compiled.messageBytes).toString("base64"),{commitment:"confirmed"}])).value;
  if(fee===null||!Number.isSafeInteger(fee)||fee>25000)throw new Error("Creator-fee collection exceeds the network-fee ceiling.");
  const simulation=await rpc<{value:{err:unknown}}>("simulateTransaction",[unsigned,{encoding:"base64",sigVerify:false,commitment:"confirmed"}]);
  requireSuccessfulSimulation(simulation);
  const wire=await signManagedPayout(unsigned,creator),signature=getSignatureFromTransaction(getTransactionDecoder().decode(Buffer.from(wire,"base64")));
  const claim:Claim={signature,mint_address:mint,creator_wallet:creator,transaction_base64:wire,last_valid_block_height:String(lifetime.lastValidBlockHeight),status:"prepared"};
  await queryRows("insert into pf_creator_claims(signature,mint_address,creator_wallet,transaction_base64,last_valid_block_height,status) values($1,$2,$3,$4,$5,'prepared')",[signature,mint,creator,wire,claim.last_valid_block_height]);
  return resumeClaim(claim);
}
