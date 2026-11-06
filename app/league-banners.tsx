"use client";

import { useState } from "react";
import { leagueBannerState, type BannerSeason } from "../lib/league-banner-model";
import "./league-banners.css";

type BannerRow = { title: string; messages: string[]; href: string; action: string; tone: string };

function BannerContent({ row, duplicate = false }: { row: BannerRow; duplicate?: boolean }) {
  return <div className="pfl-banner-group" aria-hidden={duplicate || undefined} inert={duplicate || undefined}>
    <strong>{row.title}</strong>
    {row.messages.map(message => <span key={message}>{message}</span>)}
    {duplicate ? <span className="pfl-banner-action">{row.action}</span> : <a className="pfl-banner-action" href={row.href}>{row.action}</a>}
  </div>;
}

/** The host owns the authoritative season and server-adjusted clock. No local polling. */
export function LeagueBanners({ season, now }: { season: BannerSeason; now: number }) {
  const [paused, setPaused] = useState(false);
  const state = leagueBannerState(season, now);
  const rows: BannerRow[] = [
    { title: "ON THE CLOCK", messages: [state.draft], href: "#draft", action: "View the draft →", tone: "draft" },
    { title: "6TH MAN: CREATE A PLAYER", messages: ["Stop watching. Get drafted.", "Burn 500,000 PFL once", "Debuting Season 2"], href: "#create-player", action: "Meet the 6th Man →", tone: "player" },
    { title: "THE FINAL BUZZER", messages: [state.season], href: "#status", action: "Season status →", tone: "season" },
  ];
  return <section className="pfl-banners" data-paused={paused} aria-label="League announcements">
    <div className="pfl-banner-controls"><button type="button" aria-pressed={paused} onClick={() => setPaused(value => !value)}>{paused ? "Resume motion" : "Pause motion"}</button></div>
    {rows.map(row => <div key={row.tone} className={`pfl-banner-row pfl-banner-${row.tone}`}>
      <div className="pfl-banner-track"><BannerContent row={row} /><BannerContent row={row} duplicate /></div>
    </div>)}
  </section>;
}
