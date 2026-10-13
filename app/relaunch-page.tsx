import "./relaunch.css";

const rankBands = ["01—10", "11—20", "21—30", "31—40", "41—50"];

export function RelaunchPage() {
  return (
    <main className="relaunch-page">
      <div className="relaunch-grid" aria-hidden="true" />
      <header className="relaunch-header">
        <a className="relaunch-wordmark" href="#home" aria-label="Pump.fun Fantasy League">
          <span className="relaunch-mark" aria-hidden="true"><i /><i /><b /></span>
          <span>PUMP.FUN <strong>FANTASY</strong></span>
        </a>
        <span className="relaunch-state"><i /> DRAFT ROOM CLOSED</span>
      </header>

      <section className="relaunch-hero" id="home">
        <div className="relaunch-copy">
          <p className="relaunch-kicker">SEASON RESET · 2026</p>
          <h1>The next draft<br /><em>starts tomorrow.</em></h1>
          <p className="relaunch-description">
            We’re rebuilding the room for a better season. The current draft is closed while we get the new experience ready.
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
        <span>THE ROOM IS RESETTING. SEE YOU TOMORROW.</span>
      </footer>
    </main>
  );
}
