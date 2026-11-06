import {address,getAddressEncoder,getAddressDecoder,getProgramDerivedAddress} from '@solana/kit';
import schemas from './protocol/creator-fees.json' with {type:'json'};
export const PUMP=schemas[0].program,AMM=schemas[1].program,
  WSOL='So11111111111111111111111111111111111111112',TOKEN='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  SYSTEM='11111111111111111111111111111111',ATA='ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const enc=getAddressEncoder(),dec=getAddressDecoder(),text=s=>new TextEncoder().encode(s);
const pda=async(program,...seeds)=>(await getProgramDerivedAddress({programAddress:address(program),seeds}))[0];
const ata=owner=>pda(ATA,enc.encode(address(owner)),enc.encode(address(TOKEN)),enc.encode(address(WSOL)));
export async function creatorAddresses(creator){
  address(creator);const solVault=await pda(PUMP,text('creator-vault'),enc.encode(address(creator))),ammAuthority=await pda(AMM,text('creator_vault'),enc.encode(address(creator)));
  return {creator:address(creator),solVault,solVaultATA:await ata(solVault),ammAuthority,ammATA:await ata(ammAuthority),creatorATA:await ata(creator)};
}
export const bondingCurveAddress=mint=>pda(PUMP,text('bonding-curve'),enc.encode(address(mint)));
export function assertDirectSolCreator(account,creator){
  const b=Buffer.from(account?.data?.[0]||'','base64');
  if(account?.owner!==PUMP||b.length<81||!b.subarray(0,8).equals(Buffer.from(schemas[0].curve_discriminator)))throw Error('Invalid Pump bonding curve.');
  if(dec.decode(b.subarray(49,81))!==creator)throw Error('Creator wallet differs from the onchain creator; direct collection cannot use a sharing-config vault.');
  const quote=curveQuote(b);
  if(![WSOL,SYSTEM].includes(quote))throw Error('Creator-fee rewards require a SOL-quoted coin.');
}
/** @returns {Promise<import('@solana/kit').Instruction[]>} */
export async function directCollectionInstructions(creator,{curve=true,amm=true}={}){
  const a=await creatorAddresses(creator),result=[];
  if(amm)result.push({programAddress:address(ATA),data:Buffer.from([1]),accounts:[
    {address:a.creator,role:3},{address:a.creatorATA,role:1},{address:a.creator,role:0},
    {address:address(WSOL),role:0},{address:address(SYSTEM),role:0},{address:address(TOKEN),role:0},
  ]});
  for(const schema of schemas){
    if((schema.name==='pump'&&!curve)||(schema.name==='amm'&&!amm))continue;
    const values={creator:a.creator,creator_token_account:a.creatorATA,creator_vault:a.solVault,creator_vault_token_account:a.solVaultATA,
      quote_mint:WSOL,quote_token_program:TOKEN,associated_token_program:ATA,system_program:SYSTEM,
      coin_creator:a.creator,coin_creator_vault_authority:a.ammAuthority,coin_creator_vault_ata:a.ammATA,coin_creator_token_account:a.creatorATA,
      event_authority:await pda(schema.program,text('__event_authority')),program:schema.program};
    result.push({programAddress:address(schema.program),data:Buffer.from(schema.instruction.discriminator),
      accounts:schema.instruction.accounts.map(k=>({address:address(values[k.name]||k.address),role:(k.writable?1:0)+(k.signer?2:0)}))});
  }
  if(amm)result.push({programAddress:address(TOKEN),data:Buffer.from([9]),accounts:[{address:a.creatorATA,role:1},{address:a.creator,role:1},{address:a.creator,role:2}]});
  return result;
}
export function assertFinalizedWire(expectedBase64,transaction){
  if(transaction?.meta?.err!==null||!Array.isArray(transaction.transaction)||transaction.transaction[1]!=='base64'||
    !Buffer.from(transaction.transaction[0],'base64').equals(Buffer.from(expectedBase64,'base64')))
    throw Error('Finalized bytes differ from the persisted financial transaction.');
}

