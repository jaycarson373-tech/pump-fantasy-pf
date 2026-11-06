export const TOKEN_PROGRAMS = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"] as const;
export const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
export const PLAYER_BURN_TOKENS = 500_000n;
export type BurnIntent = { id:string; wallet:string; source:string; mint:string; tokenProgram:string; decimals:number; amount:string; memo:string; created:number };
export type PreparedBurn = { transaction:string; blockhash:string; lastValidBlockHeight:number };
export type BurnProof = { signature:string; slot:number; blockTime:number };
export function tokenAmount(value:unknown):string {
 if(typeof value!=="string" || !/^[0-9]{1,20}$/.test(value) || BigInt(value)>18_446_744_073_709_551_615n) throw new Error("Invalid token amount. Retry with a valid mint.");
 return value;
}
