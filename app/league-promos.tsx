"use client";

import { useState } from "react";
import "./league-promos.css";

const PFL_MINT = "PFLnhH2Rn2kd2maipS8ueJVCojHsrnraPLn3HAQoB8W";

/** Projects26 public-token-identity: full-value copy, honest failure, selectable fallback. */
export function TokenIdentity() {
  const [feedback, setFeedback] = useState("");
  async function copy() {
    try { await navigator.clipboard.writeText(PFL_MINT); setFeedback("Copied"); }
    catch { setFeedback("Copy manually below"); }
  }
  return <div className="pfl-ca">
    <button type="button" onClick={() => void copy()} title={PFL_MINT} aria-label="Copy PFL contract address"><span>CA</span><code>PFLn…oB8W</code><span aria-hidden="true">⧉</span></button>
    <div className="pfl-ca-details"><code>{PFL_MINT}</code><a href={`https://solscan.io/token/${PFL_MINT}`} target="_blank" rel="noopener noreferrer">View token ↗</a><span role="status">{feedback}</span></div>
  </div>;
}

type Spot = { tone: string; label: string; headline: string; detail: string; href: string; action: string; numeral: string };
function PromoGroup({ spots, duplicate = false }: { spots: Spot[]; duplicate?: boolean }) {
  return <div className="pfl-promo-group" aria-hidden={duplicate || undefined} inert={duplicate || undefined}>
    {spots.map(spot => <article key={spot.tone} className={`pfl-promo-spot pfl-promo-${spot.tone}`}>
      <span className="pfl-promo-numeral" aria-hidden="true">{spot.numeral}</span>
      <div className="pfl-promo-copy"><span className="pfl-promo-label">{spot.label}</span><h2>{spot.headline}</h2><p>{spot.detail}</p></div>
      {duplicate ? <span className="pfl-promo-link">{spot.action} ↗</span> : <a className="pfl-promo-link" href={spot.href}>{spot.action} ↗</a>}
    </article>)}
  </div>;
}

/** Adapts the kit's moving-strip pause/inert/reduced-motion contract; host owns all clocks. */
export function LeaguePromos({ phase, countdown, seasonClock }: { phase: string; countdown: string; seasonClock: string }) {
  const [paused, setPaused] = useState(false);
  const spots: Spot[] = [
    { tone: "draft", label: "PFL DRAFT CENTRAL", headline: "THE PICK IS YOURS.", detail: `${phase} · ${countdown}`, href: "/draft", action: "Draft your seven", numeral: "07" },
    { tone: "player", label: "SEASON 2 EXCLUSIVE", headline: "6TH MAN: CREATE A PLAYER", detail: "Stop watching. Get drafted. · One 500K PFL burn", href: "/rules#sixth-man", action: "The scouting report", numeral: "06" },
    { tone: "season", label: "THE CHAMPIONSHIP CHASE", headline: "EVERY PLAY COUNTS.", detail: seasonClock, href: "/leaderboard", action: "Watch the standings", numeral: "PFL" },
  ];
  return <section className="pfl-promo-reel" data-paused={paused} aria-label="PFL broadcast promotions">
    <div className="pfl-promo-desk"><span><b>PFL</b> NETWORK <i /> AROUND THE LEAGUE</span><button type="button" aria-pressed={paused} onClick={() => setPaused(!paused)}>{paused ? "Play promos" : "Pause promos"}</button></div>
    <div className="pfl-promo-window"><div className="pfl-promo-track"><PromoGroup spots={spots} /><PromoGroup spots={spots} duplicate /></div></div>
  </section>;
}