// Bounded Kit 7 adaptation of pump-fees 4f1f3aa src/collect.ts and fee-sharing.ts.
// Fixture records exact inspected IDL hashes; no legacy web3.js dependency is copied.
import quoteSchemas from './protocol/quote-collection.json' with {type:'json'};
import {assetDetails} from '../reward-asset.ts';
export const PUMP_MINT=assetDetails('PUMP').mint;
const CURVE={creator:49,complete:48,cashback:82,quote:83,holder:124,fee:125,length:133};
const POOL={base:43,quote:75,quoteAccount:171,creator:211,cashback:244,holder:270,fee:279,length:287};
const POOL_DISCRIMINATOR=Buffer.from([241,154,109,4,17,177,109,188]);
const accountData=account=>Buffer.from(account?.data?.[0]||'','base64');
const keyAt=(data,offset)=>dec.decode(data.subarray(offset,offset+32));
function curveQuote(data){
  const quote=data.length>=CURVE.quote+32?keyAt(data,CURVE.quote):WSOL;
  return quote===SYSTEM?WSOL:quote;
}
function assertFeeMode(data,cashback,holder){
  if((data[cashback]??0)!==0||(data[holder]??0)!==0)throw Error('Unsupported creator fee mode: cashback and holder rewards must be disabled.');
}
export function assertDirectCreator(account,creator,quoteMint){
  const data=accountData(account);
  if(data.length<CURVE.creator+32||account.owner!==PUMP||!data.subarray(0,8).equals(Buffer.from(schemas[0].curve_discriminator)))throw Error('Invalid Pump bonding curve; verify the configured mint.');
  if(keyAt(data,CURVE.creator)!==creator)throw Error('Creator wallet differs from the direct onchain creator; sharing vaults are unsupported.');
  if(curveQuote(data)!==quoteMint)throw Error('Curve quote differs from the configured reward asset; correct PF_REWARD_ASSET.');
  if(quoteMint!==WSOL&&data.length<CURVE.length)throw Error('Token-quoted curve fee layout is incomplete; collection must wait for a supported account.');
  assertFeeMode(data,CURVE.cashback,CURVE.holder);
  return {complete:data[CURVE.complete]===1,waiting:data.length>=CURVE.length?data.readBigUInt64LE(CURVE.fee):0n};
}
export function assertQuoteMint(account,decimals){
  const data=accountData(account);
  if(account?.owner!==TOKEN||data.length!==82||data[44]!==decimals||data[45]!==1)throw Error('Invalid reward mint program, decimals or initialization; verify the mainnet mint.');
}
export function assertQuotePool(account,mint,creator,quoteMint,poolATA){
  const data=accountData(account);
  if(account?.owner!==AMM||data.length<POOL.length||!data.subarray(0,8).equals(POOL_DISCRIMINATOR))throw Error('Invalid canonical PumpSwap pool; collection must wait for migration.');
  if(keyAt(data,POOL.base)!==mint||keyAt(data,POOL.quote)!==quoteMint||keyAt(data,POOL.creator)!==creator||keyAt(data,POOL.quoteAccount)!==poolATA)throw Error('Canonical pool base mint, quote, creator or token account mismatch; verify the pool.');
  assertFeeMode(data,POOL.cashback,POOL.holder);
  return {waiting:data.readBigUInt64LE(POOL.fee)};
}
export const quoteAta=(owner,mint)=>pda(ATA,enc.encode(address(owner)),enc.encode(address(TOKEN)),enc.encode(address(mint)));
export async function quoteCollectionAddresses(creator,mint,quoteMint){
  const a=await creatorAddresses(creator),curve=await bondingCurveAddress(mint);
  const authority=await pda(PUMP,text('pool-authority'),enc.encode(address(mint)));
  const pool=await pda(AMM,text('pool'),new Uint8Array(2),enc.encode(authority),enc.encode(address(mint)),enc.encode(address(quoteMint)));
  return {...a,curve,pool,curveATA:await quoteAta(curve,quoteMint),poolATA:await quoteAta(pool,quoteMint),
    creatorATA:await quoteAta(creator,quoteMint),solVaultATA:await quoteAta(a.solVault,quoteMint),ammATA:await quoteAta(a.ammAuthority,quoteMint),
    global:await pda(PUMP,text('global')),globalConfig:await pda(AMM,text('global_config')),
    event:await pda(PUMP,text('__event_authority')),ammEvent:await pda(AMM,text('__event_authority'))};
}
/** @returns {Promise<import('@solana/kit').Instruction[]>} */
export async function quoteCollectionInstructions(creator,mint,quoteMint,{pool=false}={}){
  if(quoteMint!==PUMP_MINT)throw Error('Unsupported reward quote; use the configured PUMP mint.');
  const a=await quoteCollectionAddresses(creator,mint,quoteMint);
  const values={payer:creator,creator,global:a.global,global_config:a.globalConfig,mint,base_mint:mint,quote_mint:quoteMint,quote_token_program:TOKEN,
    associated_token_program:ATA,system_program:SYSTEM,token_program:TOKEN,pump_creator_vault:a.solVault,pump_creator_vault_ata:a.solVaultATA,bonding_curve:a.curve,associated_quote_bonding_curve:a.curveATA,
    creator_vault:a.solVault,creator_vault_token_account:a.solVaultATA,creator_token_account:a.creatorATA,
    pool:a.pool,pool_quote_token_account:a.poolATA,coin_creator:creator,coin_creator_vault_authority:a.ammAuthority,coin_creator_vault_ata:a.ammATA};
  const result=[{programAddress:address(ATA),data:Buffer.from([1]),accounts:[
    {address:address(creator),role:3},{address:a.creatorATA,role:1},{address:address(creator),role:0},
    {address:address(quoteMint),role:0},{address:address(SYSTEM),role:0},{address:address(TOKEN),role:0}]}];
  const steps=['pump_sweep_creator_fee',...(pool?['amm_sweep_creator_fee','amm_transfer_creator_fees_to_pump_v2']:[]),'pump_collect_creator_fee_v2'];
  for(const name of steps){
    const schema=quoteSchemas.instructions[name],isAmm=name.startsWith('amm_'),program=isAmm?AMM:PUMP;
    const accounts={...values,recipient:isAmm?a.ammAuthority:a.solVault,recipient_token_account:a.ammATA,associated_quote_recipient:a.solVaultATA,event_authority:isAmm?a.ammEvent:a.event,program};
    result.push({programAddress:address(program),data:Buffer.from(schema.discriminator),accounts:schema.accounts.map(k=>({address:address(accounts[k.name]),role:(k.writable?1:0)+(k.signer?2:0)}))});
  }
  return result;
}
