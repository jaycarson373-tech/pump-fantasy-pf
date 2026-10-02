"use client";

import {
  useConnect,
  useConnectedWallet,
  useDisconnect,
  useWalletStatus,
  useWallets,
} from "@solana/kit-plugin-wallet/react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { solanaClient } from "./solana-client";

type ScorePeriod = "daily" | "weekly";
type TournamentType = "weekly" | "monthly";
type Kol = {
  id: string;
  name: string;
  handle: string;
  category: string;
  daily: number;
  weekly: number;
  winRate: number;
  rank: number;
  accent: string;
  picks: string;
};

const PF_REQUIRED = 1_000_000;
const PF_MINT = process.env.NEXT_PUBLIC_PF_MINT_ADDRESS;
const RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
  "https://api.mainnet-beta.solana.com";

const KOLS: Kol[] = [
  { id: "mint", name: "Mint Chaser", handle: "@mintchaser", category: "Early calls", daily: 18.4, weekly: 44.7, winRate: 71, rank: 1, accent: "mint", picks: "82K" },
  { id: "curve", name: "Curve Caller", handle: "@curvecaller", category: "Momentum", daily: 12.8, weekly: 38.2, winRate: 68, rank: 2, accent: "blue", picks: "61K" },
  { id: "pepe", name: "Pepe Pilot", handle: "@pepepilot", category: "Memes", daily: 9.3, weekly: 29.5, winRate: 64, rank: 3, accent: "violet", picks: "55K" },
  { id: "sendor", name: "The Sendor", handle: "@sendor", category: "High velocity", daily: 7.9, weekly: 23.4, winRate: 61, rank: 4, accent: "orange", picks: "49K" },
  { id: "green", name: "Green Wick", handle: "@greenwick", category: "Chart reader", daily: 6.1, weekly: 19.8, winRate: 59, rank: 5, accent: "lime", picks: "44K" },
  { id: "orbit", name: "Orbit", handle: "@orbitcalls", category: "Solana native", daily: 4.6, weekly: 16.1, winRate: 57, rank: 6, accent: "pink", picks: "37K" },
  { id: "chef", name: "Chain Chef", handle: "@chainchef", category: "Narratives", daily: 3.2, weekly: 12.6, winRate: 55, rank: 7, accent: "yellow", picks: "33K" },
  { id: "cap", name: "Cap Finder", handle: "@capfinder", category: "Micro caps", daily: 2.7, weekly: 10.4, winRate: 54, rank: 8, accent: "cyan", picks: "29K" },
  { id: "jpeg", name: "J Peg", handle: "@jpegged", category: "Culture", daily: -0.8, weekly: 7.1, winRate: 52, rank: 9, accent: "red", picks: "26K" },
  { id: "saint", name: "Degen Saint", handle: "@degensaint", category: "Contrarian", daily: -2.4, weekly: 3.8, winRate: 49, rank: 10, accent: "gray", picks: "21K" },
  { id: "mike", name: "Microcap Mike", handle: "@microcapmike", category: "New pairs", daily: -4.1, weekly: -2.3, winRate: 47, rank: 11, accent: "navy", picks: "18K" },
  { id: "sorc", name: "SOL Sorcerer", handle: "@solsorcerer", category: "Swing trades", daily: -6.5, weekly: -8.9, winRate: 44, rank: 12, accent: "lavender", picks: "15K" },
];

const LEADERBOARD = [
  { rank: 1, player: "chasing.sol", score: 122.8, prize: "84.2 SOL", roster: ["mint", "curve", "pepe"] },
  { rank: 2, player: "banger", score: 116.4, prize: "42.1 SOL", roster: ["mint", "sendor", "orbit"] },
  { rank: 3, player: "7vYh…pump", score: 108.9, prize: "25.3 SOL", roster: ["curve", "pepe", "green"] },
  { rank: 4, player: "smartmoney", score: 96.2, prize: "16.8 SOL", roster: ["mint", "chef", "cap"] },
  { rank: 5, player: "trenches.sol", score: 88.7, prize: "12.6 SOL", roster: ["sendor", "orbit", "jpeg"] },
];

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2);
}

function formatScore(score: number) {
  return `${score >= 0 ? "+" : ""}${score.toFixed(1)}%`;
}

function shortAddress(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

async function getPfBalance(owner: string): Promise<number> {
  if (!PF_MINT) return PF_REQUIRED;
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTokenAccountsByOwner",
      params: [owner, { mint: PF_MINT }, { encoding: "jsonParsed" }],
    }),
  });
  if (!response.ok) throw new Error("Balance check unavailable");
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error.message ?? "Balance check failed");
  return payload.result.value.reduce((total: number, account: { account: { data: { parsed: { info: { tokenAmount: { uiAmountString: string } } } } } }) => {
    return total + Number(account.account.data.parsed.info.tokenAmount.uiAmountString);
  }, 0);
}

