"use client";

import "./disposable-stack-polyfill";
import "./league-relaunch.css";
import "./launch-polish.css";
import "./product-upgrade.css";
import { readLeagueSnapshot } from "../lib/league-refresh.mjs";
import Image from "next/image";
import {
  useConnect,
  useConnectedWallet,
  useDisconnect,
  useSignMessage,
  useWalletStatus,
  useWallets,
} from "@solana/kit-plugin-wallet/react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { solanaClient } from "./solana-client";
import top50Snapshot from "../data/pumpfun-one-month-top50.json";

const subscribeHydration = () => () => {};
const clientHydrated = () => true;
const serverHydrated = () => false;
const DRAFT_ROUNDS = ["TOP 10", "11–20", "21–30", "31–40", "41–50"];
const PUBLIC_CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_FANTASY_CA || process.env.NEXT_PUBLIC_PF_CA || "").trim();
const DRAFT_STORAGE_KEY = "pump-fantasy-relaunch-draft-v2";
type SnapshotTuple = [number, string, string, number, string];

function shortAddress(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

type AuthState = { configured: boolean; authenticated: boolean; eligible: boolean; wallet?: string; balance?: string; minimumTokens?: string };
type SeasonPhase = "unconfigured" | "inactive" | "scheduled" | "draft" | "live" | "complete" | "misconfigured";
type SeasonState = { configured: boolean; seasonConfigured: boolean; phase: SeasonPhase; seasonId?: string; serverTime?: string; mintAddress?: string; minimumTokens?: string; schedule?: { opensAt: string | null; lockedAt: string | null; closesAt: string | null } | null };
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


function LeagueIcon({kind}: {kind: "refresh" | "search" | "field" | "score" | "receipt"}) {
  const paths = { refresh: "M20 8a8 8 0 1 0 0 8M20 3v5h-5", search: "M15 15l6 6M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0", field: "M3 5h18v14H3zM7 5v14m5-14v14m5-14v14", score: "M3 20V4m0 16h18M6 16l5-6 4 3 6-9", receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6m-6 4h6" };
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind]} /></svg>;
}

