"use client";

import { useState } from "react";
import "./league-promos.css";

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
