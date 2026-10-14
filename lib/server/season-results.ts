import "server-only";
import { collectCreatorFees } from "./creator-fees";
import { getPayoutConfiguration } from "./automatic-payout";
import { queryRows, withAdvisoryLock, withTransaction } from "./database";
import { fetchPumpLeaderboard, type FantasyPlayer } from "./pumpfun";
import { saveRosterSnapshot } from "./players";
import { validWallet } from "./http";
import { getNativeSolBalance } from "./solana";
import { nextSeasonId, seasonWindowFromOpen } from "./season-window";
import { calculateDailyWinner } from "./daily-scoring";
import { recoverBoundaryAward, type AwardBoundary } from "./boundary-award";
import { processNextAutomaticPayout } from "./automatic-payout";

const DAY_MS = 24 * 60 * 60 * 1000;
const SNAPSHOT_GRACE_MS = 15 * 60 * 1000;
type Season = { id: string; title: string; status: string; opens_at: string | null; locked_at: string | null; closes_at: string | null; daily_prize_lamports: string | number; mint_address: string | null; prize_mode: string };
type EntryRow = { wallet: string; picks: string[] };
type ScoreSnapshot = { boundary: number; captured_at: string; pnl_by_wallet: Record<string, number>; missing_wallets: string[] };

function snapshotMap(players: FantasyPlayer[]) {
  return Object.fromEntries(players.map((player) => [player.wallet, player.pnl_usd])) as Record<string, number>;
}

async function activeSeason() {
  const configured = await queryRows<{ value: string }>("select value from pf_app_config where key = 'active_season_id' limit 1");
  const seasonId = configured[0]?.value || process.env.PF_ACTIVE_SEASON_ID;
  if (!seasonId) return null;
  const rows = await queryRows<Season>("select id, title, status, opens_at, locked_at, closes_at, daily_prize_lamports, mint_address, prize_mode from pf_seasons where id = $1 limit 1", [seasonId]);
  return rows[0] ?? null;
}

async function recordAward(season: Season, day: 1 | 2, previous: ScoreSnapshot, current: ScoreSnapshot) {
  const existing = await queryRows<{ id: string }>("select id from pf_daily_awards where season_id = $1 and day_number = $2 limit 1", [season.id, day]);
  if (existing.length) return;
  const entries = await queryRows<EntryRow>("select wallet, picks from pf_entries where season_id = $1 order by created_at asc, wallet asc", [season.id]);
  const players = await queryRows<{ id: string; wallet: string }>("select id, wallet from pf_players where season_id = $1", [season.id]);
  const result = calculateDailyWinner(entries, players, previous.pnl_by_wallet, current.pnl_by_wallet);
  if (result.kind === "no-eligible-entries") {
    await queryRows("insert into pf_daily_awards (season_id, day_number, status, prize_lamports) values ($1, $2, 'no_eligible_entries', $3) on conflict (season_id, day_number) do nothing", [season.id, day, season.daily_prize_lamports]);
    return;
  }
  if (result.kind === "awaiting-data") {
    await queryRows("insert into pf_daily_awards (season_id, day_number, status, prize_lamports) values ($1, $2, 'awaiting_data', $3) on conflict (season_id, day_number) do nothing", [season.id, day, season.daily_prize_lamports]);
    return;
  }
  if (season.prize_mode === "creator-fees") {
    if (!season.mint_address || !season.locked_at) throw new Error("Creator-fee season is missing its mint or cutoff.");
    const cutoff = new Date(Date.parse(season.locked_at) + day * DAY_MS).toISOString();
    await withTransaction(async (query) => {
      const receipts = await query<{ signature: string; daily_lamports: string }>("select signature,daily_lamports from pf_creator_fee_receipts where mint_address=$1 and award_id is null and collected_at <= $2 for update", [season.mint_address, cutoff]);
      const prize = receipts.reduce((sum, receipt) => sum + BigInt(receipt.daily_lamports), 0n);
      const awards = await query<{ id: string }>("insert into pf_daily_awards(season_id,day_number,winner_wallet,score_usd,prize_lamports,status) values($1,$2,$3,$4,$5,$6) on conflict(season_id,day_number) do nothing returning id", [season.id,day,result.wallet,result.score,prize.toString(),prize > 0n ? "pending_payment" : "no_creator_fees"]);
      if (awards[0] && receipts.length) await query("update pf_creator_fee_receipts set award_id=$1 where signature=any($2::text[]) and award_id is null", [awards[0].id, receipts.map((receipt) => receipt.signature)]);
    });
    return;
  }
  const prize = BigInt(season.daily_prize_lamports || 0);
  const status = prize > 0n ? "pending_payment" : "awaiting_funding";
  await queryRows("insert into pf_daily_awards (season_id, day_number, winner_wallet, score_usd, prize_lamports, status) values ($1, $2, $3, $4, $5, $6) on conflict (season_id, day_number) do nothing", [season.id, day, result.wallet, result.score, prize.toString(), status]);
}

