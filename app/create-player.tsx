"use client";

import { useEffect, useRef, useState } from "react";
import { getTransactionDecoder, getTransactionEncoder, isTransactionModifyingSigner } from "@solana/kit";
import { solanaClient } from "./solana-client";
import type { CommunityProfile } from "../lib/community-data";
import type { PreparedBurn } from "../lib/community-burn/types";
import "./create-player.css";

type Status = { wallet?: string; player: { display_name: string; profile_url: string } | null; pending: { id: string; signature: string | null } | null; message?: string };
type Quote = { id: string; wallet: string; amount: string; profile: CommunityProfile; prepared: PreparedBurn };
async function action<T>(input: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/community-player", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Player registration is unavailable. Retry later.");
  return data as T;
}
function connectedAddress() { return solanaClient.wallet.getState().connected?.account.address; }
function requireWallet(wallet: string) {
  if (connectedAddress() !== wallet) throw new Error("Wallet changed. Reopen your player profile before continuing.");
}

export function CreatePlayer({ wallet, verify, onBusy }: { wallet?: string; verify: () => Promise<boolean>; onBusy: (busy: boolean) => void }) {
  const [profile, setProfile] = useState<CommunityProfile | null>(null);
  const [status, setStatus] = useState<Status>({ player: null, pending: null });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    generation.current++;
    const current = generation.current;
    const reset = window.setTimeout(() => { setProfile(null); setMessage(""); setStatus({ player: null, pending: null }); }, 0);
    if (wallet) void fetch("/api/community-player", { cache: "no-store" }).then(async response => {
      const data = await response.json();
      if (response.ok && data.wallet === wallet && current === generation.current && connectedAddress() === wallet) setStatus(data);
    }).catch(() => {});
    return () => { generation.current = current + 1; window.clearTimeout(reset); };
  }, [wallet]);

  async function run(task: (address: string) => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); onBusy(true); setMessage("");
    try {
      if (!await verify()) return;
      const active = connectedAddress();
      if (!active) throw new Error("Connect your Pump.fun wallet to continue.");
      await task(active);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request failed. Check your player receipt before retrying.");
      const active = connectedAddress();
      if (active) {
        try {
          const response = await fetch("/api/community-player", { cache: "no-store" });
          const data = await response.json();
          if (response.ok && data.wallet === active && connectedAddress() === active) setStatus(data);
        } catch { /* Keep the displayed receipt if the server is temporarily unavailable. */ }
      }
    } finally { inFlight.current = false; setBusy(false); onBusy(false); }
  }

  async function preview(active: string) {
    const result = await action<{ profile: CommunityProfile }>({ action: "preview" });
    requireWallet(active);
    if (result.profile.wallet !== active) throw new Error("Profile does not match the connected wallet. Reconnect and retry.");
    setProfile(result.profile);
  }

  async function burn(active: string) {
    if (profile?.wallet !== active) throw new Error("Preview your own player before burning PFL.");
    const quote = await action<Quote>({ action: "prepare" });
    requireWallet(active);
    if (quote.wallet !== active || quote.amount !== "500000") throw new Error("Burn quote does not match your player. Refresh the preview.");
    const signer = solanaClient.wallet.getState().connected?.signer;
    if (!signer || !isTransactionModifyingSigner(signer)) throw new Error("This wallet cannot sign the player burn. Use a wallet supporting transaction signing.");
    const transaction = getTransactionDecoder().decode(Uint8Array.from(atob(quote.prepared.transaction), byte => byte.charCodeAt(0)));
    const [signed] = await signer.modifyAndSignTransactions([transaction]);
    requireWallet(active);
    const wire = btoa(String.fromCharCode(...getTransactionEncoder().encode(signed)));
    const result = await action<Status>({ action: "submit", id: quote.id, wire });
    requireWallet(active);
    setStatus(result);
    setMessage("Burn submitted. Verify the receipt after finalization; do not burn again.");
  }

  async function confirm(active: string) {
    if (!status.pending) return;
    const result = await action<Status>({ action: "confirm", id: status.pending.id });
    requireWallet(active);
    setStatus(result);
    setMessage(result.message ?? (result.player ? "Your player is registered. One burn. Future seasons." : "Waiting for finalization. Keep this receipt and check again."));
  }

  return <section id="create-player" className="pfl-create-player" aria-labelledby="create-player-title">
    <div><span className="section-label">DEBUTING SEASON 2</span><h2 id="create-player-title">6th Man: Create a Player</h2><p>Stop watching. Get drafted.</p><p>Link your Pump.fun player with its Solana wallet. Burn 500,000 PFL once to join the community pool for future seasons. Squads choose five ranked traders and one 6th Man, with all six counting equally.</p><p>Each season’s community pool locks when drafting opens. Joining afterward makes you eligible for the next draft. Your player sits out the community pool in seasons where it is already in the ranked top 50.</p></div>
    <div className="pfl-player-card">
      {status.player ? <><h3>{status.player.display_name}</h3><p>Player registered · No further creation burn</p><a href={status.player.profile_url} target="_blank" rel="noreferrer">View Pump.fun profile ↗</a></> : <>
        <h3>Your game. Your name.</h3><p>Use the wallet linked to your Pump.fun account. We verify the profile and fresh PnL before preparing a burn.</p>
        {profile && <div className="pfl-player-preview"><strong>{profile.display_name}</strong><a href={profile.profile_url} target="_blank" rel="noreferrer">Linked Pump.fun profile ↗</a><span>Profile and PnL checked · {new Date(profile.observedAt).toLocaleString()}</span></div>}
        {status.pending?.signature ? <><p>Burn receipt: <a href={`https://solscan.io/tx/${status.pending.signature}`} target="_blank" rel="noreferrer">View transaction ↗</a></p><button type="button" disabled={busy} onClick={() => void run(confirm)}>Verify existing burn</button></> : <>
          <button type="button" disabled={busy} onClick={() => void run(preview)}>{busy ? "Checking…" : "Link my Pump.fun player"}</button>
          {profile && <><p>Creating your player permanently burns 500,000 PFL, plus a SOL network fee. This does not replace the separate 500,000 PFL holding requirement to submit a squad.</p><button type="button" disabled={busy} onClick={() => void run(burn)}>Burn 500,000 PFL · Create my player</button></>}
        </>}
      </>}
      {message && <p role="status">{message}</p>}
    </div>
  </section>;
}
