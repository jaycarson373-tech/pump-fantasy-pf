"use client";

import "./disposable-stack-polyfill";
import Image from "next/image";
import {
  useConnect,
  useConnectedWallet,
  useDisconnect,
  useSignMessage,
  useWalletStatus,
  useWallets,
} from "@solana/kit-plugin-wallet/react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { solanaClient } from "./solana-client";
import top50Snapshot from "../data/pumpfun-one-month-top50.json";

const subscribeHydration = () => () => {};
const clientHydrated = () => true;
const serverHydrated = () => false;
const DRAFT_ROUNDS = ["TOP 10", "11–20", "21–30", "31–40", "41–50"];
const FEATURED_KOLS = [
  { name: "chairman", image: "/players/featured/chairman.png" },
  { name: "thedetective", image: "/players/featured/thedetective.png" },
  { name: "cap", image: "/players/featured/cap.png" },
  { name: "zinc", image: "/players/featured/zinc.png" },
  { name: "limfork", image: "/players/featured/limfork.png" },
];
const CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_FANTASY_CA || process.env.NEXT_PUBLIC_PF_CA || "51MVoyg5tEPxFMLWsojiz3gnN35nz6gPKzaGqNMEpump").trim();
const DRAFT_STORAGE_KEY = "pump-fantasy-five-pick-draft-v1";
type SnapshotTuple = [number, string, string, number, string];

function shortAddress(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

type AuthState = { configured: boolean; authenticated: boolean; eligible: boolean; wallet?: string; balance?: string; minimumTokens?: string };
type SeasonPhase = "unconfigured" | "inactive" | "scheduled" | "draft" | "live" | "complete" | "misconfigured";
type SeasonState = { configured: boolean; seasonConfigured: boolean; phase: SeasonPhase; schedule?: { opensAt: string | null; lockedAt: string | null; closesAt: string | null } | null };
type BoardPlayer = { id: string; rank: number; wallet: string; display_name: string | null; profile_url: string | null; avatar_url: string | null; pnl_usd: number; contest_change_usd: number | null };

function countdownLabel(target: string | null | undefined, now: number) {
  if (!target || !now) return null;
  const remaining = Math.max(0, Date.parse(target) - now);
  if (!Number.isFinite(remaining)) return null;
  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return `${days ? `${days}d ` : ""}${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
}
const snapshotPlayers: BoardPlayer[] = (top50Snapshot.players as SnapshotTuple[]).map(([rank, wallet, displayName, pnl, avatar]) => ({
  id: `rank-${String(rank).padStart(2, "0")}`,
  rank,
  wallet,
  display_name: displayName,
  profile_url: `https://pump.fun/profile/${wallet}`,
  avatar_url: avatar,
  pnl_usd: pnl,
  contest_change_usd: null,
}));

