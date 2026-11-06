import Link from "next/link";
import type { Metadata } from "next";
import "../league-relaunch.css";
import "../launch-polish.css";

export const metadata: Metadata = {
  title: "League rules | Pump Fantasy",
  description: "Five picks, clear scoring and creator-funded rewards. The Pump Fantasy season format.",
};

export default function Rules() {
  return (
    <main className="app-shell draft-room rules-shell">
      <header className="topbar">
        <Link className="pf-brand" href="/" aria-label="Pump Fantasy home"><span className="pf-mark-image" role="img" aria-label="Pump Fantasy logo" /><strong>PumpFun Fantasy</strong><em>LEAGUE</em></Link>
        <nav aria-label="Primary"><Link href="/#draft">Draft room</Link><Link href="/budget-draft">Draft lab</Link><Link href="/rules" className="active" aria-current="page">Rules</Link><Link href="/#status">Season status</Link></nav>
        <Link className="rules-draft-link" href="/#draft">Pick your squad <span aria-hidden="true">↗</span></Link>
      </header>
      <div className="league-rules-wrap">
        <section className="league-rules-hero">
          <span className="season-tag">Season 1</span>
          <h1>Know the format.<br /><span>Make your picks.</span></h1>
          <p>Pick five traders. Follow their PnL. Compete for the league’s creator-funded rewards.</p>
          <div className="rules-quick-facts"><div><strong>500K</strong><span>FANTASY to enter</span></div><div><strong>5 picks</strong><span>One from each rank band</span></div><div><strong>48 hours</strong><span>Season 1 scoring window</span></div></div>
        </section>
        <div className="league-rules-layout">
          <aside className="rules-contents" aria-label="On this page"><span>THE RULEBOOK</span><a href="#entry">01 / Enter the league</a><a href="#scoring">02 / How scoring works</a><a href="#rewards">03 / The reward pools</a><a href="#seasons">04 / Season schedule</a><a href="#practice">05 / Practice first</a></aside>
          <div className="rules-chapters">
            <section id="entry"><span className="rules-chapter-number">01</span><h2>Build your five.</h2><p>Hold at least <strong>500,000 FANTASY</strong> in your connected wallet. Sign in with a wallet message, then submit one lineup. Signing in does not transfer tokens.</p><div className="rules-bands" aria-label="Pick one trader per rank band">{["1–10", "11–20", "21–30", "31–40", "41–50"].map(band => <span key={band}>{band}</span>)}</div><p>Pick one trader from each band. The top-50 field is fixed when the season opens. Submit before the draft closes; edits count only after you resubmit and receive confirmation.</p></section>
            <section id="scoring"><span className="rules-chapter-number">02</span><h2>Score the change.</h2><p>Your score adds up the change in one-month PnL for your five traders between the scoring snapshots. The historical PnL on a trader’s card is their starting reference, not your contest score.</p><div className="rules-formula">Closing PnL <span>−</span> Opening PnL <span>=</span> Points</div><p>Daily windows use their own baseline. Ties are resolved by wallet address in ascending order. Incomplete snapshots hold the result for review.</p></section>
            <section id="rewards"><span className="rules-chapter-number">03</span><h2>Three reward pools.</h2><p>Creator fees fund the league. Here’s the new allocation:</p><div className="rules-pools"><div><strong>30%</strong><span>Daily payouts</span></div><div><strong>50%</strong><span>Season leaderboard</span></div><div><strong>20%</strong><span>Championship bonus</span></div></div><p className="rules-small-note">Payout activation and event rules are being finalized. Existing receipts and payout records retain their original allocations.</p><p>Only confirmed fees fund rewards. Daily pools freeze at their cutoff; later receipts enter the next pool. No eligible entries means the daily allocation carries forward. Completed payouts link to a verified Solana transaction.</p></section>
            <section id="seasons"><span className="rules-chapter-number">04</span><h2>Season 1 starts here.</h2><p>The first season has a <strong>60-minute draft</strong> followed by <strong>48 hours of scoring</strong>, with daily results at the 24-hour marks.</p><p>Later seasons may vary in length and format. Each season’s schedule and rules will be shown before entries open. Use the live season clock in the draft room for the current deadline.</p><Link className="rules-inline-link" href="/#status">View season status <span aria-hidden="true">↗</span></Link></section>
            <section id="practice"><span className="rules-chapter-number">05</span><h2>Try your lineup first.</h2><p>The 100-credit Draft Lab lets you build a practice lineup. Picks stay in your browser; practice does not spend tokens, enter a contest or pay prizes.</p><Link className="rules-inline-link" href="/budget-draft">Open Draft Lab <span aria-hidden="true">↗</span></Link></section>
          </div>
        </div>
        <div className="rules-finish"><div><span className="section-label">READY TO PICK?</span><h2>Five traders. Your squad.</h2></div><Link className="primary-cta" href="/#draft">Go to the draft room</Link></div>
        <p className="rules-fineprint">Entry availability follows the published season status. Pump Fantasy is independent of Pump.fun. External PnL data can be delayed or revised; rewards are not guaranteed.</p>
      </div>
    </main>
  );
}
