"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {DRAFT_BUDGET, priceForRank, serializePicks, restorePicks} from "../../lib/budget-draft";
import top50Snapshot from "../../data/pumpfun-one-month-top50.json";

type SnapshotTuple = [number, string, string, number, string];
type Player = {
  id: string;
  rank: number;
  wallet: string;
  display_name: string | null;
  profile_url?: string | null;
  avatar_url?: string | null;
  pnl_usd: number;
};
type PlayerResponse = { live?: boolean; players?: Player[]; snapshotAt?: string | null; source?: string };
type Picks = Record<number, number>;

const BUDGET = DRAFT_BUDGET;
const STORAGE_KEY = "pump-fantasy-budget-lab-v2";
const BAND_NAMES = ["Top 10", "11–20", "21–30", "31–40", "41–50"];
const fallbackPlayers: Player[] = (top50Snapshot.players as SnapshotTuple[]).map(([rank, wallet, name, pnl, avatar]) => ({
  id: `rank-${String(rank).padStart(2, "0")}`,
  rank,
  wallet,
  display_name: name,
  profile_url: `https://pump.fun/profile/${wallet}`,
  avatar_url: avatar,
  pnl_usd: pnl,
}));

function shortWallet(wallet: string) {
  return `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;
}

export function BudgetDraftLab() {
  const [players, setPlayers] = useState<Player[]>(fallbackPlayers);
  const [snapshotAt, setSnapshotAt] = useState<string | null>((top50Snapshot as { snapshotAt: string }).snapshotAt);
  const [liveFeed, setLiveFeed] = useState(false);
  const [picks, setPicks] = useState<Picks>({});
  const [hydrated, setHydrated] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [feedbackError, setFeedbackError] = useState(false);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    let saved: unknown;
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch { /* Invalid local state starts empty. */ }
    async function loadField() {
      let field = fallbackPlayers;
      let timestamp: string | null = top50Snapshot.snapshotAt;
      let live = false;
      try {
        const response = await fetch("/api/players", { cache: "no-store", signal: controller.signal });
        const result: PlayerResponse | null = response.ok ? await response.json() : null;
        if (Array.isArray(result?.players) && result.players.length === 50) {
          field = result.players;
          timestamp = result.snapshotAt ?? null;
          live = result.live === true;
        }
      } catch { /* Keep the dated snapshot when the live feed is unavailable. */ }
      finally { window.clearTimeout(timeout); }
      if (!active) return;
      setPlayers(field);
      setSnapshotAt(timestamp);
      setLiveFeed(live);
      setPicks(restorePicks(saved, field));
      setHydrated(true);
    }
    void loadField();
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
  }, []);

  useEffect(() => {
    if (hydrated) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(serializePicks(picks, players)));
      } catch {
        // The draft still works for this visit when browser storage is unavailable.
      }
    }
  }, [hydrated, picks, players]);

  const selectedPlayers = useMemo(() => Object.entries(picks)
    .map(([band, rank]) => ({ band: Number(band), player: players.find((item) => item.rank === rank) }))
    .filter((entry): entry is { band: number; player: Player } => Boolean(entry.player)), [picks, players]);
  const spent = selectedPlayers.reduce((sum, entry) => sum + priceForRank(entry.player.rank), 0);
  const remaining = BUDGET - spent;

  function togglePick(band: number, player: Player) {
    const next = { ...picks };
    if (next[band] === player.rank) {
      delete next[band];
      setPicks(next);
      setFeedback(`${player.display_name || shortWallet(player.wallet)} removed from your lineup.`);
      setFeedbackError(false);
      return;
    }

    next[band] = player.rank;
    const nextCost = Object.values(next).reduce((sum, rank) => sum + priceForRank(rank), 0);
    if (nextCost > BUDGET) {
      setFeedback(`That lineup costs ${nextCost} credits. Drop ${nextCost - BUDGET} credits to fit the cap.`);
      setFeedbackError(true);
      return;
    }
    setPicks(next);
    setFeedback(`${player.display_name || shortWallet(player.wallet)} drafted for ${priceForRank(player.rank)} credits.`);
    setFeedbackError(false);
  }

  const scoreDate = snapshotAt ? new Date(snapshotAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Updating";

  return (
    <main className="budget-lab">
      <header className="budget-topbar">
        <Link className="budget-brand" href="/" aria-label="PumpFun Fantasy home"><span className="budget-brand-mark">↗</span><span>PUMPFUN FANTASY <small> / DRAFT LAB</small></span></Link>
        <nav aria-label="Draft lab navigation"><a href="/draft">Main draft</a><Link href="/">Home</Link></nav>
      </header>

      <div className="budget-shell">
        <section className="budget-hero">
          <div>
            <div className="budget-kicker">SALARY CAP MODE · SIMULATION</div>
            <h1>Draft five traders.<br /><span>100 credits. Your call.</span></h1>
            <p>Draft one trader from each rank band. The top of the board costs more, so every lineup has to make a call on where to spend.</p>
          </div>
          <div className="budget-cap-card"><span>YOUR TOTAL BUDGET</span><strong>100 <em>CREDITS</em></strong><small>Game credits only. No token or SOL spending.</small></div>
        </section>

        <div className="budget-notice"><b>PREVIEW MODE</b><span>This salary-cap draft is separate from the live contest. Your picks stay in this browser and cannot be submitted for prizes.</span></div>

        <div className="budget-layout">
          <section className="budget-field" aria-label="Choose traders for your budget draft">
            <div className="budget-field-head"><div><div className="budget-section-label">THE PLAYER MARKET</div><h2>Five bands. One cap.</h2></div><div className="budget-feed-state">{liveFeed ? "LIVE PUMP.FUN FIELD" : "SAVED FIELD SNAPSHOT"}<br />AS OF {scoreDate.toUpperCase()}</div></div>
            {BAND_NAMES.map((bandName, band) => {
              const bandPlayers = players.filter((player) => Math.floor((player.rank - 1) / 10) === band);
              return (
                <article className="budget-band" key={bandName}>
                  <div className="budget-band-head"><div><i>0{band + 1}</i><b>{bandName}</b></div><small>SELECT ONE · {priceForRank(band * 10 + 1)}–{priceForRank(band * 10 + 10)} CREDITS</small></div>
                  <div className="budget-band-players">
                    {bandPlayers.map((player) => {
                      const selected = picks[band] === player.rank;
                      return (
                        <button className={`budget-player ${selected ? "selected" : ""}`} type="button" aria-pressed={selected} disabled={!hydrated} key={player.id} onClick={() => togglePick(band, player)}>
                          <span className="budget-player-rank">#{player.rank}</span>
                          <Image src={player.avatar_url || "/players/personas/curveghost.svg"} alt="" width={40} height={40} unoptimized />
                          <span className="budget-player-identity"><b>{player.display_name || shortWallet(player.wallet)}</b><small>{shortWallet(player.wallet)} · ${player.pnl_usd.toLocaleString("en-US", { maximumFractionDigits: 0 })} 1M PNL</small></span>
                          <strong className="budget-player-cost">{priceForRank(player.rank)}<small>CREDITS</small></strong>
                        </button>
                      );
                    })}
                  </div>
                </article>
              );
            })}
            <p className="budget-footnote">Credit prices are an experimental game rule based only on current rank. They are not dollar values, token prices, odds, or estimates of future performance. Leaderboard PnL is a historical snapshot.</p>
          </section>

          <aside className="budget-lineup">
            <div className="budget-lineup-head"><div><span>YOUR LINEUP</span><b>{selectedPlayers.length} / 5 drafted</b></div><em>{remaining < 0 ? "OVER CAP" : "IN BUDGET"}</em></div>
            <div className="budget-gauge"><div className="budget-gauge-row"><span>SPENT</span><strong>{spent} / {BUDGET} CREDITS</strong></div><div className="budget-gauge-track"><i className={remaining < 0 ? "over" : ""} style={{ width: `${Math.min(100, (spent / BUDGET) * 100)}%` }} /></div></div>
            <div className="budget-squad">
              {[0, 1, 2, 3, 4].map((band) => {
                const player = players.find((item) => item.rank === picks[band]);
                return <div className="budget-squad-slot" key={band}><i>0{band + 1}</i><span><b>{player?.display_name || "Open pick"}</b><small>{player ? `RANK #${player.rank} · ${BAND_NAMES[band].toUpperCase()}` : `${BAND_NAMES[band].toUpperCase()} BAND`}</small></span><strong>{player ? `${priceForRank(player.rank)} CR` : "--"}</strong></div>;
              })}
            </div>
            {feedback && <p className={`budget-feedback ${feedbackError ? "error" : ""}`} role="status">{feedback}</p>}
            <button className="budget-clear" type="button" onClick={() => { setPicks({}); setFeedback("Lineup cleared. Build a new five under the cap."); setFeedbackError(false); }} disabled={selectedPlayers.length === 0}>Clear lineup</button>
          </aside>
        </div>
        <a className="budget-back" href="/draft">← Back to the main draft</a>
      </div>
    </main>
  );
}
