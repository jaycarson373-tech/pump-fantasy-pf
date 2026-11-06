import "server-only";
import { queryRows, withTransaction } from "./database";
import { calculateDailyWinner, type DailyWinnerResult, type ScoringEntry, type ScoringPlayer } from "./daily-scoring";
import { isWalletTestSeason } from "./season-window";

type ClosingSeason = { id: string; prize_mode: string; mint_address: string | null; closes_at: string | null };

async function seasonWinner(seasonId: string): Promise<DailyWinnerResult> {
  const [entries, players, snapshots, seasons] = await Promise.all([
    queryRows<ScoringEntry>("select wallet,picks from pf_entries where season_id=$1", [seasonId]),
    queryRows<ScoringPlayer>("select id,wallet from pf_players where season_id=$1", [seasonId]),
    queryRows<{ boundary: number; pnl_by_wallet: Record<string, number> }>("select boundary,pnl_by_wallet from pf_score_snapshots where season_id=$1 and boundary in (0,2)", [seasonId]),
    queryRows<{ squad_size: number }>("select squad_size from pf_seasons where id=$1", [seasonId]),
  ]);
  if (!entries.length) return { kind: "no-eligible-entries" };
  const opening = snapshots.find(snapshot => snapshot.boundary === 0);
  const closing = snapshots.find(snapshot => snapshot.boundary === 2);
  if (!opening || !closing) return { kind: "awaiting-data" };
  return calculateDailyWinner(entries, players, opening.pnl_by_wallet, closing.pnl_by_wallet, seasons[0]?.squad_size ?? 0);
}

/** Daily and season awards claim independent portions of the same receipts. */
export async function settleSeasonAward(season: ClosingSeason) {
  if (season.prize_mode !== "creator-fees" || isWalletTestSeason(season.id)) return;
  if (!season.mint_address || !season.closes_at) throw new Error("Season reward requires a mint and closing cutoff. Repair the season configuration.");
  const cutoff = Date.parse(season.closes_at);
  if (!Number.isFinite(cutoff)) throw new Error("Season reward cutoff is invalid. Repair the season schedule.");
  if (Date.now() < cutoff) return;
  const existing = await queryRows("select id from pf_daily_awards where season_id=$1 and award_kind='season'", [season.id]);
  if (existing.length) return;
  const result = await seasonWinner(season.id);
  const winner = result.kind === "winner" ? { wallet: result.wallet, score: result.score } : { wallet: null, score: null };
  await withTransaction(async query => {
    const receipts = await query<{ signature: string; season_lamports: string }>("select signature,season_lamports from pf_creator_fee_receipts where mint_address=$1 and season_award_id is null and season_lamports>0 and collected_at <= $2 for update", [season.mint_address, season.closes_at]);
    const noEntries = result.kind === "no-eligible-entries";
    const prize = noEntries ? 0n : receipts.reduce((total, receipt) => total + BigInt(receipt.season_lamports), 0n);
    let status = prize > 0n ? "pending_payment" : "no_creator_fees";
    if (result.kind === "awaiting-data") status = "awaiting_data";
    if (noEntries) status = "no_eligible_entries";
    const awards = await query<{ id: string }>("insert into pf_daily_awards(season_id,award_kind,day_number,winner_wallet,score_usd,prize_lamports,status) values($1,'season',null,$2,$3,$4,$5) on conflict do nothing returning id", [season.id, winner.wallet, winner.score, prize.toString(), status]);
    // Missing scoring data holds this season's pool for review; it cannot be
    // awarded to a later season. No-entry pools deliberately carry forward.
    if (awards[0] && !noEntries && receipts.length) await query("update pf_creator_fee_receipts set season_award_id=$1 where signature=any($2::text[]) and season_award_id is null", [awards[0].id, receipts.map(receipt => receipt.signature)]);
  });
}
