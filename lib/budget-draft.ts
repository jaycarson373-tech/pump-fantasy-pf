export const DRAFT_BUDGET = 100;
export type DraftPlayer = {rank:number;wallet:string};
export type DraftPicks = Record<number,number>;
const ranges=[{high:35,low:25},{high:28,low:18},{high:22,low:13},{high:18,low:10},{high:14,low:6}];
export function priceForRank(rank:number){
 if(!Number.isInteger(rank)||rank<1||rank>50)throw Error('Unknown draft rank.');
 const band=Math.floor((rank-1)/10),position=(rank-1)%10,range=ranges[band];
 return Math.round(range.high-((range.high-range.low)*position)/9);
}
export function serializePicks(picks:DraftPicks,players:DraftPlayer[]){
 return Object.fromEntries(Object.entries(picks).flatMap(([band,rank])=>{
  const p=players.find(p=>p.rank===rank);
  return p&&Math.floor((p.rank-1)/10)===Number(band)?[[band,p.wallet]]:[];
 }));
}
/** Persist identity, never a rank that could belong to another trader after refresh. */
export function restorePicks(value:unknown,players:DraftPlayer[]):DraftPicks{
 if(!value||typeof value!=='object'||Array.isArray(value))return{};
 const picks:DraftPicks={};let spent=0;
 for(let band=0;band<5;band++){
  const wallet=(value as Record<string,unknown>)[band];
  const p=players.find(p=>typeof wallet==='string'&&p.wallet===wallet&&Math.floor((p.rank-1)/10)===band);
  if(p){const cost=priceForRank(p.rank);if(spent+cost<=DRAFT_BUDGET){picks[band]=p.rank;spent+=cost;}}
 }
 return picks;
}
export function rebasePicks(picks:DraftPicks,before:DraftPlayer[],after:DraftPlayer[]){return restorePicks(serializePicks(picks,before),after)}