async function reconcileStoredAward(season: Season, boundary: AwardBoundary, snapshot?: ScoreSnapshot) {
  const current = snapshot ?? (await queryRows<ScoreSnapshot>("select boundary, captured_at, pnl_by_wallet, missing_wallets from pf_score_snapshots where season_id = $1 and boundary = $2 limit 1", [season.id, boundary]))[0];
  if (!current) return false;

  return recoverBoundaryAward({
    boundary,
    snapshot: current,
    loadPrevious: async (previousBoundary) => (await queryRows<ScoreSnapshot>("select boundary, captured_at, pnl_by_wallet, missing_wallets from pf_score_snapshots where season_id = $1 and boundary = $2 limit 1", [season.id, previousBoundary]))[0],
    recordAward: async (awardBoundary, previous, closing) => recordAward(season, awardBoundary, previous, closing)
  });
}

async function captureBoundary(season: Season, boundary: 0 | 1 | 2) {
  const already = await queryRows<ScoreSnapshot>("select boundary, captured_at, pnl_by_wallet, missing_wallets from pf_score_snapshots where season_id = $1 and boundary = $2 limit 1", [season.id, boundary]);
  if (already[0]) {
    if (boundary === 1 || boundary === 2) await reconcileStoredAward(season, boundary, already[0]);
    return false;
  }
  const board = await fetchPumpLeaderboard(100, { fresh: true });
  if (board.players.length < 50 || new Set(board.players.map((player) => player.wallet)).size !== board.players.length || board.players.some((player) => !validWallet(player.wallet) || !Number.isFinite(player.pnl_usd))) throw new Error("Pump.fun returned an incomplete or invalid scoring snapshot.");
  const entries = await queryRows<EntryRow>("select wallet, picks from pf_entries where season_id = $1", [season.id]);
  const players = await queryRows<{ id: string; wallet: string }>("select id, wallet from pf_players where season_id = $1", [season.id]);
  const walletById = new Map(players.map((player) => [player.id, player.wallet]));
  const pickedWallets = new Set(entries.flatMap((entry) => entry.picks.map((id) => walletById.get(id)).filter((wallet): wallet is string => Boolean(wallet))));
  const values = snapshotMap(board.players);
  const missing = [...pickedWallets].filter((wallet) => values[wallet] === undefined);
  const capturedAt = new Date().toISOString();
  const inserted = await queryRows<{ boundary: number }>("insert into pf_score_snapshots (season_id, boundary, captured_at, source_url, pnl_by_wallet, missing_wallets) values ($1, $2, $3, $4, $5::jsonb, $6::jsonb) on conflict (season_id, boundary) do nothing returning boundary", [season.id, boundary, capturedAt, "https://pump.fun/leaderboard", JSON.stringify(values), JSON.stringify(missing)]);
  const savedSnapshot: ScoreSnapshot = inserted.length
    ? { boundary, captured_at: capturedAt, pnl_by_wallet: values, missing_wallets: missing }
    : (await queryRows<ScoreSnapshot>("select boundary, captured_at, pnl_by_wallet, missing_wallets from pf_score_snapshots where season_id = $1 and boundary = $2 limit 1", [season.id, boundary]))[0];
  if (savedSnapshot && (boundary === 1 || boundary === 2)) await reconcileStoredAward(season, boundary, savedSnapshot);
  return inserted.length > 0;
}