const subscribeHydration = () => () => {};
const clientHydrated = () => true;
const serverHydrated = () => false;

function WalletControl() {
  const hydrated = useSyncExternalStore(subscribeHydration, clientHydrated, serverHydrated);
  const wallets = useWallets(solanaClient);
  const detectedWallet = useConnectedWallet(solanaClient);
  const detectedStatus = useWalletStatus(solanaClient);
  // Wallet discovery is browser-only. Keep the initial render identical to SSR.
  const connected = hydrated ? detectedWallet : undefined;
  const status = hydrated ? detectedStatus : "pending";
  const connect = useConnect(solanaClient);
  const disconnect = useDisconnect(solanaClient);
  const [open, setOpen] = useState(false);

  return (
    <div className="wallet-control">
      <button
        className={`wallet-button ${connected ? "connected" : ""}`}
        onClick={() => setOpen((value) => !value)}
        disabled={status === "pending" || status === "reconnecting"}
      >
        <span className="wallet-dot" />
        {connected
          ? shortAddress(connected.account.address)
          : status === "pending" || status === "reconnecting"
            ? "Finding wallets"
            : "Connect wallet"}
        <span className="chevron">⌄</span>
      </button>
      {open && (
        <>
          <button className="modal-scrim" aria-label="Close wallet menu" onClick={() => setOpen(false)} />
          <div className="wallet-menu">
            <div className="wallet-menu-head">
              <div>
                <span>Solana wallet</span>
                <strong>{connected ? "Wallet connected" : "Choose a wallet"}</strong>
              </div>
              <button aria-label="Close" onClick={() => setOpen(false)}>×</button>
            </div>
            {connected ? (
              <div className="wallet-connected-card">
                <span className="wallet-big-dot" />
                <div><b>{connected.wallet.name}</b><small>{connected.account.address}</small></div>
                <button onClick={() => disconnect.dispatch()} disabled={disconnect.isRunning}>Disconnect</button>
              </div>
            ) : wallets.length ? (
              <div className="wallet-options">
                {wallets.map((wallet) => (
                  <button key={wallet.name} onClick={() => { connect.dispatch(wallet); setOpen(false); }} disabled={connect.isRunning}>
                    <span>{initials(wallet.name)}</span>
                    <b>{wallet.name}</b>
                    <i>Connect →</i>
                  </button>
                ))}
              </div>
            ) : (
              <div className="no-wallet">
                <span>◫</span>
                <b>No Solana wallet found</b>
                <p>Install Phantom, Solflare, or Backpack, then refresh this page.</p>
              </div>
            )}
            {connect.error ? (
              <p className="wallet-error">
                {connect.error instanceof Error ? connect.error.message : "Wallet connection failed."}
              </p>
            ) : null}
            <small className="wallet-safety">Connecting is free. PF never asks for your seed phrase.</small>
          </div>
        </>
      )}
    </div>
  );
}

