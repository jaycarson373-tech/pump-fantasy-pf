import "./relaunch.css";
import type { SeasonPhase } from "../lib/server/season-window";

const rankBands = ["01–10", "11–20", "21–30", "31–40", "41–50"];

type RelaunchPageProps = {
  phase: SeasonPhase | "unconfigured";
  opensAt: string | null;
};

export function RelaunchPage({ phase, opensAt }: RelaunchPageProps) {
  const scheduledDate = phase === "scheduled" && opensAt
    ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZoneName: "short" }).format(new Date(opensAt))
    : null;
  const title = phase === "scheduled"
    ? <>The next draft<br /><em>opens {scheduledDate ?? "soon"}.</em></>
    : phase === "misconfigured" || phase === "unconfigured"
      ? <>Draft room<br /><em>temporarily offline.</em></>
      : <>The next draft<br /><em>is being prepared.</em></>;
  const description = phase === "scheduled"
    ? "The season is scheduled. The draft room opens automatically at the time shown, and squad submissions close three hours later."
    : phase === "misconfigured" || phase === "unconfigured"
      ? "Season status is temporarily unavailable. Entries remain closed until the season schedule and backend are ready."
      : "The current draft is closed while the next season is prepared. Check back when the new draft window opens.";
  const stateLabel = phase === "scheduled" ? "DRAFT SCHEDULED" : phase === "misconfigured" || phase === "unconfigured" ? "STATUS UNAVAILABLE" : "DRAFT ROOM CLOSED";

  return (
    <main className="relaunch-page">
      <div className="relaunch-grid" aria-hidden="true" />
      <header className="relaunch-header">
        <a className="relaunch-wordmark" href="#home" aria-label="Pump.fun Fantasy League">
          <span className="relaunch-mark" aria-hidden="true"><i /><i /><b /></span>
          <span>PUMP.FUN <strong>FANTASY</strong></span>
        </a>
        <span className="relaunch-state"><i /> {stateLabel}</span>
      </header>

      <section className="relaunch-hero" id="home">
        <div className="relaunch-copy">
          <p className="relaunch-kicker">PUMPFUN FANTASY LEAGUE</p>
          <h1>{title}</h1>
          <p className="relaunch-description">
            {description}
          </p>
          <div className="relaunch-rule"><span /> FIVE PICKS. ONE LEADERBOARD. A FRESH START.</div>
        </div>

        <div className="relaunch-card" aria-label="Preview of the five leaderboard rank bands">
          <div className="relaunch-card-top"><span>THE DRAFT BOARD</span><span>01 / 05</span></div>
          <div className="relaunch-picks">
            {rankBands.map((band, index) => (
              <div className={`relaunch-pick pick-${index + 1}`} key={band}>
                <span className="pick-number">0{index + 1}</span>
                <span className="pick-band">{band}</span>
                <span className="pick-line" />
              </div>
            ))}
          </div>
          <div className="relaunch-card-foot"><span>TOP 50 TRADERS</span><span>YOUR FIVE. YOUR CALL.</span></div>
        </div>
      </section>

      <footer className="relaunch-footer">
        <span>FANTASY LEAGUE</span>
        <span>{phase === "scheduled" ? "YOUR FIVE. NEXT SEASON." : "FIVE PICKS. ONE LEADERBOARD."}</span>
      </footer>
    </main>
  );
}