function ProjectHeaderLinks({ contractAddress }: { contractAddress: string }) {
  const [copied, setCopied] = useState(false);

  async function copyContractAddress() {
    if (!contractAddress) return;
    try {
      await navigator.clipboard.writeText(contractAddress);
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
      <button className="ca-copy-button" onClick={copyContractAddress} disabled={!contractAddress} aria-label={contractAddress ? "Copy contract address" : "Contract address not set"} title={contractAddress ? "Copy contract address" : "Contract address not set"}>
        <span className="ca-label">CA:</span>{contractAddress ? <code>{shortAddress(contractAddress)}</code> : <code>Pending</code>}{copied ? <span className="ca-copied">COPIED</span> : null}
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
  const [feedRevision, setFeedRevision] = useState(0);
  const [feedPartial, setFeedPartial] = useState(false);
  const [feedRefreshing, setFeedRefreshing] = useState(false);
  const [players, setPlayers] = useState<BoardPlayer[]>(snapshotPlayers);
  const [selected, setSelected] = useState<Record<number, number>>({});
  const [hydratedDraftKey, setHydratedDraftKey] = useState("");
  const [savedPicks, setSavedPicks] = useState<string[]>([]);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const serverEntryLoaded = useRef("");
  const [rosterSeasonId, setRosterSeasonId] = useState<string | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [seasonConfigured, setSeasonConfigured] = useState(false);
  const [season, setSeason] = useState<SeasonState>({ configured: false, seasonConfigured: false, phase: "unconfigured" });
  const [clockNow, setClockNow] = useState(0);
  const [search, setSearch] = useState("");
  const [entryBusy, setEntryBusy] = useState(false);
  const [entryMessage, setEntryMessage] = useState("");
  const [standings, setStandings] = useState<Array<{ wallet: string; score: number | null; scoringReady: boolean }>>([]);
  const [awards, setAwards] = useState<Array<{ id: string; season_id: string; day_number: number; winner_wallet: string | null; score_usd: number | null; prize_lamports: string; status: string; payment_signature: string | null }>>([]);
  const [feePools, setFeePools] = useState({ availableDailyLamports: "0", reserveLamports: "0", collectedLamports: "0" });
  const [snapshotAt, setSnapshotAt] = useState<string | null>(null);
  const [leaderboardSource, setLeaderboardSource] = useState("Loading Pump.fun leaderboard");
  const onAuthChange = useCallback((state: AuthState) => setAuth(state), []);

  useEffect(() => {
    let active = true;
    const refreshSeason = async () => {
      const response = await fetch("/api/entry", { cache: "no-store" });
      const body = await response.json() as SeasonState;
      if (!active) return;
      if (!response.ok || !body.phase) return;
      setSeason(body);
      if (body.serverTime) setClockOffset(Date.parse(body.serverTime) - Date.now());
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

  const rosterIdentity = players.map((player) => player.id).join(",");
  const draftKey = `${DRAFT_STORAGE_KEY}:${season.seasonId ?? "preview"}:${rosterSeasonId ? rosterIdentity : "preview"}:${auth.wallet ?? "guest"}`;

  useEffect(() => {
    const restored: Record<number, number> = {};
    try {
      const saved = JSON.parse(window.localStorage.getItem(draftKey) ?? "{}") as Record<string, unknown>;
      for (let band = 0; band < 5; band += 1) {
        const rank = saved[String(band)];
        if (typeof rank === "number" && Math.floor((rank - 1) / 10) === band && rank <= 50) restored[band] = rank;
      }
    } catch { /* Storage is optional; submission is always saved on the server. */ }
    const timer = window.setTimeout(() => {
      setSelected(restored);
      setSavedPicks([]);
      setSavedAt(null);
      setEntryMessage("");
      setHydratedDraftKey(draftKey);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [draftKey]);

  useEffect(() => {
    if (hydratedDraftKey !== draftKey) return;
    try { window.localStorage.setItem(draftKey, JSON.stringify(selected)); }
    catch { /* Continue when browser storage is disabled. */ }
  }, [draftKey, hydratedDraftKey, selected]);

  useEffect(() => {
    const controller = new AbortController();
    let inFlight = false;
    const refresh = async () => {
      if (inFlight || controller.signal.aborted) return;
      inFlight = true;
      setFeedRefreshing(true);
      try {
        const snapshot = await readLeagueSnapshot({ signal: controller.signal });
        if (controller.signal.aborted) return;
        const playerResult = snapshot.players;
        const standingsResult = snapshot.standings;
        const fieldValid = Array.isArray(playerResult?.players) && playerResult.players.length === 50;
        setFeedPartial(snapshot.partial || !fieldValid);
        if (!fieldValid) {
          setLeaderboardSource((source) => source.startsWith("Loading") ? "Dated fallback snapshot · refresh unavailable" : source);
          setSnapshotAt((previous) => previous ?? top50Snapshot.snapshotAt);
        }
        if (Array.isArray(playerResult?.players) && playerResult.players.length === 50) {
          setPlayers(playerResult.players);
          setRosterSeasonId(playerResult.seasonId ?? null);
          setSnapshotAt(playerResult.snapshotAt ?? top50Snapshot.snapshotAt);
          setLeaderboardSource(playerResult.source ?? (playerResult.live ? "Live Pump.fun 1M leaderboard" : "Dated fallback snapshot"));
        }
        if (Array.isArray(standingsResult?.standings)) setStandings(standingsResult.standings);
        if (Array.isArray(standingsResult?.awards)) setAwards(standingsResult.awards);
        if (standingsResult?.feePools) setFeePools(standingsResult.feePools);
      } finally {
        inFlight = false;
        if (!controller.signal.aborted) setFeedRefreshing(false);
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [feedRevision]);

  useEffect(() => {
    let active = true;
    if (!auth.authenticated || !season.seasonId || rosterSeasonId !== season.seasonId || hydratedDraftKey !== draftKey || serverEntryLoaded.current === draftKey) return;
    const ids = rosterIdentity.split(",");
    fetch("/api/entry", { cache: "no-store" }).then(async (response) => ({ ok: response.ok, body: await response.json() })).then(({ ok, body }) => {
      if (!active || !ok || body.seasonId !== season.seasonId || body.wallet !== auth.wallet) return;
      serverEntryLoaded.current = draftKey;
      if (Array.isArray(body.entry?.picks)) {
        const restored: Record<number, number> = {};
        for (const id of body.entry.picks as string[]) {
          const index = ids.indexOf(id);
          if (index >= 0) restored[Math.floor(index / 10)] = index + 1;
        }
        setSelected(restored);
        setSavedPicks(body.entry.picks);
        setSavedAt(body.entry.updated_at);
        setEntryMessage("Your submitted squad is restored.");
      }
    }).catch(() => {});
    return () => { active = false; };
  }, [auth.authenticated, auth.wallet, draftKey, hydratedDraftKey, rosterIdentity, rosterSeasonId, season.seasonId]);

  async function submitEntry() {
    const picks = [0, 1, 2, 3, 4].map((band) => players.find((player) => player.rank === selected[band])?.id);
    if (picks.some((pick) => !pick)) return;
    setEntryBusy(true);
    setEntryMessage("");
    try {
      const response = await fetch("/api/entry", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ picks }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save lineup.");
      setSavedPicks(result.picks);
      setSavedAt(new Date().toISOString());
      setEntryMessage("Squad submitted. You can change picks and resubmit until the one-hour draft closes.");
    } catch (error) {
      setEntryMessage(error instanceof Error ? error.message : "Could not save lineup.");
    } finally {
      setEntryBusy(false);
    }
  }

  const rosterSize = Object.keys(selected).length;
  const playerDataReady = players.length === 50;
  const rosterMatchesSeason = Boolean(season.seasonId && rosterSeasonId === season.seasonId);
  const effectiveNow = clockNow ? clockNow + clockOffset : 0;
  const lockPassed = Boolean(effectiveNow && season.schedule?.lockedAt && effectiveNow >= Date.parse(season.schedule.lockedAt));
  const draftOpen = season.phase === "draft" && !lockPassed;
  const picksLocked = season.phase === "live" || season.phase === "complete" || (season.phase === "draft" && lockPassed);
  const currentPicks = [0, 1, 2, 3, 4].map((band) => players.find((player) => player.rank === selected[band])?.id);
  const hasSavedSquad = savedPicks.length === 5;
  const hasUnsavedChanges = hasSavedSquad && currentPicks.some((pick) => !pick || !savedPicks.includes(pick));
  const phaseName = season.phase === "draft" ? "DRAFT OPEN" : season.phase === "scheduled" ? "UP NEXT" : season.phase === "live" ? "SEASON LIVE" : season.phase === "complete" ? "SEASON COMPLETE" : season.phase === "misconfigured" ? "SCHEDULE ERROR" : "PRE-SEASON";
  const timerTitle = season.phase === "draft" ? "DRAFT CLOSES IN" : season.phase === "live" ? "SEASON ENDS IN" : season.phase === "scheduled" ? "DRAFT OPENS IN" : null;
  const timerTarget = season.phase === "draft" ? season.schedule?.lockedAt : season.phase === "live" ? season.schedule?.closesAt : season.phase === "scheduled" ? season.schedule?.opensAt : undefined;
  const timerValue = countdownLabel(timerTarget, effectiveNow);
  const filteredPlayers = (band: number) => players
    .filter((player) => Math.floor((player.rank - 1) / 10) === band)
    .filter((player) => !search || `${player.display_name ?? ""} ${player.wallet}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <main className="app-shell draft-room">
      <header className="topbar" id="top">
        <a className="pf-brand" href="#top" aria-label="Pump Fantasy home">
          <span className="pf-mark-image" role="img" aria-label="Pump Fantasy logo" /><strong>PumpFun Fantasy</strong><em>LEAGUE</em>
        </a>
        <nav aria-label="Primary">
          <a className="active" href="#draft">Draft room</a>
          <a href="/budget-draft">Draft lab</a>
          <a href="/rules">Rules</a>
          <a href="#status">Season status</a>
        </nav>
        <div className="header-right">
          <ProjectHeaderLinks contractAddress={season.mintAddress ?? PUBLIC_CONTRACT_ADDRESS} />
          <WalletControl onAuthChange={onAuthChange} />
        </div>
      </header>

      <section className="league-live-strip" aria-label="League schedule and eligibility">
        <div><span className={`league-phase-dot ${draftOpen ? "open" : ""}`} /><span>{phaseName}</span><strong>{timerValue ?? "Not scheduled"}</strong></div>
        <div><span>DRAFT WINDOW</span><strong>60 minutes</strong></div>
        <div><span>HOLDER ENTRY</span><strong>500,000 FANTASY</strong></div>
        <div><span>{Number(feePools.availableDailyLamports) > 0 ? "FUNDED DAILY POOL" : "DAILY FEE ALLOCATION"}</span><strong>{Number(feePools.availableDailyLamports) > 0 ? `${(Number(feePools.availableDailyLamports) / 1e9).toLocaleString()} SOL` : "65% of creator fees"}</strong></div>
      </section>
      <section className="hero-light draft-hero">
        <div className="draft-eyebrow"><span className="status-lamp" /> PUMP.FUN FANTASY <span className="eyebrow-divider">/</span> ONE-MONTH PNL <a className="pumpfun-pill" href="https://pump.fun/leaderboard?period=monthly" target="_blank" rel="noreferrer">1M LEADERBOARD</a></div>
        <div className="hero-copy-grid">
          <div>
            <h1>Pick five traders.<br /><span>Play the PnL.</span></h1>
              <p>Draft five traders from Pump.fun’s top 50. Set your lineup in 60 minutes. Compete on their combined PnL change over the next 48 hours.</p>
            <div className="hero-ctas">
              <a className="primary-cta" href="#draft">Pick your squad</a>
              <a className="secondary-cta" href="/budget-draft">Try a budget draft ↗</a>
            </div>
            <div className="snapshot-stamp"><span className="snapshot-live-dot" /> {leaderboardSource.toUpperCase()} <b>{snapshotAt ? new Date(snapshotAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "UPDATING"}</b></div>
          </div>
          <div className="league-board" aria-label="One trader from each leaderboard rank band">
            <div className="league-board-top"><span>THE DRAFT BOARD</span><b>50 → 5</b></div>
            <div className="league-board-cards">
              {[0, 1, 2, 3, 4].map((band) => {
                const player = players.find((p) => p.rank === selected[band]) ?? players[band * 10];
                return <a href={`#draft-band-${band}`} className="league-preview-card" key={band} aria-label={`Browse ${DRAFT_ROUNDS[band]} traders`}>
                  <small>#{player?.rank ?? band * 10 + 1}</small>
                  <span className="league-avatar">{player?.avatar_url ? <Image src={player.avatar_url} alt="" width={76} height={76} unoptimized /> : player?.display_name?.slice(0, 1).toUpperCase() ?? "?"}</span>
                  <b>{player?.display_name || (player ? shortAddress(player.wallet) : "Rank band")}</b>
                  <em>{DRAFT_ROUNDS[band]}</em>
                </a>;
              })}
            </div>
            <div className="league-board-bottom"><span>ONE PICK PER BAND</span><span>{rosterSize ? `${rosterSize} / 5 SELECTED` : "EXPLORE THE FIELD ↗"}</span></div>
          </div>
        </div>
        <div className="draft-ticker"><span>TOP 50 · ONE-MONTH PNL</span><i /><span>5 BANDS · 1 PICK PER BAND</span><i /><span>1 HOUR TO DRAFT · 48 HOURS TO COMPETE</span></div>
      </section>

      <section className="league-rule-summary" aria-label="How the league works">
        <div><b>01</b><span><strong>Hold 500k FANTASY</strong><small>Connect your wallet and sign in.</small></span></div>
        <div><b>02</b><span><strong>Draft in one hour</strong><small>One trader per band. Submit your five.</small></span></div>
        <div><b>03</b><span><strong>Compete for 48 hours</strong><small>Picks lock. Daily PnL decides the winner.</small></span></div>
      </section>
      <section className="draft-section" id="draft">
        <div className="field-refresh"><span role="status">{feedPartial ? 'Some league data could not refresh. The last received field and results remain visible.' : 'Season field and confirmed results'} </span><button type="button" disabled={feedRefreshing} onClick={() => setFeedRevision((n) => n + 1)}>{feedRefreshing ? 'Refreshing…' : 'Refresh field'}<LeagueIcon kind="refresh" /></button></div>
        <div className="draft-heading">
          <div><span className="section-label">THE DRAFT ROOM</span><h2>Draft five traders.</h2><p>Pick one trader from each of the five rank bands in Pump.fun’s one-month top 50. Tap a pick again to remove it.</p></div>
          <div className="draft-progress"><span>ROSTER <b>{rosterSize} / 5</b></span><div>{[0, 1, 2, 3, 4].map((index) => <i className={selected[index] ? "filled" : ""} key={index} />)}</div></div>
        </div>

        <div className="draft-layout">
          <div className="kol-browser">
            <div className="kol-toolbar"><label className="search-box draft-search"><LeagueIcon kind="search" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a trader or wallet" aria-label="Search top 50 traders" /></label><span className={`board-state ${playerDataReady ? "board-ready" : ""}`}><i /> {playerDataReady ? "50 IN THE FIELD" : "ROSTER UNAVAILABLE"}</span></div>
            <div className="draft-rounds">
              {DRAFT_ROUNDS.map((round, index) => (
                <article className="draft-round" key={round} id={`draft-band-${index}`}>
                  <div className="draft-round-head">
                    <span className="round-number">0{index + 1}</span>
                    <div><b>{index === 0 ? "Top 10" : `Ranks ${round}`}</b><small>CHOOSE 1 OF 10</small></div>
                    <span className="round-pick">PICK 1</span>
                  </div>
                  {playerDataReady ? <div className="band-players">{filteredPlayers(index).map((player) => (
                    <button type="button" aria-pressed={selected[index] === player.rank} disabled={picksLocked || entryBusy} className={`band-player ${selected[index] === player.rank ? "selected" : ""}`} key={player.id} onClick={() => { setSelected((current) => { const next = { ...current }; if (next[index] === player.rank) delete next[index]; else next[index] = player.rank; return next; }); setEntryMessage(""); }}>
                      <span className="player-rank">#{player.rank}</span><span className="player-avatar" aria-hidden="true" style={player.avatar_url ? { backgroundImage: `url("${player.avatar_url}")` } : undefined}>{player.display_name?.slice(0, 1).toUpperCase()}</span><span className="player-identity"><b>{player.display_name || shortAddress(player.wallet)}</b><small>{shortAddress(player.wallet)}</small></span><strong className="pnl-positive">${player.pnl_usd.toLocaleString("en-US", { maximumFractionDigits: 0 })}<small>1M PNL</small></strong><span className="player-select-mark">{selected[index] === player.rank ? "✓" : "+"}</span>
                    </button>
                  ))}{filteredPlayers(index).length === 0 ? <p className="search-empty">No matching traders in this rank band.</p> : null}</div> : <div className="round-empty"><span className="rank-stack"><i /><i /><i /></span><div><b>Top-50 source snapshot unavailable</b><small>Check the source leaderboard before opening a contest.</small></div></div>}
                </article>
              ))}
            </div>
            <div className="draft-board-footnote"><span className="status-lamp" /> Rank bands use the saved top-50 snapshot. Choose one trader in every band; a trader’s displayed 1M PnL is their starting mark, not a contest score.</div>
          </div>

          <aside className="roster-panel">
            <div className="roster-panel-head"><div><span>YOUR SQUAD</span><b>Five picks</b></div><em>{auth.eligible ? "HOLDER CHECK PASSED" : "CONNECT WALLET"}</em></div>
            <div className={`season-clock ${season.phase}`} aria-live="polite">
              <span>{timerTitle ?? "LEAGUE STATUS"}</span>
              <b>{timerValue ?? phaseName}</b>
              <small>{season.phase === "draft" ? "Submit before the clock hits zero. Picks saved only on this device are not entered." : season.phase === "live" ? "Drafts are locked. The 48-hour scoring period is underway." : season.phase === "complete" ? "This season has ended. The next draft opens after the new field and funded prizes pass launch checks." : season.phase === "scheduled" ? "The draft opens at the scheduled start time." : season.phase === "misconfigured" ? "The season schedule needs an operator check." : "The one-hour timer starts when the operator opens the season. You can browse the field now."}</small>
            </div>
            <div className="roster-slots">
              {[0, 1, 2, 3, 4].map((band) => {
                const player = players.find((item) => item.rank === selected[band]);
                return <div className="roster-slot" key={band}><i>{String(band + 1).padStart(2, "0")}</i><span><b>{player?.display_name || (player ? shortAddress(player.wallet) : "Open pick")}</b><small>{player ? `Rank #${player.rank} · ${player.pnl_usd >= 0 ? "+" : ""}$${player.pnl_usd.toLocaleString("en-US", { maximumFractionDigits: 0 })} 1M PnL` : `Choose from ranks ${band * 10 + 1}–${band * 10 + 10}`}</small></span></div>;
              })}
            </div>
            <div className="roster-note"><span className="note-mark">i</span><p>{rosterSize === 5 ? "Five traders drafted. Submit to enter. Local picks alone do not count." : "Pick one trader in each of the five rank bands. Your draft saves on this device."} {auth.authenticated ? `Wallet verified${auth.balance ? ` · ${auth.balance} $FANTASY` : ""}.` : "Connect a wallet holding at least 500,000 $FANTASY to verify eligibility."}</p></div>
            <button className="clear-draft-button" type="button" onClick={() => { setSelected({}); setEntryMessage(""); }} disabled={rosterSize === 0 || picksLocked || entryBusy}>Clear draft</button>
            <button className="lock-button" disabled={entryBusy || rosterSize !== 5 || !auth.eligible || !seasonConfigured || !draftOpen || !playerDataReady || !rosterMatchesSeason} onClick={submitEntry}>{entryBusy ? "Saving squad…" : season.phase === "live" || season.phase === "complete" ? "Draft locked" : !seasonConfigured || !draftOpen ? "Draft opens at launch" : !playerDataReady || !rosterMatchesSeason ? "Loading season roster" : !auth.eligible ? "Connect & verify $FANTASY" : rosterSize !== 5 ? `Pick ${5 - rosterSize} more` : hasSavedSquad ? "Save squad changes" : "Submit squad"}</button>
            {hasSavedSquad ? <div className={`squad-save-state ${hasUnsavedChanges ? "dirty" : "saved"}`} role="status"><b>{hasUnsavedChanges ? "Changes not submitted" : "Squad submitted"}</b><span>{hasUnsavedChanges ? "Your previous submission still counts. Save your changes before the deadline." : picksLocked ? "Your final five are locked for this season." : `Saved ${savedAt ? new Date(savedAt).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"}) : "on the server"}. Edit and resubmit before the clock ends.`}</span></div> : null}
            {entryMessage ? <p className="entry-message" role="status">{entryMessage}</p> : null}
            <small className="no-signature">Wallet message signature only. No transaction or token transfer.</small>
          </aside>
        </div>
      </section>

      <section className="leaderboard-section-light" id="status">
        <div className="section-topline"><div><span className="section-label">CONTEST STATUS</span><h2>{season.phase === "draft" ? "The draft is open." : season.phase === "scheduled" ? "The next draft is scheduled." : season.phase === "live" ? "The season is underway." : season.phase === "complete" ? "The season window has ended." : "Roster is visible. Entry is not open."}</h2></div><span className="contest-status-pill"><i /> {phaseName}</span></div>
        <div className="status-cards">
          <article><span className="status-index">01</span><i className="status-symbol"><LeagueIcon kind="field" /></i><h3>One-month top 50</h3><p>Captured from the Pump.fun 1M profit leaderboard. The five rank bands are fixed for each contest.</p><span className={`status-pill ${playerDataReady ? "active" : "pending"}`}>{playerDataReady ? "50 SNAPSHOT PLAYERS" : "ROSTER UNAVAILABLE"}</span></article>
          <article><span className="status-index">02</span><i className="status-symbol"><LeagueIcon kind="score" /></i><h3>Daily PnL race</h3><p>For each pick, closing 1M PnL minus opening 1M PnL. Add all five changes; the highest score wins.</p><span className="status-pill pending">{standings.some((row) => row.scoringReady) ? "ROUND SCORES LOADED" : "SCORING STARTS AT DRAFT LOCK"}</span></article>
          <article><span className="status-index">03</span><i className="status-symbol"><LeagueIcon kind="receipt" /></i><h3>Holder entry + prize</h3><p>Hold 500,000 FANTASY to submit. 65% of confirmed creator fees funds daily first place; 35% remains in the league reserve. Future event payouts require published rules.</p><span className="status-pill pending">{auth.eligible ? "TOKEN CHECK PASSED" : "500K FANTASY REQUIRED"}</span></article>
        </div>
        <div className="live-standings">
          <div className="standings-heading"><div><span className="section-label">DAILY LEADERBOARD</span><h3>Five picks. One score.</h3></div><small>{snapshotAt ? `SEASON FIELD · ${new Date(snapshotAt).toLocaleString()}` : "NO SOURCE SNAPSHOT"}</small></div>
          {standings.length ? <div className="standings-list">{standings.map((row, index) => <div className="standings-row" key={row.wallet}><b className="standing-rank">{String(index + 1).padStart(2, "0")}</b><span>{shortAddress(row.wallet)}</span><strong>{row.scoringReady && row.score !== null ? `${row.score >= 0 ? "+" : "−"}$${Math.abs(row.score).toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "Awaiting verified PnL"}</strong></div>)}</div> : <p className="standings-empty">Submitted squads appear here. Scores begin after the draft locks and a scoring snapshot is captured.</p>}
        </div>
        <div className="daily-awards"><div className="standings-heading"><div><span className="section-label">DAILY WINNERS</span><h3>Daily results</h3></div><small>65% OF CONFIRMED CREATOR FEES</small></div>{awards.length ? <div className="award-list">{awards.map((award) => <article className="award-card" key={award.id}><span>DAY {award.day_number}</span><b>{award.winner_wallet ? shortAddress(award.winner_wallet) : award.status === "no_eligible_entries" ? "No eligible entries" : "Awaiting complete PnL data"}</b><strong>{award.score_usd === null ? "" : `${award.score_usd >= 0 ? "+" : "−"}$${Math.abs(award.score_usd).toLocaleString("en-US", { maximumFractionDigits: 2 })}`}</strong><small className={award.status === "paid" ? "paid" : "pending"}>{award.status.replaceAll("_", " ").toUpperCase()}</small>{award.payment_signature ? <a href={`https://solscan.io/tx/${award.payment_signature}`} target="_blank" rel="noreferrer">View payment ↗</a> : null}</article>)}</div> : <p className="standings-empty">The season clock captures daily PnL snapshots and calculates the top five-pick squad at each 24-hour mark.</p>}</div><div className="fee-flow"><span className="section-label">CREATOR FEES FUND THE LEAGUE</span><div className="reward-split"><article><b>65%</b><strong>Daily winners</strong><small>{(Number(feePools.availableDailyLamports) / 1e9).toLocaleString(undefined, {maximumFractionDigits: 6})} SOL in the daily pool</small></article><article><b>35%</b><strong>League reward reserve</strong><small>{(Number(feePools.reserveLamports) / 1e9).toLocaleString(undefined, {maximumFractionDigits: 6})} SOL reserved for weekly, monthly, and playoff rewards</small></article></div><p>Only finalized creator-fee claims enter the pools. The daily prize freezes at each 24-hour cutoff; fees confirmed after that cutoff carry into the next daily pool. The 35% reserve is excluded from daily payouts. Weekly, monthly, and playoff payout rules will be published before those events open.</p><span className="section-label">DAILY SETTLEMENT</span><div><b>Daily PnL snapshot</b><i aria-hidden="true">/</i><b>Top squad</b><i aria-hidden="true">/</i><b>Verified SOL transfer</b></div><p>The highest squad PnL change at each daily cutoff wins that day’s pool. A prize is only shown as paid after the winning wallet receives the configured SOL amount and the transaction is verified on Solana.</p></div>
        <div className="season-pathway">
          <div><span className="section-label">THE LEAGUE KEEPS GOING</span><h3>A new field every season.</h3><p>Each season runs a 1-hour draft, then 48 hours of scoring. Daily results are captured at the 24-hour marks. When a season closes, the next one-hour draft opens once the fresh top-50 field and funded daily prizes pass the server checks.</p></div>
          <ol><li><b>01</b><span><strong>Draft</strong><small>Pick five before entries lock.</small></span></li><li><b>02</b><span><strong>Season</strong><small>Track the 48-hour PnL race.</small></span></li><li><b>03</b><span><strong>Next season</strong><small>Fresh draft, new standings.</small></span></li></ol>
          <small className="season-pathway-note">Season rollover, score snapshots, and configured SOL payouts run from the protected server cron. Every payout is checked onchain before it is marked paid.</small>
        </div>
      </section>

      <section className="how-section" id="format">
        <div className="how-heading"><span className="section-label">THE FORMAT</span><h2>The league rules.</h2><p>Five rank bands. One locked lineup. Scores follow the published PnL rules.</p></div>
        <div className="how-grid">
          <article><span>01</span><i className="how-icon">01</i><h3>Build the field</h3><p>At season launch, the one-month Pump.fun top 50 is frozen into five bands of ten. That field stays fixed for all 48 hours.</p></article>
          <article><span>02</span><i className="how-icon">02</i><h3>Pick your five</h3><p>Hold 500,000 FANTASY, connect and sign in, then pick one trader per band. Submit within 60 minutes. Changes only count after you resubmit.</p></article>
          <article><span>03</span><i className="how-icon">03</i><h3>Score the move</h3><p>Each pick scores its change in one-month PnL between the round’s opening and closing snapshots. Sum your five.</p></article>
          <article><span>04</span><i className="how-icon">04</i><h3>Pay the winner</h3><p>The top squad at each daily snapshot is recorded. A SOL award is shown as paid only after the onchain transfer is verified.</p></article>
        </div>
        <div className="docs-note"><div><span>SCORING RULE</span><h3>Measure the move.</h3></div><p>For each trader, take closing 1M PnL minus opening 1M PnL. Add the five results. The highest total wins. Day 1 compares the scoring start with hour 24; Day 2 compares hour 24 with hour 48. Negative changes count. Equal scores are ordered by wallet address. Missing PnL data holds settlement for review.</p></div>
      </section>

      <section className="closing-cta"><span>PF</span><div><p>PUMP FANTASY</p><h2>Pick five.<br />Follow the PnL.</h2><a href="#draft">Build your squad</a></div></section>

      <footer>
        <a className="pf-brand" href="#top"><span className="pf-mark-image" role="img" aria-label="Pump Fantasy logo" /><strong>PumpFun Fantasy</strong><em>LEAGUE</em></a>
        <p>A fantasy draft for the pump.fun culture.</p>
        <div><a href="#draft">Draft room</a><a href="/budget-draft">Draft lab</a>
          <a href="/rules">Rules</a><a href="#status">Season status</a></div>
        <small>Independent project; not affiliated with pump.fun. Trader rankings and one-month PnL come from Pump.fun and can change. A submitted squad is scored against the round’s opening snapshot. Connect a wallet holding $FANTASY to enter during an open draft window. Crypto assets are risky; this is not financial advice.</small>
      </footer>
    </main>
  );
}