export function FantasyApp() {
  const connected = useConnectedWallet(solanaClient);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All KOLs");
  const [scorePeriod, setScorePeriod] = useState<ScorePeriod>("weekly");
  const [tournament, setTournament] = useState<TournamentType>("weekly");
  const [locked, setLocked] = useState(false);
  const [toast, setToast] = useState("");
  const [loadedKey, setLoadedKey] = useState("");
  const [pfBalance, setPfBalance] = useState<number | null>(null);
  const [balanceState, setBalanceState] = useState<"idle" | "loading" | "ready" | "error">("idle");

  const address = connected?.account.address ?? "guest";
  const rosterKey = `pump-fantasy-roster:${address}:${tournament}`;
  const lockKey = `pump-fantasy-locked:${address}:${tournament}`;

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(rosterKey);
      const savedLock = window.localStorage.getItem(lockKey);
      // Hydrate the device-local roster whenever the wallet or tournament changes.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelected(saved ? JSON.parse(saved) : []);
      setLocked(savedLock === "true");
    } catch {
      setSelected([]);
      setLocked(false);
    }
    setLoadedKey(rosterKey);
  }, [rosterKey, lockKey]);

  useEffect(() => {
    if (loadedKey !== rosterKey) return;
    window.localStorage.setItem(rosterKey, JSON.stringify(selected));
  }, [selected, rosterKey, loadedKey]);

  useEffect(() => {
    if (!connected) {
      // Reset the wallet-scoped eligibility state after disconnection.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPfBalance(null);
      setBalanceState("idle");
      return;
    }
    let active = true;
    setBalanceState("loading");
    getPfBalance(connected.account.address)
      .then((balance) => {
        if (!active) return;
        setPfBalance(balance);
        setBalanceState("ready");
      })
      .catch(() => {
        if (!active) return;
        setPfBalance(null);
        setBalanceState("error");
      });
    return () => { active = false; };
  }, [connected]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const categories = ["All KOLs", "Early calls", "Momentum", "Memes", "Micro caps"];
  const filteredKols = useMemo(() => {
    const query = search.trim().toLowerCase();
    return KOLS.filter((kol) => {
      const matchesQuery = !query || `${kol.name} ${kol.handle} ${kol.category}`.toLowerCase().includes(query);
      const matchesFilter = filter === "All KOLs" || kol.category === filter;
      return matchesQuery && matchesFilter;
    });
  }, [search, filter]);

  const selectedKols = selected.map((id) => KOLS.find((kol) => kol.id === id)).filter(Boolean) as Kol[];
  const projectedScore = selectedKols.reduce((sum, kol) => sum + kol[tournament === "weekly" ? "weekly" : "daily"], 0);
  const isEligible = !PF_MINT || (pfBalance ?? 0) >= PF_REQUIRED;

  function toggleKol(id: string) {
    if (locked) {
      setToast("This roster is locked for the current tournament.");
      return;
    }
    if (selected.includes(id)) {
      setSelected((current) => current.filter((item) => item !== id));
      return;
    }
    if (selected.length === 5) {
      setToast("Your roster is full. Remove one KOL to make another pick.");
      return;
    }
    setSelected((current) => [...current, id]);
  }

  function submitRoster() {
    if (!connected) {
      setToast("Connect a Solana wallet before locking your roster.");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (selected.length !== 5) {
      setToast(`Pick ${5 - selected.length} more KOL${5 - selected.length === 1 ? "" : "s"}.`);
      return;
    }
    if (balanceState === "loading") {
      setToast("Checking your PF balance…");
      return;
    }
    if (!isEligible) {
      setToast("This wallet needs 1,000,000 PF to enter.");
      return;
    }
    window.localStorage.setItem(lockKey, "true");
    setLocked(true);
    setToast(`${tournament === "weekly" ? "Weekly" : "Monthly"} roster locked. You’re in.`);
  }

  return (
    <main className="app-shell">
      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}

      <header className="topbar" id="top">
        <a className="pf-brand" href="#top" aria-label="Pump Fantasy home">
          <span className="pf-mark"><i /><i /></span>
          <strong>Pump Fantasy</strong>
          <em>PF</em>
        </a>
        <nav aria-label="Primary">
          <a className="active" href="#play">Play</a>
          <a href="#tournaments">Tournaments</a>
          <a href="#leaderboard">Leaderboard</a>
          <a href="#docs">Docs</a>
        </nav>
        <WalletControl />
      </header>

      <section className="hero-light">
        <div className="hero-badge"><i /> Entries open · Season 01</div>
        <h1>Draft the culture.<br /><span>Own the week.</span></h1>
        <p>Pick five pump.fun KOLs. Their performance is your score. Climb the leaderboard and compete for creator-fee-funded prizes.</p>
        <div className="hero-ctas">
          <a className="primary-cta" href="#play">Build your roster <span>↘</span></a>
          <a className="secondary-cta" href="#tournaments">View tournaments <span>→</span></a>
        </div>
        <div className="live-strip">
          <div><span>LIVE PRIZE POOL</span><strong>428.6 SOL</strong><small>↗ 12.4% this week</small></div>
          <div><span>ACTIVE PLAYERS</span><strong>2,847</strong><small>512 entered today</small></div>
          <div><span>PF TO ENTER</span><strong>1,000,000</strong><small>No entry fee</small></div>
          <div className="live-chart" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></div>
        </div>
      </section>

      <section className="tournament-section" id="tournaments">
        <div className="section-topline">
          <div><span className="section-label">Live tournaments</span><h2>Choose your arena</h2></div>
          <div className="segmented" role="group" aria-label="Tournament type">
            <button className={tournament === "weekly" ? "active" : ""} onClick={() => setTournament("weekly")}>Weekly</button>
            <button className={tournament === "monthly" ? "active" : ""} onClick={() => setTournament("monthly")}>Monthly</button>
          </div>
        </div>
        <div className="tournament-grid">
          <article className="tournament-card featured">
            <div className="card-top"><span><i /> Entries open</span><b>{tournament === "weekly" ? "WEEK 08" : "AUGUST"}</b></div>
            <div className="tournament-graphic"><span>PF</span><i className="ring r1" /><i className="ring r2" /></div>
            <h3>{tournament === "weekly" ? "The Green Candle" : "The Big Monthly"}</h3>
            <p>{tournament === "weekly" ? "7-day performance sprint" : "30-day season championship"}</p>
            <div className="card-stats"><div><span>PRIZE</span><b>{tournament === "weekly" ? "428.6 SOL" : "1,842 SOL"}</b></div><div><span>PLAYERS</span><b>{tournament === "weekly" ? "2,847" : "8,109"}</b></div><div><span>LOCKS</span><b>{tournament === "weekly" ? "18h 42m" : "4d 18h"}</b></div></div>
            <a href="#play">Enter tournament <span>→</span></a>
          </article>
          <article className="tournament-card upcoming">
            <div className="card-top"><span>Upcoming</span><b>{tournament === "weekly" ? "WEEK 09" : "SEPTEMBER"}</b></div>
            <div className="mini-podium"><i /><i /><i /></div>
            <h3>{tournament === "weekly" ? "Trenches Cup" : "Creator League"}</h3>
            <p>{tournament === "weekly" ? "Opens in 5 days" : "Opens August 28"}</p>
            <div className="card-stats"><div><span>SEED POOL</span><b>{tournament === "weekly" ? "125 SOL" : "750 SOL"}</b></div><div><span>DURATION</span><b>{tournament === "weekly" ? "7 days" : "30 days"}</b></div></div>
            <button onClick={() => setToast("Reminder set on this device.")}>Remind me <span>＋</span></button>
          </article>
        </div>
      </section>

      <section className="draft-section" id="play">
        <div className="draft-heading">
          <div><span className="section-label">Build your roster</span><h2>Pick your five.</h2><p>Select exactly five KOLs before entries lock. You can edit your team until you submit it.</p></div>
          <div className="draft-progress"><span>{selected.length} / 5 selected</span><div>{[0,1,2,3,4].map((index) => <i className={index < selected.length ? "filled" : ""} key={index} />)}</div></div>
        </div>

        <div className="draft-layout">
          <div className="kol-browser">
            <div className="kol-toolbar">
              <label className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search KOLs" /></label>
              <div className="score-toggle"><button className={scorePeriod === "daily" ? "active" : ""} onClick={() => setScorePeriod("daily")}>24H</button><button className={scorePeriod === "weekly" ? "active" : ""} onClick={() => setScorePeriod("weekly")}>7D</button></div>
            </div>
            <div className="filter-row">
              {categories.map((category) => <button className={filter === category ? "active" : ""} onClick={() => setFilter(category)} key={category}>{category}</button>)}
            </div>
            <div className="kol-list-head"><span>KOL</span><span>WIN RATE</span><span>{scorePeriod === "daily" ? "24H SCORE" : "7D SCORE"}</span><span /></div>
            <div className="kol-list">
              {filteredKols.map((kol) => {
                const isSelected = selected.includes(kol.id);
                const score = kol[scorePeriod];
                return (
                  <button className={`kol-row ${isSelected ? "selected" : ""}`} onClick={() => toggleKol(kol.id)} key={kol.id} aria-pressed={isSelected}>
                    <span className="kol-person"><i className={`kol-avatar ${kol.accent}`}>{initials(kol.name)}</i><span><b>{kol.name}</b><small>{kol.handle} · {kol.category}</small></span></span>
                    <span className="win-rate"><b>{kol.winRate}%</b><i><em style={{ width: `${kol.winRate}%` }} /></i></span>
                    <strong className={score >= 0 ? "positive" : "negative"}>{formatScore(score)}</strong>
                    <span className="pick-action">{isSelected ? "✓" : "+"}</span>
                  </button>
                );
              })}
            </div>
            {!filteredKols.length && <div className="empty-state">No KOLs match that search.</div>}
          </div>

          <aside className="roster-panel">
            <div className="roster-panel-head"><div><span>YOUR ROSTER</span><b>{tournament === "weekly" ? "The Green Candle" : "The Big Monthly"}</b></div><em>{locked ? "LOCKED" : "DRAFT"}</em></div>
            <div className="roster-slots">
              {[0,1,2,3,4].map((slot) => {
                const kol = selectedKols[slot];
                return kol ? (
                  <div className="roster-slot filled" key={kol.id}>
                    <i className={`kol-avatar ${kol.accent}`}>{initials(kol.name)}</i>
                    <span><b>{kol.name}</b><small>{formatScore(kol.weekly)} this week</small></span>
                    {!locked && <button onClick={() => toggleKol(kol.id)} aria-label={`Remove ${kol.name}`}>×</button>}
                  </div>
                ) : (
                  <div className="roster-slot" key={slot}><i>{slot + 1}</i><span><b>Empty slot</b><small>Pick a KOL from the list</small></span></div>
                );
              })}
            </div>
            <div className="projection"><span>PROJECTED SCORE</span><strong>{formatScore(projectedScore)}</strong><small>Based on current {tournament === "weekly" ? "7-day" : "24-hour"} form</small></div>
            <div className={`eligibility ${connected ? "has-wallet" : ""}`}>
              <span className="eligibility-icon">◆</span>
              <div><b>{connected ? (balanceState === "loading" ? "Checking PF balance" : isEligible ? "Wallet eligible" : "More PF required") : "1M PF required"}</b><small>{connected ? (PF_MINT ? `${(pfBalance ?? 0).toLocaleString()} PF detected` : "Preview mode · mint address not set") : "Connect a wallet to verify"}</small></div>
            </div>
            <button className="lock-button" onClick={submitRoster} disabled={locked}>
              {locked ? "Roster locked ✓" : connected ? `Lock ${selected.length}/5 picks` : "Connect wallet to enter"}
              {!locked && <span>→</span>}
            </button>
            <small className="no-signature">No transaction or wallet signature is required to draft.</small>
          </aside>
        </div>
      </section>

      <section className="leaderboard-section-light" id="leaderboard">
        <div className="section-topline">
          <div><span className="section-label">Live leaderboard</span><h2>The week&apos;s sharpest rosters</h2></div>
          <div className="live-clock"><i /> 18:42:09 remaining</div>
        </div>
        <div className="leaderboard-table">
          <div className="lb-head"><span>RANK / PLAYER</span><span>TOP KOLS</span><span>SCORE</span><span>LIVE PRIZE</span></div>
          {LEADERBOARD.map((row) => (
            <div className="lb-row" key={row.rank}>
              <div className="lb-player"><strong>{String(row.rank).padStart(2, "0")}</strong><i>{row.player[0].toUpperCase()}</i><b>{row.player}</b></div>
              <div className="lb-roster">{row.roster.map((id) => { const kol = KOLS.find((item) => item.id === id)!; return <i className={`kol-avatar ${kol.accent}`} key={id}>{initials(kol.name)}</i>; })}<span>+2</span></div>
              <strong className="positive">+{row.score}%</strong>
              <b>{row.prize}</b>
            </div>
          ))}
        </div>
      </section>

      <section className="how-section" id="docs">
        <div className="how-heading"><span className="section-label">How it works</span><h2>Simple by design.</h2></div>
        <div className="how-grid">
          <article><span>01</span><i className="how-icon">◆</i><h3>Hold PF</h3><p>Keep at least 1,000,000 PF in your connected wallet when the tournament snapshot is taken.</p></article>
          <article><span>02</span><i className="how-icon">＋5</i><h3>Draft KOLs</h3><p>Pick five tracked voices before the lock. Their public calls and performance become your roster.</p></article>
          <article><span>03</span><i className="how-icon">↗</i><h3>Score daily</h3><p>Daily scores show short-term form. Weekly and monthly scores decide tournament standings.</p></article>
          <article><span>04</span><i className="how-icon">★</i><h3>Win the pool</h3><p>The highest combined roster scores share prizes funded by PF creator fees.</p></article>
        </div>
        <div className="docs-note">
          <div><span>SCORING MODEL</span><h3>Transparent inputs. One clear score.</h3></div>
          <p>KOL performance is normalized across tracked public calls, entry timing, realized results, and drawdown. Sample scores are shown in this frontend build; connect a live scoring/indexing source before launch.</p>
        </div>
      </section>

      <section className="closing-cta">
        <span>PF</span>
        <div><p>Season 01 · Entries open</p><h2>Your five.<br />Your conviction.</h2><a href="#play">Build a roster <i>→</i></a></div>
      </section>

      <footer>
        <a className="pf-brand" href="#top"><span className="pf-mark"><i /><i /></span><strong>Pump Fantasy</strong><em>PF</em></a>
        <p>Fantasy KOL tournaments for the pump.fun community.</p>
        <div><a href="#play">Play</a><a href="#tournaments">Tournaments</a><a href="#docs">Docs</a></div>
        <small>Independent product concept. Not affiliated with or endorsed by pump.fun. Sample KOLs and scores are for demonstration until a live indexing source is configured. Crypto assets are risky; nothing here is financial advice.</small>
      </footer>
    </main>
  );
}