function ProjectHeaderLinks() {
  const [copied, setCopied] = useState(false);

  async function copyContractAddress() {
    if (!CONTRACT_ADDRESS) return;
    try {
      await navigator.clipboard.writeText(CONTRACT_ADDRESS);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="header-actions">
      <a className="social-x-button" href="https://x.com/PumpFunFantasy_" target="_blank" rel="noreferrer" aria-label="PumpFun Fantasy on X" title="X">
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M18.901 1.153h3.68l-8.04 9.19 9.46 12.5h-7.406l-5.8-7.584-6.637 7.584h-3.684l8.6-9.83L.004 1.153h7.594l5.242 6.932 6.06-6.932Zm-1.29 19.49h2.039L6.486 3.238H4.298L17.61 20.643Z" /></svg>
      </a>
      <button className="ca-copy-button" onClick={copyContractAddress} disabled={!CONTRACT_ADDRESS} aria-label={CONTRACT_ADDRESS ? "Copy contract address" : "Contract address not set"} title={CONTRACT_ADDRESS ? "Copy contract address" : "Contract address not set"}>
        <span className="ca-label">CA:</span>{CONTRACT_ADDRESS ? <code>{shortAddress(CONTRACT_ADDRESS)}</code> : null}{copied ? <span className="ca-copied">COPIED</span> : null}
      </button>
      {copied ? <span className="copy-status" role="status">CA COPIED</span> : null}
    </div>
  );
}

function WalletControl({ onAuthChange }: { onAuthChange: (state: AuthState) => void }) {
  const hydrated = useSyncExternalStore(subscribeHydration, clientHydrated, serverHydrated);
  const wallets = useWallets(solanaClient);
  const detectedWallet = useConnectedWallet(solanaClient);
  const detectedStatus = useWalletStatus(solanaClient);
  const connected = hydrated ? detectedWallet : undefined;
  const status = hydrated ? detectedStatus : "pending";
  const connect = useConnect(solanaClient);
  const disconnect = useDisconnect(solanaClient);
  const signMessage = useSignMessage(solanaClient);
  const [open, setOpen] = useState(false);
  const [auth, setAuth] = useState<AuthState>({ configured: false, authenticated: false, eligible: false });
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const address = connected?.account.address;

  useEffect(() => {
    if (!address) {
      return;
    }
    let active = true;
    fetch("/api/auth/session", { cache: "no-store" }).then((response) => response.json()).then((result: AuthState) => {
      if (active && result.authenticated && result.wallet === address) {
        setAuth(result);
        onAuthChange(result);
      } else if (active) {
        const next = { configured: result.configured, authenticated: false, eligible: false };
        setAuth(next);
        onAuthChange(next);
      }
    }).catch(() => {});
    return () => { active = false; };
  }, [address, onAuthChange]);

  async function verifyWallet() {
    if (!address) return;
    setAuthBusy(true);
    setAuthError("");
    try {
      const challengeResponse = await fetch("/api/auth/challenge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet: address }) });
      const challenge = await challengeResponse.json();
      if (!challengeResponse.ok) throw new Error(challenge.error || "Could not create sign-in challenge.");
      const message = new TextEncoder().encode(challenge.message);
      const signature = await signMessage.dispatchAsync(message);
      const signatureBase64 = btoa(String.fromCharCode(...signature));
      const verifyResponse = await fetch("/api/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ wallet: address, message: challenge.message, signature: signatureBase64 }) });
      const result = await verifyResponse.json();
      if (!verifyResponse.ok) throw new Error(result.error || "Wallet verification failed.");
      const next = { configured: true, authenticated: true, eligible: Boolean(result.eligible), wallet: result.wallet, balance: result.balance?.displayBalance, minimumTokens: result.balance?.minimumTokens };
      setAuth(next);
      onAuthChange(next);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Wallet verification failed.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function disconnectWallet() {
    await fetch("/api/auth/session", { method: "DELETE" }).catch(() => {});
    await disconnect.dispatch();
    const next = { configured: false, authenticated: false, eligible: false };
    setAuth(next);
    onAuthChange(next);
  }

  return (
    <div className="wallet-control">
      <button
        className={`wallet-button ${connected ? "connected" : ""}`}
        onClick={() => setOpen((value) => !value)}
        disabled={status === "pending" || status === "reconnecting"}
      >
        <span className="wallet-dot" />
        {connected ? shortAddress(connected.account.address) : status === "pending" || status === "reconnecting" ? "Finding wallets" : "Connect wallet"}
        <span className="chevron">⌄</span>
      </button>
      {open && (
        <>
          <button className="modal-scrim" aria-label="Close wallet menu" onClick={() => setOpen(false)} />
          <div className="wallet-menu">
            <div className="wallet-menu-head">
              <div><span>Solana wallet</span><strong>{connected ? "Wallet connected" : "Choose a wallet"}</strong></div>
              <button aria-label="Close" onClick={() => setOpen(false)}>×</button>
            </div>
            {connected ? (
              <>
              <div className="wallet-connected-card">
                <span className="wallet-big-dot" />
                <div><b>{connected.wallet.name}</b><small>{connected.account.address}</small></div>
                <button onClick={disconnectWallet} disabled={disconnect.isRunning}>Disconnect</button>
              </div>
              {auth.authenticated ? <div className={`holder-status ${auth.eligible ? "eligible" : "ineligible"}`}><b>{auth.eligible ? "ELIGIBLE HOLDER" : "HOLDER CHECK FAILED"}</b><span>{auth.balance ?? "Not checked"} $FANTASY · minimum {auth.minimumTokens ?? "not set"}</span></div> : (
                <button className="verify-wallet-button" onClick={verifyWallet} disabled={authBusy || signMessage.isRunning}>{authBusy ? "Verifying wallet…" : auth.configured ? "Sign message · check token balance" : "Verify wallet to enter"}</button>
              )}
              </>
            ) : wallets.length ? (
              <div className="wallet-options">
                {wallets.map((wallet) => (
                  <button key={wallet.name} onClick={() => { connect.dispatch(wallet); setOpen(false); }} disabled={connect.isRunning}>
                    <span>{wallet.name.slice(0, 2).toUpperCase()}</span><b>{wallet.name}</b><i>Connect</i>
                  </button>
                ))}
              </div>
            ) : (
              <div className="no-wallet"><span>◫</span><b>No Solana wallet found</b><p>Install Phantom, Solflare, or Backpack, then refresh this page.</p></div>
            )}
            {connect.error ? <p className="wallet-error">{connect.error instanceof Error ? connect.error.message : "Wallet connection failed."}</p> : null}
            {authError ? <p className="wallet-error">{authError}</p> : null}
            <small className="wallet-safety">Connecting is free. Pump Fantasy never asks for your recovery phrase.</small>
          </div>
        </>
      )}
    </div>
  );
}

export function FantasyApp() {
  const [auth, setAuth] = useState<AuthState>({ configured: false, authenticated: false, eligible: false });
  const [players, setPlayers] = useState<BoardPlayer[]>(snapshotPlayers);
  const [selected, setSelected] = useState<Record<number, number>>({});
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [seasonConfigured, setSeasonConfigured] = useState(false);
  const [season, setSeason] = useState<SeasonState>({ configured: false, seasonConfigured: false, phase: "unconfigured" });
  const [clockNow, setClockNow] = useState(0);
  const [search, setSearch] = useState("");
  const [entryBusy, setEntryBusy] = useState(false);
  const [entryMessage, setEntryMessage] = useState("");
  const [standings, setStandings] = useState<Array<{ wallet: string; score: number | null; scoringReady: boolean }>>([]);
  const [awards, setAwards] = useState<Array<{ id: string; season_id: string; day_number: number; winner_wallet: string | null; score_usd: number | null; prize_lamports: string; status: string; payment_signature: string | null }>>([]);
  const [dailyPrizeLamports, setDailyPrizeLamports] = useState("0");
  const [snapshotAt, setSnapshotAt] = useState<string | null>(null);
  const [leaderboardSource, setLeaderboardSource] = useState("Loading Pump.fun leaderboard");
  const onAuthChange = useCallback((state: AuthState) => setAuth(state), []);

  useEffect(() => {
    let active = true;
    const refreshSeason = async () => {
      const response = await fetch("/api/entry", { cache: "no-store" });
      const body = await response.json() as SeasonState;
      if (!active) return;
      setSeason(body);
      setSeasonConfigured(Boolean(body.seasonConfigured));
    };
    void refreshSeason().catch(() => {});
    const interval = window.setInterval(() => { void refreshSeason().catch(() => {}); }, 15_000);
    return () => { active = false; window.clearInterval(interval); };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setClockNow(Date.now()), 1_000);
    const firstTick = window.setTimeout(() => setClockNow(Date.now()), 0);
    return () => { window.clearInterval(interval); window.clearTimeout(firstTick); };
  }, []);

  useEffect(() => {
    if (draftHydrated || players.length !== 50) return;
    const restored: Record<number, number> = {};
    try {
      const saved = JSON.parse(window.localStorage.getItem(DRAFT_STORAGE_KEY) ?? "{}") as Record<string, unknown>;
      for (let band = 0; band < 5; band += 1) {
        const rank = saved[String(band)];
        if (typeof rank === "number" && Math.floor((rank - 1) / 10) === band && players.some((player) => player.rank === rank)) {
          restored[band] = rank;
        }
      }
    } catch {
      // Ignore unavailable or invalid local storage and start with an empty draft.
    }
    const restoreTimer = window.setTimeout(() => {
      setSelected(restored);
      setDraftHydrated(true);
    }, 0);
    return () => window.clearTimeout(restoreTimer);
  }, [draftHydrated, players]);

  useEffect(() => {
    if (!draftHydrated) return;
    try {
      window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(selected));
    } catch {
      // Drafting remains usable when browser storage is disabled.
    }
  }, [draftHydrated, selected]);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const [playerResponse, standingsResponse] = await Promise.all([
        fetch("/api/players", { cache: "no-store" }),
        fetch("/api/standings", { cache: "no-store" }),
      ]);
      const [playerResult, standingsResult] = await Promise.all([playerResponse.json(), standingsResponse.json()]);
      if (active && Array.isArray(playerResult.players) && playerResult.players.length === 50) {
        setPlayers(playerResult.players ?? []);
        setSnapshotAt(playerResult.snapshotAt ?? top50Snapshot.snapshotAt);
        setLeaderboardSource(playerResult.source ?? (playerResult.live ? "Live Pump.fun 1M leaderboard" : "Dated fallback snapshot"));
      }
      if (active && Array.isArray(standingsResult.standings)) setStandings(standingsResult.standings);
      if (active && Array.isArray(standingsResult.awards)) setAwards(standingsResult.awards);
      if (active && typeof standingsResult.prizeLamports === "string") setDailyPrizeLamports(standingsResult.prizeLamports);
    };
    void refresh().catch(() => {});
    const interval = window.setInterval(() => { void refresh().catch(() => {}); }, 30_000);
    return () => { active = false; window.clearInterval(interval); };
  }, []);

  useEffect(() => {
    let active = true;
    if (!auth.authenticated) {
      return;
    }
    fetch("/api/entry", { cache: "no-store" }).then(async (response) => ({ ok: response.ok, body: await response.json() })).then(({ body }) => {
      if (!active) return;
      setSeasonConfigured(Boolean(body.seasonConfigured));
      if (body.entry?.picks && Array.isArray(body.entry.picks)) {
        const restored: Record<number, number> = {};
        for (const id of body.entry.picks as string[]) {
          const player = players.find((item) => item.id === id);
          if (player) restored[Math.floor((player.rank - 1) / 10)] = player.rank;
        }
        setSelected(restored);
        setEntryMessage("Saved lineup restored.");
      }
    }).catch(() => {});
    return () => { active = false; };
  }, [auth.authenticated, players]);

  async function submitEntry() {
    const picks = [0, 1, 2, 3, 4].map((band) => players.find((player) => player.rank === selected[band])?.id);
    if (picks.some((pick) => !pick)) return;
    setEntryBusy(true);
    setEntryMessage("");
    try {
      const response = await fetch("/api/entry", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ picks }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save lineup.");
      setEntryMessage("Eligible lineup saved to your wallet entry.");
    } catch (error) {
      setEntryMessage(error instanceof Error ? error.message : "Could not save lineup.");
    } finally {
      setEntryBusy(false);
    }
  }

  const rosterSize = Object.keys(selected).length;
  const playerDataReady = players.length === 50;
  const phaseName = season.phase === "draft" ? "DRAFT OPEN" : season.phase === "scheduled" ? "UP NEXT" : season.phase === "live" ? "SEASON LIVE" : season.phase === "complete" ? "SEASON COMPLETE" : season.phase === "misconfigured" ? "SCHEDULE ERROR" : "PRE-SEASON";
  const timerTitle = season.phase === "draft" ? "DRAFT CLOSES IN" : season.phase === "live" ? "SEASON ENDS IN" : season.phase === "scheduled" ? "DRAFT OPENS IN" : null;
  const timerTarget = season.phase === "draft" ? season.schedule?.lockedAt : season.phase === "live" ? season.schedule?.closesAt : season.phase === "scheduled" ? season.schedule?.opensAt : undefined;
  const timerValue = countdownLabel(timerTarget, clockNow);
  const filteredPlayers = (band: number) => players
    .filter((player) => Math.floor((player.rank - 1) / 10) === band)
    .filter((player) => !search || `${player.display_name ?? ""} ${player.wallet}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <main className="app-shell draft-room">
      <header className="topbar" id="top">
        <a className="pf-brand" href="#top" aria-label="Pump Fantasy home">
          <span className="pf-mark-image" role="img" aria-label="Pump Fantasy crowned pill logo" /><strong>PumpFun Fantasy</strong><em>LEAGUE</em>
        </a>
        <nav aria-label="Primary">
          <a className="active" href="#draft">Draft room</a>
          <a href="#format">Format</a>
          <a href="#status">Season status</a>
        </nav>
        <div className="header-right">
          <ProjectHeaderLinks />
          <WalletControl onAuthChange={onAuthChange} />
        </div>
      </header>

      <section className="hero-light draft-hero">
        <div className="draft-eyebrow"><span className="status-lamp" /> PUMP.FUN FANTASY <span className="eyebrow-divider">/</span> ONE-MONTH PNL <a className="pumpfun-pill" href="https://pump.fun/leaderboard?period=monthly" target="_blank" rel="noreferrer">1M LEADERBOARD ↗</a></div>
        <div className="hero-copy-grid">
          <div>
            <h1>Pick your<br /><span>five.</span></h1>
              <p>Draft five traders from Pump.fun’s one-month top 50, with one pick from each rank band.</p>
            <div className="hero-ctas">
              <a className="primary-cta" href="#draft">Pick your squad <span>↓</span></a>
              <a className="secondary-cta" href="#format">See how it scores</a>
            </div>
            <div className="snapshot-stamp"><span className="snapshot-live-dot" /> {leaderboardSource.toUpperCase()} <b>{snapshotAt ? new Date(snapshotAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "UPDATING"}</b></div>
          </div>
          <div className="draft-board-art" aria-label="Featured Pump.fun KOLs">
            <div className="board-topline"><span>FACES IN THE FIELD</span><span>FEATURED KOLS</span></div>
            <div className="board-slots featured-kol-slots">
              {FEATURED_KOLS.map((kol, index) => (
                <a className="featured-kol-card" href="#draft" key={kol.name} aria-label={`See the official draft list, featured KOL ${kol.name}`}>
                  <span className="pick-number">0{index + 1}</span>
                  <Image className="featured-kol-avatar" src={kol.image} alt="" width={76} height={76} />
                  <span className="player-label">{kol.name}</span>
                  <span className="player-plus">KOL</span>
                </a>
              ))}
            </div>
            <div className="board-footer"><span>PUMP.FUN CREATOR SPOTLIGHT</span><span>BUILD YOUR FIVE BELOW</span></div>
          </div>
        </div>
        <div className="draft-ticker"><span>TOP 50 · ONE-MONTH PNL</span><i /><span>5 BANDS · 1 PICK PER BAND</span><i /><span>DAILY PNL CHANGE · HIGHEST SQUAD WINS</span></div>
      </section>

      <section className="draft-section" id="draft">
        <div className="draft-heading">
          <div><span className="section-label">THE DRAFT ROOM</span><h2>Draft five traders.</h2><p>Pick one trader from each of the five rank bands in Pump.fun’s one-month top 50. Tap a pick again to remove it.</p></div>
          <div className="draft-progress"><span>ROSTER <b>{rosterSize} / 5</b></span><div>{[0, 1, 2, 3, 4].map((index) => <i className={selected[index] ? "filled" : ""} key={index} />)}</div></div>
        </div>

        <div className="draft-layout">
          <div className="kol-browser">
            <div className="kol-toolbar"><label className="search-box draft-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a trader or wallet" aria-label="Search top 50 traders" /></label><span className={`board-state ${playerDataReady ? "board-ready" : ""}`}><i /> {playerDataReady ? "50 IN THE FIELD" : "ROSTER UNAVAILABLE"}</span></div>
            <div className="draft-rounds">
              {DRAFT_ROUNDS.map((round, index) => (
                <article className="draft-round" key={round} id={`draft-band-${index}`}>
                  <div className="draft-round-head">
                    <span className="round-number">0{index + 1}</span>
                    <div><b>{index === 0 ? "Top 10" : `Ranks ${round}`}</b><small>CHOOSE 1 OF 10</small></div>
                    <span className="round-pick">PICK 1</span>
                  </div>
                  {playerDataReady ? <div className="band-players">{filteredPlayers(index).map((player) => (
                    <button type="button" aria-pressed={selected[index] === player.rank} className={`band-player ${selected[index] === player.rank ? "selected" : ""}`} key={player.id} onClick={() => { setSelected((current) => { const next = { ...current }; if (next[index] === player.rank) delete next[index]; else next[index] = player.rank; return next; }); setEntryMessage(""); }}>
                      <span className="player-rank">#{player.rank}</span><span className="player-avatar" aria-hidden="true" style={player.avatar_url ? { backgroundImage: `url("${player.avatar_url}")` } : undefined}>{player.display_name?.slice(0, 1).toUpperCase()}</span><span className="player-identity"><b>{player.display_name || shortAddress(player.wallet)}</b><small>{shortAddress(player.wallet)}</small></span><strong className="pnl-positive">${player.pnl_usd.toLocaleString("en-US", { maximumFractionDigits: 0 })}<small>1M PNL</small></strong><span className="player-select-mark">{selected[index] === player.rank ? "✓" : "+"}</span>
                    </button>
                  ))}{filteredPlayers(index).length === 0 ? <p className="search-empty">No matching traders in this rank band.</p> : null}</div> : <div className="round-empty"><span className="rank-stack"><i /><i /><i /></span><div><b>Top-50 source snapshot unavailable</b><small>Check the source leaderboard before opening a contest.</small></div></div>}
                </article>
              ))}
            </div>
            <div className="draft-board-footnote"><span className="status-lamp" /> Rank bands use the saved top-50 snapshot. Choose one trader in every band; a trader’s displayed 1M PnL is their starting mark, not a contest score.</div>
          </div>

          <aside className="roster-panel">
            <div className="roster-panel-head"><div><span>YOUR SQUAD</span><b>Five picks</b></div><em>{auth.eligible ? "FANTASY CHECK PASSED" : "CONNECT WALLET"}</em></div>
            <div className={`season-clock ${season.phase}`} aria-live="polite">
              <span>{timerTitle ?? "LEAGUE STATUS"}</span>
              <b>{timerValue ?? phaseName}</b>
              <small>{season.phase === "draft" ? "Submit before the clock hits zero. Picks saved only on this device are not entered." : season.phase === "live" ? "Drafts are locked. The 48-hour scoring period is underway." : season.phase === "complete" ? "This season has ended. Results are final, and the next draft opens automatically after rollover." : season.phase === "scheduled" ? "The draft opens at the scheduled start time." : season.phase === "misconfigured" ? "The season schedule needs an operator check." : "The live season schedule has not been configured."}</small>
            </div>
            <div className="roster-slots">
              {[0, 1, 2, 3, 4].map((band) => {
                const player = players.find((item) => item.rank === selected[band]);
                return <div className="roster-slot" key={band}><i>{String(band + 1).padStart(2, "0")}</i><span><b>{player?.display_name || (player ? shortAddress(player.wallet) : "Open pick")}</b><small>{player ? `Rank #${player.rank} · ${player.pnl_usd >= 0 ? "+" : ""}$${player.pnl_usd.toLocaleString("en-US", { maximumFractionDigits: 0 })} 1M PnL` : `Choose from ranks ${band * 10 + 1}–${band * 10 + 10}`}</small></span></div>;
              })}
            </div>
            <div className="roster-note"><span className="note-mark">i</span><p>{rosterSize === 5 ? "Five traders drafted. Your squad is saved on this device until you submit it." : "Pick one trader in each of the five rank bands. Your draft saves on this device."} {auth.authenticated ? `Wallet verified${auth.balance ? ` · ${auth.balance} $FANTASY` : ""}.` : "Connect a wallet holding at least 500,000 $FANTASY to verify eligibility."}</p></div>
            <button className="clear-draft-button" type="button" onClick={() => { setSelected({}); setEntryMessage(""); }} disabled={rosterSize === 0}>Clear draft</button>
            <button className="lock-button" disabled={entryBusy || rosterSize !== 5 || !auth.eligible || !seasonConfigured || season.phase !== "draft" || !playerDataReady} onClick={submitEntry}>{entryBusy ? "Saving squad…" : season.phase === "live" || season.phase === "complete" ? "Draft locked" : !seasonConfigured || season.phase !== "draft" ? "Draft window not open" : !playerDataReady ? "Roster unavailable" : !auth.eligible ? "Connect & verify $FANTASY" : rosterSize !== 5 ? `Pick ${5 - rosterSize} more` : "Submit squad"}</button>
            {entryMessage ? <p className="entry-message" role="status">{entryMessage}</p> : null}
            <small className="no-signature">Wallet message signature only. No transaction or token transfer.</small>
          </aside>
        </div>
      </section>

      <section className="leaderboard-section-light" id="status">
        <div className="section-topline"><div><span className="section-label">CONTEST STATUS</span><h2>{season.phase === "draft" ? "The draft is open." : season.phase === "scheduled" ? "The next draft is scheduled." : season.phase === "live" ? "The season is underway." : season.phase === "complete" ? "The season window has ended." : "Roster is visible. Entry is not open."}</h2></div><span className="contest-status-pill"><i /> {phaseName}</span></div>
        <div className="status-cards">
          <article><span className="status-index">01</span><i className="status-symbol">◎</i><h3>One-month top 50</h3><p>Captured from the Pump.fun 1M profit leaderboard. The five rank bands are fixed for each contest.</p><span className={`status-pill ${playerDataReady ? "active" : "pending"}`}>{playerDataReady ? "50 SNAPSHOT PLAYERS" : "ROSTER UNAVAILABLE"}</span></article>
          <article><span className="status-index">02</span><i className="status-symbol">⌁</i><h3>Daily PnL race</h3><p>For each pick, closing 1M PnL minus opening 1M PnL. Add all five changes; the highest score wins.</p><span className="status-pill pending">{standings.some((row) => row.scoringReady) ? "ROUND SCORES LOADED" : "NO ROUND SCORING FEED"}</span></article>
          <article><span className="status-index">03</span><i className="status-symbol">▤</i><h3>Holder entry + prize</h3><p>Wallet signing checks the 500,000 $FANTASY minimum. Daily scores settle from saved PnL snapshots; the SOL prize must be configured and funded before the season starts.</p><span className="status-pill pending">{auth.eligible ? "TOKEN CHECK PASSED" : "FANTASY MINT REQUIRED"}</span></article>
        </div>
        <div className="live-standings">
          <div className="standings-heading"><div><span className="section-label">DAILY LEADERBOARD</span><h3>Five picks. One score.</h3></div><small>{snapshotAt ? `ROSTER SNAPSHOT · ${new Date(snapshotAt).toLocaleString()}` : "NO SOURCE SNAPSHOT"}</small></div>
          {standings.length ? <div className="standings-list">{standings.map((row, index) => <div className="standings-row" key={row.wallet}><b className="standing-rank">{String(index + 1).padStart(2, "0")}</b><span>{shortAddress(row.wallet)}</span><strong>{row.scoringReady && row.score !== null ? `${row.score >= 0 ? "+" : "−"}$${Math.abs(row.score).toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "Awaiting verified PnL"}</strong></div>)}</div> : <p className="standings-empty">The board fills after the first round opens, five-pick squads are submitted, and closing PnL data is captured.</p>}
        </div>
        <div className="daily-awards"><div className="standings-heading"><div><span className="section-label">DAILY WINNERS</span><h3>Every day has a result.</h3></div><small>{Number(dailyPrizeLamports) > 0 ? `${(Number(dailyPrizeLamports) / 1_000_000_000).toFixed(3)} SOL PER DAY` : "PRIZE AMOUNT NOT SET"}</small></div>{awards.length ? <div className="award-list">{awards.map((award) => <article className="award-card" key={award.id}><span>DAY {award.day_number}</span><b>{award.winner_wallet ? shortAddress(award.winner_wallet) : award.status === "no_eligible_entries" ? "No eligible entries" : "Awaiting complete PnL data"}</b><strong>{award.score_usd === null ? "" : `${award.score_usd >= 0 ? "+" : "−"}$${Math.abs(award.score_usd).toLocaleString("en-US", { maximumFractionDigits: 2 })}`}</strong><small className={award.status === "paid" ? "paid" : "pending"}>{award.status.replaceAll("_", " ").toUpperCase()}</small>{award.payment_signature ? <a href={`https://solscan.io/tx/${award.payment_signature}`} target="_blank" rel="noreferrer">View payment ↗</a> : null}</article>)}</div> : <p className="standings-empty">The season clock captures daily PnL snapshots and calculates the top five-pick squad at each 24-hour mark.</p>}</div><div className="fee-flow"><span className="section-label">PRIZE SETTLEMENT</span><div><b>Daily PnL snapshot</b><i>→</i><b>Top squad</b><i>→</i><b>Verified SOL transfer</b></div><p>Scores and winners settle automatically. A prize is only shown as paid after the winning wallet receives the configured SOL amount and the transaction is verified on Solana.</p></div>
        <div className="season-pathway">
          <div><span className="section-label">THE LEAGUE KEEPS GOING</span><h3>One season ends. The race continues.</h3><p>Each season runs a 3-hour draft, then 48 hours of scoring. Daily results are captured at the 24-hour marks. When a season closes, the next 3-hour draft opens automatically with a fresh top-50 field.</p></div>
          <ol><li><b>01</b><span><strong>Draft</strong><small>Pick five before entries lock.</small></span></li><li><b>02</b><span><strong>Season</strong><small>Track the 48-hour PnL race.</small></span></li><li><b>03</b><span><strong>Next season</strong><small>Fresh draft, new standings.</small></span></li><li><b>04</b><span><strong>Playoffs planned</strong><small>Qualification and prize rules will be published before the finals open.</small></span></li></ol>
          <small className="season-pathway-note">Season rollover, score snapshots, and configured SOL payouts run from the protected server cron. Every payout is checked onchain before it is marked paid.</small>
        </div>
      </section>

      <section className="how-section" id="format">
        <div className="how-heading"><span className="section-label">THE FORMAT</span><h2>A real fantasy draft.</h2><p>Simple roster building, transparent scoring, and results that can be checked.</p></div>
        <div className="how-grid">
          <article><span>01</span><i className="how-icon">01</i><h3>Build the field</h3><p>Start each day with the one-month Pump.fun top 50, split into five bands of ten.</p></article>
          <article><span>02</span><i className="how-icon">02</i><h3>Pick your five</h3><p>Choose one trader from each band. Connect a wallet holding at least 500,000 $FANTASY to submit your squad.</p></article>
          <article><span>03</span><i className="how-icon">03</i><h3>Score the move</h3><p>Each pick scores its change in one-month PnL between the round’s opening and closing snapshots. Sum your five.</p></article>
          <article><span>04</span><i className="how-icon">04</i><h3>Pay the winner</h3><p>The top squad at each daily snapshot is recorded. A SOL award is shown as paid only after the onchain transfer is verified.</p></article>
        </div>
        <div className="docs-note"><div><span>SCORING RULE</span><h3>Measure the move.</h3></div><p>For each trader, take closing 1M PnL minus opening 1M PnL. Add the five results. The highest total wins. A real contest needs a timestamped opening snapshot, timestamped close, published tie-break rule, and a verifiable data source before entries open.</p></div>
      </section>

      <section className="closing-cta"><span>PF</span><div><p>PUMP FANTASY</p><h2>Pick five.<br />Follow the PnL.</h2><a href="#draft">Build your squad</a></div></section>

      <footer>
        <a className="pf-brand" href="#top"><span className="pf-mark-image" role="img" aria-label="Pump Fantasy crowned pill logo" /><strong>PumpFun Fantasy</strong><em>LEAGUE</em></a>
        <p>A fantasy draft for the pump.fun culture.</p>
        <div><a href="#draft">Draft room</a><a href="#format">Format</a><a href="#status">Season status</a></div>
        <small>Independent project; not affiliated with pump.fun. Trader rankings and one-month PnL come from Pump.fun and can change. A submitted squad is scored against the round’s opening snapshot. Connect a wallet holding $FANTASY to enter during an open draft window. Crypto assets are risky; this is not financial advice.</small>
      </footer>
    </main>
  );
}