export async function tickSeason() {
  return withAdvisoryLock("pump-fantasy-season-tick", async () => {
    const season = await activeSeason();
    if (!season || season.status !== "open" || !season.locked_at || !season.closes_at) return { ok: true, action: "idle", seasonId: season?.id ?? null };
    // Collection is finalized and journaled before daily results settle.
    // A collector outage must not prevent timely PnL snapshots.
    try { if (season.prize_mode === "creator-fees") await collectCreatorFees(); }
    catch (error) { console.error("Creator-fee collection paused:", error instanceof Error ? error.message : "claim failed"); }
    const now = Date.now();
    const lockedAt = Date.parse(season.locked_at);
    const closesAt = Date.parse(season.closes_at);
    if (!Number.isFinite(lockedAt) || !Number.isFinite(closesAt)) throw new Error("Active season schedule is invalid.");
    const snapshots: string[] = [];
    if (now >= lockedAt && now <= lockedAt + SNAPSHOT_GRACE_MS && await captureBoundary(season, 0)) snapshots.push("scoring-open");
    const dayOneAt = lockedAt + DAY_MS;
    if (now >= dayOneAt && now <= dayOneAt + SNAPSHOT_GRACE_MS && await captureBoundary(season, 1)) snapshots.push("day-one-close");
    else if (now > dayOneAt + SNAPSHOT_GRACE_MS) {
      await reconcileStoredAward(season, 1);
      await queryRows("insert into pf_daily_awards (season_id, day_number, status, prize_lamports) values ($1, 1, 'awaiting_data', $2) on conflict (season_id, day_number) do nothing", [season.id, season.daily_prize_lamports]);
    }
    if (now >= closesAt && now <= closesAt + SNAPSHOT_GRACE_MS && await captureBoundary(season, 2)) snapshots.push("day-two-close");
    else if (now > closesAt + SNAPSHOT_GRACE_MS) {
      await reconcileStoredAward(season, 2);
      await queryRows("insert into pf_daily_awards (season_id, day_number, status, prize_lamports) values ($1, 2, 'awaiting_data', $2) on conflict (season_id, day_number) do nothing", [season.id, season.daily_prize_lamports]);
    }
    const payout = await processNextAutomaticPayout();
    if (now < closesAt) return { ok: true, action: snapshots.length ? "snapshotted" : payout.action === "no-pending-award" ? "waiting" : payout.action, seasonId: season.id, snapshots, payout };
    if (payout.action !== "no-pending-award") {
      return { ok: true, action: payout.action, seasonId: season.id, snapshots, payout };
    }

    if (season.prize_mode === "creator-fees") {
      const payoutConfig = await getPayoutConfiguration();
      if (payoutConfig.blockers.length) return { ok: true, action: "awaiting-reward-configuration", seasonId: season.id };
    }
    const nextPrize = BigInt(season.daily_prize_lamports || 0);
    const prizeWallet = process.env.PF_PRIZE_WALLET_ADDRESS || "";
    if (nextPrize > 0n) {
      if (!validWallet(prizeWallet)) return { ok: true, action: "awaiting-prize-wallet", seasonId: season.id };
      const balance = await getNativeSolBalance(prizeWallet);
      if (balance < nextPrize * 2n + 20_000n) return { ok: true, action: "awaiting-prize-funding", seasonId: season.id, requiredBalanceLamports: (nextPrize * 2n + 20_000n).toString() };
    }
    const board = await fetchPumpLeaderboard(50, { fresh: true });
    if (board.players.length !== 50 || board.players.some((player, index) => player.rank !== index + 1 || !validWallet(player.wallet) || !Number.isFinite(player.pnl_usd)) || new Set(board.players.map((player) => player.wallet)).size !== 50) {
      return { ok: true, action: "awaiting-leaderboard", seasonId: season.id };
    }

    return withTransaction(async (transactionQuery) => {
      const current = await transactionQuery<{ id: string }>("select id from pf_seasons where id = $1 and status = 'open' for update", [season.id]);
      if (!current.length) return { ok: true, action: "already-rolled", seasonId: season.id };
      const existing = await transactionQuery<{ id: string }>("select id from pf_seasons");
      const nextId = nextSeasonId(existing.map((row) => row.id));
      const nextNumber = Number(nextId.slice("season-".length));
      const nextPrizeLamports = nextPrize.toString();
      const nextWindow = seasonWindowFromOpen(Date.now());
      const inserted = await transactionQuery<{ id: string }>("insert into pf_seasons (id, title, status, opens_at, locked_at, closes_at, daily_prize_lamports, source_url, mint_address, prize_mode) values ($1, $2, 'draft', null, null, null, $3, $4, $5, $6) on conflict (id) do nothing returning id", [nextId, `Season ${nextNumber}`, nextPrizeLamports, "https://pump.fun/leaderboard", season.mint_address, season.prize_mode]);
      if (!inserted.length) throw new Error("Could not reserve the next season ID safely.");
      await saveRosterSnapshot(nextId, board.players, new Date(board.snapshotAt), transactionQuery);
      const opened = await transactionQuery<{ id: string }>("update pf_seasons set status = 'open', opens_at = $2, locked_at = $3, closes_at = $4 where id = $1 and status = 'draft' returning id", [nextId, nextWindow.opensAt, nextWindow.lockedAt, nextWindow.closesAt]);
      if (!opened.length) throw new Error("Could not open the next season safely.");
      const completed = await transactionQuery<{ id: string }>("update pf_seasons set status = 'complete' where id = $1 and status = 'open' returning id", [season.id]);
      if (!completed.length) throw new Error("The previous season changed during rollover.");
      await transactionQuery("insert into pf_app_config (key, value) values ('active_season_id', $1) on conflict (key) do update set value = excluded.value, updated_at = now()", [nextId]);
      return { ok: true, action: "season-rolled", completedSeasonId: season.id, activeSeasonId: nextId, draftLocksAt: nextWindow.lockedAt, seasonEndsAt: nextWindow.closesAt };
    });
  });
}
