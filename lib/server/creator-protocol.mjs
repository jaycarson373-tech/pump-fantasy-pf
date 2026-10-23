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
  const quote=b.length>=115?dec.decode(b.subarray(83,115)):WSOL;
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
